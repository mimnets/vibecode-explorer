import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import { codeTips, explainFile, explainSymbol, FileFacts, fileRole, findCycles, isTestFor, parseHover } from '../../src/analysis/explain';
import { GLOSSARY } from '../../src/analysis/glossary';

const facts = (over: Partial<FileFacts> = {}): FileFacts => ({
  path: 'src/app/dashboard.ts', fileType: 'TS', localImports: ['src/app/history.ts', 'src/app/notes.ts'], packages: ['vscode', 'crypto'],
  unknownImports: 0, importedBy: ['src/app/extension.ts'], symbolKinds: { Class: 1, Function: 3 }, commits: { count: 8, capped: false, last: '29/10/2026' },
  notes: 1, lines: 120, cycleWith: [], hasTest: false, analyzed: true, ...over,
});

test('file roles', () => {
  assert.equal(fileRole(3, 0), 'entry point');
  assert.equal(fileRole(0, 2), 'leaf');
  assert.equal(fileRole(2, 5), 'hub');
  assert.equal(fileRole(0, 9), 'hub');
  assert.equal(fileRole(2, 1), undefined);
  assert.equal(fileRole(0, 0), undefined);
});

test('circular imports are found as groups', () => {
  const cycles = findCycles(['a', 'b', 'c', 'd', 'e', 'f'], [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd'], ['e', 'e'], ['d', 'f'], ['x', 'a']]);
  assert.deepEqual(cycles, [['a', 'b', 'c'], ['e']]);
  assert.deepEqual(findCycles(['a', 'b'], [['a', 'b']]), []);
  // A long chain does not overflow the stack.
  const n = 20000;
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const chain = ids.slice(1).map((id, i): [string, string] => [ids[i], id]);
  assert.equal(findCycles(ids, [...chain, [ids[n - 1], ids[0]]])[0].length, n);
});

test('a file is explained in plain sentences', () => {
  const { sentences, role } = explainFile(facts());
  assert.equal(role, undefined);
  assert.deepEqual(sentences, [
    'dashboard.ts is a TS file with 120 lines.',
    'It uses 2 other files in this project (history.ts and notes.ts) and 2 packages (vscode, crypto).',
    '1 file uses it (extension.ts).',
    'It defines 3 functions and 1 class at the top level.',
    'It was changed in 8 commits, most recently on 29/10/2026.',
    'You have 1 note on it.',
  ]);
  const hub = explainFile(facts({ importedBy: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'], notes: 0, commits: { count: 0, capped: false } }));
  assert.equal(hub.role, 'hub');
  assert.ok(hub.sentences.includes('5 files use it (a.ts, b.ts, c.ts and 2 more).'));
  assert.ok(hub.sentences.includes('That makes it a hub: a change here can affect 5 files.'));
  assert.ok(hub.sentences.includes('It has not been committed yet.'));
  const entry = explainFile(facts({ importedBy: [] }));
  assert.equal(entry.role, 'entry point');
  const plain = explainFile(facts({ analyzed: false, symbolKinds: {}, fileType: 'MD', lines: undefined, commits: undefined, notes: 0 }));
  assert.deepEqual(plain.sentences, ['dashboard.ts is an MD file.']);
  // A file with the same name as the subject, or as another listed file, is shown with its path.
  const same = explainFile(facts({ path: 'src/extension/explain.ts', localImports: ['src/analysis/explain.ts', 'src/a/x.ts', 'src/b/x.ts', 'src/state.ts'] }));
  assert.ok(same.sentences.includes('It uses 4 other files in this project (src/analysis/explain.ts, src/a/x.ts, src/b/x.ts and 1 more) and 2 packages (vscode, crypto).'));
});

test('code tips: circular import, large file, hub without a test', () => {
  assert.deepEqual(codeTips(facts()), []);
  const tips = codeTips(facts({ cycleWith: ['src/app/notes.ts'], lines: 900, importedBy: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  assert.equal(tips.length, 3);
  assert.match(tips[0], /dashboard\.ts and notes\.ts import each other/);
  assert.match(tips[1], /900 lines/);
  assert.match(tips[2], /6 files depend on this file/);
  assert.equal(codeTips(facts({ importedBy: ['a', 'b', 'c', 'd', 'e'], hasTest: true })).length, 0);
  assert.ok(isTestFor('src/app/dashboard.ts', 'test/dashboard.test.ts'));
  assert.ok(isTestFor('src/a.b.ts', 'src/a.b.spec.js'));
  assert.ok(!isTestFor('src/app/dashboard.ts', 'test/dashboards.test.ts'));
});

test('a symbol is explained from hover text and usages', () => {
  const hover = parseHover(['```typescript\nfunction openTarget(t: Target):\n  Promise<void>\n```\nOpens a file, its **diff** or the [HEAD](x) version.']);
  assert.deepEqual(hover, { signature: 'function openTarget(t: Target): Promise<void>', doc: 'Opens a file, its diff or the HEAD version.' });
  assert.deepEqual(parseHover([]), { signature: undefined, doc: undefined });
  const base = { name: 'openTarget', kind: 'Function', line: 230, ...hover };
  const used = explainSymbol({ ...base, usages: { available: true, places: 4, files: ['src/a.ts', 'src/b.ts'], ownFile: 'src/a.ts', truncated: false } });
  assert.deepEqual(used, [
    'openTarget is a function defined on line 230.',
    'Its declaration: function openTarget(t: Target): Promise<void>',
    'Its documentation says: Opens a file, its diff or the HEAD version.',
    'It appears in 4 places in 2 files (counting its definition).',
  ]);
  const unused = explainSymbol({ name: 'x', kind: 'Variable', line: 1, usages: { available: true, places: 1, files: ['a.ts'], ownFile: 'a.ts', truncated: false } });
  assert.match(unused[1], /may be unused/);
  const local = explainSymbol({ name: 'Item', kind: 'Interface', line: 3, usages: { available: true, places: 3, files: ['a.ts'], ownFile: 'a.ts', truncated: false } });
  assert.equal(local[0], 'Item is an interface defined on line 3.');
  assert.equal(local[2], 'It is only used inside its own file.');
});

test('every term the dashboard explains has a glossary entry', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/dashboard.js'), 'utf8');
  const literal = [...js.matchAll(/withHelp\(.*?\), '([^']+)'\)/g)].map((m) => m[1]);
  const dynamic = ['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflict', 'entry point', 'hub', 'leaf',
    'class', 'function', 'method', 'property', 'variable', 'constant', 'interface', 'enum', 'module'];
  assert.ok(literal.length >= 10, `found ${literal.length} terms`);
  for (const term of [...literal, ...dynamic]) assert.ok(GLOSSARY[term], `missing glossary entry: ${term}`);
  for (const [term, text] of Object.entries(GLOSSARY)) {
    assert.equal(term, term.toLowerCase());
    assert.ok(text.length > 20 && text.length < 260, term);
  }
});
