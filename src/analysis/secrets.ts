// Text that looks like a credential. Shared by the AI sessions tab (Phase 4b), which hides it,
// and the Health tab (Phase 9), which says where it is without showing it. Pure, unit-testable.

/** Token formats that are almost always real credentials. */
export const SECRET_TOKENS: readonly { kind: string; re: RegExp }[] = [
  { kind: 'API key (sk-…)', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { kind: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
];

/** `password = …`-style assignments, for hiding in free text (any value). */
export const SECRET_ASSIGNMENT = /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*)(["']?)[^\s"']{4,}\2/gi;

/** In source code only a quoted value counts, so `password: string` (a type) is not flagged. */
const CODE_ASSIGNMENT = /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)\w*["']?\s*[:=]\s*(["'`])([^"'`\s]{8,})\1/gi;
/** Values that are clearly not real: placeholders, examples, variables. */
const PLACEHOLDER = /^(?:x+|\*+|\.+|changeme|change[_-]?me|example\w*|placeholder|dummy|test\w*|fake\w*|sample\w*|your[_-]\w+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|process\.env.*|null|undefined|none|todo)$/i;

export interface SecretHit { line: number; kind: string }

/** Where text looks like a credential. The value itself is never returned. */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lineAt = (index: number): number => text.slice(0, index).split('\n').length;
  const seen = new Set<string>();
  // One finding per line: the most specific kind (token formats are checked first).
  const add = (index: number, kind: string): void => {
    const line = lineAt(index);
    if (!seen.has(String(line))) {
      seen.add(String(line));
      hits.push({ line, kind });
    }
  };
  for (const { kind, re } of SECRET_TOKENS) for (const m of text.matchAll(re)) add(m.index ?? 0, kind);
  for (const m of text.matchAll(CODE_ASSIGNMENT)) {
    if (!PLACEHOLDER.test(m[2]) && !/^[A-Z_]+$/.test(m[2])) add(m.index ?? 0, 'password or key in the code');
  }
  return hits.sort((a, b) => a.line - b.line);
}
