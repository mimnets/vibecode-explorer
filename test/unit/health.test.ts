import { strict as assert } from 'assert';
import { test } from 'node:test';
import { baseName, explainProblem, goBackSteps, healthChecklist, nearDuplicates, possiblyUnused, safePoints } from '../../src/analysis/health';
import { parseNote, noteTemplate } from '../../src/analysis/notes';
import { findSecrets } from '../../src/analysis/secrets';

test('problems get a plain explanation', () => {
  assert.equal(explainProblem("Cannot find name 'foo'.", 'error'), 'foo is used here but never defined or imported.');
  assert.equal(explainProblem('Import "requests" could not be resolved', 'warning'), "requests can't be found: check the path, or install the package.");
  assert.match(explainProblem("'x' is declared but its value is never read.", 'warning'), /never used/);
  assert.match(explainProblem("Type 'string' is not assignable to type 'number'.", 'error'), /string where number is expected/);
  assert.match(explainProblem('Expected 2 arguments, but got 1.', 'error'), /1 input\(s\) but needs 2/);
  assert.match(explainProblem('Something unusual happened', 'error'), /^An error/);
  assert.match(explainProblem('Something unusual happened', 'warning'), /^A warning/);
});

test('the health checklist reads names and small config files only', () => {
  const good = healthChecklist({
    files: ['README.md', 'LICENSE', '.gitignore', 'eslint.config.mjs', 'package.json', 'package-lock.json', 'src/a.ts', 'test/a.test.ts', '.env'],
    gitignore: 'node_modules/\n.env*\n',
    packageJson: { name: 'x' },
    envIgnored: new Map([['.env', true]]),
  });
  assert.deepEqual(good.map((c) => `${c.id}:${c.status}`), ['readme:ok', 'gitignore:ok', 'license:ok', 'lint:ok', 'tests:ok', 'lock:ok', 'env:ok']);
  const bad = healthChecklist({
    files: ['package.json', 'src/a.ts', '.env', 'config/.env.local'],
    gitignore: 'dist\n',
    packageJson: {},
    envIgnored: new Map([['.env', false], ['config/.env.local', true]]),
  });
  assert.deepEqual(bad.map((c) => `${c.id}:${c.status}`), ['readme:warn', 'gitignore:warn', 'license:info', 'lint:warn', 'tests:warn', 'lock:warn', 'env:warn']);
  assert.match(bad.find((c) => c.id === 'gitignore')!.detail, /\.env, node_modules/);
  assert.match(bad.find((c) => c.id === 'env')!.detail, /^Git does not ignore \.env,/);
  const py = healthChecklist({ files: ['pyproject.toml', 'requirements.txt', 'tests/test_a.py'], pyproject: '[tool.ruff]\nlicense = "MIT"\n', gitignore: '.venv\n.env\n' });
  assert.deepEqual(py.map((c) => `${c.id}:${c.status}`), ['readme:warn', 'gitignore:ok', 'license:ok', 'lint:ok', 'tests:ok', 'lock:ok']);
  const noGit = healthChecklist({ files: ['.env'] });
  assert.equal(noGit.find((c) => c.id === 'env')?.status, 'info');
});

test('possibly unused files skip entry points, tests, configs and framework files', () => {
  const files = ['src/index.ts', 'src/util.ts', 'src/orphan.ts', 'src/a.test.ts', 'vite.config.ts', 'app/page.tsx', 'pages/about.tsx', 'scripts/build.js', 'src/cli.ts', 'app/models.py'];
  const importers: Record<string, number> = { 'src/util.ts': 2 };
  assert.deepEqual(possiblyUnused(files, (f) => importers[f] ?? 0, new Set(['src/cli.ts'])), ['app/models.py', 'src/orphan.ts']);
});

test('near-duplicate names are grouped per folder', () => {
  assert.equal(baseName('src/utils2.ts'), 'util');
  assert.equal(baseName('src/api-copy.ts'), 'api');
  assert.equal(baseName('src/old_api.ts'), 'api');
  assert.equal(baseName('Header.final.v2.tsx'), 'header');
  assert.deepEqual(nearDuplicates(['src/util.ts', 'src/utils.ts', 'src/utils2.ts', 'lib/util.ts', 'src/api.ts', 'src/api-copy.ts', 'src/api.test.ts', 'src/util.js', 'src/x.d.ts', 'src/x.ts']), [
    ['src/api-copy.ts', 'src/api.ts'],
    ['src/util.ts', 'src/utils.ts', 'src/utils2.ts'],
  ]);
});

test('safe points: tags, the commit before each AI session, and marked commits', () => {
  const d = (h: number) => new Date(Date.UTC(2026, 9, 30, h));
  const commits = [
    { hash: 'c'.repeat(40), date: d(12), headline: 'third' },
    { hash: 'b'.repeat(40), date: d(10), headline: 'second' },
    { hash: 'a'.repeat(40), date: d(8), headline: 'first' },
  ];
  const points = safePoints(commits, [{ name: 'v1.0', hash: 'a'.repeat(40) }], [d(11), d(9), d(7)], ['bbbbbbb']);
  assert.deepEqual(points.map((p) => `${p.short} ${p.reasons.join('; ')}`), [
    'bbbbbbb before the AI session of 2026-10-30 11:00; marked safe by you',
    'aaaaaaa tag v1.0; before the AI session of 2026-10-30 09:00',
  ]);
  const steps = goBackSteps('bbbbbbb', 'main');
  assert.ok(steps.some((s) => s.command === 'git switch --detach bbbbbbb'));
  assert.ok(steps.every((s) => !s.command || !/reset --hard|push|clean/.test(s.command)), 'no step loses work');
});

test('safe-point notes are marked in their header', () => {
  const text = noteTemplate({ commit: 'abc1234' }, '2026-10-30', 'Safe point', { safe: true });
  assert.match(text, /^---\ncommit: abc1234\nsafe: true\ncreated: 2026-10-30\n---/);
  assert.equal(parseNote(text).safe, true);
  assert.equal(parseNote(noteTemplate({ commit: 'abc1234' }, '2026-10-30', 'x')).safe, undefined);
});

test('secret-looking text is located but never returned', () => {
  const src = [
    'const key = "sk-abcdefghijklmnopqrstuv";',
    'password: string;',
    'const password = "hunter2hunter2";',
    'const token = process.env.TOKEN;',
    'apiKey: "your_api_key_here",',
    'const aws = "AKIAABCDEFGHIJKLMNOP";',
  ].join('\n');
  const hits = findSecrets(src);
  assert.deepEqual(hits.map((h) => h.line), [1, 3, 6]);
  assert.ok(!JSON.stringify(hits).includes('hunter2') && !JSON.stringify(hits).includes('sk-abc'));
});
