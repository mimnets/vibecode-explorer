import * as path from 'path';
import * as vscode from 'vscode';
import { buildFileTree, MAX_TREE_FILES, TREE_EXCLUDE_GLOB, TreeFileInput, TreeFolder } from '../analysis/fileTree';
import { isSensitiveFile } from '../analysis/sensitive';
import { Target } from './state';

// Phase 6d: the Files tab. Lists file names only (no file is read), skipping dependency
// and build folders. Graph files keep their graph id (`f…`), changed files their change
// id (`c…`, so opening shows the diff), and every other file gets a new `p…` id.

export type FilesResult =
  | { state: 'restricted' | 'none' }
  | { state: 'ok'; folder: string; tree: TreeFolder; truncated: boolean };

export async function listProjectFiles(
  folder: vscode.WorkspaceFolder,
  targets: Map<string, Target>,
): Promise<{ result: FilesResult; added: Map<string, Target> }> {
  const added = new Map<string, Target>();
  if (!vscode.workspace.isTrusted) return { result: { state: 'restricted' }, added };
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), TREE_EXCLUDE_GLOB, MAX_TREE_FILES + 1);
  const truncated = uris.length > MAX_TREE_FILES;
  const toRel = (u: vscode.Uri): string => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/');

  const graphId = new Map<string, string>();
  const changeId = new Map<string, string>();
  for (const [id, t] of targets) {
    if (id.startsWith('f')) graphId.set(t.relPath, id);
    else if (id.startsWith('c')) changeId.set(t.relPath, id);
  }
  const inputs: TreeFileInput[] = [];
  const add = (relPath: string, uri: vscode.Uri): void => {
    const sensitive = isSensitiveFile(relPath);
    const fid = graphId.get(relPath);
    const cid = changeId.get(relPath);
    const existing = fid ?? cid;
    let id = existing;
    if (!id) {
      id = `p${added.size}`;
      added.set(id, { uri, relPath, sensitive });
    }
    const group = targets.get(cid ?? id)?.group;
    inputs.push({ path: relPath, id, group, sensitive, inGraph: fid !== undefined });
  };
  for (const uri of uris.slice(0, MAX_TREE_FILES)) {
    const rel = toRel(uri);
    if (rel && !rel.startsWith('..')) add(rel, uri);
  }
  // Files deleted in the working tree are not on disk, but the changes list knows them.
  for (const [id, t] of targets) {
    if (id.startsWith('c') && t.group === 'deleted' && !inputs.some((i) => i.path === t.relPath)) add(t.relPath, t.uri);
  }
  return { result: { state: 'ok', folder: folder.name, tree: buildFileTree(inputs), truncated }, added };
}
