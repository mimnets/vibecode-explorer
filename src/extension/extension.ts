import * as vscode from 'vscode';
import { loadSessions, readSessions, resetPermissions } from './agentSessions';
import { loadApis } from './apis';
import { loadHealth } from './health';
import { BrowserView, openInBrowser } from './browserView';
import { codeForCommitFile, codeForLocation, codeForTarget } from './codeView';
import { Dashboard } from './dashboard';
import { listProjectFiles } from './files';
import { openTarget } from './open';
import { explainSymbolAt, explainTarget } from './explain';
import { describeCommit, loadHistory, openCommitFile } from './history';
import { createNote, listNotes, notesFor } from './notes';
import { openPreview } from './preview';
import { collectState, describeTarget, findUsages } from './state';

// Activated when one of our commands runs, or after VS Code has finished starting (for the
// optional "open in the browser on startup"). Startup itself is not slowed down.
export function activate(context: vscode.ExtensionContext) {
  // Phase 6c: opt-in, and only for a trusted folder. Trusting the folder later also opens it.
  const openOnStartup = (): void => {
    const wanted = vscode.workspace.getConfiguration('vibecodeExplorer').get<boolean>('openBrowserOnStartup', false);
    if (wanted && vscode.workspace.isTrusted && vscode.workspace.workspaceFolders?.length && !BrowserView.instance) {
      void openInBrowser(context.extensionUri, context.workspaceState);
    }
  };
  openOnStartup();
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(openOnStartup));

  context.subscriptions.push(
    vscode.commands.registerCommand('vibecodeExplorer.openDashboard', () => {
      Dashboard.show(context.extensionUri, context.workspaceState);
    }),
    vscode.commands.registerCommand('vibecodeExplorer.openPreview', openPreview),
    vscode.commands.registerCommand('vibecodeExplorer.openInBrowser', () => openInBrowser(context.extensionUri, context.workspaceState)),
    vscode.commands.registerCommand('vibecodeExplorer.stopBrowserView', () => {
      void vscode.window.showInformationMessage(BrowserView.stop() ? 'The browser view has stopped.' : 'The browser view is not running.');
    }),
    // Closing VS Code (or disabling the extension) always stops the browser view.
    { dispose: () => BrowserView.stop() },
    vscode.commands.registerCommand('vibecodeExplorer.resetPermissions', async () => {
      await resetPermissions(context.workspaceState);
      void vscode.window.showInformationMessage('VibeCode Explorer will ask again before reading AI session logs or saving notes in this workspace.');
    }),
    // Reconnects a dashboard tab that VS Code restores after a reload or restart.
    vscode.window.registerWebviewPanelSerializer(Dashboard.viewType, {
      deserializeWebviewPanel: async (panel) => Dashboard.revive(panel, context.extensionUri, context.workspaceState),
    }),
  );

  // Small read-only surface used by the integration tests. The note writer and the raw
  // session reader are only exposed when running tests, so other extensions cannot skip the owner's consent.
  return {
    collectState,
    describeTarget,
    findUsages,
    openTarget,
    loadHistory,
    describeCommit,
    openCommitFile,
    codeForTarget,
    codeForCommitFile,
    codeForLocation,
    listProjectFiles,
    loadApis,
    loadHealth: (folder: vscode.WorkspaceFolder, state: Parameters<typeof loadHealth>[1]) => loadHealth(folder, state, context.workspaceState),
    explainTarget,
    explainSymbolAt,
    listNotes,
    notesFor,
    createNote: context.extensionMode === vscode.ExtensionMode.Test ? createNote : undefined,
    readSessions: context.extensionMode === vscode.ExtensionMode.Test ? readSessions : undefined,
    loadSessions: (folder: vscode.WorkspaceFolder) => loadSessions(context.workspaceState, folder),
    isDashboardOpen: () => Dashboard.instance !== undefined,
    renderReport: () => Dashboard.instance?.renderReport,
    revivePanel: (panel: vscode.WebviewPanel) => Dashboard.revive(panel, context.extensionUri, context.workspaceState),
    closeDashboard: () => Dashboard.instance?.close(),
    browserLink: context.extensionMode === vscode.ExtensionMode.Test
      ? (idleMs?: number) => BrowserView.link(context.extensionUri, context.workspaceState, idleMs)
      : undefined,
    stopBrowserView: () => BrowserView.stop(),
  };
}

export function deactivate() {
  BrowserView.stop();
}
