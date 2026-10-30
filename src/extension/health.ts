import * as path from 'path';
import * as vscode from 'vscode';
import { redactSecrets } from '../analysis/agentLogs';
import { MAX_TREE_FILES, TREE_EXCLUDE_GLOB } from '../analysis/fileTree';
import { explainProblem, goBackSteps, HealthCheck, healthChecklist, nearDuplicates, possiblyUnused, SafePoint, safePoints } from '../analysis/health';
import { commitHeadline } from '../git/history';
import { parseFolderRules, ruleViolations } from '../analysis/learn';
import { findSecrets } from '../analysis/secrets';
import { isSensitiveFile } from '../analysis/sensitive';
import { getHistory, getTags, ignoredByGit } from '../git/gitChanges';
import { loadSessions, sessionsAllowed } from './agentSessions';
import { listNotes } from './notes';
import { CodeLocation, DashboardState, Target } from './state';

/** The owner's folder rules (Phase 11), one rule per line. */
export const RULES_FILE = '.vibecode/rules.md';

// Phase 9: the Health tab. Problems VS Code already knows about, a project checklist,
// secret-looking text (location only, never the value), possibly unused and near-duplicate
// files, and safe points to go back to. Read-only: nothing is run, fixed or checked out.

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 1500;
const MAX_PROBLEMS = 500;
const MAX_PER_FILE = 20;
const MAX_SECRETS = 300;
/** Text files scanned for secret-looking values (sensitive names are never opened). */
const SCAN_EXT = /\.(?:[cm]?[jt]sx?|py|json|ya?ml|toml|ini|cfg|conf|properties|xml|env\.example|sh|ps1|rb|go|java|kt|cs|php|rs|swift|txt|md)$/i;
const LOCK_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Pipfile\.lock)$/i;
/** Example env files are meant to be committed. */
const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?$/i;

