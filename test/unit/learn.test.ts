import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiContext, commitMessageHint, findTodos, hotspots, howToRun, npmPackages, packageOf, parseFolderRules, pipPackages, readingOrder, readmeCommands, ruleViolations, testMap,
} from '../../src/analysis/learn';
import { sessionTips, SessionSummary } from '../../src/analysis/agentLogs';

const FILES = ['src/index.ts', 'src/app.ts', 'src/db.ts', 'src/util.ts', 'src/lonely.ts', 'src/app.test.ts', 'test/db.spec.ts'];
const EDGES: [string, string][] = [['src/index.ts', 'src/app.ts'], ['src/app.ts', 'src/db.ts'], ['src/app.ts', 'src/util.ts'], ['src/db.ts', 'src/util.ts'],
  ['src/app.test.ts', 'src/app.ts'], ['test/db.spec.ts', 'src/db.ts']];

test('the reading order goes from start files to leaves, tests left out', () => {
  const order = readingOrder(FILES, EDGES);
  assert.deepEqual(order.map((s) => `${s.depth}:${s.file}`), ['0:src/index.ts', '1:src/app.ts', '2:src/db.ts', '2:src/util.ts', '-1:src/lonely.ts']);
  assert.equal(order[0].reason, 'start here: nothing else imports it');
  assert.equal(order[3].reason, 'used by app.ts; uses no other project file');
  assert.equal(readingOrder(FILES, EDGES, new Set(['src/app.ts']))[0].reason, 'start here: the entry point');
});

test('the test map finds tests by imports and by name', () => {
  const map = testMap([...FILES, 'src/util_test.py', 'src/util.py'], EDGES);
  assert.deepEqual(map.tested, [
    { file: 'src/app.ts', tests: ['src/app.test.ts'] }, { file: 'src/db.ts', tests: ['test/db.spec.ts'] }, { file: 'src/util.py', tests: ['src/util_test.py'] }]);
  assert.deepEqual(map.untested, ['src/index.ts', 'src/util.ts', 'src/lonely.ts']);
  assert.deepEqual(map.tests, ['src/app.test.ts', 'src/util_test.py', 'test/db.spec.ts']);
});

test('TODO comments are found with their text, not words in code', () => {
  const text = 'const todo = 1; // TODO: handle errors\n# FIXME(bob) slow loop\n/* HACK - temporary */\nconst TODO_LIST = [];\n<!-- TODO make it pretty -->\n * XXX check this';
  assert.deepEqual(findTodos(text), [
    { line: 1, tag: 'TODO', text: 'handle errors' }, { line: 2, tag: 'FIXME', text: 'bob) slow loop' }, { line: 3, tag: 'HACK', text: 'temporary' },
    { line: 5, tag: 'TODO', text: 'make it pretty' }, { line: 6, tag: 'XXX', text: 'check this' }]);
});

