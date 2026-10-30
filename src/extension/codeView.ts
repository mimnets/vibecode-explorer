import * as vscode from 'vscode';
import { DiffRow, diffRows, TextResult, toLines } from '../analysis/codeText';
import { isSensitiveFile } from '../analysis/sensitive';
import { gitUriAt, headUri } from '../git/gitChanges';
import { HistoryFile } from './history';
import { CodeLocation, Target } from './state';

// Phase 6c: the code and before/after views that the browser shows instead of opening
// VS Code's editor. Read-only: files are read through VS Code, older versions through
// VS Code's Git. Sensitive files are never read.

export interface CodeView {
  /** The id the view was asked for; the page ignores views for an earlier click. */
  for: string;
  title: string;
  path: string;
  mode: 'file' | 'diff' | 'none';
  lines?: string[];
  rows?: DiffRow[];
  /** 1-based line to highlight and scroll to. */
  highlight?: number;
  note?: string;
}

const SENSITIVE_NOTE = 'This is a sensitive file. VibeCode Explorer does not show its contents.';
const BINARY_NOTE = 'This is a binary file, so it is not shown.';
const UNREADABLE_NOTE = 'This file could not be read.';
const TRUNCATED_NOTE = 'This file is large, so only its first part is shown.';
const TOO_DIFFERENT_NOTE = 'Too many lines changed to compare them line by line. Showing the new version.';

async function read(uri: vscode.Uri): Promise<TextResult | undefined> {
  try {
    return toLines(await vscode.workspace.fs.readFile(uri));
  } catch {
    // Older Git versions are served as documents rather than files by some VS Code versions.
    try {
      return uri.scheme === 'file' ? undefined : toLines(new TextEncoder().encode((await vscode.workspace.openTextDocument(uri)).getText()));
    } catch {
      return undefined;
    }
  }
}

async function fileView(base: Omit<CodeView, 'mode'>, uri: vscode.Uri | undefined, highlight?: number): Promise<CodeView> {
  const text = uri && await read(uri);
  if (!text) return { ...base, mode: 'none', note: UNREADABLE_NOTE };
  if (text.kind === 'binary') return { ...base, mode: 'none', note: BINARY_NOTE };
  return { ...base, mode: 'file', lines: text.lines, highlight, note: [base.note, text.truncated ? TRUNCATED_NOTE : ''].filter(Boolean).join(' ') || undefined };
}

async function diffView(base: Omit<CodeView, 'mode'>, before: vscode.Uri, after: vscode.Uri): Promise<CodeView> {
  const [a, b] = await Promise.all([read(before), read(after)]);
  if (!a || !b) return { ...base, mode: 'none', note: UNREADABLE_NOTE };
  if (a.kind === 'binary' || b.kind === 'binary') return { ...base, mode: 'none', note: BINARY_NOTE };
  const rows = diffRows(a.lines, b.lines);
  if (!rows) return { ...base, mode: 'file', lines: b.lines, note: TOO_DIFFERENT_NOTE };
  return { ...base, mode: 'diff', rows, note: a.truncated || b.truncated ? TRUNCATED_NOTE : undefined };
}

/** A file from the graph or the changes list: its diff against HEAD where it changed, else its contents. */
export async function codeForTarget(id: string, t: Target): Promise<CodeView> {
  const base = { for: id, title: t.relPath, path: t.relPath };
  if (t.sensitive || isSensitiveFile(t.relPath)) return { ...base, mode: 'none', note: SENSITIVE_NOTE };
  const c = t.change;
  const head = c ? headUri(c.originalUri) : undefined;
  if (c && head && c.group === 'deleted') return fileView({ ...base, title: `${t.relPath} (deleted, HEAD version)` }, head);
  if (c && head && (c.group === 'modified' || c.group === 'renamed')) return diffView({ ...base, title: `${t.relPath} (HEAD ↔ working tree)` }, head, c.uri);
  if (c?.group === 'deleted') return { ...base, mode: 'none', note: 'This file was deleted.' };
  return fileView(base, t.uri);
}

/** A file of a commit: what the commit changed in it. */
export async function codeForCommitFile(id: string, f: HistoryFile): Promise<CodeView> {
  const short = f.hash.slice(0, 7);
  const base = { for: id, title: f.relPath, path: f.relPath };
  if (f.sensitive || isSensitiveFile(f.relPath) || (f.oldRelPath !== '' && isSensitiveFile(f.oldRelPath))) {
    return { ...base, mode: 'none', note: SENSITIVE_NOTE };
  }
  const before = gitUriAt(f.originalUri, f.parent);
  const after = gitUriAt(f.uri, f.hash);
  if (f.group === 'added') return fileView({ ...base, title: `${f.relPath} (added in ${short})` }, after);
  if (f.group === 'deleted') return fileView({ ...base, title: `${f.relPath} (deleted in ${short}, previous version)` }, before);
  if (!before || !after) return { ...base, mode: 'none', note: UNREADABLE_NOTE };
  return diffView({ ...base, title: `${f.relPath} (${short}^ ↔ ${short})` }, before, after);
}

/** A symbol or usage: the file, with that line highlighted. */
export async function codeForLocation(id: string, loc: CodeLocation): Promise<CodeView> {
  const base = { for: id, title: `${loc.relPath}:${loc.position.line + 1}`, path: loc.relPath };
  if (isSensitiveFile(loc.relPath)) return { ...base, mode: 'none', note: SENSITIVE_NOTE };
  return fileView(base, loc.uri, loc.position.line + 1);
}
