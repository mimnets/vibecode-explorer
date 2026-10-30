// Runs inside the Extension Development Host. Throwing fails the run.
import { strict as assert } from 'assert';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
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
  check('workspace has four folders', () => assert.equal(vscode.workspace.workspaceFolders?.length, 4));

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

  // Phase 6c: code and before/after views for the browser, read without opening an editor.
  const noSecret = (v: unknown) => !JSON.stringify(v).includes('do-not-read');
  const utilDiff = await api.codeForTarget('c0', targets.get(idOf('src/util.ts', 'c') as string)!);
  check('the browser view compares a modified file with HEAD', () => {
    assert.equal(utilDiff.mode, 'diff', JSON.stringify(utilDiff));
    assert.ok(utilDiff.rows?.some((r) => r.k === '-' && r.t.includes('return 1')));
    assert.ok(utilDiff.rows?.some((r) => r.k === '+' && r.t.includes('return 2')));
  });
  const oldView = await api.codeForTarget('c1', targets.get(idOf('src/old.ts', 'c') as string)!);
  const newView = await api.codeForTarget('c2', targets.get(idOf('src/new.ts', 'c') as string)!);
  check("the browser view shows a deleted file's HEAD version and a new file's contents", () => {
    assert.equal(oldView.mode, 'file');
    assert.deepEqual(oldView.lines, ['export const old = true;']);
    assert.equal(newView.mode, 'file');
    assert.ok(newView.lines?.some((l) => l.includes('util')));
  });
  const envView = await api.codeForTarget('c3', targets.get(idOf('.env', 'c') as string)!);
  const envCommitView = await api.codeForCommitFile('h0', latest.files.get(fileOf('.env')!.id)!);
  check('the browser view never shows a sensitive file, now or in a commit', () => {
    assert.equal(envView.mode, 'none');
    assert.equal(envCommitView.mode, 'none');
    assert.ok(noSecret(envView) && noSecret(envCommitView));
  });
  const renamedView = await api.codeForCommitFile('h1', latest.files.get(fileOf('src/helpers.ts')!.id)!);
  const deletedView = await api.codeForCommitFile('h2', latest.files.get(fileOf('src/temp.ts')!.id)!);
  check('the browser view shows what a commit changed in a file', () => {
    assert.ok(renamedView.mode === 'diff' || renamedView.mode === 'file', JSON.stringify(renamedView));
    assert.match(renamedView.title, /\^ ↔ /);
    assert.equal(deletedView.mode, 'file', JSON.stringify(deletedView));
    assert.match(deletedView.title, /previous version/);
  });
  const symbolView = await api.codeForLocation('s0', described.symbols.get(utilSymbol!.id)!);
  check("the browser view highlights a symbol's line", () => {
    assert.equal(symbolView.mode, 'file');
    assert.equal(symbolView.highlight, 1);
    assert.match(symbolView.lines?.[0] ?? '', /function util/);
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

  // Phase 6d: the Files tab lists names only, keeping graph and change ids.
  type Node = { kind: 'folder' | 'file'; path: string; id?: string; group?: string; sensitive?: boolean; inGraph?: boolean; children?: Node[] };
  const flatten = (n: Node): Node[] => (n.kind === 'folder' ? (n.children ?? []).flatMap(flatten) : [n]);
  const repoFiles = await api.listProjectFiles(repoFolder, targets);
  const repoList = repoFiles.result.state === 'ok' ? flatten(repoFiles.result.tree as Node) : [];
  const entry = (p: string) => repoList.find((f) => f.path === p);
  check('the Files tab lists the project with graph, change and sensitive marks', () => {
    assert.equal(repoFiles.result.state, 'ok');
    assert.ok(entry('src/util.ts')?.inGraph && entry('src/util.ts')?.id === byPath.get('src/util.ts'));
    assert.equal(entry('src/util.ts')?.group, 'modified');
    assert.equal(entry('src/old.ts')?.group, 'deleted', 'deleted files are listed from Git');
    assert.ok(entry('.env')?.sensitive && entry('.env')?.id?.startsWith('c'));
    assert.ok(!repoList.some((f) => f.path.startsWith('.git/')));
  });

  // Phase 6: Python in the graph.
  const py = await api.collectState(2, true);
  const pyGraph = py.state.graph;
  const pyId = (p: string) => pyGraph.nodes.find((n) => n.path === p)?.id;
  const pyEdge = (a: string, b: string) => pyGraph.edges.some((e) => e.source === pyId(a) && e.target === pyId(b));
  check('Python files and their imports appear in the graph', () => {
    assert.deepEqual(pyGraph.nodes.filter((n) => n.kind === 'file').map((n) => n.path).sort(),
      ['app/__init__.py', 'app/main.py', 'app/models.py', 'app/ping.py', 'app/pong.py', 'tests/test_models.py']);
    assert.ok(pyEdge('app/main.py', 'app/models.py') && pyEdge('app/main.py', 'app/ping.py'));
    assert.ok(pyEdge('tests/test_models.py', 'app/models.py'));
    assert.ok(!pyGraph.nodes.some((n) => n.label.includes('not_real') || n.label.includes('never_read')));
  });
  check('Python circular imports are marked', () => {
    assert.deepEqual(pyGraph.cycleNodes.slice().sort(), [pyId('app/ping.py'), pyId('app/pong.py')].sort());
  });
  const pyFolder = vscode.workspace.workspaceFolders![2];
  const modelsTarget = py.targets.get(pyId('app/models.py')!)!;
  const modelsDescribed = await api.describeTarget(pyId('app/models.py')!, modelsTarget);
  const modelsExplained = await api.explainTarget(pyFolder, modelsTarget, modelsDescribed.details, py.state, 0);
  check('a Python file is explained and its imports listed', () => {
    assert.equal(modelsDescribed.details.fileType, 'PY');
    assert.equal(modelsExplained.role, 'leaf');
    assert.ok(modelsExplained.sentences.includes('2 files use it (main.py and test_models.py).'), JSON.stringify(modelsExplained.sentences));
    const mainImports = py.targets.get(pyId('app/main.py')!)!.analysis!.imports.map((i) => `${i.specifier}:${i.kind}`);
    assert.deepEqual(mainImports.sort(), ['.models:local', '.ping:local', 'os:external']);
  });
  const pyFiles = await api.listProjectFiles(pyFolder, py.targets);
  const pyList = pyFiles.result.state === 'ok' ? flatten(pyFiles.result.tree as Node) : [];
  const readme = pyList.find((f) => f.path === 'README.md');
  const logo = pyList.find((f) => f.path === 'logo.png');
  check('the Files tab lists non-code files and skips virtual environments', () => {
    assert.ok(readme?.id?.startsWith('p') && !readme.inGraph);
    assert.ok(logo?.id?.startsWith('p'));
    assert.ok(!pyList.some((f) => f.path.startsWith('.venv/')));
    assert.ok(pyList.find((f) => f.path === 'app/models.py')?.inGraph);
  });
  const logoTarget = pyFiles.added.get(logo!.id!)!;
  const logoDescribed = await api.describeTarget(logo!.id!, logoTarget);
  const logoView = await api.codeForTarget(logo!.id!, logoTarget);
  const readmeView = await api.codeForTarget(readme!.id!, pyFiles.added.get(readme!.id!)!);
  check('a binary file from the Files tab is described but not shown', () => {
    assert.equal(logoDescribed.details.fileType, 'PNG');
    assert.equal(logoDescribed.details.symbols.length, 0);
    assert.equal(logoView.mode, 'none');
    assert.match(logoView.note ?? '', /binary/);
    assert.deepEqual(readmeView.lines, ['# Demo', '', '## Setup']);
  });

  // Phase 7: routes, HTTP calls and database models, read statically.
  const apiFolder = vscode.workspace.workspaceFolders![3];
  const apiState = await api.collectState(3, true);
  const apis = await api.loadApis(apiFolder, apiState.state, apiState.targets);
  const apiMap = apis.result.state === 'ok' ? apis.result : undefined;
  const route = (label: string) => apiMap?.routes.find((r) => `${r.method} ${r.path}` === label);
  check('routes are found across frameworks, with mount prefixes', () => {
    assert.ok(apiMap, JSON.stringify(apis.result));
    for (const label of ['GET /health', 'GET /api/users/:id', 'POST /api/users', 'GET /api/items', 'GET /shop/cart/{cid}']) assert.ok(route(label), `${label}: ${JSON.stringify(apiMap?.routes.map((r) => `${r.method} ${r.path}`))}`);
  });
  check('HTTP calls are matched to routes, and other servers are told apart', () => {
    const byUrl = (u: string) => apiMap!.calls.find((c) => c.url === u);
    assert.deepEqual(byUrl('/api/users/*')?.routes, [route('GET /api/users/:id')!.id]);
    assert.deepEqual(route('GET /api/users/:id')!.callers, ['web/client.js']);
    assert.deepEqual(byUrl('/api/missing')?.routes, []);
    assert.ok(byUrl('https://example.com/x')?.external);
    assert.deepEqual(byUrl('http://localhost:8000/shop/cart/7')?.routes, [route('GET /shop/cart/{cid}')!.id]);
  });
  check('database models come from SQL, Prisma and ORM code, with the files that use them', () => {
    const model = (n: string) => apiMap!.models.find((m) => m.name === n);
    assert.equal(model('orders')?.kind, 'SQL table');
    assert.equal(model('ignored'), undefined, 'commented-out tables are skipped');
    assert.deepEqual(model('Post')?.usedBy, ['service.ts']);
    assert.equal(model('Person')?.table, 'people');
    assert.deepEqual(model('Person')?.usedBy, ['service.ts']);
    assert.ok(!JSON.stringify(apis.result).includes('do-not-read'), 'the .env file is never read');
  });
  const pageOf = (p: string, kind: string) => apiMap?.pages.find((x) => x.path === p && x.kind === kind);
  check('pages are found with the files that make them', () => {
    const next = pageOf('/users', 'Next.js page');
    assert.ok(next, JSON.stringify(apiMap?.pages.map((x) => `${x.kind} ${x.path} ${x.file}`)));
    assert.equal(next.file, 'app/users/page.tsx');
    assert.ok(next.files.includes('app/layout.tsx') && next.files.includes('web/client.js'), JSON.stringify(next.files));
    const profile = pageOf('/profile/:name', 'React Router');
    assert.equal(profile?.file, 'web/Profile.jsx');
    assert.ok(profile?.needsValue && profile.files.includes('web/router.jsx'));
    assert.deepEqual(pageOf('/', 'HTML page')?.files, ['web/client.js']);
    const home = pageOf('/', 'Express view');
    assert.equal(home?.template, 'views/home.ejs');
    assert.equal(home?.file, 'site.js');
    assert.ok(!pageOf('/api/items', 'Next.js page'), 'route handlers are not pages');
  });
  const healthLoc = apis.locations.get(route('GET /health')!.id)!;
  const healthView = await api.codeForLocation(route('GET /health')!.id, healthLoc);
  check('a route opens at its line, and items carry graph ids to outline', () => {
    assert.equal(healthLoc.relPath, 'server.js');
    assert.equal(healthView.highlight, 5);
    const serverId = apiState.state.graph.nodes.find((n) => n.path === 'server.js')?.id;
    assert.ok(serverId && route('GET /health')!.nodes.includes(serverId));
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

  // Phase 9: Health checks. A problem is injected the way a language extension reports one.
  const diagnostics = vscode.languages.createDiagnosticCollection('vibecode-test');
  const utilUri = vscode.Uri.joinPath(repoFolder.uri, 'src', 'util.ts');
  diagnostics.set(utilUri, [
    new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), "Cannot find name 'foo'.", vscode.DiagnosticSeverity.Error),
    new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), "Unknown value token = 'sk-abcdefghijklmnopqrstu'", vscode.DiagnosticSeverity.Warning),
  ]);
  await api.createNote!(repoFolder, { commit: log[1].shortHash }, 'Safe point', { safe: true });
  const health = await api.loadHealth(repoFolder, state);
  diagnostics.dispose();
  const h = health.result.state === 'ok' ? health.result : undefined;
  check('problems VS Code reports are listed in plain words, with secrets hidden', () => {
    const util = h?.problems.files.find((f) => f.file === 'src/util.ts');
    assert.ok(util, JSON.stringify(h?.problems));
    assert.equal(util.errors, 1);
    assert.equal(util.node, byPath.get('src/util.ts'));
    assert.equal(util.items[0].plain, 'foo is used here but never defined or imported.');
    assert.ok(!JSON.stringify(health.result).includes('sk-abcdefghijklmnopqrstu'));
  });
  check('the checklist flags a tracked .env file and the missing basics', () => {
    const status = (id: string) => h?.checklist.find((c) => c.id === id)?.status;
    assert.equal(status('env'), 'warn', JSON.stringify(h?.checklist));
    assert.equal(status('readme'), 'warn');
    assert.equal(status('gitignore'), 'warn');
  });
  check('possibly unused files exclude entry points and imported files', () => {
    const unused = h!.unused.map((u) => u.file);
    assert.ok(unused.includes('src/helpers.ts'), JSON.stringify(unused));
    assert.ok(!unused.includes('src/index.ts') && !unused.includes('src/util.ts'));
  });
  check('safe points come from tags and marked commits, with steps that are only shown', () => {
    const points = h!.safePoints.map((p) => `${p.headline}: ${p.reasons.join(', ')}`);
    assert.deepEqual(points, ['add helper: marked safe by you', 'init: tag v0.1'], JSON.stringify(points));
    assert.ok(h!.safePoints[0].steps.some((s) => s.command === `git switch --detach ${h!.safePoints[0].short}`));
    assert.equal(h!.safeSources.sessionsAllowed, false);
  });
  const apiHealth = await api.loadHealth(vscode.workspace.workspaceFolders![3], apiState.state);
  const ah = apiHealth.result.state === 'ok' ? apiHealth.result : undefined;
  check('secret-looking text is located without its value, and near-duplicates are grouped', () => {
    assert.deepEqual(ah?.secrets.map((s) => `${s.file}:${s.line}`), ['config.js:1']);
    assert.ok(!JSON.stringify(apiHealth.result).includes('sk-fakefake') && !JSON.stringify(apiHealth.result).includes('do-not-read'));
    assert.ok(apiHealth.secretIds.has(ah!.secrets[0].id));
    assert.deepEqual(ah?.duplicates.map((d) => d.files), [['docs/notes-old.md', 'docs/notes.md']]);
  });

  // Phase 10: the Project tab reads the plan, the log, the layout and issues.
  await api.createNote!(repoFolder, undefined, 'Fix the login page', { issue: true, body: 'It fails\nafter a refresh' });
  const project = await api.loadProject(apiFolder);
  const pr = project.result.state === 'ok' ? project.result : undefined;
  check('the plan, its current stage and each phase\'s steps are read from the docs', () => {
    assert.equal(pr?.plan?.file, 'docs/roadmap.md');
    assert.deepEqual(pr?.plan?.phases.map((p) => `${p.id}:${p.state}`), ['1:done', '2:active', '3:todo']);
    assert.equal(pr?.plan?.current, '2');
    assert.equal(pr?.log?.file, 'CHANGELOG.md');
    assert.deepEqual(pr!.plan!.phases[0].steps.map((s) => s.done), [true, true, true, true, true, true]);
    assert.equal(pr!.plan!.phases[1].steps.at(-1)?.done, false, 'phase 2 is not in the log yet');
    assert.equal(pr?.requirements, undefined);
  });
  check('folders outside the intended layout are flagged, and plan files open by id', () => {
    assert.equal(pr?.structure?.file, 'AGENTS.md');
    assert.deepEqual(pr?.structure?.unplanned, ['db', 'py', 'views']);
    assert.deepEqual(pr?.structure?.missing, ['lib']);
    assert.equal(project.locations.get(pr!.plan!.id)?.relPath, 'docs/roadmap.md');
  });
  const repoProject = await api.loadProject(repoFolder);
  check('issues are saved as notes and listed, open first', () => {
    const rp = repoProject.result.state === 'ok' ? repoProject.result : undefined;
    assert.equal(rp?.plan, undefined);
    assert.deepEqual(rp?.issues.map((i) => `${i.title}:${i.state}`), ['Fix the login page:open']);
    assert.match(rp!.issues[0].path, /^\.vibecode\/notes\/\d{4}-\d{2}-\d{2}-fix-the-login-page\.md$/);
    assert.equal(repoProject.locations.get(rp!.issues[0].id)?.relPath, rp!.issues[0].path);
  });

  // Phase 11: learning aids.
  const learn = await api.loadLearn(apiFolder, apiState.state, apiState.targets);
  const lr = learn.result.state === 'ok' ? learn.result : undefined;
  check('reading order starts at the server, and how-to-run shows the install step', () => {
    const order = lr!.reading.map((s) => s.file);
    assert.ok(order.indexOf('server.js') < order.indexOf('routes/users.js'), JSON.stringify(order));
    assert.equal(lr!.reading.find((s) => s.file === 'server.js')?.depth, 0);
    assert.deepEqual(lr!.run.map((s) => s.command), ['npm install']);
  });
  check('TODO comments are listed and open by id; packages say whether they are used', () => {
    assert.deepEqual(lr!.todos.map((t) => `${t.file}:${t.line}:${t.tag}:${t.text}`), ['docs/notes.md:2:TODO:write the API docs']);
    assert.equal(learn.locations.get(lr!.todos[0].id)?.position.line, 1);
    assert.deepEqual(lr!.packages.map((p) => `${p.name}:${p.used}:${p.installed}`), ['express:imported:false', 'next:not found:false']);
  });
  const pyLearn = await api.loadLearn(pyFolder, py.state, py.targets);
  check('the test map links a Python test to the file it imports', () => {
    const t = pyLearn.result.state === 'ok' ? pyLearn.result.tests : undefined;
    assert.deepEqual(t?.tested.map((x) => `${x.file}<${x.tests.join(',')}`), ['app/models.py<tests/test_models.py']);
    assert.ok(t?.untested.some((x) => x.file === 'app/main.py' && x.node));
    assert.deepEqual(t?.testFiles.map((x) => x.file), ['tests/test_models.py']);
  });
  const ruled = await api.loadHealth(apiFolder, apiState.state, apiState.targets);
  check('folder rules list the imports that break them', () => {
    const rules = ruled.result.state === 'ok' ? ruled.result.rules : undefined;
    assert.equal(rules?.exists, true);
    assert.deepEqual(rules?.rules.map((r) => `${r.text}: ${r.violations.map((v) => `${v.file}>${v.imports}`).join(',')}`),
      ['`routes/` must not import `express`: routes/users.js>express', '`web/` must not import `routes/`: ']);
    assert.equal(ruled.locations.get(rules!.rules[0].id)?.position.line, 2);
  });
  const spots = await api.loadHotspots(repoFolder);
  check('hotspots read the history, and commit messages get a hint', () => {
    assert.equal(spots.state, 'ok');
    assert.equal(spots.commits, 2, 'the first commit has nothing to compare with');
    assert.ok(history.git.kind === 'ok' && history.git.commits.every((c) => c.hint?.startsWith('Start with a type')));
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

  // Phase 6b: the browser view's local server.
  assert.ok(api.browserLink, 'browser link is exposed in test mode');
  const link = new URL(await api.browserLink!());
  const bPort = Number(link.port);
  const request = (opts: http.RequestOptions & { body?: string }) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: bPort, ...opts }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
  const page = await request({ path: link.pathname });
  const wrongKey = await request({ path: '/not-the-key/' });
  const rebinding = await request({ path: link.pathname, headers: { host: `evil.example:${bPort}` } });
  const script = await request({ path: `${link.pathname}a/dashboard.js` });
  check('the browser page loads only with the key and the right Host', () => {
    assert.equal(link.hostname, '127.0.0.1');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
    assert.ok(page.body.includes('./a/browserBridge.js'));
    assert.equal(wrongKey.status, 404);
    assert.equal(rebinding.status, 421);
    assert.equal(script.status, 200);
    assert.match(String(script.headers['content-type']), /javascript/);
  });

  // Connect like a browser tab: open the event stream, then send messages.
  const received: { type: string; [k: string]: unknown }[] = [];
  let client = '';
  let streamText = '';
  const stream = await new Promise<http.IncomingMessage>((resolve) => {
    http.get({ host: '127.0.0.1', port: bPort, path: `${link.pathname}events` }, resolve);
  });
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    streamText += chunk;
    let end: number;
    while ((end = streamText.indexOf('\n\n')) >= 0) {
      const block = streamText.slice(0, end);
      streamText = streamText.slice(end + 2);
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (/^event: hello$/m.test(block) && data) client = JSON.parse(data).client;
      else if (/^event: stopped$/m.test(block)) received.push({ type: '__stopped' });
      else if (data) received.push(JSON.parse(data));
    }
  });
  const waitFor = async (pred: () => boolean) => {
    for (let i = 0; i < 150 && !pred(); i++) await new Promise((r) => setTimeout(r, 100));
    return pred();
  };
  await waitFor(() => client !== '');
  const origin = `http://127.0.0.1:${bPort}`;
  const send = (message: object, headers: http.OutgoingHttpHeaders = { origin, 'content-type': 'application/json' }) =>
    request({ method: 'POST', path: `${link.pathname}message?c=${client}`, headers, body: JSON.stringify(message) });
  const noOrigin = await send({ type: 'ready' }, { 'content-type': 'application/json' });
  const accepted = await send({ type: 'ready' });
  await waitFor(() => received.some((m) => m.type === 'state'));
  const bState = received.find((m) => m.type === 'state')?.state as typeof state | undefined;
  check('a browser tab gets the dashboard state over the event stream', () => {
    assert.match(client, /^[a-f0-9]{32}$/);
    assert.equal(noOrigin.status, 403, 'POST without Origin is refused');
    assert.equal(accepted.status, 204);
    assert.ok(bState && bState.graph.nodes.some((n) => n.path === 'src/util.ts'));
  });
  const utilNode = bState?.graph.nodes.find((n) => n.path === 'src/util.ts')?.id;
  // Close the text editors only (closing all editors would also close the dashboard).
  const textTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputTextDiff);
  await vscode.window.tabGroups.close(textTabs());
  await send({ type: 'open', id: utilNode });
  await waitFor(() => received.some((m) => m.type === 'details') && received.some((m) => m.type === 'code'));
  const code = received.find((m) => m.type === 'code')?.view as { for: string; mode: string; lines?: string[] } | undefined;
  check('a click in the browser shows the code on the page, not in VS Code', () => {
    assert.equal(code?.for, utilNode);
    assert.equal(code?.mode, 'file');
    assert.ok(code?.lines?.some((l) => l.includes('function util')), JSON.stringify(code));
    assert.ok(received.some((m) => m.type === 'details'));
    assert.equal(textTabs().length, 0, 'no editor was opened');
  });
  await send({ type: 'openInEditor', id: utilNode });
  await waitFor(() => textTabs().length > 0);
  check('"Open in VS Code" in the browser opens the file in VS Code', () => {
    const input = activeTab();
    assert.ok(input instanceof vscode.TabInputText && input.uri.fsPath.endsWith('util.ts'), String(input));
  });
  const envChange = bState?.git.kind === 'ok' ? bState.git.changes.find((c) => c.path === '.env')?.id : undefined;
  await send({ type: 'open', id: envChange });
  await waitFor(() => received.some((m) => m.type === 'code' && (m.view as { for: string }).for === envChange));
  check("the browser never receives a sensitive file's contents", () => {
    const envCode = received.find((m) => m.type === 'code' && (m.view as { for: string }).for === envChange)?.view as { mode: string } | undefined;
    assert.equal(envCode?.mode, 'none');
    assert.ok(!received.some((m) => JSON.stringify(m).includes('do-not-read')));
  });
  await send({ type: 'files' });
  await waitFor(() => received.some((m) => m.type === 'files'));
  check('a browser tab gets the Files tab listing', () => {
    const files = received.find((m) => m.type === 'files')?.result as { state: string; tree: Node } | undefined;
    assert.equal(files?.state, 'ok');
    assert.ok(files && flatten(files.tree).some((f) => f.path === 'src/util.ts' && f.inGraph));
  });
  await send({ type: 'apis' });
  await waitFor(() => received.some((m) => m.type === 'apis'));
  const bApis = received.find((m) => m.type === 'apis')?.result as { state: string; calls: { id: string }[]; routes: { id: string }[] } | undefined;
  check('a browser tab gets the APIs tab listing', () => assert.equal(bApis?.state, 'ok'));
  // Phase 8: previewing a page from the browser needs the preview setting; it is checked and joined to the page address.
  await send({ type: 'selectFolder', index: 3 });
  await waitFor(() => received.filter((m) => m.type === 'state').length >= 2);
  received.length = 0;
  await send({ type: 'apis' });
  await waitFor(() => received.some((m) => m.type === 'apis'));
  const pagesResult = received.find((m) => m.type === 'apis')?.result as { pages: { id: string; path: string; kind: string }[] } | undefined;
  const usersPage = pagesResult?.pages.find((p) => p.path === '/users' && p.kind === 'Next.js page');
  await send({ type: 'previewPage', id: usersPage?.id, path: '/users' });
  await waitFor(() => received.some((m) => m.type === 'previewError'));
  check('previewing without a preview address explains what to set', () => {
    assert.match(String(received.find((m) => m.type === 'previewError')?.message), /preview URL/i);
    assert.ok(!received.some((m) => m.type === 'pagePreview'));
  });
  const config = vscode.workspace.getConfiguration('vibecodeExplorer');
  await config.update('previewUrl', 'http://localhost:5173', vscode.ConfigurationTarget.Global);
  await send({ type: 'previewPage', id: usersPage?.id, path: '//evil.example/x' });
  await send({ type: 'previewPage', id: usersPage?.id, path: '/users?tab=1' });
  await waitFor(() => received.some((m) => m.type === 'pagePreview'));
  const previews = received.filter((m) => m.type === 'pagePreview');
  const framedPage = await request({ path: link.pathname });
  check('a page preview opens next to its code, only on the preview server', () => {
    assert.deepEqual(previews.map((m) => m.url), ['http://localhost:5173/users?tab=1']);
    assert.ok(received.some((m) => m.type === 'code' && (m.view as { for: string }).for === usersPage?.id));
    assert.ok(received.some((m) => m.type === 'previewError' && /stay on your preview server/.test(String(m.message))));
    assert.match(String(framedPage.headers['content-security-policy']), /frame-src http:\/\/localhost:5173;/);
  });
  await config.update('previewUrl', undefined, vscode.ConfigurationTarget.Global);
  const lanAddress = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  const fromNetwork = lanAddress
    ? await new Promise<string>((resolve) => {
      const s = net.connect({ host: lanAddress, port: bPort }, () => { s.destroy(); resolve('connected'); });
      s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
    })
    : 'no network interface';
  check('the browser view is not reachable from the network', () => assert.notEqual(fromNetwork, 'connected', lanAddress));

  api.stopBrowserView();
  await waitFor(() => received.some((m) => m.type === '__stopped'));
  const afterStop = await request({ path: link.pathname }).then(() => 'answered', (e: NodeJS.ErrnoException) => e.code);
  check('stopping closes open tabs and the server', () => {
    assert.ok(received.some((m) => m.type === '__stopped'));
    assert.equal(afterStop, 'ECONNREFUSED');
  });
  const idleLink = new URL(await api.browserLink!(300));
  await new Promise((r) => setTimeout(r, 1200));
  const afterIdle = await new Promise<string>((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: Number(idleLink.port) }, () => { s.destroy(); resolve('connected'); });
    s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
  });
  check('the browser view stops by itself when idle', () => assert.equal(afterIdle, 'ECONNREFUSED'));

  // An open tab keeps it running past the idle time; it stops once the last tab has closed.
  const busyLink = new URL(await api.browserLink!(300));
  const reachable = () => new Promise<string>((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: Number(busyLink.port) }, () => { s.destroy(); resolve('connected'); });
    s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
  });
  const busyStream = await new Promise<http.IncomingMessage>((resolve) => {
    http.get({ host: '127.0.0.1', port: Number(busyLink.port), path: `${busyLink.pathname}events` }, resolve);
  });
  busyStream.resume();
  await new Promise((r) => setTimeout(r, 1200));
  const whileOpen = await reachable();
  busyStream.destroy();
  await new Promise((r) => setTimeout(r, 1200));
  const afterClose = await reachable();
  check('an open browser tab keeps the view running; it stops after the last tab closes', () => {
    assert.equal(whileOpen, 'connected');
    assert.equal(afterClose, 'ECONNREFUSED');
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
