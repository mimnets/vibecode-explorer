import * as path from 'path';
import * as vscode from 'vscode';
import { buildGraph, FileAnalysis } from '../analysis/graph';
import { SOURCE_EXTENSIONS } from '../analysis/imports';
import { EXCLUDE_GLOB, isSensitiveFile } from '../analysis/sensitive';
import { summarizeUsages, UsageLocation } from '../analysis/usages';
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
  symbols: { id: string; name: string; kind: string; line: number; depth: number }[];
}

/** A code position the webview may jump to, addressed by an opaque id (`s…` symbol, `r…` usage). */
export interface CodeLocation { uri: vscode.Uri; relPath: string; position: vscode.Position; name: string }

const MAX_SYMBOLS = 200;
const MAX_USAGES = 100;

/** Details for the info panel. Symbols come from whatever VS Code language support is installed. */
export async function describeTarget(id: string, t: Target): Promise<{ details: FileDetails; symbols: Map<string, CodeLocation> }> {
  const symbols = new Map<string, CodeLocation>();
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
    return { details, symbols };
  }
  if (t.group === 'deleted') {
    details.note = 'Deleted in the working tree. Open shows the HEAD version.';
    return { details, symbols };
  }
  try {
    const result = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined>(
      'vscode.executeDocumentSymbolProvider', t.uri);
    const walk = (items: (vscode.DocumentSymbol | vscode.SymbolInformation)[], depth: number): void => {
      for (const s of items) {
        if (details.symbols.length >= MAX_SYMBOLS) return;
        // selectionRange is the symbol's name, which is where reference lookups must start.
        const position = 'selectionRange' in s ? s.selectionRange.start : s.location.range.start;
        const symbolId = `s${details.symbols.length}`;
        symbols.set(symbolId, { uri: t.uri, relPath: t.relPath, position, name: s.name });
        details.symbols.push({ id: symbolId, name: s.name, kind: vscode.SymbolKind[s.kind], line: position.line + 1, depth });
        if ('children' in s && depth < 2) walk(s.children, depth + 1);
      }
    };
    walk(result ?? [], 0);
  } catch {
    // No symbol provider for this language: leave the list empty.
  }
  return { details, symbols };
}

export interface UsageResult {
  symbol: string;
  /** False when no language support answered the reference request. */
  available: boolean;
  usages: { id: string; path: string; line: number }[];
  files: string[];
  hidden: number;
  truncated: boolean;
}

/** Where a symbol is used inside the folder, via VS Code's reference provider ("Find All References"). Read-only. */
export async function findUsages(folder: vscode.Uri, ref: CodeLocation): Promise<{ result: UsageResult; locations: Map<string, CodeLocation> }> {
  const locations = new Map<string, CodeLocation>();
  const result: UsageResult = { symbol: ref.name, available: false, usages: [], files: [], hidden: 0, truncated: false };
  let found: vscode.Location[] | undefined;
  try {
    found = await vscode.commands.executeCommand<vscode.Location[] | undefined>('vscode.executeReferenceProvider', ref.uri, ref.position);
  } catch {
    return { result, locations };
  }
  if (!found) return { result, locations };
  const locByKey = new Map<string, vscode.Location>();
  const raw: UsageLocation[] = found.map((loc) => {
    const relPath = loc.uri.scheme === 'file' ? path.relative(folder.fsPath, loc.uri.fsPath).split(path.sep).join('/') : '';
    const line = loc.range.start.line + 1;
    if (!locByKey.has(`${relPath}:${line}`)) locByKey.set(`${relPath}:${line}`, loc);
    return { relPath, line };
  });
  const summary = summarizeUsages(raw, MAX_USAGES);
  result.available = true;
  result.files = summary.files;
  result.hidden = summary.hidden;
  result.truncated = summary.truncated;
  result.usages = summary.usages.map((u, i) => {
    const id = `r${i}`;
    const loc = locByKey.get(`${u.relPath}:${u.line}`) as vscode.Location;
    locations.set(id, { uri: loc.uri, relPath: u.relPath, position: loc.range.start, name: ref.name });
    return { id, path: u.relPath, line: u.line };
  });
  return { result, locations };
}