export interface ProblemItem { id: string; line: number; severity: 'error' | 'warning'; message: string; plain: string; source?: string }
export interface ProblemFile { file: string; node?: string; errors: number; warnings: number; items: ProblemItem[] }
export type HealthResult =
  | { state: 'restricted' | 'none' }
  | {
    state: 'ok';
    checklist: HealthCheck[];
    problems: { files: ProblemFile[]; truncated: boolean };
    secrets: { id: string; file: string; line: number; kind: string }[];
    secretsTruncated: boolean;
    unused: { file: string; node?: string }[];
    duplicates: { files: string[]; nodes: string[] }[];
    safePoints: (SafePoint & { steps: { text: string; command?: string }[] })[];
    safeSources: { git: boolean; sessionsAllowed: boolean };
    rules: { file: string; exists: boolean; id?: string; rules: { text: string; id: string; violations: { id: string; file: string; imports: string; node?: string }[] }[] };
  };

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_FILE_BYTES) return undefined;
    const bytes = await vscode.workspace.fs.readFile(uri);
    return bytes.subarray(0, 8000).includes(0) ? undefined : new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export async function loadHealth(
  folder: vscode.WorkspaceFolder, state: DashboardState, memento: vscode.Memento, targets: ReadonlyMap<string, Target> = new Map(),
): Promise<{ result: HealthResult; locations: Map<string, CodeLocation>; secretIds: Set<string> }> {
  const locations = new Map<string, CodeLocation>();
  const secretIds = new Set<string>();
  if (!vscode.workspace.isTrusted) return { result: { state: 'restricted' }, locations, secretIds };
  const uriOf = (rel: string): vscode.Uri => vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
  const toRel = (u: vscode.Uri): string => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/');
  const nodeOf = new Map(state.graph.nodes.filter((n) => n.kind === 'file').map((n) => [n.path, n.id]));
  let nextId = 0;
  const locate = (rel: string, line: number, name: string): string => {
    const id = `y${nextId++}`;
    locations.set(id, { uri: uriOf(rel), relPath: rel, position: new vscode.Position(Math.max(0, line - 1), 0), name });
    return id;
  };

  // 1. Problems VS Code already reported (no extra checking is started).
  const problemFiles: ProblemFile[] = [];
  let problemCount = 0;
  let problemsTruncated = false;
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') continue;
    const rel = toRel(uri);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || isSensitiveFile(rel)) continue;
    const relevant = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning);
    if (!relevant.length) continue;
    const entry: ProblemFile = { file: rel, node: nodeOf.get(rel), errors: 0, warnings: 0, items: [] };
    for (const d of relevant.sort((a, b) => a.range.start.line - b.range.start.line)) {
      const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
      if (severity === 'error') entry.errors++; else entry.warnings++;
      if (entry.items.length >= MAX_PER_FILE || problemCount >= MAX_PROBLEMS) { problemsTruncated = true; continue; }
      problemCount++;
      const message = redactSecrets(d.message).slice(0, 300);
      entry.items.push({ id: locate(rel, d.range.start.line + 1, message), line: d.range.start.line + 1, severity, message, plain: explainProblem(d.message, severity), source: d.source });
    }
    problemFiles.push(entry);
  }
  problemFiles.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || (a.file < b.file ? -1 : 1));

  // 2. Checklist: file names, plus .gitignore, package.json and pyproject.toml at the root.
  const files = (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), TREE_EXCLUDE_GLOB, MAX_TREE_FILES))
    .map(toRel).filter((f) => f && !f.startsWith('..')).sort();
  const rootText = async (name: string): Promise<string | undefined> => (files.includes(name) ? readText(uriOf(name)) : undefined);
  const gitignore = await rootText('.gitignore');
  let packageJson: Record<string, unknown> | undefined;
  try {
    const text = await rootText('package.json');
    packageJson = text ? JSON.parse(text) : undefined;
  } catch {
    packageJson = {};
  }
  const pyproject = await rootText('pyproject.toml');
  const envFiles = files.filter((f) => ENV_FILE.test(f));
  const ignored = await ignoredByGit(folder, envFiles);
  const envIgnored = ignored && new Map(envFiles.map((f) => [f, ignored.has(f)]));
  const checklist = healthChecklist({ files, gitignore, packageJson, pyproject, envIgnored });

  // 3. Secret-looking text: the line and kind only. Files with sensitive names are never opened.
  const secrets: { id: string; file: string; line: number; kind: string }[] = [];
  let secretsTruncated = false;
  const scan = files.filter((f) => SCAN_EXT.test(f) && !isSensitiveFile(f) && !LOCK_FILE.test(f)).slice(0, MAX_SCAN_FILES);
  for (const f of scan) {
    if (secrets.length >= MAX_SECRETS) { secretsTruncated = true; break; }
    const text = await readText(uriOf(f));
    if (!text) continue;
    for (const hit of findSecrets(text)) {
      const id = locate(f, hit.line, hit.kind);
      secretIds.add(id);
      secrets.push({ id, file: f, line: hit.line, kind: hit.kind });
    }
  }

  // 4. Possibly unused graph files, and near-duplicate names.
  const graphFiles = [...nodeOf.keys()];
  const importers = new Map<string, number>();
  for (const e of state.graph.edges) importers.set(e.target, (importers.get(e.target) ?? 0) + 1);
  const entryFiles = new Set<string>();
  for (const key of ['main', 'module', 'browser']) {
    const v = packageJson?.[key];
    if (typeof v === 'string') entryFiles.add(path.posix.normalize(v.replace(/^\.\//, '')));
  }
  const bin = packageJson?.bin;
  for (const v of typeof bin === 'string' ? [bin] : bin && typeof bin === 'object' ? Object.values(bin) : []) {
    if (typeof v === 'string') entryFiles.add(path.posix.normalize(v.replace(/^\.\//, '')));
  }
  const unused = possiblyUnused(graphFiles, (f) => importers.get(nodeOf.get(f) as string) ?? 0, entryFiles).map((file) => ({ file, node: nodeOf.get(file) }));
  const duplicates = nearDuplicates(files).map((g) => ({ files: g, nodes: g.map((f) => nodeOf.get(f)).filter((x): x is string => !!x) }));

  // 5. Safe points: tags, the commit before each AI session (only if already allowed), marked commits.
  const history = await getHistory(folder, 200);
  const commits = history.kind === 'ok' ? history.commits.map((c) => ({ hash: c.hash, date: c.date, headline: commitHeadline(c.message) })) : [];
  const tags = history.kind === 'ok' ? await getTags(folder) : [];
  const allowed = sessionsAllowed(memento, folder);
  let starts: Date[] = [];
  if (allowed && commits.length) {
    try {
      const { result } = await loadSessions(memento, folder);
      if (result.state === 'ok') starts = result.sessions.map((s) => new Date(s.start)).filter((d) => !Number.isNaN(d.getTime()));
    } catch {
      starts = [];
    }
  }
  const marked = (await listNotes(folder)).filter((n) => n.safe && n.commit).map((n) => n.commit as string);
  const branch = state.git.kind === 'ok' ? state.git.branch : 'main';
  const points = safePoints(commits, tags, starts, marked).map((p) => ({ ...p, steps: goBackSteps(p.short, branch) }));

  // 6. Folder rules (Phase 11): imports that break the owner's rules in .vibecode/rules.md.
  const rulesText = await readText(uriOf(RULES_FILE));
  const parsed = rulesText ? parseFolderRules(rulesText) : [];
  const graphImports = [...targets].filter(([id, t]) => id.startsWith('f') && t.analysis).map(([, t]) => ({ path: t.relPath, imports: t.analysis?.imports ?? [] }));
  const broken = ruleViolations(parsed, graphImports);
  const rules = {
    file: RULES_FILE,
    exists: rulesText !== undefined,
    id: rulesText !== undefined ? locate(RULES_FILE, 1, RULES_FILE) : undefined,
    rules: parsed.map((r, i) => ({
      text: r.text,
      id: locate(RULES_FILE, r.line, r.text),
      violations: broken.filter((v) => v.rule === i).slice(0, 100)
        .map((v) => ({ id: locate(v.file, 1, v.file), file: v.file, imports: v.imports, node: nodeOf.get(v.file) })),
    })),
  };

  return {
    result: {
      state: 'ok',
      checklist,
      problems: { files: problemFiles, truncated: problemsTruncated },
      secrets,
      secretsTruncated,
      unused,
      duplicates,
      safePoints: points,
      safeSources: { git: history.kind === 'ok', sessionsAllowed: allowed },
      rules,
    },
    locations,
    secretIds,
  };
}
