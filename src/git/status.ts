// Mirrors the `Status` enum of the built-in Git extension API (git.d.ts).
// Verified against VS Code 1.143's bundled git extension.

export type ChangeGroup = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

const GROUP_BY_STATUS: Record<number, ChangeGroup> = {
  0: 'modified',  // INDEX_MODIFIED
  1: 'added',     // INDEX_ADDED
  2: 'deleted',   // INDEX_DELETED
  3: 'renamed',   // INDEX_RENAMED
  4: 'added',     // INDEX_COPIED
  5: 'modified',  // MODIFIED
  6: 'deleted',   // DELETED
  7: 'untracked', // UNTRACKED
  // 8: IGNORED is intentionally not shown
  9: 'added',     // INTENT_TO_ADD
  10: 'renamed',  // INTENT_TO_RENAME
  11: 'modified', // TYPE_CHANGED
  12: 'conflict', 13: 'conflict', 14: 'conflict', 15: 'conflict', 16: 'conflict', 17: 'conflict', 18: 'conflict',
};

export function groupForStatus(status: number): ChangeGroup | undefined {
  return GROUP_BY_STATUS[status];
}

// When a file is both staged and changed in the working tree, show the most significant state.
const PRIORITY: ChangeGroup[] = ['conflict', 'deleted', 'added', 'renamed', 'untracked', 'modified'];

export function moreSignificant(a: ChangeGroup, b: ChangeGroup): ChangeGroup {
  return PRIORITY.indexOf(a) <= PRIORITY.indexOf(b) ? a : b;
}
