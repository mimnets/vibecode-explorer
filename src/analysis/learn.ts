// Phase 11: learning aids. Pure (no `vscode` import), unit-testable. Everything is worked
// out from the import graph, file names, a few small config files and Git history.
// Nothing is run: commands are only shown, for the owner to copy.
import { isTestFile, isTestFor } from './explain';

// ---- Reading order ----

export interface ReadingStep { file: string; depth: number; reason: string }

/**
 * A suggested order to read the code: start files first (files that nothing imports but that
 * import others, and entry points), then what they use, level by level, down to the leaves.
 * Test files are left out; files not reached from a start file come last.
 */
export function readingOrder(files: readonly string[], edges: readonly [string, string][], entries: ReadonlySet<string> = new Set()): ReadingStep[] {
  const code = files.filter((f) => !isTestFile(f) && !/(^|\/)(tests?|__tests__)\//.test(f));
  const codeSet = new Set(code);
  const out = new Map<string, string[]>();
  const importedBy = new Map<string, number>();
  for (const [a, b] of edges) {
    if (!codeSet.has(a) || !codeSet.has(b) || a === b) continue;
    out.set(a, [...(out.get(a) ?? []), b]);
    importedBy.set(b, (importedBy.get(b) ?? 0) + 1);
  }
  const starts = code.filter((f) => entries.has(f) || (!importedBy.get(f) && (out.get(f)?.length ?? 0) > 0))
    .sort((a, b) => Number(entries.has(b)) - Number(entries.has(a)) || (out.get(b)?.length ?? 0) - (out.get(a)?.length ?? 0) || a.localeCompare(b));
  const steps: ReadingStep[] = [];
  const seen = new Set<string>();
  let level = starts.map((f) => ({ file: f, from: '' }));
  for (let depth = 0; level.length; depth++) {
    const next: { file: string; from: string }[] = [];
    for (const { file, from } of level) {
      if (seen.has(file)) continue;
      seen.add(file);
      const name = (p: string): string => p.split('/').pop() as string;
      steps.push({
        file, depth,
        reason: depth === 0 ? (entries.has(file) ? 'start here: the entry point' : 'start here: nothing else imports it')
          : !out.get(file)?.length ? `used by ${name(from)}; uses no other project file` : `used by ${name(from)}`,
      });
      for (const t of [...(out.get(file) ?? [])].sort()) if (!seen.has(t)) next.push({ file: t, from: file });
    }
    level = next;
  }
  for (const f of [...code].sort()) if (!seen.has(f)) steps.push({ file: f, depth: -1, reason: 'not connected to the others' });
  return steps;
}

// ---- Test map ----

export interface TestMap { tested: { file: string; tests: string[] }[]; untested: string[]; tests: string[] }

/** Which code files have a test: a test file imports them, or is named after them. */
export function testMap(files: readonly string[], edges: readonly [string, string][]): TestMap {
  const tests = files.filter((f) => isTestFile(f) || /(^|\/)(tests?|__tests__)\//.test(f));
  const testSet = new Set(tests);
  const code = files.filter((f) => !testSet.has(f));
  const byFile = new Map<string, Set<string>>(code.map((f) => [f, new Set<string>()]));
  for (const [a, b] of edges) if (testSet.has(a) && byFile.has(b)) byFile.get(b)?.add(a);
  // By name only within one language: util_test.py tests util.py, not util.ts.
  const py = (x: string): boolean => x.endsWith('.py');
  for (const f of code) for (const t of tests) if (py(f) === py(t) && isTestFor(f, t)) byFile.get(f)?.add(t);
  const tested = code.filter((f) => byFile.get(f)?.size).map((f) => ({ file: f, tests: [...(byFile.get(f) ?? [])].sort() }));
  return { tested, untested: code.filter((f) => !byFile.get(f)?.size), tests: [...tests].sort() };
}

// ---- TODO list ----

export interface TodoHit { line: number; tag: string; text: string }

const TODO = /(?:\/\/|#|\/\*|^\s*\*|<!--|--|;)\s*@?(TODO|FIXME|HACK|XXX|BUG)\b[\s:(\-–]*(.*)$/;

/** TODO/FIXME-style comments, one per line, with their text (shortened). */
export function findTodos(text: string): TodoHit[] {
  const hits: TodoHit[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const m = TODO.exec(l);
    if (!m) return;
    const rest = m[2].replace(/\*\/\s*$|-->\s*$/, '').replace(/^\)?[:\s-]*/, '').trim();
    hits.push({ line: i + 1, tag: m[1], text: rest.length > 160 ? rest.slice(0, 157) + '…' : rest });
  });
  return hits;
}

// ---- Commit message check ----

const CC_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

/** A hint when a commit's first line doesn't follow Conventional Commits; undefined when it does. */
export function commitMessageHint(headline: string): string | undefined {
  const h = headline.trim();
  if (!h || /^(Merge|Revert ")/.test(h)) return undefined;
  const m = /^([A-Za-z]+)(\([^)]*\))?(!)?(:)?(\s*)(.*)$/.exec(h);
  if (!m || !m[4]) return 'Start with a type and a colon, like "fix: …" or "feat: …", so the history says what kind of change each commit is.';
  if (!CC_TYPES.includes(m[1].toLowerCase())) return `"${m[1]}" isn't a usual type. Use one of: ${CC_TYPES.join(', ')}.`;
  if (m[1] !== m[1].toLowerCase()) return `Write the type in lower case: "${m[1].toLowerCase()}:".`;
  if (!m[5]) return 'Put a space after the colon.';
  if (!m[6]) return 'Say what changed after the colon.';
  if (h.length > 72) return 'Keep the first line under 72 characters; put the details in the lines below.';
  return undefined;
}

// ---- Packages ----

export interface PackageInfo { name: string; version: string; dev: boolean; ecosystem: 'npm' | 'pip'; used: 'imported' | 'types' | 'scripts' | 'not found' }

/** The package an import specifier comes from (`@scope/pkg/x` → `@scope/pkg`); undefined for built-ins. */
export function packageOf(spec: string): string | undefined {
  if (spec.startsWith('node:')) return undefined;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** npm packages from package.json, and whether the code imports them or a script names them. */
export function npmPackages(pkg: Record<string, unknown> | undefined, imported: ReadonlySet<string>): PackageInfo[] {
  if (!pkg) return [];
  const scripts = Object.values(pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {}).map(String);
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** A script runs the package's command (`eslint src`), or names the package (`node -r ts-node/register`). */
  const inScripts = (name: string): boolean => {
    const bin = name.split('/').pop() as string;
    const words = [esc(name), ...(bin.length >= 3 ? [esc(bin)] : [])].join('|');
    const re = new RegExp(`(^|[\\s;&|(=])(npx\\s+)?(${words})(?=$|[\\s/;&|)])`);
    return scripts.some((cmd) => re.test(cmd));
  };
  const list: PackageInfo[] = [];
  for (const [key, dev] of [['dependencies', false], ['devDependencies', true], ['optionalDependencies', false], ['peerDependencies', false]] as const) {
    const deps = pkg[key];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
      if (list.some((p) => p.name === name)) continue;
      const typesFor = name.startsWith('@types/') ? name.slice(7).replace(/^(.+)__(.+)$/, '@$1/$2') : undefined;
      const used = imported.has(name) ? 'imported'
        : typesFor && (imported.has(typesFor) || typesFor === 'node' || typesFor === 'vscode') ? 'types'
          : inScripts(name) ? 'scripts' : 'not found';
      list.push({ name, version: String(version), dev, ecosystem: 'npm', used });
    }
  }
  return list.sort((a, b) => Number(a.dev) - Number(b.dev) || a.name.localeCompare(b.name));
}

/** Python packages from requirements.txt lines, and whether a Python file imports them. */
export function pipPackages(requirements: string | undefined, imported: ReadonlySet<string>): PackageInfo[] {
  if (!requirements) return [];
  const list: PackageInfo[] = [];
  for (const raw of requirements.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (!m || line.startsWith('-')) continue;
    const module = m[1].toLowerCase().replace(/-/g, '_');
    const used = imported.has(module) || imported.has(m[1].toLowerCase()) ? 'imported' : 'not found';
    list.push({ name: m[1], version: m[3].trim() || 'any', dev: false, ecosystem: 'pip', used });
  }
  return list;
}

// ---- How to run ----

export interface RunStep { text: string; command?: string }

const SCRIPT_TEXT: Record<string, string> = {
  dev: 'Start the app while you work on it (usually reloads on save)',
  start: 'Start the app',
  serve: 'Serve the app locally',
  build: 'Build the app for release',
  compile: 'Turn the source code into runnable code',
  watch: 'Rebuild automatically while you edit',
  test: 'Run the tests',
  lint: 'Check the code for mistakes and style problems',
  format: 'Tidy the code\'s formatting',
  typecheck: 'Check the types without building',
  preview: 'Preview the built app',
  package: 'Package the app into a file to install',
};
const SCRIPT_ORDER = ['dev', 'start', 'serve', 'watch', 'build', 'compile', 'preview', 'test', 'lint', 'typecheck', 'format', 'package'];

/** The usual commands for this project, from package.json scripts and Python files. Shown only. */
export function howToRun(files: readonly string[], pkg: Record<string, unknown> | undefined): RunStep[] {
  const has = (f: string): boolean => files.includes(f);
  const steps: RunStep[] = [];
  if (pkg) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') ? 'bun' : 'npm';
    steps.push({ text: 'Install the packages (once, and after pulling changes)', command: pm === 'npm' && has('package-lock.json') ? 'npm ci' : `${pm} install` });
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts as object) : [];
    // `prebuild`/`postbuild` run by themselves around `build`, so they are not listed.
    const ordered = scripts.filter((s) => !/^(pre|post)/.test(s) || !scripts.includes(s.replace(/^(pre|post)/, '')))
      .sort((a, b) => {
        const ia = SCRIPT_ORDER.indexOf(a.split(/[:-]/)[0]);
        const ib = SCRIPT_ORDER.indexOf(b.split(/[:-]/)[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      });
    for (const s of ordered.slice(0, 12)) {
      const command = pm === 'npm' ? (s === 'start' || s === 'test' ? `npm ${s}` : `npm run ${s}`) : `${pm} ${s}`;
      const base = s.split(/[:-]/)[0];
      const text = SCRIPT_TEXT[s] ?? (SCRIPT_TEXT[base] ? `${SCRIPT_TEXT[base]} (${s.slice(base.length + 1)})` : `Run the "${s}" script`);
      steps.push({ text, command });
    }
  }
  if (has('requirements.txt')) steps.push({ text: 'Install the Python packages', command: 'pip install -r requirements.txt' });
  else if (has('pyproject.toml')) steps.push({ text: 'Install the Python project and its packages', command: 'pip install -e .' });
  if (has('manage.py')) steps.push({ text: 'Start the Django app', command: 'python manage.py runserver' });
  for (const f of ['main.py', 'app.py']) if (has(f)) steps.push({ text: `Run ${f}`, command: `python ${f}` });
  return steps;
}

const RUN_HEADING = /^#{1,4}\s+.*\b(install|installation|getting started|setup|set up|usage|run|running|quick ?start|development|build|develop)\b/i;

/** Command lines from code blocks in the README's install/run sections (at most 12). */
export function readmeCommands(readme: string | undefined): string[] {
  if (!readme) return [];
  const out: string[] = [];
  let inSection = false;
  let level = 0;
  let inCode = false;
  for (const line of readme.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode) {
      const cmd = line.replace(/^\s*[$>]\s+/, '').trim();
      if (inSection && cmd && !cmd.startsWith('#') && cmd.length <= 160) out.push(cmd);
      if (out.length >= 12) break;
      continue;
    }
    const h = /^(#{1,6})\s/.exec(line);
    if (h) {
      if (RUN_HEADING.test(line)) { inSection = true; level = h[1].length; }
      else if (h[1].length <= level) inSection = false;
    }
  }
  return out;
}

// ---- Hotspots ----

export interface Hotspot { file: string; changes: number; fixes: number }

/** Files changed most often, counting changes in `fix` commits separately. */
export function hotspots(commits: readonly { headline: string; files: readonly string[] }[], max = 15): Hotspot[] {
  const counts = new Map<string, Hotspot>();
  for (const c of commits) {
    const fix = /^(fix|bugfix|hotfix)\b|\b(fix(es|ed)?|bug)\b/i.test(c.headline);
    for (const f of new Set(c.files)) {
      const h = counts.get(f) ?? { file: f, changes: 0, fixes: 0 };
      h.changes++;
      if (fix) h.fixes++;
      counts.set(f, h);
    }
  }
  return [...counts.values()].filter((h) => h.changes > 1)
    .sort((a, b) => b.changes - a.changes || b.fixes - a.fixes || a.file.localeCompare(b.file)).slice(0, max);
}

// ---- Folder rules ----

export interface FolderRule { line: number; from: string; to: string; text: string }
export interface RuleViolation { rule: number; file: string; imports: string }

/** Folder rules written as "`src/analysis/` must not import `vscode`", one per line. */
export function parseFolderRules(md: string): FolderRule[] {
  const rules: FolderRule[] = [];
  md.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:[-*]\s+|\d+\.\s+)?`?([^`\s]+?)\/?`?\s+(?:must not|mustn't|should not|shouldn't|may not|cannot|can't)\s+(?:import|use|depend on)\s+`?([^`\s]+?)\/?`?\s*\.?\s*$/i.exec(raw);
    if (m) rules.push({ line: i + 1, from: m[1].replace(/^\.\//, ''), to: m[2].replace(/^\.\//, ''), text: raw.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, '').trim() });
  });
  return rules;
}

const under = (file: string, folder: string): boolean => file === folder || file.startsWith(folder + '/');

/** Imports that break a rule: a file in `from` importing a file in `to`, or the package `to`. */
export function ruleViolations(rules: readonly FolderRule[], files: readonly { path: string; imports: readonly { specifier: string; kind: string; target?: string }[] }[]): RuleViolation[] {
  const out: RuleViolation[] = [];
  rules.forEach((r, i) => {
    for (const f of files) {
      if (!under(f.path, r.from)) continue;
      for (const imp of f.imports) {
        const hit = imp.kind === 'local' && imp.target ? under(imp.target, r.to) : imp.kind === 'external' && packageOf(imp.specifier) === r.to;
        if (hit) out.push({ rule: i, file: f.path, imports: imp.target ?? imp.specifier });
      }
    }
  });
  return out;
}

/** Starting text of the owner's rules file. */
export const RULES_TEMPLATE = `# Folder rules

One rule per line, like the examples below. VibeCode Explorer lists every import that breaks a rule
in the Health tab. Edit, add or delete lines as you like; lines in another form are ignored.

- \`src/ui/\` must not import \`src/database/\`
- \`src/core/\` must not import \`vscode\`
`;

// ---- Context for an AI prompt ----

export interface ContextFacts {
  path: string;
  sentences: string[];
  localImports: string[];
  packages: string[];
  importedBy: string[];
  symbols: string[];
  notes: string[];
  tests: string[];
}

/** A short summary of a file to paste into an AI chat, so the agent needs to read less. */
export function aiContext(f: ContextFacts): string {
  const list = (items: string[], max: number): string => (items.length ? items.slice(0, max).join(', ') + (items.length > max ? `, and ${items.length - max} more` : '') : 'none');
  return [
    `File: ${f.path}`,
    f.sentences.join(' '),
    `Imports (project files): ${list(f.localImports, 15)}`,
    `Packages: ${list(f.packages, 15)}`,
    `Imported by: ${list(f.importedBy, 15)}`,
    `Main symbols: ${list(f.symbols, 25)}`,
    `Tests: ${list(f.tests, 5)}`,
    ...(f.notes.length ? [`Owner's notes about it: ${list(f.notes, 5)}`] : []),
  ].join('\n');
}
