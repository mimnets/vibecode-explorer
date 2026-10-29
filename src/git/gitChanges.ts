import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeGroup, groupForStatus, moreSignificant } from './status';

// Minimal subset of the built-in Git extension API (extensions/git/src/api/git.d.ts).
interface GitChange { readonly uri: vscode.Uri; readonly originalUri: vscode.Uri; readonly status: number }
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

/** Read-only view of the Git changes inside one workspace folder. */
export async function getGitSnapshot(folder: vscode.WorkspaceFolder, refresh: boolean): Promise<GitSnapshot> {
  const api = await getApi();
  if (typeof api === 'string') return { kind: 'unavailable', reason: api };

  const repo = api.getRepository(folder.uri) ?? await api.openRepository(folder.uri);
  if (!repo) return { kind: 'noGit' };
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
