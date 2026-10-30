import * as vscode from 'vscode';
import { isNoteFileName, NOTES_DIR, noteFileName, noteTemplate, parseNote, sameCommit } from '../analysis/notes';

// Phase 4: the owner's notes. This is the only place the extension writes into a project,
// and only after the owner allows it for that folder.

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
      notes.push({ uri, relPath, about: header.about, commit: header.commit, created: header.created ?? '', title: header.title || name, safe: header.safe });
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

/** Asks once per folder before the first write. Only "Yes" is remembered (in VS Code's storage, not the project). */
export async function ensureNotesAllowed(memento: vscode.Memento, folder: vscode.WorkspaceFolder): Promise<boolean> {
  if (memento.get<boolean>(allowKey(folder))) return true;
  const yes = 'Yes, save notes here';
  const answer = await vscode.window.showInformationMessage(
    `Save notes in ${NOTES_DIR}/ in "${folder.name}"?`,
    { modal: true, detail: 'VibeCode Explorer will create Markdown files in that folder only. It never changes other files and never commits. You decide whether to commit the notes.' },
    yes);
  if (answer !== yes) return false;
  await memento.update(allowKey(folder), true);
  return true;
}

/** Creates a new note file (never overwrites) and returns its URI. */
export async function createNote(folder: vscode.WorkspaceFolder, subject: NoteSubject, title: string, options: { safe?: boolean } = {}): Promise<vscode.Uri> {
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

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
