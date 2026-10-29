import * as path from 'path';
import * as vscode from 'vscode';
import { buildGraph, FileAnalysis } from '../analysis/graph';
import { SOURCE_EXTENSIONS } from '../analysis/imports';
import { EXCLUDE_GLOB, isSensitiveFile } from '../analysis/sensitive';
import { ChangeGroup } from '../git/status';
import { getGitSnapshot, WorkspaceChange } from '../git/gitChanges';

const MAX_FILE_BYTES = 512 * 1024;

/** Something the webview may ask to open or inspect, addressed by an opaque id. */
export interface Target {
  uri: vscode.Uri;
  relPath: string;
  sensitive: boolean;
  group?: ChangeGroup;
  /** Present for items in the changes list: opening shows a diff where possible. */
  change?: WorkspaceChange;
  analysis?: FileAnalysis;
}

export interface ChangeItem { id: string; path: string; group: ChangeGroup; staged: boolean; sensitive: boolean }
export interface GraphNode { id: string; label: string; path: string; kind: 'file' | 'unknown'; group?: ChangeGroup }

export interface DashboardState {
  trusted: boolean;
  folders: string[];
  folderIndex: number;
  git:
    | { kind: 'ok'; repoName: string; branch: string; changes: ChangeItem[] }
    | { kind: 'noGit' }
    | { kind: 'unavailable'; reason: string }
    | { kind: 'restricted' }
    | { kind: 'none' };
  graph: { nodes: GraphNode[]; edges: { source: string; target: string }[]; fileCount: number; truncated: boolean; maxFiles: number };
  previewUrl: string;
  scannedAt: string;
}

const emptyGraph = (maxFiles: number): DashboardState['graph'] => ({ nodes: [], edges: [], fileCount: 0, truncated: false, maxFiles });

/** Collects everything the dashboard shows for one workspace folder. Never writes to the workspace. */
export async function collectState(folderIndex: number, refreshGit: boolean): Promise<{ state: DashboardState; targets: Map<string, Target> }> {
  const config = vscode.workspace.getConfiguration('vibecodeExplorer');
  const maxFiles = Math.min(Math.max(config.get<number>('maxGraphFiles', 500), 10), 5000);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const index = folderIndex < folders.length ? folderIndex : 0;
  const targets = new Map<string, Target>();
  const state: DashboardState = {
    trusted: vscode.workspace.isTrusted,
    folders: folders.map((f) => f.name),
    folderIndex: index,
    git: { kind: 'none' },
    graph: emptyGraph(maxFiles),
    previewUrl: config.get<string>('previewUrl', ''),
    scannedAt: new Date().toLocaleTimeString(),
  };
  const folder = folders[index];
  if (!folder) return { state, targets };
  if (!vscode.workspace.isTrusted) {
    state.git = { kind: 'restricted' };
    return { state, targets };
  }

  // Git changes
  const snapshot = await getGitSnapshot(folder, refreshGit);
  const groupByPath = new Map<string, ChangeGroup>();
  if (snapshot.kind === 'ok') {
    const items = snapshot.changes.map((c, i): ChangeItem => {
      const id = `c${i}`;
      const sensitive = isSensitiveFile(c.relPath);
      targets.set(id, { uri: c.uri, relPath: c.relPath, sensitive, group: c.group, change: c });
      groupByPath.set(c.relPath, c.group);
      return { id, path: c.relPath, group: c.group, staged: c.staged, sensitive };
    });
    state.git = { kind: 'ok', repoName: snapshot.repoName, branch: snapshot.branch, changes: items };
  } else {
    state.git = snapshot;
  }

  // Dependency graph (JS/TS only in Phase 1)
  const include = new vscode.RelativePattern(folder, `**/*{${SOURCE_EXTENSIONS.join(',')}}`);
  const uris = await vscode.workspace.findFiles(include, EXCLUDE_GLOB, maxFiles * 4);
  const toRel = (u: vscode.Uri): string => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/');
  const uriByRel = new Map(uris.map((u) => [toRel(u), u]));

  const graph = await buildGraph([...uriByRel.keys()], async (rel) => {
    const uri = uriByRel.get(rel);
    if (!uri) return undefined;
    try {
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_FILE_BYTES) return undefined;
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return undefined;
    }
  }, maxFiles);

  const idByPath = new Map<string, string>();
  const nodes: GraphNode[] = graph.files.map((f, i) => {
    const id = `f${i}`;
    idByPath.set(f.path, id);
    const uri = uriByRel.get(f.path) as vscode.Uri;
    targets.set(id, { uri, relPath: f.path, sensitive: false, group: groupByPath.get(f.path), analysis: f });
    return { id, label: path.posix.basename(f.path), path: f.path, kind: 'file', group: groupByPath.get(f.path) };
  });

  // Unresolved/dynamic imports become shared "unknown" nodes instead of guessed edges.
  const unknownIds = new Map<string, string>();
  const unknownNode = (label: string): string => {
    let id = unknownIds.get(label);
    if (!id) {
      id = `u${unknownIds.size}`;
      unknownIds.set(label, id);
      nodes.push({ id, label, path: label, kind: 'unknown' });
    }
    return id;
  };
  const edges: { source: string; target: string }[] = [];
  for (const f of graph.files) {
    const source = idByPath.get(f.path) as string;
    for (const imp of f.imports) {
      if (imp.kind === 'local' && imp.target) edges.push({ source, target: idByPath.get(imp.target) as string });
      else if (imp.kind === 'unknown') edges.push({ source, target: unknownNode(`? ${imp.specifier}`) });
    }
    if (f.dynamicUnknown > 0) edges.push({ source, target: unknownNode('? dynamic import') });
  }

  state.graph = { nodes, edges, fileCount: graph.files.length, truncated: graph.truncated || uris.length >= maxFiles * 4, maxFiles };
  return { state, targets };
}

