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
  await showInSimpleBrowser(result.url);
}

/** Opens a checked local URL in the Simple Browser beside the editor, or the default browser. */
export async function showInSimpleBrowser(url: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(url), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
  } catch {
    try {
      await vscode.commands.executeCommand('simpleBrowser.show', url);
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }
}

/** The configured preview URL, checked (loopback http/https only). */
export function previewBase(): ReturnType<typeof validatePreviewUrl> {
  return validatePreviewUrl(vscode.workspace.getConfiguration('vibecodeExplorer').get<string>('previewUrl', ''));
}
