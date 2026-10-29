// Pure helpers for the owner's notes (no `vscode` import, unit-testable).
// A note is a Markdown file with a small header saying what it is about:
//   ---
//   about: src/app.ts      (or: commit: 5ed9230…)
//   created: 2026-10-29
//   ---
//   # Title

/** Notes folder, relative to the workspace folder. */
export const NOTES_DIR = '.vibecode/notes';

export interface NoteHeader {
  /** File the note is about (folder-relative, forward slashes). */
  about?: string;
  /** Commit hash the note is about. */
  commit?: string;
  created?: string;
  /** First `# ` heading, or '' when there is none. */
  title: string;
}

/** Reads the `---` header and the first heading. Unknown keys are ignored. */
export function parseNote(text: string): NoteHeader {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header: NoteHeader = { title: '' };
  let i = 0;
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      const m = /^(about|commit|created):\s*(.*?)\s*$/.exec(lines[i]);
      if (m && m[2]) header[m[1] as 'about' | 'commit' | 'created'] = m[2];
    }
    i++;
  }
  for (; i < lines.length; i++) {
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (m) {
      header.title = m[1];
      break;
    }
  }
  return header;
}

/** True when a note is about this commit. Notes may store a short or a full hash. */
export function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x));
}

/** File names the extension creates: `YYYY-MM-DD-slug.md`, lowercase letters, digits and dashes only. */
const NOTE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,60}\.md$/;

export function isNoteFileName(name: string): boolean {
  return NOTE_NAME.test(name);
}

/** A new, unused file name for a note. Never contains path separators. */
export function noteFileName(created: string, title: string, existing: Set<string>): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'note';
  for (let n = 1; ; n++) {
    const name = `${created}-${slug}${n === 1 ? '' : `-${n}`}.md`;
    if (!existing.has(name)) return name;
  }
}

/** Starting text of a new note. */
export function noteTemplate(subject: { about: string } | { commit: string }, created: string, title: string): string {
  const line = 'about' in subject ? `about: ${subject.about}` : `commit: ${subject.commit}`;
  return `---\n${line}\ncreated: ${created}\n---\n\n# ${title}\n\n## What\n\n\n## Why\n\n\n## Decision\n\n`;
}
