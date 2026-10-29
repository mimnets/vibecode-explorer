import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommitEntry, headUri } from '../git/gitChanges';
import { describeCommit, HistoryFile, loadHistory, openCommitFile } from './history';
import { askToAllowSessions, describeSession, loadSessions, StoredSession } from './agentSessions';
import { createNote, ensureNotesAllowed, listNotes, NoteEntry, notesFor, NoteSubject } from './notes';
import { parseWebviewMessage, WebviewMessage } from './messages';
import { openPreview } from './preview';
import { CodeLocation, collectState, DashboardState, describeTarget, findUsages, Target } from './state';

/** Single dashboard webview. The webview only renders; all file and Git access happens here. */
export class Dashboard {
  private static current: Dashboard | undefined;

  private targets = new Map<string, Target>();
  /** Symbols of the file shown in Details (`s…`) and usages of the last symbol (`r…`). */
  private locations = new Map<string, CodeLocation>();
  /** Commits in the History tab (`k…`) and files of the shown commit (`h…`). */
  private commits = new Map<string, CommitEntry>();
  private historyFiles = new Map<string, HistoryFile>();
  /** Notes of the file or commit shown in Details (`n…`), and every note of the folder (cached). */
  private notes = new Map<string, NoteEntry>();
  private allNotes: NoteEntry[] | undefined;
  /** The file or commit shown in Details; its id is what the webview sends with "Add note". */
  private subject: { id: string; label: string; value: NoteSubject } | undefined;
  /** AI sessions in the AI sessions tab (`a…`). */
  private sessions = new Map<string, StoredSession>();
  private state: DashboardState | undefined;
  private folderIndex = 0;
  private loading: Promise<void> | undefined;
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

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri, private readonly memento: vscode.Memento) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/.vibecode/notes/**');
    const notesChanged = (): void => {
      this.allNotes = undefined;
      void this.postNotes();
    };
    panel.webview.html = this.html();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(parseWebviewMessage(raw))),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh(false)),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.refresh(false)),
      watcher,
      watcher.onDidCreate(notesChanged),
      watcher.onDidChange(notesChanged),
      watcher.onDidDelete(notesChanged),
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
          this.locations.clear();
          this.notes.clear();
          this.allNotes = undefined;
          this.subject = undefined;
          this.sessions.clear();
          this.commits.clear();
          this.historyFiles.clear();
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
        const { details, symbols } = await describeTarget(msg.id, target);
        this.locations = symbols;
        this.post({ type: 'details', details });
        this.subject = { id: msg.id, label: target.relPath, value: { about: target.relPath } };
        await this.postNotes();
        break;
      }
      case 'history': {
        const folder = vscode.workspace.workspaceFolders?.[this.state?.folderIndex ?? 0];
        if (!folder) return;
        const { result, commits } = await loadHistory(folder, msg.limit);
        this.commits = commits;
        this.historyFiles.clear();
        this.post({ type: 'history', result });
        break;
      }
      case 'commit': {
        const commit = this.commits.get(msg.id);
        const folder = vscode.workspace.workspaceFolders?.[this.state?.folderIndex ?? 0];
        if (!commit || !folder) return;
        const { details, files } = await describeCommit(folder, msg.id, commit);
        this.historyFiles = files;
        const paths = new Set(details.files.map((f) => f.path));
        const nodeIds = [...this.targets.entries()]
          .filter(([id, t]) => id.startsWith('f') && paths.has(t.relPath))
          .map(([id]) => id);
        this.post({ type: 'commit', details, nodeIds });
        this.subject = { id: msg.id, label: `commit ${commit.hash.slice(0, 7)}`, value: { commit: commit.hash } };
        await this.postNotes();
        break;
      }
      case 'commitFile': {
        const file = this.historyFiles.get(msg.id);
        if (file) await openCommitFile(file);
        break;
      }
      case 'allowSessions': {
        const folder = this.folder();
        if (!folder || !vscode.workspace.isTrusted) return;
        if (!await askToAllowSessions(this.memento, folder)) return;
        await this.postSessions();
        break;
      }
      case 'sessions':
        await this.postSessions();
        break;
      case 'session': {
        const session = this.sessions.get(msg.id);
        const folder = this.folder();
        if (!session || !folder) return;
        const details = await describeSession(folder, msg.id, session);
        const paths = new Set(details.files);
        const nodeIds = [...this.targets.entries()]
          .filter(([id, t]) => id.startsWith('f') && paths.has(t.relPath))
          .map(([id]) => id);
        this.subject = undefined;
        this.post({ type: 'session', details, nodeIds });
        break;
      }
      case 'addNote':
        await this.addNote(msg.id);
        break;
      case 'openNote': {
        const note = this.notes.get(msg.id);
        if (note) await vscode.commands.executeCommand('vscode.open', note.uri, SIDE);
        break;
      }
      case 'goto': {
        const loc = this.locations.get(msg.id);
        if (loc) await revealLocation(loc);
        break;
      }
      case 'symbol': {
        const loc = msg.id.startsWith('s') ? this.locations.get(msg.id) : undefined;
        const folder = vscode.workspace.workspaceFolders?.[this.state?.folderIndex ?? 0];
        if (!loc || !folder) return;
        await revealLocation(loc);
        this.post({ type: 'usagesLoading', symbol: loc.name });
        const { result, locations } = await findUsages(folder.uri, loc);
        // Usage ids replace older usage ids; the current file's symbol ids stay valid.
        for (const id of [...this.locations.keys()]) if (id.startsWith('r')) this.locations.delete(id);
        for (const [id, l] of locations) this.locations.set(id, l);
        const nodeIds = [...this.targets.entries()]
          .filter(([id, t]) => id.startsWith('f') && result.files.includes(t.relPath))
          .map(([id]) => id);
        this.post({ type: 'usages', result, nodeIds });
        break;
      }
    }
  }

  private folder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[this.state?.folderIndex ?? 0];
  }

  private async postSessions(): Promise<void> {
    const folder = this.folder();
    if (!folder) return;
    try {
      const { result, sessions } = await loadSessions(this.memento, folder);
      this.sessions = sessions;
      this.post({ type: 'sessions', result });
    } catch (err) {
      this.post({ type: 'sessionsError', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Sends the notes of the file or commit shown in Details. */
  private async postNotes(): Promise<void> {
    const subject = this.subject;
    const folder = this.folder();
    if (!subject || !folder) return;
    if (!vscode.workspace.isTrusted) {
      this.post({ type: 'notes', subject: subject.id, available: false, notes: [] });
      return;
    }
    this.allNotes ??= await listNotes(folder);
    if (this.subject !== subject) return; // Details changed while reading
    this.notes.clear();
    const notes = notesFor(this.allNotes, subject.value).map((n, i) => {
      const id = `n${i}`;
      this.notes.set(id, n);
      return { id, title: n.title, created: n.created, path: n.relPath };
    });
    this.post({ type: 'notes', subject: subject.id, available: true, notes });
  }

  /** The only write into the project: a new note file, after the owner allows it. */
  private async addNote(id: string): Promise<void> {
    const subject = this.subject;
    const folder = this.folder();
    if (!subject || subject.id !== id || !folder || !vscode.workspace.isTrusted) return;
    if (!await ensureNotesAllowed(this.memento, folder)) return;
    const title = await vscode.window.showInputBox({
      title: 'New note',
      prompt: `Title of the note about ${subject.label}`,
      value: `Note about ${subject.label.split('/').pop()}`,
      validateInput: (v) => (v.trim() ? undefined : 'Enter a title.'),
    });
    if (!title?.trim()) return;
    try {
      const uri = await createNote(folder, subject.value, title.trim().slice(0, 200));
      await vscode.commands.executeCommand('vscode.open', uri, SIDE);
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
    this.allNotes = undefined;
    await this.postNotes();
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
    <div class="tabs" role="tablist">
      <button id="tabChanges" class="tab active" role="tab" aria-selected="true">Workspace changes</button>
      <button id="tabHistory" class="tab" role="tab" aria-selected="false">History</button>
      <button id="tabSessions" class="tab" role="tab" aria-selected="false">AI sessions</button>
    </div>
    <div id="changesView">
      <div id="repo" class="muted"></div>
      <div id="changes"></div>
    </div>
    <div id="historyView" hidden>
      <div id="historyInfo" class="muted"></div>
      <ul id="commits" class="commits"></ul>
      <button id="moreHistory" hidden>Load more</button>
    </div>
    <div id="sessionsView" hidden></div>
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
      <span class="dot file"></span>file <span class="dot changed"></span>changed <span class="dot untracked"></span>new <span class="dot unknown"></span>unknown import <span class="dot used"></span>uses selected symbol <span class="dot commit"></span>in selected commit or session
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

/** Opens a file at a symbol or usage position. Read-only. */
export async function revealLocation(loc: CodeLocation): Promise<void> {
  await vscode.window.showTextDocument(loc.uri, { ...SIDE, selection: new vscode.Range(loc.position, loc.position) });
}

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
