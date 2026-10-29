import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildGraph } from '../../src/analysis/graph';
import { parseImports, resolveSpecifier } from '../../src/analysis/imports';
import { isExcludedFromAnalysis, isSensitiveFile } from '../../src/analysis/sensitive';
import { isNoteFileName, noteFileName, noteTemplate, parseNote, sameCommit } from '../../src/analysis/notes';
import { summarizeUsages } from '../../src/analysis/usages';

test('parseImports finds static, re-export, require, import-equals and literal dynamic imports', () => {
  const src = `
    import a from './a';
    import type { T } from "./types";
    export * from './re';
    const b = require('./b');
    import c = require('./c');
    const d = await import('./d');
    const e = import(\`./e\`);
    import 'side-effect';
  `;
  const { specifiers, dynamicUnknown } = parseImports('x.ts', src);
  assert.deepEqual(specifiers.sort(), ['./a', './b', './c', './d', './e', './re', './types', 'side-effect'].sort());
  assert.equal(dynamicUnknown, 0);
});

test('parseImports counts non-literal dynamic imports as unknown and ignores comments/strings', () => {
  const src = `
    // import x from './commented';
    const s = "require('./in-string')";
    const m = await import(name);
    const r = require(\`./\${dir}/x\`);
  `;
  const { specifiers, dynamicUnknown } = parseImports('x.js', src);
  assert.deepEqual(specifiers, []);
  assert.equal(dynamicUnknown, 2);
});

test('parseImports tolerates JSX and syntax errors', () => {
  assert.deepEqual(parseImports('c.tsx', `import R from 'react'; export const X = () => <div>{1}</div>;`).specifiers, ['react']);
  assert.deepEqual(parseImports('bad.ts', `import a from './a'; function (( {`).specifiers, ['./a']);
});

test('resolveSpecifier resolves extensions, index files and .js→.ts', () => {
  const files = new Set(['src/a.ts', 'src/lib/index.tsx', 'src/util.ts', 'main.js']);
  assert.deepEqual(resolveSpecifier('src/b.ts', './a', files), { specifier: './a', kind: 'local', target: 'src/a.ts' });
  assert.equal(resolveSpecifier('src/b.ts', './lib', files).target, 'src/lib/index.tsx');
  assert.equal(resolveSpecifier('src/b.ts', './util.js', files).target, 'src/util.ts');
  assert.equal(resolveSpecifier('src/deep/c.ts', '../../main.js', files).target, 'main.js');
});

test('resolveSpecifier never invents connections', () => {
  const files = new Set(['src/a.ts']);
  assert.equal(resolveSpecifier('src/b.ts', './missing', files).kind, 'unknown');
  assert.equal(resolveSpecifier('src/b.ts', '../../outside', files).kind, 'unknown');
  assert.equal(resolveSpecifier('src/b.ts', '@/components/x', files).kind, 'unknown');
  assert.equal(resolveSpecifier('src/b.ts', 'C:/abs/path', files).kind, 'unknown');
  assert.equal(resolveSpecifier('src/b.ts', 'react', files).kind, 'external');
  assert.equal(resolveSpecifier('src/b.ts', '@scope/pkg', files).kind, 'external');
  assert.equal(resolveSpecifier('src/b.ts', './style.css', files).kind, 'asset');
});

test('sensitive and generated paths are excluded from analysis', () => {
  for (const p of ['.env', 'config/.env.local', 'certs/server.pem', 'id_rsa', '.npmrc', 'secrets.json', 'app.secret']) {
    assert.ok(isSensitiveFile(p), p);
  }
  for (const p of ['node_modules/x/index.js', 'dist/app.js', '.git/hooks/pre-commit.js', 'a\\build\\b.js']) {
    assert.ok(isExcludedFromAnalysis(p), p);
  }
  for (const p of ['src/env.ts', 'src/secretsManager.ts', 'src/distance.ts', 'build.ts']) {
    assert.ok(!isExcludedFromAnalysis(p), p);
  }
});

test('buildGraph never reads excluded files and respects maxFiles', async () => {
  const sources: Record<string, string> = {
    'a.ts': `import './b'; import './nope';`,
    'b.ts': `export const b = 1;`,
    'c.ts': ``,
    '.env': 'SECRET=1',
    'node_modules/p/index.js': '',
  };
  const read: string[] = [];
  const g = await buildGraph(Object.keys(sources), async (p) => { read.push(p); return sources[p]; }, 2);
  assert.deepEqual(read, ['a.ts', 'b.ts']);
  assert.equal(g.truncated, true);
  assert.deepEqual(g.files[0].imports.map((i) => i.kind), ['local', 'unknown']);

  const skipped = await buildGraph(['big.ts'], async () => undefined, 10);
  assert.ok(skipped.files[0].skipped);
});

test('summarizeUsages hides outside, excluded and sensitive locations, de-duplicates, sorts and caps', () => {
  const r = summarizeUsages([
    { relPath: 'src/b.ts', line: 9 },
    { relPath: 'src/a.ts', line: 2 },
    { relPath: 'src/a.ts', line: 2 },
    { relPath: '../other/x.ts', line: 1 },
    { relPath: 'C:/elsewhere/y.ts', line: 1 },
    { relPath: '', line: 1 },
    { relPath: 'node_modules/lib/index.d.ts', line: 1 },
    { relPath: '.env', line: 1 },
    { relPath: 'src/a.ts', line: 1 },
  ], 2);
  assert.deepEqual(r.usages, [{ relPath: 'src/a.ts', line: 1 }, { relPath: 'src/a.ts', line: 2 }]);
  assert.deepEqual(r.files, ['src/a.ts', 'src/b.ts']);
  assert.equal(r.hidden, 5);
  assert.equal(r.truncated, true);
});

test('notes: header, commit matching, safe file names and template', () => {
  const text = noteTemplate({ about: 'src/app.ts' }, '2026-10-29', 'Why we cache');
  assert.deepEqual(parseNote(text), { about: 'src/app.ts', created: '2026-10-29', title: 'Why we cache' });
  assert.deepEqual(parseNote('\uFEFF---\r\ncommit: 5ed9230\r\nfoo: bar\r\n---\r\nno heading'), { commit: '5ed9230', title: '' });
  assert.deepEqual(parseNote('# Just a title'), { title: 'Just a title' });
  assert.ok(sameCommit('5ed9230', '5ed9230c8e19abcdef'));
  assert.ok(!sameCommit('5ed92', '5ed9230c8e19'));
  assert.ok(!sameCommit('5ed9231', '5ed9230c8e19'));

  assert.equal(noteFileName('2026-10-29', 'Why we cache!', new Set()), '2026-10-29-why-we-cache.md');
  assert.equal(noteFileName('2026-10-29', 'Why we cache', new Set(['2026-10-29-why-we-cache.md'])), '2026-10-29-why-we-cache-2.md');
  for (const title of ['../../etc/passwd', '..\\..\\x', 'C:\\Windows', '', '日本語']) {
    const name = noteFileName('2026-10-29', title, new Set());
    assert.ok(isNoteFileName(name) && !/[/\\]/.test(name) && !name.includes('..'), name);
  }
  assert.ok(!isNoteFileName('../2026-10-29-x.md'));
  assert.ok(!isNoteFileName('2026-10-29-x.md.exe'));
});
