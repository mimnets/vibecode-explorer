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

  // Phase 3: history of the sample repository (3 commits, newest first).
  const repoFolder = vscode.workspace.workspaceFolders![0];
  const { result: history, commits } = await api.loadHistory(repoFolder, 50);
  assert.equal(history.git.kind, 'ok', JSON.stringify(history));
  if (history.git.kind !== 'ok') return;
  const log = history.git.commits;
  check('history lists commits newest first with opaque ids', () => {
    assert.deepEqual(log.map((c) => c.headline), ['rename helper, drop temp', 'add helper', 'init']);
    assert.ok(log.every((c) => /^k\d+$/.test(c.id) && commits.has(c.id) && c.author === 'test' && c.shortHash.length === 7));
    assert.equal(history.more, false);
  });
  const latest = await api.describeCommit(repoFolder, log[0].id, commits.get(log[0].id)!);
  const fileOf = (p: string) => latest.details.files.find((f) => f.path === p);
  check('a commit lists renamed, deleted and sensitive files', () => {
    assert.ok(latest.details.filesAvailable);
    assert.equal(fileOf('src/helpers.ts')?.group, 'renamed', JSON.stringify(latest.details.files));
    assert.equal(fileOf('src/helpers.ts')?.oldPath, 'src/helper.ts');
    assert.equal(fileOf('src/temp.ts')?.group, 'deleted');
    assert.equal(fileOf('.env')?.sensitive, true);
    assert.ok(latest.details.files.every((f) => /^h\d+$/.test(f.id) && latest.files.has(f.id)));
  });
  const second = await api.describeCommit(repoFolder, log[1].id, commits.get(log[1].id)!);
  check('a commit shows its full message and added files', () => {
    assert.match(second.details.message, /Why: keep small helpers apart from util\./);
    assert.equal(second.details.files.find((f) => f.path === 'src/helper.ts')?.group, 'added');
  });
  const first = await api.describeCommit(repoFolder, log[2].id, commits.get(log[2].id)!);
  check('the first commit reports its file list as unavailable', () => {
    assert.equal(first.details.filesAvailable, false);
    assert.equal(first.details.files.length, 0);
  });
  await api.openCommitFile(latest.files.get(fileOf('src/helpers.ts')!.id)!);
  check('clicking a renamed commit file opens a before/after diff', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputTextDiff, 'diff tab');
    assert.equal(input.original.scheme, 'git');
    assert.ok(input.modified.path.endsWith('helpers.ts'));
  });
  await api.openCommitFile(latest.files.get(fileOf('src/temp.ts')!.id)!);
  check('clicking a deleted commit file opens its previous version', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputText && input.uri.scheme === 'git' && input.uri.path.endsWith('temp.ts'));
  });
  await api.openCommitFile(latest.files.get(fileOf('.env')!.id)!);
  check('sensitive commit files are never opened', () => {
    const input = activeTab();
    assert.ok(!(input instanceof vscode.TabInputText && input.uri.path.endsWith('.env')));
  });

  // Phase 5: plain-language explanations from static facts.
  const nodeOf = (p: string) => state.graph.nodes.find((n) => n.path === p)?.id as string;
  check('circular imports are marked in the graph', () => {
    assert.deepEqual(state.graph.cycleNodes.slice().sort(), [nodeOf('src/ping.ts'), nodeOf('src/pong.ts')].sort());
    assert.equal(state.graph.cycleEdges.length, 2);
    assert.ok(state.glossary['circular import']);
  });
  const utilExplained = await api.explainTarget(repoFolder, utilTarget, described.details, state, 0);
  check('a file is explained in plain words', () => {
    assert.equal(utilExplained.role, 'leaf');
    assert.ok(utilExplained.sentences.includes('It does not import anything.'), JSON.stringify(utilExplained.sentences));
    assert.ok(utilExplained.sentences.includes('2 files use it (index.ts and new.ts).'), JSON.stringify(utilExplained.sentences));
    assert.ok(utilExplained.sentences.some((x) => /^It was changed in 1 commit/.test(x)), JSON.stringify(utilExplained.sentences));
  });
  const pingTarget = targets.get(idOf('src/ping.ts', 'f') as string)!;
  const pingDescribed = await api.describeTarget('f1', pingTarget);
  const pingExplained = await api.explainTarget(repoFolder, pingTarget, pingDescribed.details, state, 0);
  check('a circular import gets a tip naming the other file', () => {
    assert.match(pingExplained.tips[0] ?? '', /ping\.ts and pong\.ts import each other/);
    assert.ok(pingExplained.sentences.includes('It has not been committed yet.'));
  });
  const symbolText = await api.explainSymbolAt(described.symbols.get(utilSymbol!.id)!, usages);
  check('a symbol is explained with its declaration and usages', () => {
    assert.equal(symbolText[0], 'util is a function defined on line 1.');
    assert.ok(symbolText.some((x) => x.startsWith('Its declaration: function util(): number')), JSON.stringify(symbolText));
    assert.ok(symbolText.some((x) => /^It appears in \d+ places in 3 files/.test(x)), JSON.stringify(symbolText));
  });

  const plain = await api.collectState(1, true);
  const plainHistory = await api.loadHistory(vscode.workspace.workspaceFolders![1], 50);
  check('no-Git folder has no history', () => assert.equal(plainHistory.result.git.kind, 'noGit'));
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

  // Phase 4: notes. The consent dialog is modal, so tests call the writer directly (exposed in test mode only).
  const notesDir = vscode.Uri.joinPath(repoFolder.uri, '.vibecode', 'notes');
  const notesDirExists = async () => vscode.workspace.fs.stat(notesDir).then(() => true, () => false);
  const dirBefore = await notesDirExists();
  const notesBefore = await api.listNotes(repoFolder);
  check('nothing is written to the project before a note is added', () => {
    assert.equal(dirBefore, false);
    assert.deepEqual(notesBefore, []);
  });
  assert.ok(api.createNote, 'note writer is exposed in test mode');
  const noteUri = await api.createNote!(repoFolder, { about: 'src/util.ts' }, 'Why util returns 2');
  const again2 = await api.createNote!(repoFolder, { about: 'src/util.ts' }, 'Why util returns 2');
  await api.createNote!(repoFolder, { commit: log[0].shortHash }, 'Rename decision');
  const allNotes = await api.listNotes(repoFolder);
  check('a note is created inside .vibecode/notes with a generated name', () => {
    assert.match(noteUri.path, /\/\.vibecode\/notes\/\d{4}-\d{2}-\d{2}-why-util-returns-2\.md$/);
    assert.match(again2.path, /-why-util-returns-2-2\.md$/, 'never overwrites an existing note');
  });
  check('notes are listed for their file and their commit', () => {
    assert.equal(allNotes.length, 3);
    assert.deepEqual(api.notesFor(allNotes, { about: 'src/util.ts' }).map((n) => n.title), ['Why util returns 2', 'Why util returns 2']);
    const fullHash = commits.get(log[0].id)!.hash;
    assert.deepEqual(api.notesFor(allNotes, { commit: fullHash }).map((n) => n.title), ['Rename decision']);
    assert.deepEqual(api.notesFor(allNotes, { about: 'src/index.ts' }), []);
  });

  // Phase 4b: AI sessions from (fake) Claude Code logs. Reading needs the owner's permission first.
  const listed = await api.loadSessions(repoFolder);
  check('session logs are not read before permission is given', () => {
    assert.equal(listed.result.state, 'notAllowed');
    assert.equal(listed.result.sessions.length, 0);
    assert.match(listed.result.logFolder, /\.claude-config[\\/]projects[\\/]/);
  });
  assert.ok(api.readSessions, 'raw session reader is exposed in test mode');
  const read = await api.readSessions!(repoFolder);
  check('only this project\'s session logs are read', () => {
    assert.equal(read.sessions.length, 1, JSON.stringify(read.sessions.map((x) => x.file)));
    assert.ok(read.sessions[0].file.endsWith('session-1.jsonl'));
  });
  const sum = read.sessions[0].summary;
  check('a session shows prompts, tokens, edited files and security points without secrets or tool output', () => {
    assert.equal(sum.title, 'Sample session');
    assert.deepEqual(sum.prompts.map((x) => x.text), ['Make util return 2. token=[hidden]']);
    assert.deepEqual(sum.tokens, { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 });
    assert.ok(sum.filesEdited[0].endsWith('util.ts'));
    assert.equal(sum.securityMentions.length, 1);
    assert.ok(!JSON.stringify(sum).includes('TOOL OUTPUT') && !JSON.stringify(sum).includes('supersecret'));
  });

  // Restoring dashboard tabs after a reload (what VS Code's serializer does).
  const viewType = 'vibecodeExplorer.dashboard';
  const extra = vscode.window.createWebviewPanel(viewType, 'VibeCode Explorer', vscode.ViewColumn.One, {});
  let extraClosed = false;
  extra.onDidDispose(() => { extraClosed = true; });
  api.revivePanel(extra);
  check('a second restored dashboard tab is closed', () => assert.ok(extraClosed && api.isDashboardOpen()));

  api.closeDashboard();
  check('closing the dashboard clears it', () => assert.ok(!api.isDashboardOpen()));
  api.revivePanel(vscode.window.createWebviewPanel(viewType, 'VibeCode Explorer', vscode.ViewColumn.One, {}));
  let revived = api.renderReport();
  for (let i = 0; i < 100 && !revived; i++) {
    await new Promise((r) => setTimeout(r, 200));
    revived = api.renderReport();
  }
  check('a restored dashboard tab becomes the live dashboard', () => {
    assert.ok(api.isDashboardOpen());
    assert.ok(revived && 'nodes' in revived && revived.nodes > 0, JSON.stringify(revived));
  });
}
