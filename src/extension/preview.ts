import * as vscode from 'vscode';
import { validatePreviewUrl } from './previewUrl';

/** Opens the configured local URL in VS Code's built-in Simple Browser. Never starts a server. */
export async function openPreview(): Promise<void> {
  const raw = vscode.workspace.getConfiguration('vibecodeExplorer').get<string>('previewUrl', '');
  const result = validatePreviewUrl(raw);
  if (!result.ok) {
    const choice = await vscode.window.showWarningMessage(result.reason, 'Open Settings');
    if (choice) await vscode.commands.executeCommand('workbench.action.openSettings', 'vibecodeExplorer.previewUrl');
    return;
  }
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', result.url);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(result.url));
  }
}
