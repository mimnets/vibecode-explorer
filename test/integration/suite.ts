// Runs inside the Extension Development Host. Throwing fails the run.
import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import type { activate } from '../../src/extension/extension';

type Api = ReturnType<typeof activate>;

function check(name: string, fn: () => void): void {
  fn();
  console.log(`  ✔ ${name}`);
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>('mimnets.vibecode-explorer');
  check('extension is loaded in the development host', () => assert.ok(ext, 'extension not loaded (disabled or invalid manifest)'));
  if (!ext) return;
  // The Command Palette lists contributed commands of loaded extensions (before activation).
  check('dashboard command is contributed', () => {
    const contributed: { command: string }[] = ext.packageJSON.contributes.commands;
    assert.ok(contributed.some((c) => c.command === 'vibecodeExplorer.openDashboard'));
  });

  await vscode.commands.executeCommand('vibecodeExplorer.openDashboard');
  const api = ext.exports;
  check('extension activates on command', () => assert.ok(ext.isActive));
  check('dashboard opens', () => assert.ok(api.isDashboardOpen()));
  check('workspace has two folders', () => assert.equal(vscode.workspace.workspaceFolders?.length, 2));

  // The webview reports back after Cytoscape draws (proves scripts load under the CSP).
  let report = api.renderReport();
  for (let i = 0; i < 100 && !report; i++) {
    await new Promise((r) => setTimeout(r, 200));
    report = api.renderReport();
  }
  check('webview renders the graph without script errors', () => {
    assert.ok(report, 'webview sent a render report');
    assert.ok(!('error' in report), JSON.stringify(report));
    assert.ok('nodes' in report && report.nodes > 0 && report.edges > 0, JSON.stringify(report));
  });

  const { state, targets } = await api.collectState(0, true);
  const git = state.git;
  assert.equal(git.kind, 'ok', `git state: ${JSON.stringify(git)}`);
  if (git.kind !== 'ok') return;
  const groupOf = (p: string) => git.changes.find((c) => c.path === p)?.group;

  check('repository and branch are reported', () => {
    assert.equal(git.repoName, 'sample-repo');
    assert.equal(git.branch, 'main');
  });
  check('modified files are listed', () => assert.equal(groupOf('src/util.ts'), 'modified'));
  check('deleted files are listed', () => assert.equal(groupOf('src/old.ts'), 'deleted'));
  check('untracked files are listed', () => assert.equal(groupOf('src/new.ts'), 'untracked'));
  check('sensitive filenames are listed but flagged', () => {
    assert.equal(git.changes.find((c) => c.path === '.env')?.sensitive, true);
  });

  const byPath = new Map(state.graph.nodes.map((n) => [n.path, n.id]));
  const hasEdge = (from: string, to: string) => state.graph.edges.some((e) => e.source === byPath.get(from) && e.target === byPath.get(to));
  check('graph renders file nodes', () => assert.ok(byPath.has('src/index.ts') && byPath.has('src/new.ts')));
  check('local imports become edges', () => {
    assert.ok(hasEdge('src/index.ts', 'src/util.ts'));
    assert.ok(hasEdge('src/new.ts', 'src/util.ts'));
  });
  check('unresolved/alias/dynamic imports become unknown nodes', () => {
    for (const label of ['? ./missing', '? @/alias', '? dynamic import']) assert.ok(hasEdge('src/index.ts', label), label);
  });
  check('sensitive file contents are not analyzed', () => {
    assert.ok(!byPath.has('.env'));
    assert.ok(![...targets.values()].some((t) => t.analysis && t.relPath === '.env'));
  });

  const idOf = (p: string, kind: 'c' | 'f') => [...targets.entries()].find(([id, t]) => id.startsWith(kind) && t.relPath === p)?.[0];
  const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;

  await api.openTarget(targets.get(idOf('src/util.ts', 'c') as string)!);
  check('clicking a modified file opens a diff', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputTextDiff, 'diff tab');
    assert.ok(input.modified.fsPath.endsWith('util.ts'));
  });
  await api.openTarget(targets.get(idOf('src/new.ts', 'c') as string)!);
  check('clicking an untracked file opens it', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputText && input.uri.fsPath.endsWith('new.ts'));
  });
  await api.openTarget(targets.get(idOf('src/old.ts', 'c') as string)!);
  check('clicking a deleted file opens the HEAD version', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputText && input.uri.scheme === 'git');
  });
  await api.openTarget(targets.get(idOf('src/index.ts', 'f') as string)!);
  check('clicking a graph node opens the source file', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputText && input.uri.fsPath.endsWith('index.ts'));
  });

  // Phase 2: symbols and usages come from VS Code's built-in TypeScript support, which may need time to start.
  const utilTarget = targets.get(idOf('src/util.ts', 'f') as string)!;
  let described = await api.describeTarget('f0', utilTarget);
  for (let i = 0; i < 60 && described.details.symbols.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
    described = await api.describeTarget('f0', utilTarget);
  }
  const utilSymbol = described.details.symbols.find((s) => s.name === 'util');
  check('file symbols are listed with opaque ids', () => {
    assert.ok(utilSymbol, JSON.stringify(described.details.symbols));
    assert.match(utilSymbol.id, /^s\d+$/);
    assert.equal(utilSymbol.line, 1);
  });
  const { result: usages, locations } = await api.findUsages(vscode.workspace.workspaceFolders![0].uri, described.symbols.get(utilSymbol!.id)!);
  check('usages of a symbol are found across files', () => {
    assert.ok(usages.available);
    for (const f of ['src/index.ts', 'src/new.ts', 'src/util.ts']) assert.ok(usages.files.includes(f), JSON.stringify(usages));
    assert.ok(usages.usages.every((u) => /^r\d+$/.test(u.id) && locations.has(u.id)));
  });

  const plain = await api.collectState(1, true);
  check('no-Git folder reports noGit', () => assert.equal(plain.state.git.kind, 'noGit'));
  check('multi-folder workspaces are not mixed', () => {
    const paths = plain.state.graph.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['a.js', 'b.js']);
    assert.equal(plain.state.graph.edges.length, 1);
    assert.ok(!git.changes.some((c) => c.path.includes('a.js')));
  });

  const again = await api.collectState(0, true);
  check('refresh produces consistent results', () => {
    assert.equal(again.state.git.kind, 'ok');
    assert.equal(again.state.graph.edges.length, state.graph.edges.length);
  });
}
