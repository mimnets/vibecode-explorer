import * as path from 'path';
import * as vscode from 'vscode';
import { redactSecrets } from '../analysis/agentLogs';
import { MAX_TREE_FILES, TREE_EXCLUDE_GLOB } from '../analysis/fileTree';
import { findTodos, Hotspot, hotspots, howToRun, npmPackages, PackageInfo, packageOf, pipPackages, readingOrder, ReadingStep, readmeCommands, RunStep, testMap } from '../analysis/learn';
import { isSensitiveFile } from '../analysis/sensitive';
import { commitHeadline } from '../git/history';
import { getCommitFiles, getHistory } from '../git/gitChanges';
import { CodeLocation, DashboardState, Target } from './state';

// Phase 11: the Learn tab. Reading order, test map, TODO list, packages, how to run and
// hotspots. Read-only: file names, the import graph, small config files, comments and Git
// history. Nothing is run, installed or changed.

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 1500;
const MAX_TODOS = 300;
const HOTSPOT_COMMITS = 100;
const TODO_EXT = /\.(?:[cm]?[jt]sx?|py|vue|svelte|css|scss|html?|md|sh|ps1|rb|go|java|kt|cs|php|rs|swift|ya?ml|toml)$/i;

type WithNode<T> = T & { node?: string };
export type LearnResult =
  | { state: 'restricted' | 'none' }
  | {
    state: 'ok';
    reading: WithNode<ReadingStep>[];
    tests: { tested: WithNode<{ file: string; tests: string[] }>[]; untested: WithNode<{ file: string }>[]; testFiles: WithNode<{ file: string }>[] };
    todos: { id: string; file: string; line: number; tag: string; text: string }[];
    todosTruncated: boolean;
    packages: (PackageInfo & { description?: string; license?: string; installed?: boolean })[];
    run: RunStep[];
    readme: string[];
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

export async function loadLearn(folder: vscode.WorkspaceFolder, state: DashboardState, targets: ReadonlyMap<string, Target>): Promise<{ result: LearnResult; locations: Map<string, CodeLocation> }> {
  const locations = new Map<string, CodeLocation>();
  if (!vscode.workspace.isTrusted) return { result: { state: 'restricted' }, locations };
  const uriOf = (rel: string): vscode.Uri => vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
  const fileNodes = state.graph.nodes.filter((n) => n.kind === 'file');
  const nodeOf = new Map(fileNodes.map((n) => [n.path, n.id]));
  const pathOf = new Map(fileNodes.map((n) => [n.id, n.path]));
  const edges = state.graph.edges.filter((e) => pathOf.has(e.source) && pathOf.has(e.target))
    .map((e): [string, string] => [pathOf.get(e.source) as string, pathOf.get(e.target) as string]);
  const graphFiles = [...nodeOf.keys()];
  const withNode = <T extends { file: string }>(x: T): WithNode<T> => ({ ...x, node: nodeOf.get(x.file) });

  const files = (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), TREE_EXCLUDE_GLOB, MAX_TREE_FILES))
    .map((u) => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/')).filter((f) => f && !f.startsWith('..')).sort();
  let pkg: Record<string, unknown> | undefined;
  try {
    const text = files.includes('package.json') ? await readText(uriOf('package.json')) : undefined;
    pkg = text ? JSON.parse(text) : undefined;
  } catch {
    pkg = undefined;
  }

  // Reading order, from the entry points named in package.json and the graph.
  const entries = new Set<string>();
  for (const key of ['main', 'module', 'browser']) {
    const v = pkg?.[key];
    if (typeof v !== 'string') continue;
    const rel = path.posix.normalize(v.replace(/^\.\//, ''));
    // `main` often names the built file (out/x.js); the source with the same name counts too.
    const stem = rel.replace(/\.[^.]+$/, '').split('/').pop();
    for (const f of graphFiles) if (f === rel || f.replace(/\.[^.]+$/, '').endsWith('/' + stem) && /(^|\/)src\//.test(f)) entries.add(f);
  }
  for (const f of graphFiles) if (/^(main|app|manage|index|server)\.(py|[jt]sx?)$/.test(f)) entries.add(f);
  const reading = readingOrder(graphFiles, edges, entries).map(withNode);

  // Test map.
  const map = testMap(graphFiles, edges);

  // TODO list: comments only, with secret-looking text hidden. Sensitive files are never opened.
  const todos: { id: string; file: string; line: number; tag: string; text: string }[] = [];
  let todosTruncated = false;
  for (const f of files.filter((x) => TODO_EXT.test(x) && !isSensitiveFile(x)).slice(0, MAX_SCAN_FILES)) {
    if (todos.length >= MAX_TODOS) { todosTruncated = true; break; }
    const text = await readText(uriOf(f));
    if (!text || !/TODO|FIXME|HACK|XXX|BUG/.test(text)) continue;
    for (const hit of findTodos(text)) {
      const id = `l${todos.length}`;
      const shown = redactSecrets(hit.text);
      locations.set(id, { uri: uriOf(f), relPath: f, position: new vscode.Position(hit.line - 1, 0), name: shown });
      todos.push({ id, file: f, line: hit.line, tag: hit.tag, text: shown });
    }
  }

  // Packages: what the code imports, plus the package's own description and license.
  const imported = new Set<string>();
  for (const [id, t] of targets) {
    if (!id.startsWith('f')) continue;
    for (const imp of t.analysis?.imports ?? []) {
      if (imp.kind !== 'external') continue;
      // Python imports name modules (`flask.json`), JS/TS imports name packages (`@scope/pkg/x`).
      const name = t.relPath.endsWith('.py') ? imp.specifier.split('.')[0].toLowerCase() : packageOf(imp.specifier);
      if (name) imported.add(name);
    }
  }
  const requirements = files.includes('requirements.txt') ? await readText(uriOf('requirements.txt')) : undefined;
  const packages: (PackageInfo & { description?: string; license?: string; installed?: boolean })[] = [];
  for (const p of [...npmPackages(pkg, imported), ...pipPackages(requirements, imported)].slice(0, 200)) {
    if (p.ecosystem !== 'npm') { packages.push(p); continue; }
    // Read-only: the installed package's own package.json (one small file per package).
    const text = await readText(vscode.Uri.joinPath(folder.uri, 'node_modules', ...p.name.split('/'), 'package.json'));
    let info: { description?: unknown; license?: unknown };
    try {
      info = text ? JSON.parse(text) : {};
    } catch {
      info = {};
    }
    packages.push({
      ...p,
      installed: text !== undefined,
      description: typeof info.description === 'string' ? redactSecrets(info.description).slice(0, 200) : undefined,
      license: typeof info.license === 'string' ? info.license.slice(0, 60) : undefined,
    });
  }

  const readme = files.find((f) => /^readme(\.md)?$/i.test(f));
  return {
    result: {
      state: 'ok',
      reading,
      tests: { tested: map.tested.map(withNode), untested: map.untested.map((file) => withNode({ file })), testFiles: map.tests.map((file) => withNode({ file })) },
      todos,
      todosTruncated,
      packages,
      run: howToRun(files, pkg),
      readme: readmeCommands(readme ? await readText(uriOf(readme)) : undefined).map(redactSecrets),
    },
    locations,
  };
}

/** Files changed most often in the latest commits. Read-only, through VS Code's Git. */
export async function loadHotspots(folder: vscode.WorkspaceFolder): Promise<{ state: 'ok' | 'noGit' | 'restricted'; commits: number; hotspots: Hotspot[] }> {
  if (!vscode.workspace.isTrusted) return { state: 'restricted', commits: 0, hotspots: [] };
  const history = await getHistory(folder, HOTSPOT_COMMITS);
  if (history.kind !== 'ok') return { state: 'noGit', commits: 0, hotspots: [] };
  const commits: { headline: string; files: string[] }[] = [];
  for (const c of history.commits) {
    try {
      const files = await getCommitFiles(folder, c);
      if (files) commits.push({ headline: commitHeadline(c.message), files: files.map((f) => f.relPath).filter((f) => !f.startsWith('..')) });
    } catch {
      // A commit that can't be compared is skipped.
    }
  }
  return { state: 'ok', commits: commits.length, hotspots: hotspots(commits) };
}
