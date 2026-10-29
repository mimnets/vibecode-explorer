// Pure helpers for commit history (no `vscode` import, unit-testable).
import { isSensitiveFile } from '../analysis/sensitive';
import { ChangeGroup } from './status';

/** One file touched by a commit, relative to the workspace folder (forward slashes). */
export interface CommitFile {
  relPath: string;
  /** Path before a rename; '' when the file was not renamed. */
  oldRelPath: string;
  group: ChangeGroup;
}

export interface CommitFileSummary {
  files: (CommitFile & { sensitive: boolean })[];
  /** Files dropped because they are outside the folder. */
  hidden: number;
  truncated: boolean;
}

function isOutsideFolder(relPath: string): boolean {
  return relPath === '' || relPath === '..' || relPath.startsWith('../') || relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath);
}

/** Keeps files inside the folder, flags sensitive names, sorts and caps the list. */
export function summarizeCommitFiles(files: CommitFile[], max: number): CommitFileSummary {
  const kept = files.filter((f) => !isOutsideFolder(f.relPath));
  kept.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return {
    files: kept.slice(0, max).map((f) => ({ ...f, sensitive: isSensitiveFile(f.relPath) || isSensitiveFile(f.oldRelPath) })),
    hidden: files.length - kept.length,
    truncated: kept.length > max,
  };
}

/** First line of a commit message, trimmed. */
export function commitHeadline(message: string): string {
  return message.split(/\r?\n/, 1)[0].trim() || '(no message)';
}
