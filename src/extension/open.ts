import * as path from 'path';
import * as vscode from 'vscode';
import { headUri } from '../git/gitChanges';
import { CodeLocation, Target } from './state';

// Opening files, positions and diffs in the VS Code editor. Read-only.

export const SIDE = { viewColumn: vscode.ViewColumn.Beside, preview: true } as const;

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
