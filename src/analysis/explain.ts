// Phase 5: plain-language explanations built only from static facts (no AI).
// Pure helpers (no `vscode` import, unit-testable). Every sentence states a fact the
// extension can check; possible problems are worded as "may".

export type FileRole = 'entry point' | 'hub' | 'leaf';

/** Files used by at least this many other files are called a hub. */
export const HUB_THRESHOLD = 5;
const LARGE_FILE_LINES = 400;

export function fileRole(localImports: number, importedBy: number): FileRole | undefined {
  if (importedBy >= HUB_THRESHOLD) return 'hub';
  if (importedBy === 0 && localImports > 0) return 'entry point';
  if (localImports === 0 && importedBy > 0) return 'leaf';
  return undefined;
}

/** Groups of files that import each other, directly or in a loop (strongly connected components, Tarjan). */
export function findCycles(nodes: string[], edges: [string, string][]): string[][] {
  const next = new Map<string, string[]>(nodes.map((n) => [n, []]));
  const selfLoops = new Set<string>();
  for (const [a, b] of edges) {
    if (!next.has(a) || !next.has(b)) continue;
    if (a === b) selfLoops.add(a);
    else (next.get(a) as string[]).push(b);
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  // Iterative depth-first search, so a long import chain cannot overflow the call stack.
  for (const start of nodes) {
    if (idx.has(start)) continue;
    const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
    idx.set(start, index); low.set(start, index); index++;
    stack.push(start); onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const out = next.get(frame.node) as string[];
      if (frame.i < out.length) {
        const w = out[frame.i++];
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++;
          stack.push(w); onStack.add(w);
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, idx.get(w) as number));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent) as number, low.get(frame.node) as number));
      }
      if (low.get(frame.node) === idx.get(frame.node)) {
        const group: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          onStack.delete(w);
          group.push(w);
        } while (w !== frame.node);
        if (group.length > 1 || selfLoops.has(frame.node)) groups.push(group.sort());
      }
    }
  }
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}

const base = (p: string): string => p.split('/').pop() ?? p;
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

