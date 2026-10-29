import * as vscode from 'vscode';
import { codeTips, explainFile, explainSymbol, FileFacts, FileRole, isTestFor, parseHover } from '../analysis/explain';
import { getFileHistory } from '../git/gitChanges';
import { CodeLocation, DashboardState, FileDetails, Target, UsageResult } from './state';

// Phase 5: gathers static facts about a file or symbol and turns them into plain sentences.
// Read-only: graph data the dashboard already has, VS Code's hover information and Git history.

const MAX_LINE_COUNT_BYTES = 512 * 1024;

export interface FileExplanation { sentences: string[]; role?: FileRole; tips: string[] }

export async function explainTarget(
  folder: vscode.WorkspaceFolder, target: Target, details: FileDetails, state: DashboardState, notes: number,
): Promise<FileExplanation> {
  const pathOf = new Map(state.graph.nodes.map((n) => [n.id, n.path]));
  const nodeId = state.graph.nodes.find((n) => n.kind === 'file' && n.path === target.relPath)?.id;
  const importedBy = nodeId ? state.graph.edges.filter((e) => e.target === nodeId).map((e) => pathOf.get(e.source) as string) : [];
  const cycleSet = new Set(state.graph.cycleEdges.map((i) => state.graph.edges[i]));
  // Files in the same loop: reachable both ways through loop edges.
  const cycleWith: string[] = [];
  if (nodeId && state.graph.cycleNodes.includes(nodeId)) {
    const reach = (from: string, forward: boolean): Set<string> => {
      const seen = new Set([from]);
      const todo = [from];
      while (todo.length) {
        const cur = todo.pop() as string;
        for (const e of cycleSet) {
          const [a, b] = forward ? [e.source, e.target] : [e.target, e.source];
          if (a === cur && !seen.has(b)) { seen.add(b); todo.push(b); }
        }
      }
      return seen;
    };
    const back = reach(nodeId, false);
    for (const n of reach(nodeId, true)) if (n !== nodeId && back.has(n)) cycleWith.push(pathOf.get(n) as string);
  }

  const symbolKinds: Record<string, number> = {};
  for (const s of details.symbols) if (s.depth === 0) symbolKinds[s.kind] = (symbolKinds[s.kind] ?? 0) + 1;

  let lines: number | undefined;
  if (!target.sensitive && target.group !== 'deleted') {
    try {
      if ((await vscode.workspace.fs.stat(target.uri)).size <= MAX_LINE_COUNT_BYTES) lines = (await vscode.workspace.openTextDocument(target.uri)).lineCount;
    } catch {
      lines = undefined;
    }
  }
  const history = target.group === 'untracked' ? { count: 0, capped: false } : await getFileHistory(folder, target.uri, 100);

  const facts: FileFacts = {
    path: target.relPath,
    fileType: details.fileType,
    localImports: details.imports.filter((i) => i.kind === 'local' && i.target).map((i) => i.target as string),
    packages: [...new Set(details.imports.filter((i) => i.kind === 'external').map((i) => i.specifier))],
    unknownImports: details.imports.filter((i) => i.kind === 'unknown').length + details.dynamicUnknown,
    importedBy: [...new Set(importedBy)].sort(),
    symbolKinds,
    commits: history && { count: history.count, capped: history.capped, last: history.last?.toLocaleDateString() },
    notes,
    lines,
    cycleWith: cycleWith.sort(),
    hasTest: state.graph.nodes.some((n) => n.kind === 'file' && isTestFor(target.relPath, n.path)),
    analyzed: details.analyzed,
  };
  const { sentences, role } = explainFile(facts);
  return { sentences, role, tips: codeTips(facts) };
}

function hoverText(c: vscode.MarkdownString | vscode.MarkedString): string {
  if (typeof c === 'string') return c;
  if (c instanceof vscode.MarkdownString) return c.value;
  return '```' + c.language + '\n' + c.value + '\n```';
}

/** Plain sentences about a symbol, from its hover information and its usages. */
export async function explainSymbolAt(loc: CodeLocation, usages: UsageResult): Promise<string[]> {
  let hover: { signature?: string; doc?: string } = {};
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[] | undefined>('vscode.executeHoverProvider', loc.uri, loc.position);
    hover = parseHover((hovers ?? []).flatMap((h) => h.contents.map(hoverText)));
  } catch {
    // No hover support for this language.
  }
  return explainSymbol({
    name: loc.name,
    kind: loc.kind ?? 'Symbol',
    line: loc.position.line + 1,
    signature: hover.signature,
    doc: hover.doc,
    usages: { available: usages.available, places: usages.usages.length, files: usages.files, ownFile: loc.relPath, truncated: usages.truncated },
  });
}
