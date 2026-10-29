import { isExcludedFromAnalysis } from './sensitive';

/** One place where a symbol is used, relative to the workspace folder (forward slashes). */
export interface UsageLocation { relPath: string; line: number }

export interface UsageSummary {
  usages: UsageLocation[];
  /** Distinct files that use the symbol, sorted. */
  files: string[];
  /** Locations dropped because they are outside the folder, excluded or sensitive. */
  hidden: number;
  truncated: boolean;
}

function isOutsideFolder(relPath: string): boolean {
  return relPath === '' || relPath === '..' || relPath.startsWith('../') || relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath);
}

/** Filters, de-duplicates, sorts and caps reference locations reported by VS Code. */
export function summarizeUsages(locations: UsageLocation[], max: number): UsageSummary {
  let hidden = 0;
  const seen = new Set<string>();
  const kept: UsageLocation[] = [];
  for (const loc of locations) {
    if (isOutsideFolder(loc.relPath) || isExcludedFromAnalysis(loc.relPath)) {
      hidden++;
      continue;
    }
    const key = `${loc.relPath}:${loc.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(loc);
  }
  kept.sort((a, b) => a.relPath.localeCompare(b.relPath) || a.line - b.line);
  return {
    usages: kept.slice(0, max),
    files: [...new Set(kept.map((u) => u.relPath))].sort(),
    hidden,
    truncated: kept.length > max,
  };
}