test('commit messages are checked against the usual "type: what changed" form', () => {
  assert.equal(commitMessageHint('feat(ui): add a tab'), undefined);
  assert.equal(commitMessageHint('fix!: drop old API'), undefined);
  assert.equal(commitMessageHint('Merge branch main'), undefined);
  assert.match(commitMessageHint('Fixed the bug') ?? '', /Start with a type/);
  assert.match(commitMessageHint('Fix: the bug') ?? '', /lower case/);
  assert.match(commitMessageHint('feature: x') ?? '', /isn't a usual type/);
  assert.match(commitMessageHint('fix:x') ?? '', /space after/);
  assert.match(commitMessageHint('fix: ' + 'x'.repeat(80)) ?? '', /72/);
});

test('packages say whether the code, a script or nothing uses them', () => {
  const pkg = { dependencies: { react: '^18', '@scope/kit': '1.0.0', leftpad: '1' }, devDependencies: { eslint: '9', '@types/react': '18', jest: '29', '@eslint/js': '9' }, scripts: { lint: 'eslint src', t: 'node out/x.js' } };
  const used = npmPackages(pkg, new Set(['react', '@scope/kit']));
  assert.deepEqual(used.map((p) => `${p.name}:${p.used}:${p.dev}`), ['@scope/kit:imported:false', 'leftpad:not found:false', 'react:imported:false',
    '@eslint/js:not found:true', '@types/react:types:true', 'eslint:scripts:true', 'jest:not found:true']);
  assert.equal(packageOf('@a/b/c'), '@a/b');
  assert.equal(packageOf('lodash/fp'), 'lodash');
  assert.equal(packageOf('node:fs'), undefined);
  assert.deepEqual(pipPackages('# deps\nrequests>=2\npython-dateutil==2.8\nflask[async]\n-r other.txt\n', new Set(['requests', 'dateutil'])).map((p) => `${p.name}:${p.version}:${p.used}`),
    ['requests:>=2:imported', 'python-dateutil:==2.8:not found', 'flask:any:not found']);
});

test('how to run: install, then scripts in a sensible order; Python files too; README commands', () => {
  const steps = howToRun(['package-lock.json', 'manage.py', 'requirements.txt'], { scripts: { test: 'x', build: 'x', prebuild: 'x', dev: 'x', 'test:unit': 'x', custom: 'x' } });
  assert.deepEqual(steps.map((s) => s.command), ['npm ci', 'npm run dev', 'npm run build', 'npm test', 'npm run test:unit', 'npm run custom', 'pip install -r requirements.txt', 'python manage.py runserver']);
  assert.equal(steps[4].text, 'Run the tests (unit)');
  assert.equal(howToRun(['pnpm-lock.yaml'], { scripts: { start: 'x' } })[1].command, 'pnpm start');
  assert.deepEqual(howToRun([], undefined), []);
  const readme = '# App\n\n```\nnot this\n```\n\n## Getting started\n\n```bash\n$ npm install\n# a comment\nnpm run dev\n```\n\n## License\n\n```\nnope\n```\n';
  assert.deepEqual(readmeCommands(readme), ['npm install', 'npm run dev']);
});

test('hotspots count changes and fixes per file', () => {
  const spots = hotspots([
    { headline: 'fix: login', files: ['a.ts', 'b.ts'] }, { headline: 'feat: x', files: ['a.ts'] }, { headline: 'Fixed crash', files: ['a.ts', 'b.ts', 'c.ts'] }]);
  assert.deepEqual(spots, [{ file: 'a.ts', changes: 3, fixes: 2 }, { file: 'b.ts', changes: 2, fixes: 2 }]);
});

test('folder rules are read from plain lines and broken imports are listed', () => {
  const rules = parseFolderRules('# Rules\n\n- `src/analysis/` must not import `vscode`\n- src/ui should not use src/db/\nSome other text.\n1. `web` cannot import `server/`.');
  assert.deepEqual(rules.map((r) => `${r.line}:${r.from}>${r.to}`), ['3:src/analysis>vscode', '4:src/ui>src/db', '6:web>server']);
  const files = [
    { path: 'src/analysis/a.ts', imports: [{ specifier: 'vscode', kind: 'external' }, { specifier: 'path', kind: 'external' }] },
    { path: 'src/ui/view.ts', imports: [{ specifier: '../db/q', kind: 'local', target: 'src/db/q.ts' }, { specifier: '../dbx', kind: 'local', target: 'src/dbx.ts' }] },
    { path: 'src/other.ts', imports: [{ specifier: 'vscode', kind: 'external' }] },
  ];
  assert.deepEqual(ruleViolations(rules, files), [{ rule: 0, file: 'src/analysis/a.ts', imports: 'vscode' }, { rule: 1, file: 'src/ui/view.ts', imports: 'src/db/q.ts' }]);
});

test('the AI context is short and lists what the file uses and what uses it', () => {
  const text = aiContext({ path: 'src/app.ts', sentences: ['app.ts is a TS file.'], localImports: ['src/db.ts'], packages: [], importedBy: Array.from({ length: 17 }, (_, i) => `f${i}.ts`), symbols: ['App (class)'], notes: [], tests: ['src/app.test.ts'] });
  assert.equal(text.split('\n')[0], 'File: src/app.ts');
  assert.match(text, /Packages: none/);
  assert.match(text, /Imported by: f0\.ts, .*f14\.ts, and 2 more/);
  assert.ok(!text.includes('notes'));
});

test('prompt tips: repeated prompts and prompts that name no file', () => {
  const s: SessionSummary = {
    title: 't', start: '', end: '', models: [], replies: 0, filesEdited: [], securityMentions: [], foreignLines: 0, projectLines: 1,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    prompts: ['please make the login page work again now', 'Please make the login page work  again now', 'add a dark mode to the whole application please', 'make everything faster and also nicer to use'].map((text) => ({ time: '', text })),
  };
  const tips = sessionTips(s, ['src/a.ts', 'src/a.test.ts']);
  assert.ok(tips.some((t) => t.startsWith('1 prompt was sent again')), JSON.stringify(tips));
  assert.ok(tips.some((t) => t.includes('named no file')));
  s.prompts = s.prompts.map((p, i) => ({ ...p, text: `fix src/file${i}.ts so the tests pass again` }));
  assert.ok(!sessionTips(s, []).some((t) => t.includes('named no file') || t.includes('sent again')));
});
