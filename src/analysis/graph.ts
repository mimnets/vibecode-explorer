import { isExcludedFromAnalysis } from './sensitive';
import { parseImports, resolveSpecifier, ResolvedImport } from './imports';

export interface FileAnalysis {
  path: string;
  imports: ResolvedImport[];
  dynamicUnknown: number;
  /** Set when the file could not be read (too large, unreadable). */
  skipped?: string;
}

export interface DependencyGraph {
  files: FileAnalysis[];
  truncated: boolean;
}

/** Returns file text, or undefined to skip (e.g. too large). */
export type ReadFile = (relPath: string) => Promise<string | undefined>;

/**
 * Builds a file-level import graph for one workspace folder.
 * `relPaths` are POSIX paths relative to the folder root.
 */
export async function buildGraph(relPaths: string[], read: ReadFile, maxFiles: number): Promise<DependencyGraph> {
  const eligible = relPaths.filter((p) => !isExcludedFromAnalysis(p)).sort();
  const selected = eligible.slice(0, maxFiles);
  const known = new Set(selected);
  const files: FileAnalysis[] = [];

  for (const rel of selected) {
    const text = await read(rel);
    if (text === undefined) {
      files.push({ path: rel, imports: [], dynamicUnknown: 0, skipped: 'not read (too large or unreadable)' });
      continue;
    }
    const parsed = parseImports(rel, text);
    files.push({
      path: rel,
      imports: parsed.specifiers.map((s) => resolveSpecifier(rel, s, known)),
      dynamicUnknown: parsed.dynamicUnknown,
    });
  }
  return { files, truncated: eligible.length > maxFiles };
}