export interface FileDetails {
  id: string;
  path: string;
  fileType: string;
  group?: ChangeGroup;
  sensitive: boolean;
  imports: { specifier: string; kind: string; target?: string }[];
  dynamicUnknown: number;
  analyzed: boolean;
  note?: string;
  symbols: { name: string; kind: string; line: number; depth: number }[];
}

const MAX_SYMBOLS = 200;

/** Details for the info panel. Symbols come from whatever VS Code language support is installed. */
export async function describeTarget(id: string, t: Target): Promise<FileDetails> {
  const ext = path.posix.extname(t.relPath);
  const details: FileDetails = {
    id,
    path: t.relPath,
    fileType: ext ? ext.slice(1).toUpperCase() : 'no extension',
    group: t.group,
    sensitive: t.sensitive,
    imports: t.analysis?.imports ?? [],
    dynamicUnknown: t.analysis?.dynamicUnknown ?? 0,
    analyzed: !!t.analysis && !t.analysis.skipped,
    note: t.analysis?.skipped,
    symbols: [],
  };
  if (t.sensitive) {
    details.note = 'Sensitive file: contents are never read or analyzed.';
    return details;
  }
  if (t.group === 'deleted') {
    details.note = 'Deleted in the working tree. Open shows the HEAD version.';
    return details;
  }
  try {
    const result = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined>(
      'vscode.executeDocumentSymbolProvider', t.uri);
    const walk = (items: (vscode.DocumentSymbol | vscode.SymbolInformation)[], depth: number): void => {
      for (const s of items) {
        if (details.symbols.length >= MAX_SYMBOLS) return;
        const range = 'range' in s ? s.range : s.location.range;
        details.symbols.push({ name: s.name, kind: vscode.SymbolKind[s.kind], line: range.start.line + 1, depth });
        if ('children' in s && depth < 2) walk(s.children, depth + 1);
      }
    };
    walk(result ?? [], 0);
  } catch {
    // No symbol provider for this language: leave the list empty.
  }
  return details;
}
