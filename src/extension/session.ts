import * as vscode from 'vscode';
import { CommitEntry } from '../git/gitChanges';
import { loadApis } from './apis';
import { loadHealth } from './health';
import { askToAllowSessions, describeSession, loadSessions, StoredSession } from './agentSessions';
import { codeForCommitFile, codeForLocation, codeForTarget } from './codeView';
import { openTarget, revealLocation, SIDE } from './open';
import { explainSymbolAt, explainTarget } from './explain';
import { listProjectFiles } from './files';
import { describeCommit, HistoryFile, loadHistory, openCommitFile } from './history';
import { parseWebviewMessage, WebviewMessage } from './messages';
import { createNote, ensureNotesAllowed, listNotes, NoteEntry, notesFor, NoteSubject } from './notes';
import { previewAddress } from '../analysis/pages';
import { openPreview, previewBase, showInSimpleBrowser } from './preview';
import { CodeLocation, collectState, DashboardState, describeTarget, findUsages, Target } from './state';

/**
 * The dashboard's logic for one open view (the VS Code panel, or one browser tab).
 * The view only renders; all file and Git access happens here. Every view has its own
 * opaque ids, so ids from one view are never accepted from another.
 */
export class DashboardSession {
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
  /** Routes (`w…`), calls (`x…`) and models (`m…`) in the APIs tab. */
  private apiLocations = new Map<string, CodeLocation>();
  /** Problems and secret-looking text in the Health tab (`y…`); secrets only open in the editor. */
  private healthLocations = new Map<string, CodeLocation>();
  private secretIds = new Set<string>();
  /** AI sessions in the AI sessions tab (`a…`). */
  private sessions = new Map<string, StoredSession>();
  private state: DashboardState | undefined;
  private folderIndex = 0;
  private loading: Promise<void> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly send: (message: unknown) => void,
    private readonly memento: vscode.Memento,
    private readonly onOpenInBrowser?: () => void,
    /** Browser view (Phase 6c): show code and diffs on the page instead of in VS Code's editor. */
    private readonly codeInPage = false,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/.vibecode/notes/**');
    const notesChanged = (): void => {
      this.allNotes = undefined;
      void this.postNotes();
    };
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh(false)),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.refresh(false)),
      watcher,
      watcher.onDidCreate(notesChanged),
      watcher.onDidChange(notesChanged),
      watcher.onDidDelete(notesChanged),
    );
  }

  /** Handles one raw message from the view. It is untrusted and validated first. */
  handle(raw: unknown): Promise<void> {
    return this.onMessage(parseWebviewMessage(raw));
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
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
          this.apiLocations.clear();
          this.healthLocations.clear();
          this.secretIds.clear();
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
      case 'openInBrowser':
        this.onOpenInBrowser?.();
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
        if (msg.type === 'open') {
          if (this.codeInPage) this.post({ type: 'code', view: await codeForTarget(msg.id, target) });
          else await openTarget(target);
        }
        const { details, symbols } = await describeTarget(msg.id, target);
        this.locations = symbols;
        this.post({ type: 'details', details });
        this.subject = { id: msg.id, label: target.relPath, value: { about: target.relPath } };
        await this.postNotes();
        const folder = this.folder();
        if (folder && this.state && vscode.workspace.isTrusted) {
          const notes = this.allNotes ? notesFor(this.allNotes, { about: target.relPath }).length : 0;
          const explanation = await explainTarget(folder, target, details, this.state, notes);
          this.post({ type: 'explain', subject: msg.id, ...explanation });
        }
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
        if (!file) return;
        if (this.codeInPage) this.post({ type: 'code', view: await codeForCommitFile(msg.id, file) });
        else await openCommitFile(file);
        break;
      }
      case 'openInEditor': {
        const target = this.targets.get(msg.id);
        const file = this.historyFiles.get(msg.id);
        const loc = this.locations.get(msg.id) ?? this.apiLocations.get(msg.id);
        if (target) await openTarget(target);
        else if (file) await openCommitFile(file);
        else if (loc) await revealLocation(loc);
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
      case 'apis': {
        const folder = this.folder();
        if (!folder || !this.state) {
          this.post({ type: 'apis', result: { state: 'none' } });
          return;
        }
        const { result, locations } = await loadApis(folder, this.state, this.targets);
        this.apiLocations = locations;
        this.post({ type: 'apis', result });
        break;
      }
      case 'health': {
        const folder = this.folder();
        if (!folder || !this.state) {
          this.post({ type: 'health', result: { state: 'none' } });
          return;
        }
        const { result, locations, secretIds } = await loadHealth(folder, this.state, this.memento);
        this.healthLocations = locations;
        this.secretIds = secretIds;
        this.post({ type: 'health', result });
        break;
      }
      case 'healthItem': {
        const loc = this.healthLocations.get(msg.id);
        if (!loc) return;
        // A secret-looking line opens only in VS Code's editor, never on the browser page.
        if (this.secretIds.has(msg.id)) await revealLocation(loc);
        else await this.reveal(msg.id, loc);
        break;
      }
      case 'markSafe':
        await this.markSafe(msg.id);
        break;
      case 'previewPage': {
        const loc = msg.id.startsWith('g') ? this.apiLocations.get(msg.id) : undefined;
        if (!loc) return;
        const base = previewBase();
        if (!base.ok) {
          this.post({ type: 'previewError', for: msg.id, message: `${base.reason} Then start your app and click Preview again.` });
          if (!this.codeInPage) {
            const choice = await vscode.window.showWarningMessage(base.reason, 'Open Settings');
            if (choice) await vscode.commands.executeCommand('workbench.action.openSettings', 'vibecodeExplorer.previewUrl');
          }
          return;
        }
        const url = previewAddress(base.url, msg.path);
        if (!url) {
          this.post({ type: 'previewError', for: msg.id, message: 'The address must start with "/" and stay on your preview server.' });
          return;
        }
        // The page's code and the running page, side by side. VibeCode Explorer never starts the app.
        if (this.codeInPage) {
          this.post({ type: 'code', view: await codeForLocation(msg.id, loc) });
          this.post({ type: 'pagePreview', for: msg.id, url });
        } else {
          await revealLocation(loc);
          await showInSimpleBrowser(url);
        }
        break;
      }
      case 'apiItem': {
        const loc = this.apiLocations.get(msg.id);
        if (loc) await this.reveal(msg.id, loc);
        break;
      }
      case 'files': {
        const folder = this.folder();
        if (!folder) {
          this.post({ type: 'files', result: { state: 'none' } });
          return;
        }
        const { result, added } = await listProjectFiles(folder, this.targets);
        // New `p…` ids replace the previous listing's; graph and change ids stay valid.
        for (const id of [...this.targets.keys()]) if (id.startsWith('p')) this.targets.delete(id);
        for (const [id, t] of added) this.targets.set(id, t);
        this.post({ type: 'files', result });
        break;
      }
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
        if (loc) await this.reveal(msg.id, loc);
        break;
      }
      case 'symbol': {
        const loc = msg.id.startsWith('s') ? this.locations.get(msg.id) : undefined;
        const folder = vscode.workspace.workspaceFolders?.[this.state?.folderIndex ?? 0];
        if (!loc || !folder) return;
        await this.reveal(msg.id, loc);
        this.post({ type: 'usagesLoading', symbol: loc.name });
        const { result, locations } = await findUsages(folder.uri, loc);
        // Usage ids replace older usage ids; the current file's symbol ids stay valid.
        for (const id of [...this.locations.keys()]) if (id.startsWith('r')) this.locations.delete(id);
        for (const [id, l] of locations) this.locations.set(id, l);
        const nodeIds = [...this.targets.entries()]
          .filter(([id, t]) => id.startsWith('f') && result.files.includes(t.relPath))
          .map(([id]) => id);
        this.post({ type: 'usages', result, nodeIds });
        this.post({ type: 'symbolExplain', symbol: loc.name, kind: (loc.kind ?? '').toLowerCase(), sentences: await explainSymbolAt(loc, result) });
        break;
      }
    }
  }

  /** Shows a symbol or usage: on the page in the browser view, else in VS Code's editor. */
  private async reveal(id: string, loc: CodeLocation): Promise<void> {
    if (this.codeInPage) this.post({ type: 'code', view: await codeForLocation(id, loc) });
    else await revealLocation(loc);
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

  /** Phase 9: marks a commit as a safe point by saving a small note (the same opt-in as notes). */
  private async markSafe(id: string): Promise<void> {
    const commit = this.commits.get(id);
    const folder = this.folder();
    if (!commit || !folder || !vscode.workspace.isTrusted) return;
    if (!await ensureNotesAllowed(this.memento, folder)) return;
    try {
      await createNote(folder, { commit: commit.hash }, `Safe point ${commit.hash.slice(0, 7)}`, { safe: true });
      this.post({ type: 'markedSafe', id });
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
    this.allNotes = undefined;
    await this.postNotes();
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
    this.send(message);
  }
}
