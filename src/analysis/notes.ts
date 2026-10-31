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
  /** Phase 9: the commit was marked as a safe point. */
  safe?: boolean;
  /** Phase 10: an issue for the plan, open or closed (Phase 13: closed and reopened from the dashboard). */
  issue?: 'open' | 'closed';
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
      if (/^safe:\s*true\s*$/i.test(lines[i])) header.safe = true;
      const issue = /^issue:\s*(open|closed|done)\s*$/i.exec(lines[i]);
      if (issue) header.issue = issue[1].toLowerCase() === 'open' ? 'open' : 'closed';
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

export interface NoteOptions {
  safe?: boolean;
  /** Phase 10: save as an open issue for the plan. */
  issue?: boolean;
  /** Text written on the dashboard page; replaces the empty What/Why/Decision headings. */
  body?: string;
}

/** Starting text of a new note. A note without a subject is about the whole project. */
export function noteTemplate(subject: { about: string } | { commit: string } | undefined, created: string, title: string, options: NoteOptions = {}): string {
  const line = !subject ? '' : 'about' in subject ? `about: ${subject.about}\n` : `commit: ${subject.commit}\n`;
  const body = options.body?.trim() ? `${options.body.trim()}\n` : '';
  if (options.issue) {
    return `---\n${line}issue: open\ncreated: ${created}\n---\n\n# ${title}\n\n${body}${body ? '\n' : ''}To close this issue, click Close in the dashboard's Project tab, or change "issue: open" to "issue: closed" above.\n`;
  }
  if (options.safe) {
    return `---\n${line}safe: true\ncreated: ${created}\n---\n\n# ${title}\n\nMarked as a safe point: a commit that worked and is worth going back to.\n\n## Why it is safe\n\n`;
  }
  if (body) return `---\n${line}created: ${created}\n---\n\n# ${title}\n\n${body}`;
  return `---\n${line}created: ${created}\n---\n\n# ${title}\n\n## What\n\n\n## Why\n\n\n## Decision\n\n`;
}

/**
 * Phase 13: switches the header's `issue:` line from `from` to `to`, keeping every other
 * character of the note. Undefined when there is no such line, or it no longer says `from`
 * (the file was changed since the dashboard read it).
 */
export function setIssueState(text: string, from: 'open' | 'closed', to: 'open' | 'closed'): string | undefined {
  const lines = text.split('\n'); // A `\r` stays at the end of its line.
  if (lines[0].replace(/^\uFEFF/, '').trim() !== '---') return undefined;
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const m = /^(issue:\s*)(open|closed|done)(\s*)$/i.exec(lines[i]);
    if (!m) continue;
    if ((m[2].toLowerCase() === 'open' ? 'open' : 'closed') !== from) return undefined;
    lines[i] = `${m[1]}${to}${m[3]}`;
    return lines.join('\n');
  }
  return undefined;
}
