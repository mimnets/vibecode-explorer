// Phase 9: the Health tab's checks. Pure (no `vscode` import), unit-testable. Everything is
// read from file names, a few small config files, VS Code's own problem list and Git history.
// Nothing is run and nothing is changed; secret values are never returned.
import * as path from 'path';

// ---- Problems in plain words ----

const PROBLEM_TEXTS: readonly [RegExp, (m: RegExpExecArray) => string][] = [
  [/Cannot find name '([^']+)'|"([^"]+)" is not defined|'([^']+)' is not defined/, (m) => `${m[1] ?? m[2] ?? m[3]} is used here but never defined or imported.`],
  [/Cannot find module '([^']+)'|Import "([^"]+)" could not be resolved|No module named '([^']+)'/, (m) => `${m[1] ?? m[2] ?? m[3]} can't be found: check the path, or install the package.`],
  [/Property '([^']+)' does not exist on type/, (m) => `${m[1]} isn't part of this object: a typo, or its type is missing it.`],
  [/is declared but (?:its value is )?never (?:read|used)|is assigned a value but never used|is defined but never used|is not accessed/, () => 'Something is created but never used. It can probably be removed.'],
  [/Type '([^']+)' is not assignable to type '([^']+)'/, (m) => `A value of the wrong kind is used: ${m[1]} where ${m[2]} is expected.`],
  [/Argument of type '([^']+)' is not assignable to parameter of type '([^']+)'/, (m) => `A function gets ${m[1]} but expects ${m[2]}.`],
  [/Expected (\d+(?:-\d+)?) arguments?, but got (\d+)/, (m) => `The function is called with ${m[2]} input(s) but needs ${m[1]}.`],
  [/possibly '(?:undefined|null)'|possibly undefined|possibly null|is not a known attribute of "None"|Object of type "None"/, () => 'This may be empty (undefined/null/None) here. Check it before using it.'],
  [/Unexpected any|implicitly has an? '?any'? type/, () => '"any" switches off type checking here, so mistakes can slip through.'],
  [/';' expected|Expression expected|Unexpected token|invalid syntax|Declaration or statement expected/, () => 'The code is not written correctly here (a typo, a missing bracket or comma).'],
  [/is deprecated/, () => 'This still works but is outdated and may be removed in a future version.'],
];

/** A short plain-language reading of a problem message from VS Code's language support. */
export function explainProblem(message: string, severity: 'error' | 'warning'): string {
  for (const [re, text] of PROBLEM_TEXTS) {
    const m = re.exec(message);
    if (m) return text(m);
  }
  return severity === 'error' ? 'An error: the code will probably not work as it is.' : 'A warning: likely a mistake or a style problem, but the code may still run.';
}

// ---- Project health checklist ----

export interface HealthCheck { id: string; title: string; status: 'ok' | 'warn' | 'info'; detail: string; tip?: string }

export interface ChecklistInputs {
  /** Every file name in the folder (no contents), folder-relative. */
  files: readonly string[];
  /** Text of the root `.gitignore`, if any. */
  gitignore?: string;
  /** The root package.json, parsed, if any. */
  packageJson?: { license?: unknown; scripts?: Record<string, unknown>; [k: string]: unknown };
  /** Text of the root pyproject.toml, if any. */
  pyproject?: string;
  /** `.env`-style files and whether Git ignores them; undefined when Git is not available. */
  envIgnored?: ReadonlyMap<string, boolean>;
}

const isTestFile = (f: string): boolean => /(^|\/)(tests?|__tests__|spec)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(f);

/** A `.gitignore` line set covers a name when one of its simple patterns matches it. */
function ignores(gitignore: string, name: string): boolean {
  return gitignore.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!')).some((raw) => {
    const p = raw.replace(/^\//, '').replace(/\/$/, '');
    const re = new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(name);
  });
}

export function healthChecklist(i: ChecklistInputs): HealthCheck[] {
  const root = i.files.filter((f) => !f.includes('/'));
  const has = (re: RegExp): boolean => root.some((f) => re.test(f));
  const isNode = i.packageJson !== undefined;
  const isPython = i.pyproject !== undefined || has(/^(requirements[\w.-]*\.txt|setup\.py|Pipfile)$/i);
  const checks: HealthCheck[] = [];

  checks.push(has(/^readme(\.\w+)?$/i)
    ? { id: 'readme', title: 'README', status: 'ok', detail: 'There is a README that explains the project.' }
    : { id: 'readme', title: 'README', status: 'warn', detail: 'No README in the project folder.', tip: 'Add README.md: what the project does and how to run it. It helps people and AI agents alike.' });

  if (i.gitignore === undefined) {
    checks.push({ id: 'gitignore', title: '.gitignore', status: 'warn', detail: 'No .gitignore, so Git may pick up secrets, dependencies and build output.', tip: 'Add a .gitignore with at least .env and node_modules (or .venv).' });
  } else {
    const missing = [
      ...(ignores(i.gitignore, '.env') ? [] : ['.env']),
      ...(isNode && !ignores(i.gitignore, 'node_modules') ? ['node_modules'] : []),
      ...(isPython && !ignores(i.gitignore, '.venv') && !ignores(i.gitignore, 'venv') ? ['.venv'] : []),
    ];
    checks.push(missing.length
      ? { id: 'gitignore', title: '.gitignore', status: 'warn', detail: `.gitignore does not cover ${missing.join(', ')}.`, tip: `Add ${missing.map((m) => `"${m}"`).join(' and ')} on their own lines in .gitignore.` }
      : { id: 'gitignore', title: '.gitignore', status: 'ok', detail: '.gitignore covers secrets and dependency folders.' });
  }

  const license = has(/^(licen[cs]e|copying)(\.\w+)?$/i) || typeof i.packageJson?.license === 'string' || /^\s*license\s*=/m.test(i.pyproject ?? '');
  checks.push(license
    ? { id: 'license', title: 'License', status: 'ok', detail: 'The project states its license.' }
    : { id: 'license', title: 'License', status: 'info', detail: 'No license stated.', tip: 'If others may use the code, add a LICENSE file (for example MIT). For a private project this is fine.' });

  const lint = has(/^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|biome\.jsonc?|\.prettierrc(\.\w+)?|ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|tox\.ini|setup\.cfg)$/i)
    || 'eslintConfig' in (i.packageJson ?? {}) || /\[tool\.(ruff|flake8|pylint|black)\]/.test(i.pyproject ?? '');
  checks.push(lint
    ? { id: 'lint', title: 'Code checker', status: 'ok', detail: 'A linter or formatter is set up.' }
    : { id: 'lint', title: 'Code checker', status: 'warn', detail: 'No linter found (ESLint, Biome, Ruff, Flake8…).', tip: 'A linter catches mistakes as you type. Ask your AI agent to set one up for this project.' });

  const tests = i.files.filter(isTestFile).length;
  checks.push(tests
    ? { id: 'tests', title: 'Tests', status: 'ok', detail: `${tests} test file${tests === 1 ? '' : 's'} found.` }
    : { id: 'tests', title: 'Tests', status: 'warn', detail: 'No test files found.', tip: 'Tests let you (and the AI) change code without breaking it unnoticed. Start with one test for the most important file.' });

  if (isNode || isPython) {
    const lock = has(/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|npm-shrinkwrap\.json|poetry\.lock|uv\.lock|Pipfile\.lock|pdm\.lock)$/i)
      || (isPython && !isNode && has(/^requirements[\w.-]*\.txt$/i));
    checks.push(lock
      ? { id: 'lock', title: 'Locked versions', status: 'ok', detail: 'Dependency versions are pinned in a lock file.' }
      : { id: 'lock', title: 'Locked versions', status: 'warn', detail: 'No lock file, so each install may get different package versions.', tip: 'Run your package manager\'s install once and commit the lock file it creates.' });
  }

  if (i.envIgnored === undefined) {
    if (i.files.some((f) => /(^|\/)\.env(\.|$)/.test(f))) checks.push({ id: 'env', title: 'Secret files', status: 'info', detail: 'There are .env files, but Git is not available to check whether they are ignored.' });
  } else {
    const exposed = [...i.envIgnored].filter(([, ignored]) => !ignored).map(([f]) => f);
    if (exposed.length) checks.push({ id: 'env', title: 'Secret files', status: 'warn', detail: `Git does not ignore ${exposed.join(', ')}, so it could be committed and shared.`, tip: 'Add the file names to .gitignore. If one was already committed, change the secrets in it.' });
    else if (i.envIgnored.size) checks.push({ id: 'env', title: 'Secret files', status: 'ok', detail: 'Every .env file is ignored by Git.' });
  }
  return checks;
}

// ---- Possibly unused and near-duplicate files ----

const ENTRY_NAME = /^(index|main|app|server|cli|extension|setup|manage|wsgi|asgi|__init__|__main__|conftest|middleware|instrumentation|vite-env\.d)$/i;
const CONFIG_FILE = /(^|\/)[^/]*(\.config|rc)\.[cm]?[jt]s$|(^|\/)(gulpfile|gruntfile|webpack\.\w+|setup|noxfile|fabfile)\.[\w]+$/i;
/** Files a framework loads by their name or folder (Next.js pages and app router, SvelteKit-style routes). */
const FRAMEWORK_FILE = /(^|\/)pages\/|(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware)\.[cm]?[jt]sx?$/;

/** Graph files nothing imports that aren't entry points, tests, configs or framework files. */
export function possiblyUnused(graphFiles: readonly string[], importedBy: (file: string) => number, entryFiles: ReadonlySet<string>): string[] {
  return graphFiles.filter((f) => {
    const base = path.posix.basename(f).replace(/\.[^.]+$/, '');
    return importedBy(f) === 0 && !entryFiles.has(f) && !ENTRY_NAME.test(base) && !isTestFile(f) && !CONFIG_FILE.test(f) && !FRAMEWORK_FILE.test(f) && !f.includes('/scripts/') && !f.startsWith('scripts/');
  }).sort();
}

/** A file name without the extras that copies usually get: `-copy`, `_old`, `2`, `final`, a plural s. */
export function baseName(file: string): string {
  let n = path.posix.basename(file).toLowerCase().replace(/\.[^.]+$/, '');
  n = n.replace(/^(old|copy|backup|new)[ _.-]+/, '');
  for (let k = 0; k < 3; k++) n = n.replace(/([ _.-]?(copy|old|backup|bak|orig|new|final|v?\d+))$/, '');
  return n.replace(/s$/, '');
}

/** Groups of files in the same folder whose names differ only by such extras (`utils.ts`, `utils2.ts`). */
export function nearDuplicates(files: readonly string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    if (isTestFile(f) || /\.d\.ts$/.test(f)) continue;
    const ext = path.posix.extname(f).toLowerCase();
    const base = baseName(f);
    if (base.length < 2) continue;
    const key = `${path.posix.dirname(f)}\n${base}\n${ext}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ---- Safe points ----

