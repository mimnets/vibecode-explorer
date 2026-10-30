// Phase 10: the Project tab. Reads the project's own plan (a roadmap table), requirements
// table, development log and intended folder layout, all plain Markdown the owner and the
// AI agents already keep. Pure (no `vscode` import), unit-testable. Nothing is written.

export type PhaseState = 'done' | 'active' | 'todo' | 'skipped';

export interface PlanPhase {
  id: string;
  goal: string;
  status: string;
  state: PhaseState;
  /** Other columns, such as "Serves". */
  extra: { name: string; value: string }[];
}

export interface WorkflowStep { name: string; done: boolean }

/** Splits a Markdown table row into trimmed cells. */
function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.trim());
}

const isSeparator = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** Every Markdown table in the text: header cells and body rows. */
export function markdownTables(md: string): { header: string[]; rows: string[][] }[] {
  const lines = md.split(/\r?\n/);
  const tables: { header: string[]; rows: string[][] }[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes('|') || !isSeparator(lines[i + 1])) continue;
    const header = cells(lines[i]);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]));
    tables.push({ header, rows });
    i = j - 1;
  }
  return tables;
}

/** Plain text of a Markdown cell: no bold, links or code marks. */
export function plainCell(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/<br\s*\/?>/gi, ' ').trim();
}

