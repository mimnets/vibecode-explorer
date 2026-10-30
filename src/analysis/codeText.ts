// Phase 6c: turns file contents into lines for the browser's code view, and compares two
// versions line by line. Pure functions (no `vscode` import), so they are unit-testable.

export const MAX_CODE_BYTES = 1024 * 1024;
export const MAX_CODE_LINES = 20_000;
/** Above this many changed lines the comparison gives up rather than use a lot of time and memory. */
export const MAX_DIFF_EDITS = 2_000;
/** Unchanged lines shown before and after each change in a diff. */
export const DIFF_CONTEXT = 3;

export type TextResult =
  | { kind: 'text'; lines: string[]; truncated: boolean }
  | { kind: 'binary' };

/** Decodes file bytes as UTF-8 lines. Files with a NUL byte near the start count as binary. */
export function toLines(bytes: Uint8Array): TextResult {
  if (bytes.subarray(0, 8000).includes(0)) return { kind: 'binary' };
  let truncated = bytes.length > MAX_CODE_BYTES;
  const text = new TextDecoder('utf-8').decode(truncated ? bytes.subarray(0, MAX_CODE_BYTES) : bytes);
  const lines = text.split(/\r\n|\r|\n/);
  // A final newline does not start another line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > MAX_CODE_LINES) {
    lines.length = MAX_CODE_LINES;
    truncated = true;
  }
  return { kind: 'text', lines, truncated };
}

/** One row of a diff: unchanged (`=`), added (`+`), removed (`-`), or a run of hidden unchanged lines (`…`). */
export type DiffRow =
  | { k: '='; o: number; n: number; t: string }
  | { k: '+'; n: number; t: string }
  | { k: '-'; o: number; t: string }
  | { k: '…'; count: number };

type Edit = '=' | '+' | '-';

/**
 * Myers' shortest-edit comparison of two line lists. Returns one edit per output row,
 * or undefined when more than `maxEdits` lines differ.
 */
export function diffEdits(a: string[], b: string[], maxEdits = MAX_DIFF_EDITS): Edit[] | undefined {
  // Matching lines at the start and end are common and cheap to take off first.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle = myers(midA, midB, maxEdits);
  if (!middle) return undefined;
  return [...Array<Edit>(start).fill('='), ...middle, ...Array<Edit>(a.length - endA).fill('=')];
}

function myers(a: string[], b: string[], maxEdits: number): Edit[] | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array<Edit>(m).fill('+');
  if (m === 0) return Array<Edit>(n).fill('-');
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds diagonals -d..d of `v` as it was before step d (kept small: memory grows with d²).
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return undefined;
}

function backtrack(trace: Int32Array[], n: number, m: number): Edit[] {
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    // trace[d][i] is diagonal i - d - 1.
    const at = (k: number): number => trace[d][k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { edits.push('='); x--; y--; }
    edits.push(x === prevX ? '+' : '-');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { edits.push('='); x--; y--; }
  return edits.reverse();
}

/**
 * Builds the rows of a before/after view. Unchanged lines far from a change are folded
 * into one `…` row. Returns undefined when the versions differ too much to compare.
 */
export function diffRows(before: string[], after: string[], context = DIFF_CONTEXT, maxEdits = MAX_DIFF_EDITS): DiffRow[] | undefined {
  const edits = diffEdits(before, after, maxEdits);
  if (!edits) return undefined;
  const full: Exclude<DiffRow, { k: '…' }>[] = [];
  let o = 0;
  let n = 0;
  for (const e of edits) {
    if (e === '=') full.push({ k: '=', o: ++o, n: ++n, t: after[n - 1] });
    else if (e === '+') full.push({ k: '+', n: ++n, t: after[n - 1] });
    else full.push({ k: '-', o: ++o, t: before[o - 1] });
  }
  // Keep unchanged lines within `context` rows of a change.
  const keep = new Uint8Array(full.length);
  full.forEach((r, i) => {
    if (r.k === '=') return;
    for (let j = Math.max(0, i - context); j <= Math.min(full.length - 1, i + context); j++) keep[j] = 1;
  });
  const rows: DiffRow[] = [];
  let hidden = 0;
  full.forEach((r, i) => {
    if (keep[i]) {
      if (hidden) rows.push({ k: '…', count: hidden });
      hidden = 0;
      rows.push(r);
    } else {
      hidden++;
    }
  });
  if (hidden) rows.push({ k: '…', count: hidden });
  return rows;
}
