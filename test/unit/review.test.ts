import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReviewed, MAX_REVIEWED, reviewChecklist, reviewKey } from '../../src/analysis/review';

test('the review checklist labels each changed file and sums up the session', () => {
  const { items, checks } = reviewChecklist([
    { path: 'src/app.ts', uncommitted: true, exists: true },
    { path: 'test/app.test.ts', uncommitted: false, exists: true },
    { path: '.env', uncommitted: true, exists: true },
    { path: 'src/old.ts', uncommitted: false, exists: false },
    { path: 'test/gone.test.ts', uncommitted: false, exists: false },
  ], ['src/app.ts', 'src/old.ts'], 2);
  assert.deepEqual(items.map((i) => `${i.path}:${i.labels.join('+')}:${i.reviewed}`), [
    'src/app.ts:uncommitted:true',
    'test/app.test.ts:test:false',
    '.env:sensitive+uncommitted:false',
    'src/old.ts:deleted:true',
    'test/gone.test.ts:deleted+test:false',
  ]);
  assert.deepEqual(checks, { total: 5, reviewed: 2, tests: 1, uncommitted: 2, deleted: 2, sensitive: 1, securityMentions: 2 });
  assert.deepEqual(reviewChecklist([], [], 0).checks, { total: 0, reviewed: 0, tests: 0, uncommitted: 0, deleted: 0, sensitive: 0, securityMentions: 0 });
});

test('stored ticks are kept only for this session\'s files, and keyed by the log file name', () => {
  const paths = ['a.ts', 'b.ts'];
  assert.deepEqual(cleanReviewed(['a.ts', 'a.ts', 'c.ts', 7, null, '../a.ts'], paths), ['a.ts']);
  assert.deepEqual(cleanReviewed('a.ts', paths), []);
  assert.deepEqual(cleanReviewed(undefined, paths), []);
  const many = Array.from({ length: MAX_REVIEWED + 5 }, (_, i) => `f${i}.ts`);
  assert.equal(cleanReviewed(many, many).length, MAX_REVIEWED);
  assert.equal(reviewKey('file:///c%3A/p', 'C:\\Users\\x\\.claude\\projects\\p\\abc.jsonl'), 'reviewed:file:///c%3A/p:abc.jsonl');
  assert.equal(reviewKey('file:///p', '/home/x/abc.jsonl'), 'reviewed:file:///p:abc.jsonl');
});
