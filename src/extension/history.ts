import * as path from 'path';
import * as vscode from 'vscode';
import { commitHeadline, summarizeCommitFiles } from '../git/history';
import { ChangeGroup } from '../git/status';
import { CommitEntry, CommitFileRef, getCommitFiles, getHistory, gitUriAt } from '../git/gitChanges';

export const MAX_COMMITS = 200;
const MAX_COMMIT_FILES = 300;

export interface HistoryResult {
  git:
    | { kind: 'ok'; commits: { id: string; headline: string; author: string; date: string; shortHash: string }[] }
    | { kind: 'noGit' }
    | { kind: 'unavailable'; reason: string }
    | { kind: 'restricted' };
  limit: number;
  /** True when the log returned as many commits as asked for, so more may exist. */
  more: boolean;
}

/** The latest commits, addressed by opaque `k…` ids. Read-only. */
export async function loadHistory(folder: vscode.WorkspaceFolder, limit: number): Promise<{ result: HistoryResult; commits: Map<string, CommitEntry> }> {
  const commits = new Map<string, CommitEntry>();
  const max = Math.min(Math.max(limit, 1), MAX_COMMITS);
  if (!vscode.workspace.isTrusted) return { result: { git: { kind: 'restricted' }, limit: max, more: false }, commits };
  const history = await getHistory(folder, max);
  if (history.kind !== 'ok') return { result: { git: history, limit: max, more: false }, commits };
  const items = history.commits.map((c, i) => {
    const id = `k${i}`;
    commits.set(id, c);
    return { id, headline: commitHeadline(c.message), author: c.author, date: c.date?.toLocaleString() ?? '', shortHash: c.hash.slice(0, 7) };
  });
  return { result: { git: { kind: 'ok', commits: items }, limit: max, more: items.length >= max && max < MAX_COMMITS }, commits };
}

export interface CommitDetails {
  id: string;
  hash: string;
  message: string;
  author: string;
  date: string;
  /** False for the first commit, whose file list the Git extension API cannot provide. */
  filesAvailable: boolean;
  files: { id: string; path: string; oldPath: string; group: ChangeGroup; sensitive: boolean }[];
  hidden: number;
  truncated: boolean;
}

/** A file of the shown commit, addressed by an opaque `h…` id. */
export interface HistoryFile extends CommitFileRef { sensitive: boolean; hash: string; parent: string }

/** Full message and touched files of one commit. Read-only. */
export async function describeCommit(folder: vscode.WorkspaceFolder, id: string, commit: CommitEntry): Promise<{ details: CommitDetails; files: Map<string, HistoryFile> }> {
  const files = new Map<string, HistoryFile>();
  const details: CommitDetails = {
    id,
    hash: commit.hash,
    message: commit.message,
    author: commit.author,
    date: commit.date?.toLocaleString() ?? '',
    filesAvailable: false,
    files: [],
    hidden: 0,
    truncated: false,
  };
  let refs: CommitFileRef[] | undefined;
  try {
    refs = await getCommitFiles(folder, commit);
  } catch {
    refs = undefined;
  }
  if (!refs || !commit.parent) return { details, files };
  const byKey = new Map(refs.map((r) => [`${r.relPath}\n${r.oldRelPath}`, r]));
  const summary = summarizeCommitFiles(refs, MAX_COMMIT_FILES);
  details.filesAvailable = true;
  details.hidden = summary.hidden;
  details.truncated = summary.truncated;
  details.files = summary.files.map((f, i) => {
    const fileId = `h${i}`;
    const ref = byKey.get(`${f.relPath}\n${f.oldRelPath}`) as CommitFileRef;
    files.set(fileId, { ...ref, sensitive: f.sensitive, hash: commit.hash, parent: commit.parent as string });
    return { id: fileId, path: f.relPath, oldPath: f.oldRelPath, group: f.group, sensitive: f.sensitive };
  });
  return { details, files };
}

const SIDE = { viewColumn: vscode.ViewColumn.Beside, preview: true } as const;

/** Opens a file as it was before and after a commit. Sensitive files are never opened. Read-only. */
export async function openCommitFile(f: HistoryFile): Promise<void> {
  if (f.sensitive) {
    void vscode.window.showInformationMessage(`${f.relPath} is a sensitive file. VibeCode Explorer does not open its contents.`);
    return;
  }
  const short = f.hash.slice(0, 7);
  const name = path.posix.basename(f.relPath);
  const before = gitUriAt(f.originalUri, f.parent);
  const after = gitUriAt(f.uri, f.hash);
  if (!before || !after) return;
  if (f.group === 'added') {
    await vscode.commands.executeCommand('vscode.open', after, SIDE, `${name} (added in ${short})`);
  } else if (f.group === 'deleted') {
    await vscode.commands.executeCommand('vscode.open', before, SIDE, `${name} (deleted in ${short}, previous version)`);
  } else {
    await vscode.commands.executeCommand('vscode.diff', before, after, `${name} (${short}^ ↔ ${short})`, SIDE);
  }
}
