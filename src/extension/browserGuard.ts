// Phase 6b: request checks for the browser view's local server (no `vscode` import, unit-testable).
// The server listens on 127.0.0.1 only. Every request must also:
//  - carry one of the secret keys as the first path segment (other web pages cannot guess it),
//  - name this server in the Host header (blocks DNS rebinding),
//  - for POST, come from this server's own page (Origin / Sec-Fetch-Site checks).
import * as crypto from 'crypto';

export type Route = 'page' | 'asset' | 'events' | 'message';

export interface GuardInput {
  method: string | undefined;
  url: string | undefined;
  host: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  contentType: string | undefined;
  port: number;
  keys: ReadonlySet<string>;
}

export type GuardResult =
  | { ok: true; route: Route; asset?: string; client?: string }
  | { ok: false; status: number };

/** Files the page may load, by the name used in its URL. */
export const ASSET_NAMES = ['dashboard.js', 'dashboard.css', 'browser.css', 'browserBridge.js', 'cytoscape.min.js'] as const;

export function newKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkRequest(r: GuardInput): GuardResult {
  const hosts = [`127.0.0.1:${r.port}`, `localhost:${r.port}`];
  if (!r.host || !hosts.includes(r.host.toLowerCase())) return { ok: false, status: 421 };
  let url: URL;
  try {
    url = new URL(r.url ?? '', `http://127.0.0.1:${r.port}`);
  } catch {
    return { ok: false, status: 400 };
  }
  const [, key = '', ...rest] = url.pathname.split('/');
  // Compare against every key, without stopping early.
  let known = false;
  for (const k of r.keys) known = sameKey(key, k) || known;
  if (!known) return { ok: false, status: 404 };
  const sub = rest.join('/');

  if (r.method === 'GET' || r.method === 'HEAD') {
    if (r.secFetchSite && !['same-origin', 'none'].includes(r.secFetchSite)) return { ok: false, status: 403 };
    if (sub === '') return { ok: true, route: 'page' };
    if (sub === 'events') return { ok: true, route: 'events' };
    const m = /^a\/([\w.-]+)$/.exec(sub);
    if (m && (ASSET_NAMES as readonly string[]).includes(m[1])) return { ok: true, route: 'asset', asset: m[1] };
    return { ok: false, status: 404 };
  }
  if (r.method === 'POST' && sub === 'message') {
    const origins = hosts.map((h) => `http://${h}`);
    if (!r.origin || !origins.includes(r.origin.toLowerCase())) return { ok: false, status: 403 };
    if (r.secFetchSite && r.secFetchSite !== 'same-origin') return { ok: false, status: 403 };
    if (!/^application\/json\b/i.test(r.contentType ?? '')) return { ok: false, status: 415 };
    const client = url.searchParams.get('c') ?? '';
    if (!/^[a-f0-9]{32}$/.test(client)) return { ok: false, status: 400 };
    return { ok: true, route: 'message', client };
  }
  return { ok: false, status: 405 };
}

/** Content-Security-Policy of the browser page: same rules as the VS Code panel, plus same-origin connections. */
/**
 * `frameOrigin` (Phase 8) is the owner's preview server, the only page that may be shown
 * inside the dashboard. It must be a loopback http(s) origin and never this server itself.
 */
/** The preview origin that may be framed, or undefined when it is missing, not local, or this server. */
export function framableOrigin(previewUrl: string | undefined, ownPort: number): string | undefined {
  if (!previewUrl) return undefined;
  let u: URL;
  try {
    u = new URL(previewUrl);
  } catch {
    return undefined;
  }
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (port === ownPort) return undefined;
  return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin : undefined;
}

export function browserCsp(nonce: string, frameOrigin?: string): string {
  return [
    "default-src 'none'",
    `frame-src ${frameOrigin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/i.test(frameOrigin) ? frameOrigin : "'none'"}`,
    "img-src 'self' data:",
    "style-src 'self'",
    "font-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
