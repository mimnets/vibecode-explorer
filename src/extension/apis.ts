import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeJsApi } from '../analysis/apiJs';
import { analyzePyApi } from '../analysis/apiPy';
import { ApiMap, combineApis, FileApiFacts, MountFact, pythonModuleFile } from '../analysis/apis';
import { analyzePrisma, analyzeSql, SCHEMA_GLOB } from '../analysis/apiSchema';
import { resolveSpecifier, SOURCE_EXTENSIONS } from '../analysis/imports';
import { MAX_TREE_FILES, TREE_EXCLUDE_GLOB } from '../analysis/fileTree';
import { combinePages, htmlAssets, Page } from '../analysis/pages';
import { EXCLUDE_GLOB, isSensitiveFile } from '../analysis/sensitive';
import { CodeLocation, DashboardState, Target } from './state';

// Phase 7: the APIs tab. Reads the graph's source files and the folder's schema files
// (`.sql`, `.prisma`) and finds routes, HTTP calls and database models. Read-only: nothing
// is run, no server is called and no database is opened.
// Phase 8 adds the app's pages (Next.js, React/Vue Router, HTML files, server templates)
// and the files that make each one, so a page can be previewed next to its code.

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCHEMA_FILES = 200;
const MAX_HTML_FILES = 300;
const MAX_PACKAGE_FILES = 20;

