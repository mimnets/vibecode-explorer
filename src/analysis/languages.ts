// Phase 6: one entry per language the dependency graph understands.
// Adding a language means adding an entry: its file extensions and how it reads and
// resolves imports. Everything built on the graph (roles, loops, tips) then works for it.
import * as path from 'path';
import { parseImports, resolveSpecifier, ResolvedImport, SOURCE_EXTENSIONS } from './imports';
import { parsePythonImports, PYTHON_EXTENSIONS, resolvePython } from './python';

export interface LanguageSupport {
  name: string;
  extensions: string[];
  /** Reads a file's imports and resolves them against the folder's known files. */
  analyze(relPath: string, text: string, files: ReadonlySet<string>): { imports: ResolvedImport[]; dynamicUnknown: number };
}

const javascript: LanguageSupport = {
  name: 'JavaScript/TypeScript',
  extensions: SOURCE_EXTENSIONS,
  analyze(relPath, text, files) {
    const parsed = parseImports(relPath, text);
    return { imports: parsed.specifiers.map((s) => resolveSpecifier(relPath, s, files)), dynamicUnknown: parsed.dynamicUnknown };
  },
};

const python: LanguageSupport = {
  name: 'Python',
  extensions: PYTHON_EXTENSIONS,
  analyze(relPath, text, files) {
    const parsed = parsePythonImports(text);
    return { imports: resolvePython(relPath, parsed, files), dynamicUnknown: parsed.dynamicUnknown };
  },
};

export const LANGUAGES: readonly LanguageSupport[] = [javascript, python];

/** Every file extension the graph scans. */
export const GRAPH_EXTENSIONS = LANGUAGES.flatMap((l) => l.extensions);

export function languageFor(relPath: string): LanguageSupport | undefined {
  const ext = path.posix.extname(relPath).toLowerCase();
  return LANGUAGES.find((l) => l.extensions.includes(ext));
}