export interface SafeCommit { hash: string; date?: Date; headline: string }
export interface SafePoint { hash: string; short: string; date: string; headline: string; reasons: string[] }

/**
 * Commits worth going back to: tagged ones, the last commit before each AI session started,
 * and commits the owner marked. Newest first. Nothing is checked out or run.
 */
export function safePoints(
  commits: readonly SafeCommit[], tags: readonly { name: string; hash: string }[], sessionStarts: readonly Date[], marked: readonly string[],
): SafePoint[] {
  const byHash = new Map<string, SafePoint>();
  const find = (hash: string): SafeCommit | undefined => commits.find((c) => c.hash === hash || (hash.length >= 7 && c.hash.startsWith(hash)));
  const add = (c: SafeCommit, reason: string): void => {
    const p = byHash.get(c.hash) ?? { hash: c.hash, short: c.hash.slice(0, 7), date: c.date?.toISOString() ?? '', headline: c.headline, reasons: [] };
    if (!p.reasons.includes(reason)) p.reasons.push(reason);
    byHash.set(c.hash, p);
  };
  for (const t of tags) {
    const c = find(t.hash);
    if (c) add(c, `tag ${t.name}`);
  }
  for (const start of sessionStarts) {
    // Commits are newest first: the first one older than the session start.
    const c = commits.find((x) => x.date && x.date.getTime() < start.getTime());
    if (c) add(c, `before the AI session of ${start.toISOString().slice(0, 16).replace('T', ' ')}`);
  }
  for (const h of marked) {
    const c = find(h);
    if (c) add(c, 'marked safe by you');
  }
  const order = new Map(commits.map((c, i) => [c.hash, i]));
  return [...byHash.values()].sort((a, b) => (order.get(a.hash) ?? 0) - (order.get(b.hash) ?? 0));
}

/** Plain steps to go back to a commit. Shown only: the extension never runs them. */
export function goBackSteps(short: string, branch: string): { text: string; command?: string }[] {
  return [
    { text: 'First save your current work: commit it, or put it aside with', command: 'git stash' },
    { text: 'Look at the project as it was (you can always come back):', command: `git switch --detach ${short}` },
    { text: 'Come back to your latest work:', command: `git switch ${branch || 'main'}` },
    { text: 'Or bring back just one file from then:', command: `git restore --source ${short} -- path/to/file` },
    { text: 'Or start a new branch from that point:', command: `git switch -c rescue-${short} ${short}` },
  ];
}