/** Graph ids of the files an item involves, so the page can outline them. */
type WithNodes<T> = T & { nodes: string[] };
export type ApisResult =
  | { state: 'restricted' | 'none' }
  | {
    state: 'ok';
    routes: WithNodes<ApiMap['routes'][number]>[];
    calls: WithNodes<ApiMap['calls'][number]>[];
    models: WithNodes<ApiMap['models'][number]>[];
    pages: WithNodes<Page>[];
    truncated: boolean;
  };

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_FILE_BYTES) return undefined;
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export async function loadApis(
  folder: vscode.WorkspaceFolder, state: DashboardState, targets: ReadonlyMap<string, Target>,
): Promise<{ result: ApisResult; locations: Map<string, CodeLocation> }> {
  const locations = new Map<string, CodeLocation>();
  if (!vscode.workspace.isTrusted) return { result: { state: 'restricted' }, locations };

  const uriOf = new Map<string, vscode.Uri>();
  const facts = new Map<string, FileApiFacts>();
  for (const [id, t] of targets) {
    if (!id.startsWith('f') || !t.analysis || t.analysis.skipped || t.sensitive) continue;
    const text = await readText(t.uri);
    if (text === undefined) continue;
    uriOf.set(t.relPath, t.uri);
    const ext = path.posix.extname(t.relPath).toLowerCase();
    try {
      if (SOURCE_EXTENSIONS.includes(ext)) facts.set(t.relPath, analyzeJsApi(t.relPath, text));
      else if (ext === '.py') facts.set(t.relPath, analyzePyApi(text));
    } catch {
      // A file the readers can't handle is left out rather than failing the whole tab.
    }
  }
  const schemaUris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SCHEMA_GLOB), EXCLUDE_GLOB, MAX_SCHEMA_FILES);
  for (const uri of schemaUris) {
    const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
    if (rel.startsWith('..') || isSensitiveFile(rel)) continue;
    const text = await readText(uri);
    if (text === undefined) continue;
    uriOf.set(rel, uri);
    facts.set(rel, rel.endsWith('.prisma') ? analyzePrisma(text) : analyzeSql(text));
  }

  const graphFiles = new Set(state.graph.nodes.filter((n) => n.kind === 'file').map((n) => n.path));
  const idByPath = new Map(state.graph.nodes.filter((n) => n.kind === 'file').map((n) => [n.path, n.id]));
  const pathById = new Map(state.graph.nodes.map((n) => [n.id, n.path]));
  const resolveMount = (from: string, m: MountFact): string | undefined => {
    if ('js' in m.target) return resolveSpecifier(from, m.target.js, graphFiles).target;
    // `users.router` names a variable in the module `users`, so try the shorter name too.
    const mod = m.target.py;
    return pythonModuleFile(from, mod, graphFiles) ?? (mod.includes('.') ? pythonModuleFile(from, mod.slice(0, mod.lastIndexOf('.')), graphFiles) : undefined);
  };
  const importersOf = (file: string): string[] => {
    const id = idByPath.get(file);
    return id ? state.graph.edges.filter((e) => e.target === id).map((e) => pathById.get(e.source) as string) : [];
  };
  const map = combineApis(facts, resolveMount, importersOf);

  // Pages: names of every file (no contents), plus package.json and HTML files, which are read.
  const toRel = (u: vscode.Uri): string => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/');
  const allFiles = (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), TREE_EXCLUDE_GLOB, MAX_TREE_FILES))
    .map(toRel).filter((f) => f && !f.startsWith('..') && !isSensitiveFile(f));
  const allSet = new Set(allFiles);
  let hasNext = false;
  for (const pkg of allFiles.filter((f) => /(^|\/)package\.json$/.test(f)).slice(0, MAX_PACKAGE_FILES)) {
    const text = await readText(vscode.Uri.joinPath(folder.uri, ...pkg.split('/')));
    try {
      const json = text ? JSON.parse(text) : {};
      if (json?.dependencies?.next || json?.devDependencies?.next) hasNext = true;
    } catch {
      // Not valid JSON: ignore it.
    }
  }
  const html = new Map<string, string[]>();
  for (const f of allFiles.filter((x) => /\.html?$/i.test(x)).slice(0, MAX_HTML_FILES)) {
    const text = await readText(vscode.Uri.joinPath(folder.uri, ...f.split('/')));
    if (text !== undefined) html.set(f, htmlAssets(f, text, allSet));
  }
  const importsOf = (file: string): string[] => {
    const id = idByPath.get(file);
    return id ? state.graph.edges.filter((e) => e.source === id).map((e) => pathById.get(e.target) as string).filter((p) => graphFiles.has(p)) : [];
  };
  const resolveComponent = (from: string, spec: string): string | undefined => {
    const hit = resolveSpecifier(from, spec, graphFiles).target;
    if (hit) return hit;
    // Components the graph doesn't read, such as `.vue` files, still exist as files.
    const rel = spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)) : '';
    return rel && allSet.has(rel) ? rel : undefined;
  };
  const pageMap = combinePages({ facts, routes: map.routes, allFiles, hasNext, html, resolveComponent, importsOf });

  const nodesFor = (files: string[]): string[] => [...new Set(files)].map((f) => idByPath.get(f)).filter((x): x is string => !!x);
  const locate = (id: string, file: string, line: number, name: string): void => {
    const uri = uriOf.get(file) ?? vscode.Uri.joinPath(folder.uri, ...file.split('/'));
    if (uri) locations.set(id, { uri, relPath: file, position: new vscode.Position(Math.max(0, line - 1), 0), name });
  };
  const routeFile = new Map(map.routes.map((r) => [r.id, r.file]));
  for (const r of map.routes) locate(r.id, r.file, r.line, `${r.method} ${r.path}`);
  for (const c of map.calls) locate(c.id, c.file, c.line, `${c.method} ${c.url}`);
  for (const m of map.models) locate(m.id, m.file, m.line, m.name);
  for (const p of pageMap.pages) locate(p.id, p.file, p.line, p.path);
  return {
    result: {
      state: 'ok',
      routes: map.routes.map((r) => ({ ...r, nodes: nodesFor([r.file, ...r.callers]) })),
      calls: map.calls.map((c) => ({ ...c, nodes: nodesFor([c.file, ...c.routes.map((id) => routeFile.get(id) as string)]) })),
      models: map.models.map((m) => ({ ...m, nodes: nodesFor([m.file, ...m.usedBy]) })),
      pages: pageMap.pages.map((p) => ({ ...p, nodes: nodesFor([p.file, ...p.files]) })),
      truncated: map.truncated || pageMap.truncated,
    },
    locations,
  };
}