/** Reads a status text as done, in progress, not started or not planned. */
export function phaseState(status: string): PhaseState {
  const s = plainCell(status).toLowerCase();
  if (/^(done|complete|completed|finished|shipped|released)\b|✅|✔|owner-verified/.test(s)) return 'done';
  if (/not planned|dropped|cancel|won't|wont do|skipped/.test(s)) return 'skipped';
  if (/progress|implemented|awaiting|current|doing|wip|building|started|review|testing|approved/.test(s)) return 'active';
  return 'todo';
}

/** The first table with a phase (or step, milestone, stage) column and a status column. */
export function parsePlan(md: string): PlanPhase[] {
  for (const t of markdownTables(md)) {
    const h = t.header.map((x) => plainCell(x).toLowerCase());
    const idCol = h.findIndex((x) => /^(phase|step|milestone|stage|sprint|#)$/.test(x));
    const statusCol = h.findIndex((x) => x.startsWith('status'));
    if (idCol < 0 || statusCol < 0) continue;
    const goalCol = h.findIndex((x, i) => i !== idCol && i !== statusCol && /goal|description|what|scope|title|name/.test(x));
    return t.rows.filter((r) => r.length > Math.max(idCol, statusCol) && plainCell(r[idCol])).map((r) => ({
      id: plainCell(r[idCol]).replace(/^(phase|step|milestone|stage)\s+/i, ''),
      goal: goalCol >= 0 ? plainCell(r[goalCol] ?? '') : '',
      status: plainCell(r[statusCol]),
      state: phaseState(r[statusCol]),
      extra: t.header.map((name, i) => ({ name: plainCell(name), value: plainCell(r[i] ?? '') }))
        .filter((_, i) => i !== idCol && i !== statusCol && i !== goalCol && r[i] !== undefined)
        .filter((x) => x.value && x.value !== '—' && x.value !== '-'),
    }));
  }
  return [];
}

/** The phase being worked on: the first one in progress, otherwise the first not started. */
export function currentPhase(phases: readonly PlanPhase[]): PlanPhase | undefined {
  return phases.find((p) => p.state === 'active') ?? phases.find((p) => p.state === 'todo');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the log mentions the phase by name ("Phase 6" does not match "Phase 6b" or "Phase 60"). */
export function logMentions(logText: string, id: string): boolean {
  return new RegExp(`\\b(phase|step|milestone|stage)\\s+${escapeRe(id)}(?![\\w])`, 'i').test(logText);
}

/** The usual steps of a phase, ticked from the status text and the log. */
export function workflowSteps(p: PlanPhase, logText: string | undefined): WorkflowStep[] {
  const s = p.status.toLowerCase();
  const done = p.state === 'done';
  const built = done || /implemented|built|auto-tested|awaiting|testing|review|verified/.test(s);
  const steps: WorkflowStep[] = [
    { name: 'Plan written', done: true },
    { name: 'Approved by the owner', done: done || built || /approved/.test(s) },
    { name: 'Built', done: built },
    { name: 'Tested automatically', done: done || /tested|verified/.test(s) },
    { name: 'Checked by the owner', done: done },
  ];
  if (logText !== undefined) steps.push({ name: 'Recorded in the development log', done: logMentions(logText, p.id) });
  return steps;
}

export interface RequirementsSummary { total: number; counts: { status: string; count: number }[] }

/** Counts the first table with a requirement column and a status column by the status's first word. */
export function summarizeRequirements(md: string): RequirementsSummary | undefined {
  for (const t of markdownTables(md)) {
    const h = t.header.map((x) => plainCell(x).toLowerCase());
    const req = h.findIndex((x) => x.startsWith('requirement'));
    const status = h.findIndex((x) => x.startsWith('status'));
    if (req < 0 || status < 0) continue;
    const counts = new Map<string, number>();
    for (const r of t.rows) {
      const word = (/^[A-Za-z-]+/.exec(plainCell(r[status] ?? '')) ?? ['Unknown'])[0];
      const key = word[0].toUpperCase() + word.slice(1).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { total: t.rows.length, counts: [...counts].map(([s, count]) => ({ status: s, count })).sort((a, b) => b.count - a.count) };
  }
  return undefined;
}

// ---- Intended folder structure ----

const STRUCTURE_HEADING = /^(#{1,6})\s+.*\b(layout|structure|folders|directory|directories)\b/i;

/**
 * Planned folders from a "Layout"/"Structure" section: backticked paths ending in "/" in
 * bullets, and folder lines ("name/") of a text tree in a code block. Returns POSIX paths
 * without the trailing slash.
 */
export function plannedFolders(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const found = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = STRUCTURE_HEADING.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    let inCode = false;
    const stack: { depth: number; name: string }[] = [];
    let unit = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const h = /^(#{1,6})\s/.exec(line);
      if (!inCode && h && h[1].length <= level) break;
      if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; stack.length = 0; unit = 0; continue; }
      if (inCode) {
        const name = /^([\s│├└─|`+\\-]*)([^\s│├└─|`+][^#]*?)\s*(?:#.*)?$/.exec(line);
        if (!name) continue;
        const prefix = name[1].length;
        const entry = name[2].trim();
        if (!entry.endsWith('/') || /\s/.test(entry.slice(0, -1).trim())) continue;
        if (prefix > 0 && !unit) unit = prefix;
        const depth = unit ? Math.round(prefix / unit) : 0;
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        const parts = entry.replace(/^\.\//, '').replace(/\/$/, '');
        const full = [...stack.map((s) => s.name), parts].join('/');
        stack.push({ depth, name: parts });
        if (parts && parts !== '.') found.add(full);
      } else {
        for (const b of line.matchAll(/`([^`\s]+\/)`/g)) {
          const p = b[1].replace(/^\.\//, '').replace(/\/$/, '');
          if (p && !p.startsWith('/') && !p.includes('..') && !p.includes('*')) found.add(p);
        }
      }
    }
  }
  return [...found].sort();
}

export interface StructureDrift {
  /** Folders that exist but are not in the plan (and not inside a planned folder). */
  unplanned: string[];
  /** Planned folders that don't exist yet. */
  missing: string[];
}

/** Every folder that holds a file, from folder-relative file paths. */
export function foldersOf(files: readonly string[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }
  return [...set].sort();
}

/**
 * Compares the planned folders with the real ones. A planned folder covers everything inside
 * it; a folder is "not in the plan" when its parent is the root or a folder that only leads
 * to planned ones (like `src` for `src/extension`). Hidden folders are ignored.
 */
export function structureDrift(planned: readonly string[], existing: readonly string[]): StructureDrift {
  const plan = new Set(planned);
  const ancestors = new Set<string>();
  for (const p of planned) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) ancestors.add(parts.slice(0, i).join('/'));
  }
  const exists = new Set(existing);
  const unplanned = existing.filter((f) => {
    if (f.split('/').some((part) => part.startsWith('.'))) return false;
    if (plan.has(f) || ancestors.has(f)) return false;
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    return parent === '' || (ancestors.has(parent) && !plan.has(parent));
  });
  return { unplanned, missing: planned.filter((p) => !exists.has(p)) };
}

// ---- Issues ----

/** Control characters, except tab and line break (removing them is the point). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Cleans a one-line issue or note title from the page. */
export function cleanTitle(title: string): string {
  return title.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Cleans free text from the page: no control characters except line breaks and tabs. */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL, '').slice(0, 8000).trimEnd();
}

