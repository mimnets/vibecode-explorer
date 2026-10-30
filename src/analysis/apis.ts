// Phase 7: API routes, HTTP calls and database models, found statically. Pure (no `vscode`
// import), so it is unit-testable. Nothing is run, no server is called and no database is
// opened: the per-language readers (apiJs.ts, apiPy.ts, apiSchema.ts) only read source text.
import * as path from 'path';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** What a route sends back as a page (Phase 8): a rendered view, a file, a template, or a Django view function. */
export interface RouteView { render?: string; file?: string; template?: string; handler?: string }
export interface RouteFact { method: HttpMethod; path: string; line: number; framework: string; view?: RouteView }
/** A client-side route (React Router, Vue Router): an address and the component it shows. */
export interface PageRouteFact { path: string; line: number; kind: 'React Router' | 'Vue Router'; component?: string; componentName?: string }
/** A Python view function or class and the template it renders. */
export interface ViewFact { name: string; template: string; line: number }
/** A router included at a path prefix, defined in another file (`app.use('/api', users)`). */
export interface MountFact { prefix: string; line: number; target: { js: string } | { py: string }; framework: string }
/** An HTTP call. `url` has `*` for parts computed while the program runs; '' when nothing is known. */
export interface CallFact { method: HttpMethod; url: string; line: number; client: string }
export interface ModelFact { name: string; table?: string; line: number; kind: string }
/** A use of a Prisma model through its client (`prisma.user.findMany()`). */
export interface ModelUseFact { model: string; line: number }

export interface FileApiFacts {
  routes: RouteFact[];
  mounts: MountFact[];
  calls: CallFact[];
  models: ModelFact[];
  modelUses: ModelUseFact[];
  /** HTTP method names a JS/TS file exports (Next.js route handlers). */
  exportedMethods: HttpMethod[];
  pageRoutes: PageRouteFact[];
  views: ViewFact[];
}

export const emptyFacts = (): FileApiFacts => ({ routes: [], mounts: [], calls: [], models: [], modelUses: [], exportedMethods: [], pageRoutes: [], views: [] });

export interface ApiRoute { id: string; method: HttpMethod; path: string; file: string; line: number; framework: string; callers: string[]; view?: RouteView }
export interface ApiCall { id: string; method: HttpMethod; url: string; file: string; line: number; client: string; routes: string[]; external: boolean }
export interface ApiModel { id: string; name: string; table?: string; kind: string; file: string; line: number; usedBy: string[] }
export interface ApiMap { routes: ApiRoute[]; calls: ApiCall[]; models: ApiModel[]; truncated: boolean }

export const MAX_API_ITEMS = 2000;

