import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { headUri } from '../git/gitChanges';
import { parseWebviewMessage, WebviewMessage } from './messages';
import { openPreview } from './preview';
import { collectState, DashboardState, describeTarget, Target } from './state';

/** Single dashboard webview. The webview only renders; all file and Git access happens here. */
export class Dashboard {
  private static current: Dashboard | undefined;

  private targets = new Map<string, Target>();
  private state: DashboardState | undefined;
  private folderIndex = 0;
  private loading: Promise<void> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri): Dashboard {
    if (Dashboard.current) {
      Dashboard.current.panel.reveal();
      return Dashboard.current;
    }
    const panel = vscode.window.createWebviewPanel('vibecodeExplorer.dashboard', 'VibeCode Explorer', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'cytoscape', 'dist'),
      ],
    });
    Dashboard.current = new Dashboard(panel, extensionUri);
    return Dashboard.current;
  }

  static get instance(): Dashboard | undefined {
    return Dashboard.current;
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri) {
    panel.webview.html = this.html();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(parseWebviewMessage(raw))),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh(false)),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.refresh(false)),
    );
  }

  /** What the webview last reported drawing, or its last script error (used by integration tests). */
  renderReport: { nodes: number; edges: number } | { error: string } | undefined;

  refresh(refreshGit: boolean): Promise<void> {
    // Coalesce overlapping refreshes so rapid clicks cannot queue up scans.
    if (!this.loading) {
      this.loading = (async () => {
        try {
          this.post({ type: 'loading' });
          const { state, targets } = await collectState(this.folderIndex, refreshGit);
          this.state = state;
          this.targets = targets;
          this.post({ type: 'state', state });
        } catch (err) {
          this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        } finally {
          this.loading = undefined;
        }
      })();
    }
    return this.loading;
  }

  private async onMessage(msg: WebviewMessage | undefined): Promise<void> {
    if (!msg) return; // Malformed or unknown messages are ignored.
    switch (msg.type) {
      case 'ready':
        if (this.state) this.post({ type: 'state', state: this.state });
        else await this.refresh(false);
        break;
      case 'refresh':
        await this.refresh(true);
        break;
      case 'selectFolder':
        if (msg.index < (vscode.workspace.workspaceFolders?.length ?? 0)) {
          this.folderIndex = msg.index;
          await this.refresh(false);
        }
        break;
      case 'preview':
        await openPreview();
        break;
      case 'rendered':
        this.renderReport = { nodes: msg.nodes, edges: msg.edges };
        break;
      case 'webviewError':
        this.renderReport = { error: msg.message };
        console.error(`[VibeCode Explorer] webview error: ${msg.message}`);
        break;
      case 'open':
      case 'inspect': {
        const target = this.targets.get(msg.id);
        if (!target) return; // Only ids issued in the current state are accepted.
        if (msg.type === 'open') await openTarget(target);
        this.post({ type: 'details', details: await describeTarget(msg.id, target) });
        break;
      }
    }
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private html(): string {
    const webview = this.panel.webview;
    const asset = (...p: string[]): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...p));
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    // The stylesheet id stops Cytoscape from injecting an inline <style>, which the CSP would block.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link id="__________cytoscape_stylesheet" rel="stylesheet" href="${asset('src', 'webview', 'dashboard.css')}">
<title>VibeCode Explorer</title>
</head>
<body>
<header class="toolbar">
  <strong>VibeCode Explorer</strong>
  <label>Folder <select id="folder"></select></label>
  <button id="refresh" title="Re-read Git status and rescan imports">Refresh</button>
  <button id="preview" title="Open the configured local app URL">Open Preview</button>
  <span id="status" class="muted"></span>
</header>
<div id="banner" class="banner" hidden></div>
<main class="layout">
  <section class="pane" id="changesPane">
    <h2>Workspace changes</h2>
    <div id="repo" class="muted"></div>
    <div id="changes"></div>
  </section>
  <section class="pane graph-pane">
    <div class="graph-tools">
      <h2>File dependencies</h2>
      <button id="fit" title="Fit graph to screen">Fit</button>
      <button id="zoomIn" title="Zoom in">+</button>
      <button id="zoomOut" title="Zoom out">−</button>
      <button id="layout" title="Re-run layout">Re-layout</button>
      <span id="graphInfo" class="muted"></span>
    </div>
    <div id="graph"></div>
    <div class="legend muted">
      <span class="dot file"></span>file <span class="dot changed"></span>changed <span class="dot untracked"></span>new <span class="dot unknown"></span>unknown import
    </div>
  </section>
  <aside class="pane" id="info"><h2>Details</h2><p class="muted">Select a file in the graph or the changes list.</p></aside>
</main>
<script nonce="${nonce}" src="${asset('node_modules', 'cytoscape', 'dist', 'cytoscape.min.js')}"></script>
<script nonce="${nonce}" src="${asset('src', 'webview', 'dashboard.js')}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    Dashboard.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}

const SIDE = { viewColumn: vscode.ViewColumn.Beside, preview: true } as const;

/** Opens a file, its diff against HEAD, or the HEAD version of a deleted file. Read-only. */
export async function openTarget(t: Target): Promise<void> {
  const c = t.change;
  const head = c ? headUri(c.originalUri) : undefined;
  const title = (suffix: string): string => `${path.posix.basename(t.relPath)} (${suffix})`;
  if (c && head && c.group === 'deleted') {
    await vscode.commands.executeCommand('vscode.open', head, SIDE, title('deleted, HEAD'));
  } else if (c && head && (c.group === 'modified' || c.group === 'renamed')) {
    await vscode.commands.executeCommand('vscode.diff', head, c.uri, title('HEAD ↔ Working Tree'), SIDE);
  } else if (c?.group === 'deleted') {
    void vscode.window.showInformationMessage(`${t.relPath} was deleted.`);
  } else {
    await vscode.commands.executeCommand('vscode.open', t.uri, SIDE);
  }
}
