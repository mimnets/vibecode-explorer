import * as path from 'path';
import * as vscode from 'vscode';
import { CommitFile } from './history';
import { ChangeGroup, groupForStatus, moreSignificant } from './status';

// Minimal subset of the built-in Git extension API (extensions/git/src/api/git.d.ts).
interface GitChange { readonly uri: vscode.Uri; readonly originalUri: vscode.Uri; readonly status: number }
interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
}
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: { readonly name?: string; readonly commit?: string };
    readonly indexChanges: GitChange[];
    readonly workingTreeChanges: GitChange[];
    readonly untrackedChanges?: GitChange[];
    readonly mergeChanges: GitChange[];
  };
  status(): Promise<void>;
  log(options?: { maxEntries?: number; path?: string }): Promise<GitCommit[]>;
  /** Runs `git diff ref1...ref2`; both refs must be commits. */
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
}
interface GitAPI {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  getRepository(uri: vscode.Uri): GitRepository | null;
  openRepository(root: vscode.Uri): Promise<GitRepository | null>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
interface GitExtension { readonly enabled: boolean; getAPI(version: 1): GitAPI }

export interface WorkspaceChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  /** POSIX path relative to the workspace folder. */
  relPath: string;
  group: ChangeGroup;
  staged: boolean;
}

export type GitSnapshot =
  | { kind: 'ok'; repoName: string; branch: string; changes: WorkspaceChange[] }
  | { kind: 'noGit' }
  | { kind: 'unavailable'; reason: string };

let cachedApi: GitAPI | undefined;

async function getApi(): Promise<GitAPI | string> {
  if (cachedApi) return cachedApi;
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return 'The built-in Git extension is not available.';
  const exports = ext.isActive ? ext.exports : await ext.activate();
  if (!exports.enabled) return 'Git is disabled in VS Code settings (git.enabled).';
  const api = exports.getAPI(1);
  if (api.state !== 'initialized') {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      api.onDidChangeState((s) => { if (s === 'initialized') { clearTimeout(timer); resolve(); } });
    });
  }
  cachedApi = api;
  return api;
}

type RepoLookup = { kind: 'repo'; repo: GitRepository } | { kind: 'noGit' } | { kind: 'unavailable'; reason: string };

async function findRepo(folder: vscode.WorkspaceFolder): Promise<RepoLookup> {
  const api = await getApi();
  if (typeof api === 'string') return { kind: 'unavailable', reason: api };
  const repo = api.getRepository(folder.uri) ?? await api.openRepository(folder.uri);
  return repo ? { kind: 'repo', repo } : { kind: 'noGit' };
}

function relativeTo(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** Read-only view of the Git changes inside one workspace folder. */
export async function getGitSnapshot(folder: vscode.WorkspaceFolder, refresh: boolean): Promise<GitSnapshot> {
  const found = await findRepo(folder);
  if (found.kind !== 'repo') return found;
  const { repo } = found;
  if (refresh) await repo.status();

  const { state } = repo;
  const byPath = new Map<string, WorkspaceChange>();
  const add = (changes: GitChange[] | undefined, staged: boolean): void => {
    for (const c of changes ?? []) {
      const group = groupForStatus(c.status);
      if (!group) continue;
      const rel = path.relative(folder.uri.fsPath, c.uri.fsPath);
      // Only changes inside this folder; a repo can span several workspace folders.
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const key = c.uri.fsPath.toLowerCase();
      const prev = byPath.get(key);
      byPath.set(key, {
        uri: c.uri,
        originalUri: c.originalUri,
        relPath: rel.split(path.sep).join('/'),
        group: prev ? moreSignificant(prev.group, group) : group,
        staged: staged || (prev?.staged ?? false),
      });
    }
  };
  add(state.mergeChanges, false);
  add(state.indexChanges, true);
  add(state.workingTreeChanges, false);
  add(state.untrackedChanges, false);

  const changes = [...byPath.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
  const branch = state.HEAD?.name ?? (state.HEAD?.commit ? `detached at ${state.HEAD.commit.slice(0, 7)}` : 'no commits yet');
  return { kind: 'ok', repoName: path.basename(repo.rootUri.fsPath), branch, changes };
}

/** URI for the HEAD version of a file (read-only, served by the Git extension). */
export function headUri(uri: vscode.Uri): vscode.Uri | undefined {
  return cachedApi?.toGitUri(uri, 'HEAD');
}

export interface CommitEntry {
  hash: string;
  /** First parent, or undefined for the first commit of the repository. */
  parent?: string;
  message: string;
  author: string;
  date?: Date;
}

export type HistorySnapshot =
  | { kind: 'ok'; commits: CommitEntry[] }
  | { kind: 'noGit' }
  | { kind: 'unavailable'; reason: string };

/** The latest commits of the folder's repository, newest first. Read-only. */
export async function getHistory(folder: vscode.WorkspaceFolder, max: number): Promise<HistorySnapshot> {
  const found = await findRepo(folder);
  if (found.kind !== 'repo') return found;
  const { repo } = found;
  try {
    const commits = await repo.log({ maxEntries: max });
    return {
      kind: 'ok',
      commits: commits.map((c) => ({ hash: c.hash, parent: c.parents[0], message: c.message, author: c.authorName ?? '', date: c.authorDate })),
    };
  } catch {
    // A repository without commits makes `git log` fail.
    return { kind: 'ok', commits: [] };
  }
}

/** How many commits changed a file (capped), and the date of the latest. Read-only. */
export async function getFileHistory(folder: vscode.WorkspaceFolder, uri: vscode.Uri, max: number): Promise<{ count: number; capped: boolean; last?: Date } | undefined> {
  const found = await findRepo(folder);
  if (found.kind !== 'repo') return undefined;
  try {
    const commits = await found.repo.log({ maxEntries: max, path: uri.fsPath });
    return { count: commits.length, capped: commits.length >= max, last: commits[0]?.authorDate };
  } catch {
    return undefined;
  }
}

/** A file touched by a commit, with the URIs needed to show it before and after. */
export interface CommitFileRef extends CommitFile { uri: vscode.Uri; originalUri: vscode.Uri }

/**
 * Files changed by a commit compared with its first parent. Returns undefined for the
 * first commit: the Git extension API can only diff two commits, not a commit and the empty tree.
 */
export async function getCommitFiles(folder: vscode.WorkspaceFolder, commit: CommitEntry): Promise<CommitFileRef[] | undefined> {
  if (!commit.parent) return undefined;
  const found = await findRepo(folder);
  if (found.kind !== 'repo') return undefined;
  const { repo } = found;
  const changes = await repo.diffBetween(commit.parent, commit.hash);
  const files: CommitFileRef[] = [];
  for (const c of changes) {
    const group = groupForStatus(c.status);
    if (!group) continue;
    const relPath = relativeTo(folder, c.uri);
    const oldRelPath = group === 'renamed' ? relativeTo(folder, c.originalUri) : '';
    files.push({ relPath, oldRelPath, group, uri: c.uri, originalUri: c.originalUri });
  }
  return files;
}

/** URI for a file's content at a commit (read-only, served by the Git extension). */
export function gitUriAt(uri: vscode.Uri, ref: string): vscode.Uri | undefined {
  return cachedApi?.toGitUri(uri, ref);
}
