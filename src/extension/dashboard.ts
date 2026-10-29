import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { dashboardHtml } from './page';
import { DashboardSession } from './session';

/** The single dashboard panel inside VS Code. Its logic lives in a DashboardSession. */
export class Dashboard {
  private static current: Dashboard | undefined;
  private readonly session: DashboardSession;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, memento: vscode.Memento): Dashboard {
    if (Dashboard.current) {
      Dashboard.current.panel.reveal();
      return Dashboard.current;
    }
    const panel = vscode.window.createWebviewPanel(Dashboard.viewType, 'VibeCode Explorer', vscode.ViewColumn.One, Dashboard.options(extensionUri));
    Dashboard.current = new Dashboard(panel, extensionUri, memento);
    return Dashboard.current;
  }

  static readonly viewType = 'vibecodeExplorer.dashboard';

  private static options(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'cytoscape', 'dist'),
      ],
    };
  }

  /**
   * Restores a dashboard tab left open before a reload, so it becomes the live dashboard
   * instead of a stale page. Extra restored tabs are closed: there is only one dashboard.
   */
  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, memento: vscode.Memento): void {
    if (Dashboard.current) {
      panel.dispose();
      return;
    }
    panel.webview.options = Dashboard.options(extensionUri);
    Dashboard.current = new Dashboard(panel, extensionUri, memento);
  }

  static get instance(): Dashboard | undefined {
    return Dashboard.current;
  }

  close(): void {
    this.panel.dispose();
  }

  /** What the webview last reported drawing, or its last script error (used by integration tests). */
  get renderReport(): DashboardSession['renderReport'] {
    return this.session.renderReport;
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri, memento: vscode.Memento) {
    this.session = new DashboardSession(
      (message) => void panel.webview.postMessage(message),
      memento,
      () => void vscode.commands.executeCommand('vibecodeExplorer.openInBrowser'),
    );
    panel.webview.html = this.html();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((raw) => this.session.handle(raw)),
    );
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return dashboardHtml({
      mode: 'vscode',
      nonce,
      csp,
      asset: (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...p)).toString(),
    });
  }

  private dispose(): void {
    Dashboard.current = undefined;
    this.session.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
