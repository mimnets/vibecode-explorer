import * as path from 'path';
import * as ts from 'typescript';

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export interface ParsedImports {
  /** String-literal module specifiers (static imports, re-exports, require, import()). */
  specifiers: string[];
  /** import()/require() calls whose argument is not a plain string: target unknown. */
  dynamicUnknown: number;
}

function scriptKind(fileName: string): ts.ScriptKind {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Extracts imports with the TypeScript parser (syntax only, no type checking). */
export function parseImports(fileName: string, source: string): ParsedImports {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKind(fileName));
  const specifiers = new Set<string>();
  let dynamicUnknown = 0;

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.add(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isImport || isRequire) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) specifiers.add(arg.text);
        else dynamicUnknown++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specifiers: [...specifiers], dynamicUnknown };
}

export type ImportKind = 'local' | 'external' | 'asset' | 'unknown';

export interface ResolvedImport {
  specifier: string;
  kind: ImportKind;
  /** Folder-relative POSIX path, only for kind === 'local'. */
  target?: string;
}

const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'],
};

/**
 * Resolves a specifier against the known source files of one workspace folder.
 * Only relative paths are resolved; aliases (@/, ~/, #) and anything outside the
 * folder are 'unknown' rather than guessed.
 */
export function resolveSpecifier(fromRel: string, spec: string, files: ReadonlySet<string>): ResolvedImport {
  if (!spec.startsWith('.')) {
    if (spec.startsWith('/') || /^[a-z]:/i.test(spec) || /^(@\/|~\/|#)/.test(spec)) return { specifier: spec, kind: 'unknown' };
    return { specifier: spec, kind: 'external' };
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  if (base.startsWith('..')) return { specifier: spec, kind: 'unknown' };

  const ext = path.posix.extname(base);
  const candidates = [base, ...SOURCE_EXTENSIONS.map((e) => base + e), ...SOURCE_EXTENSIONS.map((e) => `${base}/index${e}`)];
  for (const tsExt of JS_TO_TS[ext] ?? []) candidates.push(base.slice(0, -ext.length) + tsExt);

  const hit = candidates.find((c) => files.has(c));
  if (hit) return { specifier: spec, kind: 'local', target: hit };
  if (ext && !SOURCE_EXTENSIONS.includes(ext)) return { specifier: spec, kind: 'asset' };
  return { specifier: spec, kind: 'unknown' };
}
