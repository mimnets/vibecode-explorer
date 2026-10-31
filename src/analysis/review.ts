// Phase 14: a review checklist of the files an AI session changed (no `vscode` import, unit-testable).
// Ticks are kept in VS Code's storage, never in the project.

import { isTestFile } from './explain';
import { isSensitiveFile } from './sensitive';

export type ReviewLabel = 'uncommitted' | 'test' | 'deleted' | 'sensitive';

export interface ReviewFileFacts {
  /** Folder-relative path, forward slashes. */
  path: string;
  /** In the current workspace changes (not committed yet). */
  uncommitted: boolean;
  exists: boolean;
}

export interface ReviewItem { path: string; labels: ReviewLabel[]; reviewed: boolean }

export interface ReviewChecks {
  total: number;
  reviewed: number;
  /** Test files the session added or changed. */
  tests: number;
  uncommitted: number;
  deleted: number;
  sensitive: number;
  securityMentions: number;
}

/** At most this many ticks are kept per session. */
export const MAX_REVIEWED = 500;

/** Storage key for one session's ticks in one folder. Only the log file's name is used. */
export function reviewKey(folderUri: string, sessionFile: string): string {
  return `reviewed:${folderUri}:${sessionFile.split(/[\\/]/).pop() ?? sessionFile}`;
}

/** Ticks read from storage, kept only when they are paths of this session's files. */
export function cleanReviewed(stored: unknown, paths: string[]): string[] {
  if (!Array.isArray(stored)) return [];
  const known = new Set(paths);
  return [...new Set(stored.filter((p): p is string => typeof p === 'string' && known.has(p)))].slice(0, MAX_REVIEWED);
}

/** One line per changed file with its labels and tick, plus the checks for the whole session. */
export function reviewChecklist(files: ReviewFileFacts[], reviewed: string[], securityMentions: number): { items: ReviewItem[]; checks: ReviewChecks } {
  const ticked = new Set(reviewed);
  const items = files.map((f): ReviewItem => {
    const labels: ReviewLabel[] = [];
    if (isSensitiveFile(f.path)) labels.push('sensitive');
    if (!f.exists) labels.push('deleted');
    if (f.uncommitted) labels.push('uncommitted');
    if (isTestFile(f.path)) labels.push('test');
    return { path: f.path, labels, reviewed: ticked.has(f.path) };
  });
  const count = (label: ReviewLabel): number => items.filter((i) => i.labels.includes(label)).length;
  return {
    items,
    checks: {
      total: items.length,
      reviewed: items.filter((i) => i.reviewed).length,
      tests: items.filter((i) => i.labels.includes('test') && !i.labels.includes('deleted')).length,
      uncommitted: count('uncommitted'),
      deleted: count('deleted'),
      sensitive: count('sensitive'),
      securityMentions,
    },
  };
}
