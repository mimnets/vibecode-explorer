import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { ASSET_NAMES, browserCsp, checkRequest, framableOrigin, newKey } from './browserGuard';
import { previewBase } from './preview';
import { dashboardHtml } from './page';
import { DashboardSession } from './session';

// Phase 6b: shows the dashboard in the owner's web browser. A small server inside the
// extension listens on 127.0.0.1 only, on a random port, and only answers requests that
// carry a secret key (see browserGuard.ts). Each browser tab gets its own DashboardSession,
// so it works exactly like the VS Code panel. Read-only; it never runs a shell.

/** Stops this long after the last browser tab closed (or after a link was never opened). */
const IDLE_MS = 30 * 60 * 1000;
const MAX_TABS = 5;
const MAX_BODY_BYTES = 64 * 1024;
const ASSET_TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

interface Tab { res: http.ServerResponse; session: DashboardSession; keepAlive: NodeJS.Timeout }

export class BrowserView {
  private static current: BrowserView | undefined;
  private readonly keys = new Set<string>();
  private readonly tabs = new Map<string, Tab>();
  private lastActivity = Date.now();
  private readonly idleTimer: NodeJS.Timeout;

  private constructor(
    private readonly server: http.Server,
    readonly port: number,
    private readonly extensionUri: vscode.Uri,
    private readonly memento: vscode.Memento,
    idleMs: number,
  ) {
    this.idleTimer = setInterval(() => {
      // Keeps running while a tab is open; stops once no tab has been open for `idleMs`.
      if (this.tabs.size === 0 && Date.now() - this.lastActivity > idleMs) BrowserView.stop();
    }, Math.min(60_000, idleMs));
  }

  static get instance(): BrowserView | undefined {
    return BrowserView.current;
  }

  /** Starts the server if needed and returns a fresh link (a new secret key each time). */
  static async link(extensionUri: vscode.Uri, memento: vscode.Memento, idleMs = IDLE_MS): Promise<string> {
    if (!BrowserView.current) {
      const server = http.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const port = (server.address() as { port: number }).port;
      const view = new BrowserView(server, port, extensionUri, memento, idleMs);
      server.on('request', (req, res) => view.onRequest(req, res));
      BrowserView.current = view;
    }
    const view = BrowserView.current;
    const key = newKey();
    view.keys.add(key);
    view.lastActivity = Date.now();
    return `http://127.0.0.1:${view.port}/${key}/`;
  }

  /** Stops the server and tells open browser tabs. */
  static stop(): boolean {
    const view = BrowserView.current;
    if (!view) return false;
    BrowserView.current = undefined;
    clearInterval(view.idleTimer);
    for (const tab of view.tabs.values()) {
      tab.res.end('event: stopped\ndata: {}\n\n');
      clearInterval(tab.keepAlive);
      tab.session.dispose();
    }
    view.tabs.clear();
    view.keys.clear();
    view.server.close();
    view.server.closeAllConnections?.();
    return true;
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const verdict = checkRequest({
      method: req.method,
      url: req.url,
      host: req.headers.host,
      origin: req.headers.origin,
      secFetchSite: req.headers['sec-fetch-site'] as string | undefined,
      contentType: req.headers['content-type'],
      port: this.port,
      keys: this.keys,
    });
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    };
    if (!verdict.ok) {
      res.writeHead(verdict.status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not available.');
      req.resume();
      return;
    }
    this.lastActivity = Date.now();
    switch (verdict.route) {
      case 'page': {
        const nonce = crypto.randomBytes(16).toString('base64');
        const base = previewBase();
        const csp = browserCsp(nonce, framableOrigin(base.ok ? base.url : undefined, this.port));
        const html = dashboardHtml({ mode: 'browser', nonce, csp, asset: (...p) => `./a/${p[p.length - 1]}` });
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp }).end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      case 'asset':
        this.sendAsset(verdict.asset as string, res, headers);
        return;
      case 'events':
        this.openTab(req, res, headers);
        return;
      case 'message':
        this.receive(verdict.client as string, req, res, headers);
        return;
    }
  }

  private sendAsset(name: string, res: http.ServerResponse, headers: Record<string, string>): void {
    if (!(ASSET_NAMES as readonly string[]).includes(name)) {
      res.writeHead(404, headers).end();
      return;
    }
    const parts = name === 'cytoscape.min.js' ? ['node_modules', 'cytoscape', 'dist', name] : ['src', 'webview', name];
    const file = path.join(this.extensionUri.fsPath, ...parts);
    fs.readFile(file, (err, data) => {
      if (err) res.writeHead(404, headers).end();
      else res.writeHead(200, { ...headers, 'Content-Type': ASSET_TYPES[path.extname(name)] ?? 'application/octet-stream' }).end(data);
    });
  }

  private openTab(req: http.IncomingMessage, res: http.ServerResponse, headers: Record<string, string>): void {
    if (this.tabs.size >= MAX_TABS) {
      res.writeHead(429, headers).end();
      return;
    }
    const client = crypto.randomBytes(16).toString('hex');
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ client })}\n\n`);
    const session = new DashboardSession(
      (message) => res.write(`data: ${JSON.stringify(message)}\n\n`),
      this.memento,
      () => void vscode.window.showInformationMessage('This dashboard is already open in your browser.'),
      true,
    );
    // A comment line every 25 s keeps proxies and the browser from closing an idle stream.
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    this.tabs.set(client, { res, session, keepAlive });
    req.on('close', () => {
      clearInterval(keepAlive);
      session.dispose();
      this.tabs.delete(client);
      this.lastActivity = Date.now();
    });
  }

  private receive(client: string, req: http.IncomingMessage, res: http.ServerResponse, headers: Record<string, string>): void {
    const tab = this.tabs.get(client);
    if (!tab) {
      res.writeHead(404, headers).end();
      req.resume();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, headers).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      let message: unknown;
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, headers).end();
        return;
      }
      res.writeHead(204, headers).end();
      // The session validates the message like any webview message.
      void tab.session.handle(message);
    });
  }
}

/** Opens the dashboard in the default browser. */
export async function openInBrowser(extensionUri: vscode.Uri, memento: vscode.Memento): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('The browser view is off in Restricted Mode. Trust the workspace first.');
    return;
  }
  const link = await BrowserView.link(extensionUri, memento);
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(link));
  await vscode.env.openExternal(external);
}
