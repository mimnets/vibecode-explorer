// @ts-check
// Dashboard UI. Runs inside the sandboxed webview: no file, Git or shell access.
// It only renders state and sends opaque ids back to the extension host.
(function () {
  const vscode = acquireVsCodeApi();
  window.addEventListener('error', (e) => vscode.postMessage({ type: 'webviewError', message: String(e.message) }));
  if (typeof cytoscape !== 'function') vscode.postMessage({ type: 'webviewError', message: 'Graph library failed to load.' });
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const GROUP_LABELS = { added: 'Added', modified: 'Modified', renamed: 'Renamed', deleted: 'Deleted', untracked: 'Untracked', conflict: 'Conflicts' };

  /** @type {any} */
  let cy;
  /** Term -> plain explanation, sent by the extension with the state. */
  let glossary = {};
  let selectedId = '';
  /** Symbol whose usages are being looked up; stale replies are ignored. */
  let pendingSymbol = '';
  const HISTORY_PAGE = 50;
  /** 'changes' | 'history' | 'sessions' | 'files' */
  let activeTab = 'changes';
  /** AI session whose details are being loaded; stale replies are ignored. */
  let pendingSession = '';
  let historyLimit = HISTORY_PAGE;
  /** Commit whose files are being loaded; stale replies are ignored. */
  let pendingCommit = '';
  /** File or commit shown in Details; notes replies for anything else are ignored. */
  let currentSubject = '';

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /** Adds a "?" button after a term; clicking shows its explanation inline (keyboard accessible). */
  function withHelp(node, term) {
    const text = glossary[String(term).toLowerCase()];
    if (!text) return node;
    const btn = el('button', '?', 'help-btn');
    btn.title = `What does "${term}" mean?`;
    btn.setAttribute('aria-expanded', 'false');
    /** @type {HTMLElement | undefined} */
    let box;
    btn.addEventListener('click', () => {
      if (box) {
        box.remove();
        box = undefined;
      } else {
        box = el('p', text, 'help');
        // An inline term (a tag inside a heading) gets its explanation below the heading.
        (node.tagName === 'SPAN' && node.parentElement ? node.parentElement : node).after(box);
      }
      btn.setAttribute('aria-expanded', String(!!box));
    });
    node.append(btn);
    return node;
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  /** Browser view only: the click whose code or comparison should be shown (stale replies are ignored). */
  let pendingCode = '';
  const CODE_REQUESTS = new Set(['open', 'commitFile', 'symbol', 'goto']);

  function send(msg) {
    if (CODE_REQUESTS.has(msg.type)) pendingCode = msg.id;
    vscode.postMessage(msg);
  }

  // ---- toolbar ----
  $('refresh').addEventListener('click', () => send({ type: 'refresh' }));
  $('preview').addEventListener('click', () => send({ type: 'preview' }));
  // Only in VS Code: the browser page has no "Open in Browser" button.
  document.getElementById('openBrowser')?.addEventListener('click', () => send({ type: 'openInBrowser' }));
  $('folder').addEventListener('change', (e) => send({ type: 'selectFolder', index: Number(/** @type {HTMLSelectElement} */ (e.target).value) }));
  $('fit').addEventListener('click', () => cy && cy.fit(undefined, 30));
  $('zoomIn').addEventListener('click', () => cy && cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: center() }));
  $('zoomOut').addEventListener('click', () => cy && cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: center() }));
  $('layout').addEventListener('click', () => runLayout());
  $('tabChanges').addEventListener('click', () => showTab('changes'));
  $('tabHistory').addEventListener('click', () => showTab('history'));
  $('tabSessions').addEventListener('click', () => showTab('sessions'));
  $('tabFiles').addEventListener('click', () => showTab('files'));
  $('expandAll').addEventListener('click', () => { for (const d of $('fileTree').querySelectorAll('details')) /** @type {HTMLDetailsElement} */ (d).open = true; });
  $('collapseAll').addEventListener('click', () => { for (const d of $('fileTree').querySelectorAll('details')) /** @type {HTMLDetailsElement} */ (d).open = false; });
  document.getElementById('codeBack')?.addEventListener('click', () => showGraph());
  document.getElementById('codeEditor')?.addEventListener('click', () => { if (codeFor) send({ type: 'openInEditor', id: codeFor }); });
  $('moreHistory').addEventListener('click', () => {
    historyLimit = Math.min(historyLimit + HISTORY_PAGE, 200);
    requestHistory();
  });

  function showTab(name) {
    activeTab = name;
    for (const [tab, view, key] of [['tabChanges', 'changesView', 'changes'], ['tabHistory', 'historyView', 'history'], ['tabSessions', 'sessionsView', 'sessions'], ['tabFiles', 'filesView', 'files']]) {
      $(tab).classList.toggle('active', key === name);
      $(tab).setAttribute('aria-selected', String(key === name));
      $(view).hidden = key !== name;
    }
    clearHighlight();
    if (name === 'history') requestHistory();
    else if (name === 'sessions') requestSessions();
    else if (name === 'files') requestFiles();
  }

  function requestFiles() {
    $('filesInfo').textContent = 'Loading files…';
    send({ type: 'files' });
  }

  function requestSessions() {
    $('sessionsView').replaceChildren(el('p', 'Loading AI sessions…', 'muted'));
    send({ type: 'sessions' });
  }

  function requestHistory() {
    $('historyInfo').textContent = 'Loading history…';
    send({ type: 'history', limit: historyLimit });
  }

  function center() {
    const g = $('graph');
    return { x: g.clientWidth / 2, y: g.clientHeight / 2 };
  }

  // ---- messages from the extension host ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'loading') $('status').textContent = 'Scanning…';
    else if (msg.type === 'error') $('status').textContent = 'Error: ' + msg.message;
    else if (msg.type === 'state') renderState(msg.state);
    else if (msg.type === 'details') renderDetails(msg.details);
    else if (msg.type === 'usagesLoading') renderUsagesLoading(msg.symbol);
    else if (msg.type === 'usages') renderUsages(msg.result, msg.nodeIds);
    else if (msg.type === 'symbolExplain') renderSymbolExplain(msg);
    else if (msg.type === 'explain') renderExplain(msg);
    else if (msg.type === 'history') renderHistory(msg.result);
    else if (msg.type === 'commit') renderCommit(msg.details, msg.nodeIds);
    else if (msg.type === 'notes') renderNotes(msg);
    else if (msg.type === 'sessions') renderSessions(msg.result);
    else if (msg.type === 'sessionsError') $('sessionsView').replaceChildren(el('p', 'Could not read the session logs: ' + msg.message, 'muted'));
    else if (msg.type === 'session') renderSession(msg.details, msg.nodeIds);
    else if (msg.type === 'code') renderCode(msg.view);
    else if (msg.type === 'files') renderFiles(msg.result);
  });

  // ---- code and before/after views (browser view only, Phase 6c) ----
  /** Id of the file, commit file or symbol shown in the code view. */
  let codeFor = '';

  function showGraph() {
    const view = document.getElementById('codeView');
    if (!view) return;
    view.hidden = true;
    for (const id of ['graphTools', 'graph', 'legend']) $(id).hidden = false;
    // The graph was hidden, so it needs to measure its container again.
    if (cy) cy.resize();
  }

  function codeRow(className, cells) {
    const row = el('div', undefined, 'code-row ' + className);
    for (const [text, cls] of cells) row.append(el('span', text, cls));
    return row;
  }

  function renderCode(v) {
    const view = document.getElementById('codeView');
    if (!view || v.for !== pendingCode) return;
    codeFor = v.for;
    for (const id of ['graphTools', 'graph', 'legend']) $(id).hidden = true;
    view.hidden = false;
    $('codeTitle').textContent = v.title;
    const note = $('codeNote');
    note.textContent = v.note || '';
    note.hidden = !v.note;
    const body = $('codeBody');
    body.classList.toggle('diff', v.mode === 'diff');
    const rows = document.createDocumentFragment();
    /** @type {HTMLElement | undefined} */
    let highlighted;
    if (v.mode === 'file') {
      v.lines.forEach((line, i) => {
        const row = codeRow(i + 1 === v.highlight ? 'hl' : '', [[String(i + 1), 'ln'], [line, 'text']]);
        if (i + 1 === v.highlight) highlighted = row;
        rows.append(row);
      });
    } else if (v.mode === 'diff') {
      for (const r of v.rows) {
        if (r.k === '…') rows.append(el('div', `… ${r.count} unchanged line${r.count === 1 ? '' : 's'}`, 'code-row skip'));
        else if (r.k === '+') rows.append(codeRow('add', [['', 'ln'], [String(r.n), 'ln'], ['+', 'sign'], [r.t, 'text']]));
        else if (r.k === '-') rows.append(codeRow('del', [[String(r.o), 'ln'], ['', 'ln'], ['−', 'sign'], [r.t, 'text']]));
        else rows.append(codeRow('', [[String(r.o), 'ln'], [String(r.n), 'ln'], ['', 'sign'], [r.t, 'text']]));
      }
    }
    body.replaceChildren(rows);
    body.scrollTop = 0;
    if (highlighted) highlighted.scrollIntoView({ block: 'center' });
  }

  function renderState(state) {
    glossary = state.glossary || {};
    $('status').textContent = 'Updated ' + state.scannedAt;
    const select = /** @type {HTMLSelectElement} */ ($('folder'));
    select.replaceChildren(...state.folders.map((name, i) => {
      const opt = /** @type {HTMLOptionElement} */ (el('option', name));
      opt.value = String(i);
      opt.selected = i === state.folderIndex;
      return opt;
    }));
    select.disabled = state.folders.length < 2;

    const banner = $('banner');
    banner.hidden = true;
    if (state.folders.length === 0) showBanner('No folder is open. Use File → Open Folder, then run "VibeCode Explorer: Open Dashboard" again.');
    else if (!state.trusted) showBanner('This workspace is not trusted. VibeCode Explorer does not read Git data or analyze files in Restricted Mode. Trust the workspace to continue.');

    renderChanges(state.git);
    showGraph();
    renderGraph(state.graph);
    // A refresh invalidates commit and session ids, so the active tab reloads.
    if (activeTab === 'history') requestHistory();
    else if (activeTab === 'sessions') requestSessions();
    else if (activeTab === 'files') requestFiles();
  }

  function showBanner(text) {
    const banner = $('banner');
    banner.textContent = text;
    banner.hidden = false;
  }

  function renderChanges(git) {
    const repo = $('repo');
    const list = $('changes');
    list.replaceChildren();
    if (git.kind === 'noGit') { repo.textContent = 'No Git repository for this folder. Git changes are unavailable; the graph still works.'; return; }
    if (git.kind === 'unavailable') { repo.textContent = git.reason; return; }
    if (git.kind !== 'ok') { repo.textContent = ''; return; }

    repo.textContent = `${git.repoName} · ${git.branch} · ${git.changes.length} changed`;
    if (git.changes.length === 0) { list.append(el('p', 'No workspace changes.', 'muted')); return; }

    for (const group of Object.keys(GROUP_LABELS)) {
      const items = git.changes.filter((c) => c.group === group);
      if (items.length === 0) continue;
      list.append(withHelp(el('h3', `${GROUP_LABELS[group]} (${items.length})`, 'group ' + group), group));
      const ul = el('ul', undefined, 'files');
      for (const c of items) {
        const li = el('li');
        const btn = el('button', c.path, 'link');
        btn.title = group === 'modified' || group === 'renamed' ? 'Open diff against HEAD' : 'Open file';
        btn.addEventListener('click', () => send({ type: 'open', id: c.id }));
        li.append(btn);
        if (c.staged) li.append(el('span', 'staged', 'tag'));
        if (c.sensitive) li.append(el('span', 'sensitive', 'tag warn'));
        ul.append(li);
      }
      list.append(ul);
    }
  }

  function renderGraph(graph) {
    const info = `${graph.fileCount} files · ${graph.edges.length} imports` + (graph.truncated ? ` · limited to ${graph.maxFiles} files` : '');
    $('graphInfo').textContent = info;

    const cycleNodes = new Set(graph.cycleNodes || []);
    const cycleEdges = new Set(graph.cycleEdges || []);
    const fg = cssVar('--vscode-foreground', '#ccc');
    const accent = cssVar('--vscode-focusBorder', '#0078d4');
    const bg = cssVar('--vscode-editor-background', '#1e1e1e');
    const elements = [
      ...graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, kind: n.kind, group: n.group || '', cycle: cycleNodes.has(n.id) } })),
      ...graph.edges.map((e, i) => ({ data: { id: 'e' + i, source: e.source, target: e.target, cycle: cycleEdges.has(i) } })),
    ];
    if (cy) cy.destroy();
    cy = cytoscape({
      container: $('graph'),
      elements,
      wheelSensitivity: 0.3,
      minZoom: 0.05,
      maxZoom: 4,
      style: [
        { selector: 'node', style: { label: 'data(label)', color: fg, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, width: 14, height: 14, 'background-color': '#6c8ebf',
          // A backdrop keeps a label readable where it crosses edges or another label.
          'text-background-color': bg, 'text-background-opacity': 0.75, 'text-background-padding': 1 } },
        { selector: 'node[group = "modified"], node[group = "renamed"], node[group = "added"], node[group = "conflict"]', style: { 'background-color': '#d7a33a' } },
        { selector: 'node[group = "untracked"]', style: { 'background-color': '#4caf50' } },
        { selector: 'node[kind = "unknown"]', style: { shape: 'diamond', 'background-color': '#888', 'font-style': 'italic' } },
        { selector: 'edge', style: { width: 1, 'line-color': '#777', 'target-arrow-color': '#777', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.7, opacity: 0.7 } },
        { selector: 'node[?cycle]', style: { 'border-width': 2, 'border-color': '#f14c4c' } },
        { selector: 'edge[?cycle]', style: { width: 2, 'line-color': '#f14c4c', 'target-arrow-color': '#f14c4c' } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': accent } },
        { selector: '.faded', style: { opacity: 0.15 } },
        { selector: 'node.used', style: { 'border-width': 3, 'border-color': '#c586c0' } },
        { selector: 'node.inCommit', style: { 'border-width': 3, 'border-color': '#4fc1ff' } },
      ],
    });
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      selectedId = node.id();
      cy.elements().removeClass('used inCommit').addClass('faded');
      node.closedNeighborhood().removeClass('faded');
      if (node.data('kind') === 'file') send({ type: 'inspect', id: selectedId });
      else renderUnknown(node.data('label'));
    });
    cy.on('tap', (evt) => { if (evt.target === cy) clearHighlight(); });
    cy.on('dbltap', 'node[kind = "file"]', (evt) => send({ type: 'open', id: evt.target.id() }));
    runLayout();
    send({ type: 'rendered', nodes: cy.nodes().length, edges: cy.edges().length });
    if (graph.nodes.length === 0) $('graphInfo').textContent = 'No JavaScript, TypeScript or Python files found in this folder.';
  }

  function clearHighlight() {
    if (cy) cy.elements().removeClass('faded used inCommit');
  }

  function runLayout() {
    if (!cy) return;
    // Counting labels in each node's size keeps file names from landing on top of each other.
    cy.layout({ name: 'cose', animate: false, nodeDimensionsIncludeLabels: true, nodeRepulsion: 12000, idealEdgeLength: 70, padding: 30 }).run();
  }

  function renderUnknown(label) {
    currentSubject = '';
    const info = $('info');
    info.replaceChildren(el('h2', 'Unknown import'), el('p', label, 'mono'),
      el('p', 'The target could not be resolved statically (path alias, dynamic expression, or outside this folder). No edge is guessed.', 'muted'));
  }

  function renderDetails(d) {
    pendingSymbol = '';
    pendingCommit = '';
    pendingSession = '';
    const info = $('info');
    const open = el('button', d.group === 'deleted' ? 'Open HEAD version' : 'Open source');
    open.addEventListener('click', () => send({ type: 'open', id: d.id }));
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    row('Path', d.path);
    row('Type', d.fileType);
    rows.append(withHelp(el('dt', 'Git status'), 'git status'));
    rows.append(withHelp(el('dd', d.group ? GROUP_LABELS[d.group] : 'unchanged'), d.group || ''));
    info.replaceChildren(el('h2', 'Details'), el('div', undefined, 'explain'), rows, open);
    if (d.note) info.append(el('p', d.note, 'muted'));
    currentSubject = d.id;
    info.append(el('div', undefined, 'notes'));

    if (d.analyzed) {
      info.append(withHelp(el('h3', `Imports (${d.imports.length})`), 'imports'));
      const ul = el('ul', undefined, 'files');
      for (const imp of d.imports) {
        // The kind stays on one line; long paths wrap between words first.
        const li = el('li', `${imp.specifier}${imp.target ? ' → ' + imp.target : ''} `, 'mono');
        li.append(el('span', `[${imp.kind}]`, 'nowrap'));
        ul.append(li);
      }
      if (d.dynamicUnknown) ul.append(el('li', `${d.dynamicUnknown} dynamic import(s) with unknown target`, 'muted'));
      info.append(ul);
    }
    if (!d.sensitive && d.group !== 'deleted') {
      info.append(withHelp(el('h3', `Symbols (${d.symbols.length})`), 'symbols'));
      if (d.symbols.length === 0) info.append(el('p', 'No symbols reported by VS Code language support.', 'muted'));
      else info.append(el('p', 'Click a symbol to jump to it and see where it is used.', 'muted'));
      const ul = el('ul', undefined, 'files');
      for (const s of d.symbols) {
        const btn = el('button', `${'  '.repeat(s.depth)}${s.kind} ${s.name}  :${s.line}`, 'link mono');
        btn.title = 'Go to definition and find usages';
        btn.addEventListener('click', () => send({ type: 'symbol', id: s.id }));
        const li = el('li');
        li.append(btn);
        ul.append(li);
      }
      info.append(ul, el('div', undefined, 'usages'));
    }
  }

  function usagesBox() {
    const box = /** @type {HTMLElement | null} */ ($('info').querySelector('.usages'));
    if (box) box.replaceChildren();
    return box;
  }

  function renderUsagesLoading(symbol) {
    const box = usagesBox();
    if (!box) return;
    pendingSymbol = symbol;
    box.append(el('h3', `Used in: ${symbol}`), el('p', 'Finding usages…', 'muted'));
  }

  function renderUsages(r, nodeIds) {
    if (r.symbol !== pendingSymbol) return; // the details panel changed meanwhile
    const box = usagesBox();
    if (!box) return;
    box.append(withHelp(el('h3', `Used in: ${r.symbol} (${r.usages.length}${r.truncated ? '+' : ''} places, ${r.files.length} files)`), 'used in'));
    if (!r.available) box.append(el('p', 'Usages are not available: no VS Code language support answered for this file type.', 'muted'));
    else if (r.usages.length === 0) box.append(el('p', 'No usages found in this folder.', 'muted'));
    const ul = el('ul', undefined, 'files');
    for (const u of r.usages) {
      const btn = el('button', `${u.path}:${u.line}`, 'link mono');
      btn.addEventListener('click', () => send({ type: 'goto', id: u.id }));
      const li = el('li');
      li.append(btn);
      ul.append(li);
    }
    box.append(ul);
    if (r.truncated) box.append(el('p', 'Only the first results are shown.', 'muted'));
    if (r.hidden) box.append(el('p', `${r.hidden} location(s) hidden: outside this folder, generated, or sensitive.`, 'muted'));
    if (cy && nodeIds.length) {
      cy.elements().removeClass('used').addClass('faded');
      for (const id of nodeIds) cy.getElementById(id).removeClass('faded').addClass('used');
      if (selectedId) cy.getElementById(selectedId).removeClass('faded');
    }
  }

  function renderHistory(r) {
    const info = $('historyInfo');
    const list = $('commits');
    const more = $('moreHistory');
    list.replaceChildren();
    more.hidden = true;
    if (r.git.kind === 'restricted') { info.textContent = 'History is off in Restricted Mode. Trust the workspace to see it.'; return; }
    if (r.git.kind === 'noGit') { info.textContent = 'No Git repository for this folder, so there is no history.'; return; }
    if (r.git.kind === 'unavailable') { info.textContent = r.git.reason; return; }
    const commits = r.git.commits;
    info.textContent = commits.length === 0 ? 'No commits yet.' : `Latest ${commits.length} commit${commits.length === 1 ? '' : 's'}`;
    for (const c of commits) {
      const li = el('li');
      const btn = el('button', c.headline, 'link');
      btn.title = 'Show this commit and the files it changed';
      btn.addEventListener('click', () => {
        for (const b of list.querySelectorAll('button.selected')) b.classList.remove('selected');
        btn.classList.add('selected');
        pendingCommit = c.id;
        pendingSession = '';
        $('info').replaceChildren(el('h2', 'Commit'), el('p', 'Loading…', 'muted'));
        send({ type: 'commit', id: c.id });
      });
      li.append(btn, el('div', `${c.shortHash} · ${c.author} · ${c.date}`, 'muted small'));
      list.append(li);
    }
    more.hidden = !r.more;
  }

  function renderCommit(d, nodeIds) {
    if (d.id !== pendingCommit) return; // another commit or file was selected meanwhile
    pendingSymbol = '';
    const info = $('info');
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    row('Commit', d.hash.slice(0, 12));
    row('Author', d.author);
    row('Date', d.date);
    info.replaceChildren(withHelp(el('h2', 'Commit'), 'commit'), rows, el('h3', 'Message'), el('p', d.message.trim() || '(no message)', 'message'));
    currentSubject = d.id;
    info.append(el('div', undefined, 'notes'));

    if (!d.filesAvailable) {
      info.append(el('p', 'The file list is not available for this commit. If it is the first commit in the repository, VS Code\'s Git extension has no earlier commit to compare it with.', 'muted'));
    } else {
      info.append(el('h3', `Files changed (${d.files.length}${d.truncated ? '+' : ''})`));
      for (const group of Object.keys(GROUP_LABELS)) {
        const items = d.files.filter((f) => f.group === group);
        if (items.length === 0) continue;
        info.append(withHelp(el('h3', `${GROUP_LABELS[group]} (${items.length})`, 'group ' + group), group));
        const ul = el('ul', undefined, 'files');
        for (const f of items) {
          const li = el('li');
          const btn = el('button', f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, 'link');
          btn.title = f.sensitive ? 'Sensitive file: contents are not opened' : group === 'modified' || group === 'renamed' ? 'Open before/after diff' : 'Open file';
          btn.addEventListener('click', () => send({ type: 'commitFile', id: f.id }));
          li.append(btn);
          if (f.sensitive) li.append(el('span', 'sensitive', 'tag warn'));
          ul.append(li);
        }
        info.append(ul);
      }
      if (d.truncated) info.append(el('p', 'Only the first files are shown.', 'muted'));
      if (d.hidden) info.append(el('p', `${d.hidden} file(s) outside this folder are hidden.`, 'muted'));
    }
    if (cy) {
      cy.elements().removeClass('used inCommit').addClass('faded');
      for (const id of nodeIds) cy.getElementById(id).removeClass('faded').addClass('inCommit');
      if (nodeIds.length === 0) cy.elements().removeClass('faded');
    }
  }

  /** "In plain words" for the file shown in Details. */
  function renderExplain(msg) {
    if (msg.subject !== currentSubject) return;
    const box = /** @type {HTMLElement | null} */ ($('info').querySelector('.explain'));
    if (!box) return;
    const head = el('h3', 'In plain words');
    if (msg.role) head.append(withHelp(el('span', msg.role, 'tag'), msg.role));
    box.replaceChildren(head, el('p', msg.sentences.join(' ')));
    if (msg.tips.length) {
      const ul = el('ul', undefined, 'tips');
      for (const tip of msg.tips) ul.append(el('li', tip));
      box.append(withHelp(el('h3', 'Tips'), msg.tips.some((t) => t.includes('circular')) ? 'circular import' : ''), ul);
    }
  }

  function renderSymbolExplain(msg) {
    if (msg.symbol !== pendingSymbol) return;
    const box = /** @type {HTMLElement | null} */ ($('info').querySelector('.usages'));
    if (!box) return;
    const p = el('p', msg.sentences.join(' '), 'symbol-explain');
    box.prepend(withHelp(el('h3', `About ${msg.symbol}`), msg.kind), p);
  }

  function renderNotes(msg) {
    if (msg.subject !== currentSubject) return;
    const box = /** @type {HTMLElement | null} */ ($('info').querySelector('.notes'));
    if (!box) return;
    box.replaceChildren(withHelp(el('h3', `Notes (${msg.notes.length})`), 'notes'));
    if (!msg.available) { box.append(el('p', 'Notes are off in Restricted Mode.', 'muted')); return; }
    const ul = el('ul', undefined, 'files');
    for (const n of msg.notes) {
      const li = el('li');
      const btn = el('button', n.title, 'link');
      btn.title = 'Open ' + n.path;
      btn.addEventListener('click', () => send({ type: 'openNote', id: n.id }));
      li.append(btn);
      if (n.created) li.append(el('span', n.created, 'muted small note-date'));
      ul.append(li);
    }
    const add = el('button', 'Add note');
    add.title = 'Write down what, why and the decision. Saved as a Markdown file in .vibecode/notes/';
    add.addEventListener('click', () => send({ type: 'addNote', id: currentSubject }));
    box.append(ul, add);
  }

  // ---- Files tab (Phase 6d) ----
  function renderFiles(r) {
    const info = $('filesInfo');
    const treeBox = $('fileTree');
    treeBox.replaceChildren();
    if (r.state === 'restricted') { info.textContent = 'Files are off in Restricted Mode. Trust the workspace to see them.'; return; }
    if (r.state !== 'ok') { info.textContent = 'No folder is open.'; return; }
    info.textContent = `${r.tree.files} file${r.tree.files === 1 ? '' : 's'} in ${r.folder}` + (r.truncated ? ' (only the first ones are listed)' : '') +
      '. Click a file for details, double-click to open it. Click a folder to see its files in the graph.';
    treeBox.append(...r.tree.children.map((n) => treeNode(n, 0)));
  }

  function clearTreeSelection() {
    for (const s of $('fileTree').querySelectorAll('.selected')) s.classList.remove('selected');
  }

  /** Graph node ids of the files below a folder. */
  function graphIdsIn(folder) {
    const ids = [];
    const walk = (n) => {
      if (n.kind === 'folder') n.children.forEach(walk);
      else if (n.inGraph) ids.push(n.id);
    };
    walk(folder);
    return ids;
  }

  function treeNode(n, depth) {
    if (n.kind === 'folder') {
      const details = /** @type {HTMLDetailsElement} */ (el('details'));
      details.open = depth === 0;
      const summary = el('summary');
      summary.setAttribute('role', 'treeitem');
      summary.append(el('span', n.name, 'folder-name'), el('span', String(n.files), 'count muted'));
      summary.title = n.path;
      summary.addEventListener('click', () => {
        clearTreeSelection();
        summary.classList.add('selected');
        showGraph();
        highlightNodes(graphIdsIn(n));
      });
      const children = el('div', undefined, 'tree-children');
      // Children are built when the folder is first opened, so large projects stay quick.
      let built = false;
      const build = () => {
        if (built) return;
        built = true;
        children.append(...n.children.map((c) => treeNode(c, depth + 1)));
      };
      if (details.open) build();
      details.addEventListener('toggle', () => { if (details.open) build(); });
      details.append(summary, children);
      return details;
    }
    const btn = el('button', n.name, 'link tree-file' + (n.group ? ' group ' + n.group : '') + (n.inGraph ? ' in-graph' : ''));
    btn.setAttribute('role', 'treeitem');
    btn.title = n.path + (n.sensitive ? ' (sensitive: contents are never shown)' : n.group ? ` (${GROUP_LABELS[n.group] || n.group})` : '') + (n.inGraph ? ' · in the graph' : '');
    btn.addEventListener('click', () => {
      clearTreeSelection();
      btn.classList.add('selected');
      if (n.inGraph && cy) {
        // Show the graph (the browser may be showing code) and bring the file into view, selected.
        showGraph();
        selectedId = n.id;
        const node = cy.getElementById(n.id);
        cy.elements().unselect().removeClass('used inCommit').addClass('faded');
        node.select();
        node.closedNeighborhood().removeClass('faded');
        cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 250 });
      } else {
        clearHighlight();
      }
      send({ type: 'inspect', id: n.id });
    });
    // Sensitive files are never opened from the tree.
    if (!n.sensitive) btn.addEventListener('dblclick', () => send({ type: 'open', id: n.id }));
    if (n.sensitive) {
      const wrap = el('div');
      wrap.append(btn, el('span', 'sensitive', 'tag warn'));
      return wrap;
    }
    return btn;
  }

  /** Outlines the given graph nodes (a folder's files) and fades the rest. */
  function highlightNodes(nodeIds) {
    if (!cy) return;
    cy.elements().unselect().removeClass('used inCommit').addClass('faded');
    const nodes = cy.collection(nodeIds.map((id) => cy.getElementById(id)));
    nodes.removeClass('faded').addClass('inCommit');
    if (nodeIds.length === 0) cy.elements().removeClass('faded');
    // Fit the folder's files into view.
    else cy.animate({ fit: { eles: nodes, padding: 60 } }, { duration: 250 });
  }

  const fmt = (n) => Number(n).toLocaleString();
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

  function renderSessions(r) {
    const view = $('sessionsView');
    view.replaceChildren();
    if (r.state === 'restricted') { view.append(el('p', 'AI sessions are off in Restricted Mode. Trust the workspace to see them.', 'muted')); return; }
    if (r.state === 'notAllowed') {
      const allow = el('button', `Allow reading ${r.agent} logs`);
      allow.addEventListener('click', () => send({ type: 'allowSessions' }));
      view.append(
        el('p', `See the prompts you gave ${r.agent}, its replies and security points, tokens used, and learning tips.`),
        el('p', 'VibeCode Explorer will only read, never change, this folder on your computer:', 'muted'),
        el('p', r.logFolder, 'mono'),
        allow);
      return;
    }
    if (r.sessions.length === 0) {
      view.append(el('p', `No ${r.agent} sessions found for this folder.`, 'muted'), el('p', 'Looked in: ' + r.logFolder, 'mono muted'));
      return;
    }
    const t = r.totals;
    const summary = el('div', undefined, 'summary');
    summary.append(
      el('div', `${t.sessions} sessions · ${fmt(t.prompts)} prompts`),
      el('div', `Tokens: ${fmt(t.input)} input · ${fmt(t.output)} output`, 'small'),
      el('div', `Cache: ${fmt(t.cacheRead)} read · ${fmt(t.cacheWrite)} written`, 'muted small'));
    if (r.topFiles.length) {
      summary.append(el('div', 'Most edited files', 'small strong'));
      const ul = el('ul', undefined, 'files');
      for (const f of r.topFiles.slice(0, 5)) ul.append(el('li', `${f.path} (${f.sessions} session${f.sessions === 1 ? '' : 's'})`, 'mono small'));
      summary.append(ul);
    }
    view.append(summary);
    const list = el('ul', undefined, 'commits');
    for (const sess of r.sessions) {
      const li = el('li');
      const btn = el('button', sess.title, 'link');
      btn.title = 'Show prompts, tokens, security points and tips';
      btn.addEventListener('click', () => {
        for (const b of list.querySelectorAll('button.selected')) b.classList.remove('selected');
        btn.classList.add('selected');
        pendingSession = sess.id;
        pendingCommit = '';
        currentSubject = '';
        $('info').replaceChildren(el('h2', 'AI session'), el('p', 'Loading…', 'muted'));
        send({ type: 'session', id: sess.id });
      });
      li.append(btn, el('div', `${when(sess.start)} · ${sess.prompts} prompts · ${fmt(sess.tokens)} tokens`, 'muted small'));
      list.append(li);
    }
    view.append(list);
  }

  function renderSession(d, nodeIds) {
    if (d.id !== pendingSession) return;
    pendingSymbol = '';
    const info = $('info');
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    row('Started', when(d.start));
    row('Ended', when(d.end));
    row('Model', d.models.join(', ') || 'unknown');
    row('Replies', fmt(d.replies));
    info.replaceChildren(el('h2', 'AI session'), el('p', d.title, 'strong'), rows);

    info.append(withHelp(el('h3', 'Tokens'), 'tokens'));
    const tok = el('dl');
    tok.append(withHelp(el('dt', 'Input'), 'input tokens'), el('dd', fmt(d.tokens.input)), withHelp(el('dt', 'Output'), 'output tokens'), el('dd', fmt(d.tokens.output)),
      withHelp(el('dt', 'Cache read'), 'cache tokens'), el('dd', fmt(d.tokens.cacheRead)), el('dt', 'Cache write'), el('dd', fmt(d.tokens.cacheWrite)));
    info.append(tok);

    if (d.tips.length) {
      info.append(el('h3', 'Tips'));
      const ul = el('ul', undefined, 'tips');
      for (const tip of d.tips) ul.append(el('li', tip));
      info.append(ul);
    }

    info.append(el('h3', `Files changed (${d.files.length})`));
    if (d.files.length === 0) info.append(el('p', 'No files were changed in this folder.', 'muted'));
    const files = el('ul', undefined, 'files');
    for (const f of d.files) files.append(el('li', f, 'mono'));
    info.append(files);
    if (d.hiddenFiles) info.append(el('p', `${d.hiddenFiles} file(s) outside this folder are not shown.`, 'muted'));

    if (d.commits.length) {
      info.append(el('h3', `Commits during this session (${d.commits.length})`));
      const ul = el('ul', undefined, 'files');
      for (const c of d.commits) ul.append(el('li', `${c.shortHash} ${c.headline}`, 'mono'));
      info.append(ul, el('p', 'Open them in the History tab.', 'muted small'));
    }

    info.append(withHelp(el('h3', `Security mentions (${d.securityMentions.length})`), 'security mentions'));
    if (d.securityMentions.length === 0) info.append(el('p', 'None found in the replies.', 'muted'));
    else info.append(el('p', 'Sentences in the replies that mention a security topic. Found by keywords, not a review of your code.', 'muted small'));
    const sec = el('ul', undefined, 'mentions');
    for (const m of d.securityMentions) sec.append(el('li', m));
    info.append(sec);

    info.append(withHelp(el('h3', `Prompts (${d.prompts.length})`), 'prompt'));
    const prompts = el('ol', undefined, 'prompts');
    for (const p of d.prompts) {
      const li = el('li');
      const short = p.text.length > 300;
      const text = el('div', short ? p.text.slice(0, 300) + '…' : p.text, 'prompt');
      li.append(el('div', when(p.time), 'muted small'), text);
      if (short) {
        const more = el('button', 'Show all', 'link small');
        more.addEventListener('click', () => {
          const expanded = more.textContent === 'Show less';
          text.textContent = expanded ? p.text.slice(0, 300) + '…' : p.text;
          more.textContent = expanded ? 'Show all' : 'Show less';
        });
        li.append(more);
      }
      prompts.append(li);
    }
    info.append(prompts);
    info.append(el('p', 'Text that looks like a key or password is shown as [hidden]. Tool output is never shown.', 'muted small'));

    if (cy) {
      cy.elements().removeClass('used inCommit').addClass('faded');
      for (const id of nodeIds) cy.getElementById(id).removeClass('faded').addClass('inCommit');
      if (nodeIds.length === 0) cy.elements().removeClass('faded');
    }
  }

  send({ type: 'ready' });
})();
