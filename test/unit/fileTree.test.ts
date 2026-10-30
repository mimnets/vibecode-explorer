import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildFileTree, TREE_EXCLUDE_GLOB, TreeFolder, TreeNode } from '../../src/analysis/fileTree';

const file = (path: string, id: string, extra: Partial<{ group: string; sensitive: boolean; inGraph: boolean }> = {}) =>
  ({ path, id, sensitive: false, inGraph: false, ...extra });

/** A compact picture of the tree: folders as "name/ (files)", files by name. */
function shape(n: TreeNode): unknown {
  return n.kind === 'folder' ? { [`${n.name}/ (${n.files})`]: n.children.map(shape) } : n.name;
}

test('files are grouped into folders, folders first, sorted by name', () => {
  const tree = buildFileTree([
    file('src/b.ts', 'f1'), file('README.md', 'p0'), file('src/a/z.ts', 'f2'), file('src/A.ts', 'f3'),
    file('docs/guide.md', 'p1'), file('.gitignore', 'p2'), file('src/a/y.py', 'f4'),
  ]);
  assert.deepEqual(shape(tree), { '/ (7)': [
    { 'docs/ (1)': ['guide.md'] },
    { 'src/ (4)': [{ 'a/ (2)': ['y.py', 'z.ts'] }, 'A.ts', 'b.ts'] },
    '.gitignore',
    'README.md',
  ] });
});

test('files keep their id, change group, sensitive flag and graph flag, and folders their path', () => {
  const tree = buildFileTree([file('src/util.ts', 'f0', { group: 'modified', inGraph: true }), file('.env', 'c3', { sensitive: true })]);
  const src = tree.children[0] as TreeFolder;
  assert.equal(src.path, 'src');
  assert.deepEqual(src.children[0], { kind: 'file', name: 'util.ts', path: 'src/util.ts', id: 'f0', group: 'modified', sensitive: false, inGraph: true });
  assert.deepEqual(tree.children[1], { kind: 'file', name: '.env', path: '.env', id: 'c3', sensitive: true, inGraph: false });
});

test('duplicates, empty paths and dot segments are ignored', () => {
  const tree = buildFileTree([file('a.ts', 'p0'), file('a.ts', 'p1'), file('', 'p2'), file('../x.ts', 'p3'), file('b/./c.ts', 'p4')]);
  assert.deepEqual(shape(tree), { '/ (1)': ['a.ts'] });
});

test('an empty project gives an empty root', () => {
  assert.deepEqual(buildFileTree([]), { kind: 'folder', name: '', path: '', files: 0, children: [] });
});

test('the tree skips build and dependency folders but still lists sensitive names', () => {
  assert.match(TREE_EXCLUDE_GLOB, /\*\*\/node_modules\/\*\*/);
  assert.match(TREE_EXCLUDE_GLOB, /\*\*\/\.git\/\*\*/);
  assert.doesNotMatch(TREE_EXCLUDE_GLOB, /\.env/);
});

test('a deep, wide tree is built quickly', () => {
  const files = Array.from({ length: 5000 }, (_, i) => file(`d${i % 50}/e${i % 7}/f${i}.ts`, `p${i}`));
  const t = Date.now();
  const tree = buildFileTree(files);
  assert.equal(tree.files, 5000);
  assert.equal(tree.children.length, 50);
  assert.ok(Date.now() - t < 1000);
});
