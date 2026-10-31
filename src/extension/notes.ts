import * as vscode from 'vscode';
import { isNoteFileName, NoteOptions, NOTES_DIR, noteFileName, noteTemplate, parseNote, sameCommit, setIssueState } from '../analysis/notes';

// Phase 4: the owner's notes. This is the only place the extension writes into a project,
// and only after the owner allows it for that folder. Existing notes are never changed,
// except the `issue:` line of an issue (Phase 13).

const MAX_NOTES = 500;
const MAX_NOTE_BYTES = 64 * 1024;

export interface NoteEntry {
  uri: vscode.Uri;
  /** Folder-relative path of the note file. */
  relPath: string;
  about?: string;
  commit?: string;
  created: string;
  title: string;
  /** Phase 9: a safe-point mark on a commit. */
  safe?: boolean;
  /** Phase 10: an issue for the plan. */
  issue?: 'open' | 'closed';
}

/** What a note is attached to. */
export type NoteSubject = { about: string } | { commit: string };

export function notesFolderUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, ...NOTES_DIR.split('/'));
}

/** All notes in the folder's notes directory (read-only, capped). */
export async function listNotes(folder: vscode.WorkspaceFolder): Promise<NoteEntry[]> {
  if (!vscode.workspace.isTrusted) return [];
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `${NOTES_DIR}/**/*.md`), null, MAX_NOTES);
  const notes: NoteEntry[] = [];
  for (const uri of uris) {
    try {
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_NOTE_BYTES) continue;
      const header = parseNote(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
      const relPath = vscode.workspace.asRelativePath(uri, false);
      const name = relPath.split('/').pop() ?? relPath;
      notes.push({ uri, relPath, about: header.about, commit: header.commit, created: header.created ?? '', title: header.title || name, safe: header.safe, issue: header.issue });
    } catch {
      // Unreadable note: skip it.
    }
  }
  return notes.sort((a, b) => b.created.localeCompare(a.created) || a.title.localeCompare(b.title));
}

export function notesFor(notes: NoteEntry[], subject: NoteSubject): NoteEntry[] {
  return 'about' in subject
    ? notes.filter((n) => n.about === subject.about)
    : notes.filter((n) => n.commit !== undefined && sameCommit(n.commit, subject.commit));
}

const allowKey = (folder: vscode.WorkspaceFolder): string => `notesAllowed:${folder.uri.toString()}`;

/** True when the owner answered "No" to saving notes in this folder (Phase 12). */
export function notesDeclined(memento: vscode.Memento, folder: vscode.WorkspaceFolder): boolean {
  return memento.get<boolean>(allowKey(folder)) === false;
}

/** Forgets a "No", so the next note asks again (the owner clicked "Ask me again"). */
export async function forgetNotesAnswer(memento: vscode.Memento, folder: vscode.WorkspaceFolder): Promise<void> {
  if (notesDeclined(memento, folder)) await memento.update(allowKey(folder), undefined);
}

/**
 * Asks once per folder before the first write. "Yes" and "No" are remembered (in VS Code's
 * storage, not the project); closing the question without an answer asks again next time.
 */
export async function ensureNotesAllowed(memento: vscode.Memento, folder: vscode.WorkspaceFolder): Promise<boolean> {
  const saved = memento.get<boolean>(allowKey(folder));
  if (saved === true) return true;
  if (saved === false) {
    void vscode.window.showInformationMessage(`Notes are turned off for "${folder.name}". Click "Ask me again" under Notes in the dashboard to change that.`);
    return false;
  }
  const yes = 'Yes, save notes here';
  const no = 'No, don\'t ask again';
  const answer = await vscode.window.showInformationMessage(
    `Save notes in ${NOTES_DIR}/ in "${folder.name}"?`,
    { modal: true, detail: 'VibeCode Explorer will create Markdown files in that folder only. It never changes other files and never commits. You decide whether to commit the notes.' },
    yes, no);
  if (answer === no) await memento.update(allowKey(folder), false);
  if (answer !== yes) return false;
  await memento.update(allowKey(folder), true);
  return true;
}

/** Creates a new note file (never overwrites) and returns its URI. */
export async function createNote(folder: vscode.WorkspaceFolder, subject: NoteSubject | undefined, title: string, options: NoteOptions = {}): Promise<vscode.Uri> {
  if (!vscode.workspace.isTrusted) throw new Error('Notes are off in Restricted Mode.');
  const dir = notesFolderUri(folder);
  await vscode.workspace.fs.createDirectory(dir);
  const existing = new Set((await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name));
  const created = new Date().toISOString().slice(0, 10);
  const name = noteFileName(created, title, existing);
  // Defence in depth: the name is generated here and must be a plain file name.
  if (!isNoteFileName(name)) throw new Error('Invalid note file name.');
  const uri = vscode.Uri.joinPath(dir, name);
  if (await exists(uri)) throw new Error(`${NOTES_DIR}/${name} already exists.`);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(noteTemplate(subject, created, title, options)));
  return uri;
}

/**
 * Phase 13: closes or reopens an issue by switching its `issue:` line, nothing else.
 * Only a note inside the notes folder, and only when it still says the opposite state.
 */
export async function changeIssueState(folder: vscode.WorkspaceFolder, uri: vscode.Uri, to: 'open' | 'closed'): Promise<'ok' | 'changed'> {
  if (!vscode.workspace.isTrusted) throw new Error('Notes are off in Restricted Mode.');
  // Windows paths ignore letter case, so a drive letter may be spelled either way.
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const dir = norm(notesFolderUri(folder).path.replace(/\/$/, ''));
  const file = norm(uri.path);
  if (uri.scheme !== folder.uri.scheme || !file.startsWith(`${dir}/`) || file.includes('/../') || !file.endsWith('.md')) {
    throw new Error(`Only issues in ${NOTES_DIR}/ can be changed.`);
  }
  let text: string;
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_NOTE_BYTES) return 'changed';
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return 'changed'; // Deleted or unreadable since the list was read.
  }
  const next = setIssueState(text, to === 'open' ? 'closed' : 'open', to);
  if (next === undefined) return 'changed';
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next));
  return 'ok';
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
