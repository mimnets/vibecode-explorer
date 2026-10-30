// Phase 7: database definitions in schema files: `CREATE TABLE` in SQL files and `model`
// blocks in Prisma schemas. Pure, unit-testable. The files are only read, never run.
import { emptyFacts, FileApiFacts } from './apis';

export const SCHEMA_GLOB = '**/{*.sql,*.prisma}';

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Blanks out comments (keeping line breaks) so commented-out tables are not found. */
function withoutComments(text: string, lineComment: RegExp): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(lineComment, (c) => ' '.repeat(c.length));
}

export function analyzeSql(source: string): FileApiFacts {
  const facts = emptyFacts();
  const text = withoutComments(source, /--[^\n]*/g);
  const re = /\bcreate\s+(?:or\s+replace\s+)?(?:(?:global\s+|local\s+)?temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:[`"[]?[\w$]+[`"\]]?\.)?[`"[]?[\w$]+[`"\]]?)/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1].replace(/[`"[\]]/g, '');
    facts.models.push({ name, table: name, line: lineAt(text, m.index ?? 0), kind: 'SQL table' });
  }
  return facts;
}

export function analyzePrisma(source: string): FileApiFacts {
  const facts = emptyFacts();
  const text = withoutComments(source, /\/\/[^\n]*/g);
  for (const m of text.matchAll(/^\s*model\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const table = /@@map\(\s*"([^"]+)"\s*\)/.exec(m[2])?.[1];
    facts.models.push({ name: m[1], table, line: lineAt(text, (m.index ?? 0) + m[0].indexOf('model')), kind: 'Prisma model' });
  }
  return facts;
}
