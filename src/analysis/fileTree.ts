// Phase 6d: the project's folders and files as a tree for the Files tab. Pure (no `vscode`
// import), so it is unit-testable. Only names are used here; no file is read.

import { EXCLUDED_DIRS } from './sensitive';

export const MAX_TREE_FILES = 5000;

/** Glob for `workspace.findFiles`: like the graph's, but sensitive files are listed (never read). */
export const TREE_EXCLUDE_GLOB = `{${EXCLUDED_DIRS.map((d) => `**/${d}/**`).join(',')},**/*.egg-info/**}`;

export interface TreeFileInput {
  path: string;
  /** Opaque id the host issued for this file. */
  id: string;
  group?: string;
  sensitive: boolean;
  /** True when the file is a node in the dependency graph. */
  inGraph: boolean;
}

export interface TreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  /** Number of files anywhere below this folder. */
  files: number;
  children: TreeNode[];
}

export interface TreeFile extends TreeFileInput {
  kind: 'file';
  name: string;
}

export type TreeNode = TreeFolder | TreeFile;

const byName = (a: TreeNode, b: TreeNode): number => {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

/** Builds the tree under a root folder: folders first, then files, each sorted by name. */
export function buildFileTree(files: TreeFileInput[]): TreeFolder {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', files: 0, children: [] };
  const folders = new Map<string, TreeFolder>([['', root]]);
  const folderAt = (dir: string): TreeFolder => {
    let f = folders.get(dir);
    if (f) return f;
    const slash = dir.lastIndexOf('/');
    const parent = folderAt(slash < 0 ? '' : dir.slice(0, slash));
    f = { kind: 'folder', name: dir.slice(slash + 1), path: dir, files: 0, children: [] };
    parent.children.push(f);
    folders.set(dir, f);
    return f;
  };
  const seen = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    const clean = parts.join('/');
    if (parts.length === 0 || seen.has(clean) || parts.some((p) => p === '..' || p === '.')) continue;
    seen.add(clean);
    const dir = parts.slice(0, -1).join('/');
    folderAt(dir).children.push({ ...file, path: clean, kind: 'file', name: parts[parts.length - 1] });
    for (let d = dir; ; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
      (folders.get(d) as TreeFolder).files++;
      if (d === '') break;
    }
  }
  for (const f of folders.values()) f.children.sort(byName);
  return root;
}
