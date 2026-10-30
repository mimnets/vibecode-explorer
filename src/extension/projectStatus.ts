import * as path from 'path';
import * as vscode from 'vscode';
import { MAX_TREE_FILES, TREE_EXCLUDE_GLOB } from '../analysis/fileTree';
import {
  currentPhase, foldersOf, parsePlan, PlanPhase, plannedFolders, RequirementsSummary, structureDrift, summarizeRequirements, WorkflowStep, workflowSteps,
} from '../analysis/projectStatus';
import { listNotes } from './notes';
import { CodeLocation } from './state';

// Phase 10: the Project tab. Where development stands, read from the project's own plan,
// requirements, development log and intended folder layout (plain Markdown). Read-only;
// the only write is a new issue, saved as a note under the notes permission (session.ts).

const MAX_DOC_BYTES = 1024 * 1024;
const PLAN_FILES = ['docs/roadmap.md', 'ROADMAP.md', 'roadmap.md', 'docs/ROADMAP.md', 'docs/plan.md', 'PLAN.md', 'plan.md'];
const REQUIREMENT_FILES = ['docs/requirements.md', 'REQUIREMENTS.md', 'requirements.md'];
const LOG_FILES = ['docs/development-log.md', 'DEVELOPMENT-LOG.md', 'docs/devlog.md', 'docs/changelog.md', 'CHANGELOG.md'];
const STRUCTURE_FILES = ['docs/structure.md', 'STRUCTURE.md', 'AGENTS.md', 'CLAUDE.md', 'docs/architecture.md', 'README.md'];

export interface DocRef { id: string; file: string }
export type ProjectResult =
  | { state: 'restricted' | 'none' }
  | {
    state: 'ok';
    folder: string;
    plan?: DocRef & { phases: (PlanPhase & { steps: WorkflowStep[] })[]; current?: string };
    requirements?: DocRef & RequirementsSummary;
    log?: DocRef;
    structure?: DocRef & { planned: string[]; unplanned: string[]; missing: string[] };
    issues: { id: string; title: string; created: string; state: 'open' | 'closed'; path: string }[];
    lookedFor: { plan: string[]; structure: string[] };
  };

async function readDoc(uri: vscode.Uri): Promise<string | undefined> {
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_DOC_BYTES) return undefined;
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export async function loadProject(folder: vscode.WorkspaceFolder): Promise<{ result: ProjectResult; locations: Map<string, CodeLocation> }> {
  const locations = new Map<string, CodeLocation>();
  if (!vscode.workspace.isTrusted) return { result: { state: 'restricted' }, locations };
  const uriOf = (rel: string): vscode.Uri => vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
  let next = 0;
  const locate = (rel: string, name: string, uri = uriOf(rel)): string => {
    const id = `j${next++}`;
    locations.set(id, { uri, relPath: rel, position: new vscode.Position(0, 0), name });
    return id;
  };
  /** The first candidate that exists and passes `accept`. */
  const first = async <T>(names: string[], accept: (text: string) => T | undefined): Promise<{ file: string; value: T; text: string } | undefined> => {
    for (const name of names) {
      const text = await readDoc(uriOf(name));
      if (text === undefined) continue;
      const value = accept(text);
      if (value !== undefined) return { file: name, value, text };
    }
    return undefined;
  };

  const log = await first(LOG_FILES, () => true);
  const plan = await first(PLAN_FILES, (t) => { const p = parsePlan(t); return p.length ? p : undefined; });
  const reqs = await first(REQUIREMENT_FILES, summarizeRequirements);
  const layout = await first(STRUCTURE_FILES, (t) => { const p = plannedFolders(t); return p.length ? p : undefined; });

  let structure: (DocRef & { planned: string[]; unplanned: string[]; missing: string[] }) | undefined;
  if (layout) {
    const files = (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), TREE_EXCLUDE_GLOB, MAX_TREE_FILES))
      .map((u) => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/'))
      .filter((f) => f && !f.startsWith('..'));
    const drift = structureDrift(layout.value, foldersOf(files));
    structure = { id: locate(layout.file, layout.file), file: layout.file, planned: layout.value, ...drift };
  }

  const issues = (await listNotes(folder)).filter((n) => n.issue).map((n) => {
    const id = `j${next++}`;
    locations.set(id, { uri: n.uri, relPath: n.relPath, position: new vscode.Position(0, 0), name: n.title });
    return { id, title: n.title, created: n.created, state: n.issue as 'open' | 'closed', path: n.relPath };
  }).sort((a, b) => (a.state === b.state ? b.created.localeCompare(a.created) : a.state === 'open' ? -1 : 1));

  const phases = plan?.value.map((p) => ({ ...p, steps: workflowSteps(p, log?.text) }));
  return {
    result: {
      state: 'ok',
      folder: folder.name,
      plan: plan && phases ? { id: locate(plan.file, plan.file), file: plan.file, phases, current: currentPhase(plan.value)?.id } : undefined,
      requirements: reqs ? { id: locate(reqs.file, reqs.file), file: reqs.file, ...reqs.value } : undefined,
      log: log ? { id: locate(log.file, log.file), file: log.file } : undefined,
      structure,
      issues,
      lookedFor: { plan: PLAN_FILES, structure: STRUCTURE_FILES },
    },
    locations,
  };
}
