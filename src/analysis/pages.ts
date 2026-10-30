// Phase 8: the app's pages and the files that make them, found statically, so a page can be
// previewed next to its code. Pure (no `vscode` import), unit-testable. Only links that can be
// read from the code are made; anything else is left out or marked as not found.
import * as path from 'path';
import { ApiRoute, FileApiFacts } from './apis';

export type PageKind = 'Next.js page' | 'React Router' | 'Vue Router' | 'HTML page' | 'Express view' | 'Flask template' | 'FastAPI template' | 'Django template';

export interface Page {
  id: string;
  /** Address of the page in the app, e.g. `/users/[id]`. */
  path: string;
  kind: PageKind;
  /** The page's main file (page component, HTML file or route handler). */
  file: string;
  line: number;
  /** Template file the page renders, when found. */
  template?: string;
  /** A template or component that is named in the code but could not be found. */
  missing?: string;
  /** Other files that make up the page (layouts, imported scripts, the template). */
  files: string[];
  /** True when the address has parts (like `:id`) that need a value before previewing. */
  needsValue: boolean;
}

export const MAX_PAGES = 1000;

const PAGE_EXT = /\.(tsx|jsx|ts|js|mdx|md)$/;

/** Next.js file-based pages: `app/**\/page.tsx` and `pages/**` (not `pages/api`, `_app`, `_document`). */
export function nextPagePath(relPath: string): string | undefined {
  const app = /^(?:.*\/)?(?:src\/)?app\/(.*\/)?page\.(?:tsx|jsx|ts|js|mdx|md)$/.exec(relPath);
  if (app) {
    const segs = (app[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('_') && !s.startsWith('@'));
    return '/' + segs.join('/');
  }
  const pages = /^(?:.*\/)?(?:src\/)?pages\/(.+)$/.exec(relPath);
  if (pages && PAGE_EXT.test(pages[1])) {
    const route = pages[1].replace(PAGE_EXT, '');
    if (route === 'api' || route.startsWith('api/') || /(^|\/)_(app|document|error|middleware)$/.test(route)) return undefined;
    return '/' + route.replace(/(^|\/)index$/, '').replace(/^\/+/, '');
  }
  return undefined;
}

/** Next.js app-router layouts that wrap a page: `layout.tsx` in its folder and every parent up to `app/`. */
export function nextLayouts(pageFile: string, files: ReadonlySet<string>): string[] {
  const m = /^((?:.*\/)?(?:src\/)?app)\/(.*\/)?page\.[^/]+$/.exec(pageFile);
  if (!m) return [];
  const out: string[] = [];
  let dir = path.posix.dirname(pageFile);
  for (;;) {
    for (const ext of ['tsx', 'jsx', 'ts', 'js']) if (files.has(`${dir}/layout.${ext}`)) out.push(`${dir}/layout.${ext}`);
    if (dir === m[1] || !dir.includes('/')) break;
    dir = path.posix.dirname(dir);
  }
  return out;
}

/** The address an HTML file is served at: `public/` and `static/` folders are the site root. */
export function htmlPagePath(relPath: string): string {
  const served = relPath.replace(/^(?:.*\/)?(?:public|static|www)\//, '');
  return '/' + served.replace(/(^|\/)index\.html?$/i, '');
}

/** Local scripts and stylesheets an HTML page loads, as folder-relative paths. */
export function htmlAssets(relPath: string, html: string, files: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const refs = [
    ...noComments.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
    ...noComments.matchAll(/<link\b(?=[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload)["']?)[^>]*\bhref\s*=\s*["']([^"']+)["']/gi),
  ].map((m) => m[1]);
  const dir = path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath);
  const servedRoot = /^((?:.*\/)?(?:public|static|www))\//.exec(relPath)?.[1];
  for (const ref of refs) {
    if (/^[a-z]+:|^\/\//i.test(ref)) continue; // another server
    const clean = ref.split(/[?#]/)[0];
    // `/src/main.ts` is from the project root (Vite) or from the served folder.
    const candidates = clean.startsWith('/')
      ? [clean.slice(1), servedRoot ? `${servedRoot}${clean}` : '', dir ? `${dir}${clean}` : '']
      : [path.posix.normalize(path.posix.join(dir, clean))];
    const hit = candidates.find((c) => c && !c.startsWith('..') && files.has(c));
    if (hit) out.add(hit);
  }
  return [...out];
}

/**
 * A template named in the code, as a project file: Express views (`views/users.ejs`),
 * Flask and Django templates (`templates/shop/cart.html`).
 */
export function findTemplate(name: string, kind: 'express' | 'python', files: readonly string[]): string | undefined {
  const clean = name.replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return undefined;
  const hits = files.filter((f) => kind === 'express'
    ? f.endsWith(`views/${clean}`) || new RegExp(`(^|/)views/${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z]+$`).test(f)
    : f.endsWith(`templates/${clean}`));
  return hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
}

/** True when the address has parts that need a value: `:id`, `{id}`, `<int:id>`, `[id]`, `*`. */
export const needsValue = (p: string): boolean => /\/(:|\{|<|\[)|\*/.test(p);

/** Checks a page address typed by the owner before it is joined to the preview URL. */
export function safePagePath(p: unknown): string | undefined {
  if (typeof p !== 'string' || p.length > 512 || !p.startsWith('/') || p.startsWith('//')) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(p)) return undefined;
  return p;
}

/** The preview address for a page: the preview URL's origin and path, then the page path. */
export function previewAddress(base: string, pagePath: string): string | undefined {
  const safe = safePagePath(pagePath);
  if (!safe) return undefined;
  let b: URL;
  try {
    b = new URL(base);
  } catch {
    return undefined;
  }
  const url = new URL(b.pathname.replace(/\/+$/, '') + safe, b.origin);
  return url.origin === b.origin ? url.toString() : undefined;
}

export interface PageInputs {
  facts: ReadonlyMap<string, FileApiFacts>;
  /** Routes with mount prefixes applied (from combineApis). */
  routes: readonly ApiRoute[];
  /** Every file name in the folder (no contents). */
  allFiles: readonly string[];
  /** True when a package.json lists `next`, so `pages/` and `app/` are Next.js folders. */
  hasNext: boolean;
  /** HTML files and the local scripts and stylesheets each one loads. */
  html: ReadonlyMap<string, string[]>;
  /** The file an imported component comes from. */
  resolveComponent: (fromFile: string, specifier: string) => string | undefined;
  /** The local files a file imports directly (from the dependency graph). */
  importsOf: (file: string) => string[];
}

/** Collects every page the code defines, with the files that make each one. */
export function combinePages(i: PageInputs): { pages: Page[]; truncated: boolean } {
  const pages: Page[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const add = (p: Omit<Page, 'id' | 'needsValue'>): void => {
    const key = `${p.kind}\n${p.path}\n${p.file}`;
    if (seen.has(key)) return;
    if (pages.length >= MAX_PAGES) { truncated = true; return; }
    seen.add(key);
    const files = [...new Set([...p.files, ...(p.template ? [p.template] : [])])].filter((f) => f !== p.file).sort();
    pages.push({ ...p, files, id: `g${pages.length}`, needsValue: needsValue(p.path) });
  };
  const all = new Set(i.allFiles);

  if (i.hasNext) {
    for (const f of [...i.allFiles].sort()) {
      const p = nextPagePath(f);
      if (p !== undefined) add({ path: p, kind: 'Next.js page', file: f, line: 1, files: [...nextLayouts(f, all), ...i.importsOf(f)] });
    }
  }

  for (const [file, f] of [...i.facts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const r of f.pageRoutes) {
      const target = r.component ? i.resolveComponent(file, r.component) : r.componentName ? file : undefined;
      const main = target ?? file;
      add({
        path: r.path, kind: r.kind, file: main, line: main === file ? r.line : 1,
        missing: r.component && !target ? r.component : undefined,
        files: [file, ...i.importsOf(main)],
      });
    }
  }

  for (const [file, assets] of [...i.html].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Files in template folders are rendered by a server, not served as they are.
    if (/(^|\/)(views|templates|layouts|partials)\//.test(file)) continue;
    add({ path: htmlPagePath(file), kind: 'HTML page', file, line: 1, files: [...assets, ...assets.flatMap((a) => i.importsOf(a))] });
  }

  const viewsByName = new Map<string, { file: string; template: string }[]>();
  for (const [file, f] of i.facts) for (const v of f.views) viewsByName.set(v.name, [...(viewsByName.get(v.name) ?? []), { file, template: v.template }]);
  for (const r of i.routes) {
    if (!r.view || (r.method !== 'GET' && r.method !== 'ANY')) continue;
    const v = r.view;
    let name: string | undefined;
    let template: string | undefined;
    let kind: PageKind;
    let handlerFile: string | undefined;
    if (v.render !== undefined) { name = v.render; template = findTemplate(v.render, 'express', i.allFiles); kind = 'Express view'; }
    else if (v.file !== undefined) { name = v.file; template = all.has(v.file) ? v.file : undefined; kind = 'Express view'; }
    else if (v.template !== undefined) { name = v.template; template = findTemplate(v.template, 'python', i.allFiles); kind = r.framework === 'FastAPI' ? 'FastAPI template' : 'Flask template'; }
    else if (v.handler !== undefined) {
      // Django: the view function named in urls.py, preferring one next to it.
      const candidates = viewsByName.get(v.handler) ?? [];
      const dir = path.posix.dirname(r.file);
      const hit = candidates.find((c) => path.posix.dirname(c.file) === dir) ?? candidates[0];
      if (!hit) continue;
      name = hit.template;
      handlerFile = hit.file;
      template = findTemplate(hit.template, 'python', i.allFiles);
      kind = 'Django template';
    } else continue;
    add({ path: r.path, kind, file: handlerFile ?? r.file, line: handlerFile ? 1 : r.line, template, missing: template ? undefined : name, files: [r.file, ...(handlerFile ? [handlerFile] : [])] });
  }
  return { pages: pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((p, n) => ({ ...p, id: `g${n}` })), truncated };
}
