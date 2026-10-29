// Paths that are never read or parsed. Git may still *list* these filenames.

/** Directories skipped entirely during scanning: generated, vendored or VCS internals. */
export const EXCLUDED_DIRS = [
  'node_modules', '.git', 'out', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', '.vscode-test', 'vendor', 'bower_components',
  // Python
  '__pycache__', '.venv', 'venv', '.tox', '.nox', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'site-packages', '.eggs',
];

/** Glob for `workspace.findFiles` exclusion. */
export const EXCLUDE_GLOB = `{${EXCLUDED_DIRS.map((d) => `**/${d}/**`).join(',')},**/*.egg-info/**,**/.env*,**/*.d.ts,**/*.min.js}`;

const SENSITIVE_NAME_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|crt|cer|der|keystore|jks|kdbx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^(\.npmrc|\.yarnrc(\.yml)?|\.pypirc|\.netrc|\.pgpass|\.htpasswd)$/i,
  /^(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /\.secrets?(\.[a-z0-9]+)?$/i,
];

function segments(relPath: string): string[] {
  return relPath.split(/[\\/]+/).filter(Boolean);
}

/** True for files whose *contents* must never be read (secrets, keys, env files). */
export function isSensitiveFile(relPath: string): boolean {
  const name = segments(relPath).pop() ?? '';
  return SENSITIVE_NAME_PATTERNS.some((re) => re.test(name));
}

/** True when the path is inside an excluded directory or is sensitive. */
export function isExcludedFromAnalysis(relPath: string): boolean {
  const parts = segments(relPath);
  return parts.slice(0, -1).some((p) => EXCLUDED_DIRS.includes(p) || p.endsWith('.egg-info')) || isSensitiveFile(relPath);
}
