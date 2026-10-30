import { strict as assert } from 'assert';
import { test } from 'node:test';
import { diffEdits, diffRows, MAX_CODE_BYTES, MAX_CODE_LINES, toLines } from '../../src/analysis/codeText';

const enc = (s: string) => new TextEncoder().encode(s);

test('text is split into lines whatever the line endings', () => {
  assert.deepEqual(toLines(enc('a\r\nb\nc\rd\n')), { kind: 'text', lines: ['a', 'b', 'c', 'd'], truncated: false });
  assert.deepEqual(toLines(enc('')), { kind: 'text', lines: [''], truncated: false });
  assert.deepEqual(toLines(enc('ä ✓\n')), { kind: 'text', lines: ['ä ✓'], truncated: false });
});

test('binary files are recognised and not decoded', () => {
  assert.deepEqual(toLines(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])), { kind: 'binary' });
});

test('large files are cut off and say so', () => {
  const many = toLines(enc('x\n'.repeat(MAX_CODE_LINES + 5)));
  assert.ok(many.kind === 'text' && many.truncated && many.lines.length === MAX_CODE_LINES);
  const big = toLines(enc('y'.repeat(MAX_CODE_BYTES + 10)));
  assert.ok(big.kind === 'text' && big.truncated && big.lines[0].length === MAX_CODE_BYTES);
});

/** Length of the longest common subsequence: the smallest diff keeps exactly this many lines. */
function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  return dp[a.length][b.length];
}

/** Rebuilds both versions from the edits, which must reproduce them exactly. */
function apply(a: string[], b: string[], edits: string[]): { before: string[]; after: string[] } {
  const before: string[] = [];
  const after: string[] = [];
  let i = 0;
  let j = 0;
  for (const e of edits) {
    if (e === '=') { assert.equal(a[i], b[j]); before.push(a[i++]); after.push(b[j++]); }
    else if (e === '-') before.push(a[i++]);
    else after.push(b[j++]);
  }
  return { before, after };
}

test('the comparison is correct and as small as possible (random cases)', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 400; round++) {
    const a = Array.from({ length: rnd(12) }, () => 'abcd'[rnd(4)]);
    const b = Array.from({ length: rnd(12) }, () => 'abcd'[rnd(4)]);
    const edits = diffEdits(a, b);
    assert.ok(edits, `${a} / ${b}`);
    assert.deepEqual(apply(a, b, edits), { before: a, after: b });
    assert.equal(edits.filter((e) => e === '=').length, lcs(a, b), `${a} / ${b}`);
  }
});

test('the comparison gives up when too many lines differ', () => {
  const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
  assert.equal(diffEdits(a, b, 20), undefined);
  assert.ok(diffEdits(a, b, 100));
});

test('diff rows number both sides and fold unchanged lines far from a change', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const after = [...before];
  after[9] = 'changed';
  after.push('new last');
  const rows = diffRows(before, after, 2);
  assert.deepEqual(rows, [
    { k: '…', count: 7 },
    { k: '=', o: 8, n: 8, t: 'line 8' },
    { k: '=', o: 9, n: 9, t: 'line 9' },
    { k: '-', o: 10, t: 'line 10' },
    { k: '+', n: 10, t: 'changed' },
    { k: '=', o: 11, n: 11, t: 'line 11' },
    { k: '=', o: 12, n: 12, t: 'line 12' },
    { k: '…', count: 6 },
    { k: '=', o: 19, n: 19, t: 'line 19' },
    { k: '=', o: 20, n: 20, t: 'line 20' },
    { k: '+', n: 21, t: 'new last' },
  ]);
  assert.deepEqual(diffRows(['same'], ['same']), [{ k: '…', count: 1 }]);
});

test('a 20,000-line file with a few changes is compared quickly', () => {
  const before = Array.from({ length: 20_000 }, (_, i) => `const v${i} = ${i};`);
  const after = before.filter((_, i) => i % 5000 !== 0);
  const t = Date.now();
  const rows = diffRows(before, after);
  assert.ok(rows && rows.filter((r) => r.k === '-').length === 4);
  assert.ok(Date.now() - t < 2000);
});
