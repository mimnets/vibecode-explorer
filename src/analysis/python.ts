// Phase 6: Python import reading and resolution (no `vscode` import, unit-testable).
// A small scanner removes comments and strings and joins continued lines, so only real
// `import` / `from … import` statements are seen. Nothing is executed or guessed.
import * as path from 'path';
import { ResolvedImport } from './imports';

export const PYTHON_EXTENSIONS = ['.py'];

export interface PyImport {
  /** Dotted module, with leading dots for relative imports ('' for `from . import x`'s rest). */
  module: string;
  /** Names after `from … import` (empty for `import x` and for `*`). */
  names: string[];
}

export interface ParsedPython {
  imports: PyImport[];
  /** Literal `importlib.import_module("x")` / `__import__("x")` targets. */
  dynamicModules: string[];
  /** Dynamic imports whose target is computed while the program runs. */
  dynamicUnknown: number;
}

const STR = '\u0001';

/** Splits source into logical lines with comments removed and strings replaced by placeholders. */
export function logicalLines(source: string): { lines: string[]; strings: string[] } {
  const lines: string[] = [];
  const strings: string[] = [];
  let cur = '';
  let depth = 0;
  const n = source.length;
  let i = 0;
  const flush = (): void => {
    if (cur.trim()) lines.push(cur.trim());
    cur = '';
  };
  while (i < n) {
    const c = source[i];
    if (c === '#') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = source.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      let j = i + quote.length;
      let text = '';
      while (j < n) {
        if (source[j] === '\\') {
          text += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (source.startsWith(quote, j)) break;
        if (!triple && source[j] === '\n') break; // unterminated single-line string
        text += source[j];
        j++;
      }
      cur += `${STR}${strings.length}${STR}`;
      strings.push(text);
      i = j + (source.startsWith(quote, j) ? quote.length : 0);
      continue;
    }
    if (c === '\\' && (source[i + 1] === '\n' || (source[i + 1] === '\r' && source[i + 2] === '\n'))) {
      i += source[i + 1] === '\r' ? 3 : 2;
      cur += ' ';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--;
    if (c === '\n' || c === '\r') {
      if (depth > 0) cur += ' ';
      else flush();
    } else if (c === ';' && depth === 0) {
      flush();
    } else {
      cur += c;
    }
    i++;
  }
  flush();
  return { lines, strings };
}

const MODULE = /^\.*[A-Za-z_][\w.]*$|^\.+$/;
const literal = (arg: string, strings: string[]): string | undefined => {
  const m = new RegExp(`^\\s*[rRbBuU]?${STR}(\\d+)${STR}\\s*$`).exec(arg);
  return m ? strings[Number(m[1])] : undefined;
};

/** Reads the imports of one Python file. */
export function parsePythonImports(source: string): ParsedPython {
  const { lines, strings } = logicalLines(source);
  const imports: PyImport[] = [];
  const dynamicModules: string[] = [];
  let dynamicUnknown = 0;
  for (const raw of lines) {
    // A one-line compound statement such as `if x: import y` or `try: import y`.
    const line = raw.replace(/^(?:(?:if|elif|else|try|except|finally|with|while|for)\b[^:]*:\s*)+/, '');
    let m = /^import\s+(.+)$/.exec(line);
    if (m) {
      for (const part of m[1].split(',')) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim();
        if (MODULE.test(mod) && !mod.startsWith('.')) imports.push({ module: mod, names: [] });
      }
    } else if ((m = /^from\s+(\S+)\s+import\s+(.+)$/.exec(line))) {
      const mod = m[1];
      if (!MODULE.test(mod)) continue;
      const names = m[2].replace(/[()]/g, ' ').split(',')
        .map((p) => p.trim().split(/\s+as\s+/)[0].trim())
        .filter((p) => /^[A-Za-z_]\w*$/.test(p));
      imports.push({ module: mod, names });
    }
    for (const call of line.matchAll(/\b(?:import_module|__import__)\s*\(([^,)]*)/g)) {
      const value = literal(call[1], strings);
      if (value !== undefined && /^[A-Za-z_][\w.]*$/.test(value)) dynamicModules.push(value);
      else dynamicUnknown++;
    }
  }
  return { imports, dynamicModules, dynamicUnknown };
}

const fileFor = (base: string, files: ReadonlySet<string>): string | undefined =>
  [`${base}.py`, `${base}/__init__.py`].find((c) => files.has(c));

/**
 * Resolves Python imports against the folder's known files.
 * Relative imports use the file's package; absolute ones are tried from the folder root,
 * a `src/` folder and the file's own folder (how a script finds its neighbours).
 * Absolute modules that are not found are packages (standard library or installed).
 */
export function resolvePython(fromRel: string, parsed: ParsedPython, files: ReadonlySet<string>): ResolvedImport[] {
  const out = new Map<string, ResolvedImport>();
  const add = (r: ResolvedImport): void => {
    if (!out.has(r.specifier)) out.set(r.specifier, r);
  };
  const dir = path.posix.dirname(fromRel);
  const roots = [...new Set(['', 'src', dir === '.' ? '' : dir])];
  const absolute = (dotted: string): string | undefined => {
    for (const root of roots) {
      const hit = fileFor(path.posix.join(root, dotted.split('.').join('/')), files);
      if (hit) return hit;
    }
    return undefined;
  };
  const resolveModule = (mod: string, names: string[]): void => {
    if (mod.startsWith('.')) {
      const level = /^\.+/.exec(mod)![0].length;
      const rest = mod.slice(level);
      let pkg = dir === '.' ? '' : dir;
      for (let k = 1; k < level; k++) {
        if (!pkg) return add({ specifier: mod, kind: 'unknown' }); // above the folder
        pkg = path.posix.dirname(pkg) === '.' ? '' : path.posix.dirname(pkg);
      }
      const base = rest ? path.posix.join(pkg, rest.split('.').join('/')) : pkg;
      // `from .pkg import sub` may import a submodule file.
      let fromPackage = names.length === 0;
      for (const name of names) {
        const sub = fileFor(path.posix.join(base, name), files);
        if (sub) add({ specifier: `${mod}${rest ? '.' : ''}${name}`, kind: 'local', target: sub });
        else fromPackage = true;
      }
      // The package file itself is a dependency only when a name comes from it.
      if (!fromPackage) return;
      const own = base ? fileFor(base, files) : files.has('__init__.py') ? '__init__.py' : undefined;
      add(own ? { specifier: mod, kind: 'local', target: own } : { specifier: mod, kind: 'unknown' });
      return;
    }
    let fromPackage = names.length === 0;
    for (const name of names) {
      const sub = absolute(`${mod}.${name}`);
      if (sub) add({ specifier: `${mod}.${name}`, kind: 'local', target: sub });
      else fromPackage = true;
    }
    if (!fromPackage) return;
    const own = absolute(mod);
    add(own ? { specifier: mod, kind: 'local', target: own } : { specifier: mod, kind: 'external' });
  };
  for (const imp of parsed.imports) resolveModule(imp.module, imp.names);
  for (const mod of parsed.dynamicModules) resolveModule(mod, []);
  // A file importing its own package's __init__ is not a dependency worth drawing.
  return [...out.values()].filter((r) => r.target !== fromRel);
}
