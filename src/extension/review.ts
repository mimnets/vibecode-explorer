import * as vscode from 'vscode';
import { cleanReviewed, MAX_REVIEWED, ReviewChecks, reviewChecklist, ReviewItem, reviewKey } from '../analysis/review';
import { isSensitiveFile } from '../analysis/sensitive';
import { Target } from './state';

// Phase 14: the review checklist for one AI session. Reads the files' state only; the ticks
// are kept in VS Code's storage (workspaceState), never in the project.

export interface ReviewResult { session: string; items: (ReviewItem & { id: string })[]; checks: ReviewChecks }
export interface ReviewFile { target: Target; exists: boolean }

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * The checklist for a session's changed files (`paths`, folder-relative). Files are addressed
 * by opaque `v…` ids. A file in the workspace changes opens as its diff, like in the changes list.
 */
export async function loadReview(
  folder: vscode.WorkspaceFolder, memento: vscode.Memento, sessionId: string, sessionFile: string,
  paths: string[], securityMentions: number, targets: Map<string, Target>,
): Promise<{ result: ReviewResult; files: Map<string, ReviewFile> }> {
  const unique = [...new Set(paths)];
  const changed = new Map<string, Target>();
  for (const t of targets.values()) if (t.change) changed.set(t.relPath, t);
  const files = new Map<string, ReviewFile>();
  const facts = await Promise.all(unique.map(async (p) => {
    const change = changed.get(p);
    const target: Target = change ?? { uri: vscode.Uri.joinPath(folder.uri, ...p.split('/')), relPath: p, sensitive: isSensitiveFile(p) };
    return { path: p, uncommitted: !!change, exists: await exists(target.uri), target };
  }));
  const reviewed = cleanReviewed(memento.get(reviewKey(folder.uri.toString(), sessionFile)), unique);
  const { items, checks } = reviewChecklist(facts, reviewed, securityMentions);
  const result: ReviewResult = {
    session: sessionId,
    items: items.map((item, i) => {
      const id = `v${i}`;
      files.set(id, { target: facts[i].target, exists: facts[i].exists });
      return { ...item, id };
    }),
    checks,
  };
  return { result, files };
}

/** Ticks or unticks one file of a session. Returns how many of `paths` are now ticked. */
export async function setReviewed(
  folder: vscode.WorkspaceFolder, memento: vscode.Memento, sessionFile: string, paths: string[], file: string, reviewed: boolean,
): Promise<number> {
  const key = reviewKey(folder.uri.toString(), sessionFile);
  const unique = [...new Set(paths)];
  const ticks = new Set(cleanReviewed(memento.get(key), unique));
  if (reviewed && unique.includes(file)) ticks.add(file);
  else ticks.delete(file);
  await memento.update(key, ticks.size ? [...ticks].slice(0, MAX_REVIEWED) : undefined);
  return ticks.size;
}

/** How many of a session's files are ticked, for the session list. */
export function reviewedCount(folder: vscode.WorkspaceFolder, memento: vscode.Memento, sessionFile: string, paths: string[]): number {
  return cleanReviewed(memento.get(reviewKey(folder.uri.toString(), sessionFile)), paths).length;
}
