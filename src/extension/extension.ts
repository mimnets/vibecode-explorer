import * as vscode from 'vscode';
import { Dashboard, openTarget } from './dashboard';
import { describeCommit, loadHistory, openCommitFile } from './history';
import { openPreview } from './preview';
import { collectState, describeTarget, findUsages } from './state';

// Activated only when one of our commands runs (no startup cost).
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('vibecodeExplorer.openDashboard', () => {
      Dashboard.show(context.extensionUri);
    }),
    vscode.commands.registerCommand('vibecodeExplorer.openPreview', openPreview),
  );

  // Small read-only surface used by the integration tests.
  return {
    collectState,
    describeTarget,
    findUsages,
    openTarget,
    loadHistory,
    describeCommit,
    openCommitFile,
    isDashboardOpen: () => Dashboard.instance !== undefined,
    renderReport: () => Dashboard.instance?.renderReport,
  };
}

export function deactivate() {}
