import * as vscode from 'vscode';
import { loadSessions, readSessions, resetPermissions } from './agentSessions';
import { BrowserView, openInBrowser } from './browserView';
import { Dashboard } from './dashboard';
import { openTarget } from './open';
import { explainSymbolAt, explainTarget } from './explain';
import { describeCommit, loadHistory, openCommitFile } from './history';
import { createNote, listNotes, notesFor } from './notes';
import { openPreview } from './preview';
import { collectState, describeTarget, findUsages } from './state';

// Activated only when one of our commands runs (no startup cost).
export function activate(context: vscode.ExtensionContext) {
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