/** "a.ts, b.ts and 3 more" */
function listNames(paths: string[], max = 3): string {
  const names = paths.map(base);
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

export interface FileFacts {
  path: string;
  fileType: string;
  /** Project files this file imports. */
  localImports: string[];
  /** Package names this file imports. */
  packages: string[];
  unknownImports: number;
  /** Project files that import this file. */
  importedBy: string[];
  /** Top-level symbol counts by kind name (e.g. Class, Function). */
  symbolKinds: Record<string, number>;
  commits?: { count: number; capped: boolean; last?: string };
  notes: number;
  lines?: number;
  /** Other files in the same import loop. */
  cycleWith: string[];
  /** True when a test file for this file exists in the project. */
  hasTest: boolean;
  analyzed: boolean;
}

const KIND_WORDS: Record<string, [string, string]> = {
  Class: ['class', 'classes'], Function: ['function', 'functions'], Interface: ['interface', 'interfaces'],
  Enum: ['enum', 'enums'], Variable: ['variable', 'variables'], Constant: ['constant', 'constants'],
  Method: ['method', 'methods'], Module: ['module', 'modules'], Namespace: ['namespace', 'namespaces'],
  TypeParameter: ['type', 'types'], Property: ['property', 'properties'], Struct: ['struct', 'structs'],
};

/** Plain sentences about a file. */
export function explainFile(f: FileFacts): { sentences: string[]; role?: FileRole } {
  const sentences: string[] = [];
  const name = base(f.path);
  const lineInfo = f.lines ? ` with ${plural(f.lines, 'line')}` : '';
  // Abbreviations are read letter by letter: "an MD file", "a TS file".
  const article = /^[AEFHILMNORSX]/.test(f.fileType) ? 'an' : 'a';
  sentences.push(f.fileType === 'no extension' ? `${name} is a file without an extension${lineInfo}.` : `${name} is ${article} ${f.fileType} file${lineInfo}.`);
  let role: FileRole | undefined;
  if (f.analyzed) {
    const uses: string[] = [];
    if (f.localImports.length) uses.push(`${plural(f.localImports.length, 'other file')} in this project (${listNames(f.localImports)})`);
    if (f.packages.length) uses.push(`${plural(f.packages.length, 'package')} (${f.packages.slice(0, 3).join(', ')}${f.packages.length > 3 ? ', …' : ''})`);
    sentences.push(uses.length ? `It uses ${uses.join(' and ')}.` : 'It does not import anything.');
    if (f.unknownImports) sentences.push(`${plural(f.unknownImports, 'import')} could not be followed (an alias or a computed path).`);
    sentences.push(f.importedBy.length ? `${plural(f.importedBy.length, 'file')} use${f.importedBy.length === 1 ? 's' : ''} it (${listNames(f.importedBy)}).` : 'No other file in this project imports it.');
    role = fileRole(f.localImports.length, f.importedBy.length);
    if (role === 'hub') sentences.push(`That makes it a hub: a change here can affect ${plural(f.importedBy.length, 'file')}.`);
    else if (role === 'entry point') sentences.push('Nothing imports it, so it is likely an entry point where the program or a feature starts.');
    else if (role === 'leaf') sentences.push('It uses no other project files, so it is a leaf: it can be read and tested on its own.');
  }
  const kinds = Object.entries(f.symbolKinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (kinds.length) {
    const parts = kinds.slice(0, 4).map(([k, n]) => {
      const w = KIND_WORDS[k] ?? [k.toLowerCase(), k.toLowerCase() + 's'];
      return plural(n, w[0], w[1]);
    });
    sentences.push(`It defines ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]} at the top level.`);
  }
  if (f.commits && f.commits.count > 0) {
    sentences.push(`It was changed in ${f.commits.capped ? 'at least ' : ''}${plural(f.commits.count, 'commit')}${f.commits.last ? `, most recently on ${f.commits.last}` : ''}.`);
  } else if (f.commits) {
    sentences.push('It has not been committed yet.');
  }
  if (f.notes) sentences.push(`You have ${plural(f.notes, 'note')} on it.`);
  return { sentences, role };
}

/** At most three rule-based tips about a file. */
export function codeTips(f: FileFacts): string[] {
  const tips: string[] = [];
  if (f.cycleWith.length) {
    tips.push(`${base(f.path)} and ${listNames(f.cycleWith)} import each other (a circular import). This can cause load-order bugs where something is still undefined. Moving the shared part into a separate file breaks the loop.`);
  }
  if (f.lines && f.lines > LARGE_FILE_LINES) {
    tips.push(`At ${f.lines} lines this file is large. Splitting it by responsibility makes it easier to read and to ask an AI about one part at a time.`);
  }
  if (f.importedBy.length >= HUB_THRESHOLD && !f.hasTest && !/\.(test|spec)\.[a-z]+$/i.test(f.path)) {
    tips.push(`${plural(f.importedBy.length, 'file')} depend on this file and no test file for it was found. A test protects everything that depends on it.`);
  }
  return tips.slice(0, 3);
}

/** True when `candidate` looks like a test file for `path` (same base name, .test/.spec). */
export function isTestFor(path: string, candidate: string): boolean {
  const stem = base(path).replace(/\.[^.]+$/, '');
  return new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(test|spec)\\.[a-z]+$`, 'i').test(base(candidate));
}

export interface SymbolFacts {
  name: string;
  kind: string;
  line: number;
  /** Declaration text from the language's hover information, if any. */
  signature?: string;
  /** Doc comment from the hover information, if any. */
  doc?: string;
  usages?: { available: boolean; places: number; files: string[]; ownFile: string; truncated: boolean };
}

/** Plain sentences about a symbol. */
export function explainSymbol(s: SymbolFacts): string[] {
  const kind = (KIND_WORDS[s.kind]?.[0] ?? s.kind.toLowerCase());
  const sentences = [`${s.name} is a${/^[aeiou]/.test(kind) ? 'n' : ''} ${kind} defined on line ${s.line}.`];
  if (s.signature) sentences.push(`Its declaration: ${s.signature}`);
  if (s.doc) sentences.push(`Its documentation says: ${s.doc}`);
  const u = s.usages;
  if (u?.available) {
    const others = u.files.filter((f) => f !== u.ownFile);
    if (u.places <= 1) {
      sentences.push('No usages were found besides its definition, so it may be unused.');
    } else {
      sentences.push(`It appears in ${u.truncated ? 'more than ' : ''}${plural(u.places, 'place')} in ${plural(u.files.length, 'file')} (counting its definition).`);
      if (others.length === 0) sentences.push('It is only used inside its own file.');
    }
  }
  return sentences;
}

/** Splits VS Code hover markdown into a declaration (first code block) and plain doc text. */
export function parseHover(markdown: string[]): { signature?: string; doc?: string } {
  let signature: string | undefined;
  const docs: string[] = [];
  for (const md of markdown) {
    const fence = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(md);
    if (fence && signature === undefined) signature = fence[1].trim().replace(/\s+/g, ' ').slice(0, 300);
    const text = md.replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
      .replace(/[*_`#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) docs.push(text);
  }
  const doc = docs.join(' ').slice(0, 500);
  return { signature: signature || undefined, doc: doc || undefined };
}
