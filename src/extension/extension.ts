import * as vscode from 'vscode';
import { Dashboard, openTarget } from './dashboard';
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
    // Reconnects a dashboard tab that VS Code restores after a reload or restart.
    vscode.window.registerWebviewPanelSerializer(Dashboard.viewType, {
      deserializeWebviewPanel: async (panel) => Dashboard.revive(panel, context.extensionUri, context.workspaceState),
    }),
  );

  // Small read-only surface used by the integration tests. The note writer is only
  // exposed when running tests, so other extensions cannot skip the owner's consent.
  return {
    collectState,
    describeTarget,
    findUsages,
    openTarget,
    loadHistory,
    describeCommit,
    openCommitFile,
    listNotes,
    notesFor,
    createNote: context.extensionMode === vscode.ExtensionMode.Test ? createNote : undefined,
    isDashboardOpen: () => Dashboard.instance !== undefined,
    renderReport: () => Dashboard.instance?.renderReport,
    revivePanel: (panel: vscode.WebviewPanel) => Dashboard.revive(panel, context.extensionUri, context.workspaceState),
    closeDashboard: () => Dashboard.instance?.close(),
  };
}

export function deactivate() {}