/** Joins a prefix and a path into one clean path (`/api` + `users/` → `/api/users`). */
export function joinPath(prefix: string, p: string): string {
  const joined = `/${prefix}/${p}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/';
}

/** True for a route parameter segment in any common style: `:id`, `{id}`, `<int:id>`, `[id]`, `[...slug]`. */
const isParam = (seg: string): boolean => /^:\w+\??$|^\{[^}]+\}$|^<[^>]+>$|^\[[^\]]+\]$|^\*$/.test(seg);
const isCatchAll = (seg: string): boolean => /^\[\[?\.\.\.[^\]]+\]\]?$|^\*$|^:\w+\*$|^\{[^}]+:path\}$|^<path:[^>]+>$/.test(seg);

const segments = (p: string): string[] => p.split('/').filter(Boolean);

/**
 * The path part of a call's URL, or undefined when it points at another server.
 * Relative URLs and `localhost`/`127.0.0.1` count as this project.
 */
export function callPath(url: string): string | undefined {
  let u = url.split(/[?#]/)[0];
  const abs = /^[a-z]+:\/\/([^/]*)(.*)$/i.exec(u);
  if (abs) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:[\d*]+)?$/i.test(abs[1])) return undefined;
    u = abs[2] || '/';
  }
  // A computed base URL in front (`${API}/users`) is dropped: the path is what matters.
  u = u.replace(/^\*+(?=\/)/, '');
  return u.startsWith('/') ? u : undefined;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One segment: a route parameter matches anything, and `*` in the call stands for computed text. */
function segmentMatches(route: string, call: string): boolean {
  if (isParam(route) || call === '*') return true;
  if (call.includes('*')) return new RegExp(`^${call.split('*').map(escape).join('.*')}$`).test(route);
  return route === call;
}

/** Whether a call's path can reach a route's path. */
export function pathMatches(routePath: string, callUrlPath: string): boolean {
  const r = segments(routePath);
  const c = segments(callUrlPath);
  for (let i = 0; i < r.length; i++) {
    // `[...slug]` needs at least one more segment, `[[...slug]]` none.
    if (isCatchAll(r[i])) return c.length >= i + (r[i].startsWith('[[') ? 0 : 1);
    if (i >= c.length || !segmentMatches(r[i], c[i])) return false;
  }
  return r.length === c.length;
}

const methodMatches = (route: HttpMethod, call: HttpMethod): boolean => route === 'ANY' || call === 'ANY' || route === call;

/** Next.js file-based routes: `app/**\/route.ts` (one route per exported method) and `pages/api/**`. */
export function nextRoutes(relPath: string, exportedMethods: HttpMethod[]): RouteFact[] {
  const app = /^(?:.*\/)?(?:src\/)?app\/(.*\/)?route\.[cm]?[jt]sx?$/.exec(relPath);
  if (app && exportedMethods.length) {
    // Route groups `(name)` and private folders `_name` don't appear in the URL.
    const p = joinPath('', (app[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('_') && !s.startsWith('@')).join('/'));
    return exportedMethods.map((method) => ({ method, path: p, line: 1, framework: 'Next.js' }));
  }
  const pages = /^(?:.*\/)?(?:src\/)?pages\/(api(?:\/.*)?)\.[cm]?[jt]sx?$/.exec(relPath);
  if (pages) return [{ method: 'ANY', path: joinPath('', pages[1].replace(/(^|\/)index$/, '')), line: 1, framework: 'Next.js' }];
  return [];
}

/**
 * Turns every file's facts into one map: routes with mount prefixes applied, calls matched to
 * routes, and models with the files that use them. `resolveMount` finds the file a mount points
 * at; `importersOf` lists the files that import a file (from the dependency graph).
 */
export function combineApis(
  facts: ReadonlyMap<string, FileApiFacts>,
  resolveMount: (fromFile: string, mount: MountFact) => string | undefined,
  importersOf: (file: string) => string[],
): ApiMap {
  // Prefixes for files mounted by others, followed up to 5 levels (`/api` → `/v1` → routes).
  const mountedAt = new Map<string, string[]>();
  for (const [file, f] of facts) {
    for (const m of f.mounts) {
      const target = resolveMount(file, m);
      if (target && target !== file) mountedAt.set(target, [...(mountedAt.get(target) ?? []), `${file}\n${m.prefix}`]);
    }
  }
  const prefixesOf = (file: string, depth = 0): string[] => {
    const parents = mountedAt.get(file);
    if (!parents || depth > 5) return [''];
    return parents.flatMap((entry) => {
      const [parent, prefix] = entry.split('\n');
      return prefixesOf(parent, depth + 1).map((p) => joinPath(p, prefix));
    });
  };

  const routes: ApiRoute[] = [];
  const calls: ApiCall[] = [];
  const models: ApiModel[] = [];
  let truncated = false;
  const files = [...facts.keys()].sort();
  for (const file of files) {
    const f = facts.get(file) as FileApiFacts;
    const own = [...f.routes, ...nextRoutes(file, f.exportedMethods)];
    const prefixes = prefixesOf(file);
    for (const r of own) {
      for (const prefix of prefixes) {
        if (routes.length >= MAX_API_ITEMS) { truncated = true; break; }
        routes.push({ id: `w${routes.length}`, method: r.method, path: joinPath(prefix, r.path), file, line: r.line, framework: r.framework, callers: [], view: r.view });
      }
    }
    for (const c of f.calls) {
      if (calls.length >= MAX_API_ITEMS) { truncated = true; break; }
      const p = callPath(c.url);
      calls.push({ id: `x${calls.length}`, method: c.method, url: c.url, file, line: c.line, client: c.client, routes: [], external: p === undefined && /^[a-z]+:\/\//i.test(c.url) });
    }
    for (const m of f.models) {
      if (models.length >= MAX_API_ITEMS) { truncated = true; break; }
      models.push({ id: `m${models.length}`, name: m.name, table: m.table, kind: m.kind, file, line: m.line, usedBy: [] });
    }
  }

  // Calls → routes. Several routes may match (for example GET /users/:id and GET /users/me).
  for (const c of calls) {
    const p = callPath(c.url);
    if (p === undefined) continue;
    for (const r of routes) {
      if (methodMatches(r.method, c.method) && pathMatches(r.path, p)) {
        c.routes.push(r.id);
        if (!r.callers.includes(c.file)) r.callers.push(c.file);
      }
    }
  }

  // Models → files that use them: importers of a code model's file, or Prisma client uses.
  const prismaUses = new Map<string, Set<string>>();
  for (const [file, f] of facts) {
    for (const u of f.modelUses) {
      const key = u.model.toLowerCase();
      prismaUses.set(key, (prismaUses.get(key) ?? new Set()).add(file));
    }
  }
  for (const m of models) {
    const users = m.kind === 'Prisma model' ? [...(prismaUses.get(m.name.toLowerCase()) ?? [])] : m.kind === 'SQL table' ? [] : importersOf(m.file);
    m.usedBy = [...new Set(users)].filter((u) => u !== m.file).sort();
  }
  return { routes, calls, models, truncated };
}

/** A Python module name (`shop.urls`, `.routers.users`) to a file, relative to the importing file. */
export function pythonModuleFile(fromRel: string, module: string, files: ReadonlySet<string>): string | undefined {
  const dir = path.posix.dirname(fromRel) === '.' ? '' : path.posix.dirname(fromRel);
  const fileFor = (base: string): string | undefined => [`${base}.py`, `${base}/__init__.py`].find((c) => files.has(c));
  if (module.startsWith('.')) {
    const level = /^\.+/.exec(module)![0].length;
    let pkg = dir;
    for (let k = 1; k < level; k++) pkg = path.posix.dirname(pkg) === '.' ? '' : path.posix.dirname(pkg);
    const rest = module.slice(level);
    return fileFor(path.posix.join(pkg, rest.split('.').join('/')));
  }
  for (const root of [...new Set(['', 'src', dir])]) {
    const hit = fileFor(path.posix.join(root, module.split('.').join('/')));
    if (hit) return hit;
  }
  return undefined;
}
