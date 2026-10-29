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
  let selectedId = '';
  /** Symbol whose usages are being looked up; stale replies are ignored. */
  let pendingSymbol = '';
  const HISTORY_PAGE = 50;
  let historyActive = false;
  let historyLimit = HISTORY_PAGE;
  /** Commit whose files are being loaded; stale replies are ignored. */
  let pendingCommit = '';

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  function send(msg) {
    vscode.postMessage(msg);
  }

  // ---- toolbar ----
  $('refresh').addEventListener('click', () => send({ type: 'refresh' }));
  $('preview').addEventListener('click', () => send({ type: 'preview' }));
  $('folder').addEventListener('change', (e) => send({ type: 'selectFolder', index: Number(/** @type {HTMLSelectElement} */ (e.target).value) }));
  $('fit').addEventListener('click', () => cy && cy.fit(undefined, 30));
  $('zoomIn').addEventListener('click', () => cy && cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: center() }));
  $('zoomOut').addEventListener('click', () => cy && cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: center() }));
  $('layout').addEventListener('click', () => runLayout());
  $('tabChanges').addEventListener('click', () => showTab(false));
  $('tabHistory').addEventListener('click', () => showTab(true));
  $('moreHistory').addEventListener('click', () => {
    historyLimit = Math.min(historyLimit + HISTORY_PAGE, 200);
    requestHistory();
  });

  function showTab(history) {
    historyActive = history;
    $('tabChanges').classList.toggle('active', !history);
    $('tabHistory').classList.toggle('active', history);
    $('tabChanges').setAttribute('aria-selected', String(!history));
    $('tabHistory').setAttribute('aria-selected', String(history));
    $('changesView').hidden = history;
    $('historyView').hidden = !history;
    if (history) requestHistory();
    else clearHighlight();
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
    else if (msg.type === 'history') renderHistory(msg.result);
    else if (msg.type === 'commit') renderCommit(msg.details, msg.nodeIds);
  });

  function renderState(state) {
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
    renderGraph(state.graph);
    // A refresh invalidates commit ids, so the History tab reloads.
    if (historyActive) requestHistory();
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
      list.append(el('h3', `${GROUP_LABELS[group]} (${items.length})`, 'group ' + group));
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

    const fg = cssVar('--vscode-foreground', '#ccc');
    const accent = cssVar('--vscode-focusBorder', '#0078d4');
    const elements = [
      ...graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, kind: n.kind, group: n.group || '' } })),
      ...graph.edges.map((e, i) => ({ data: { id: 'e' + i, source: e.source, target: e.target } })),
    ];
    if (cy) cy.destroy();
    cy = cytoscape({
      container: $('graph'),
      elements,
      wheelSensitivity: 0.3,
      minZoom: 0.05,
      maxZoom: 4,
      style: [
        { selector: 'node', style: { label: 'data(label)', color: fg, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, width: 14, height: 14, 'background-color': '#6c8ebf' } },
        { selector: 'node[group = "modified"], node[group = "renamed"], node[group = "added"], node[group = "conflict"]', style: { 'background-color': '#d7a33a' } },
        { selector: 'node[group = "untracked"]', style: { 'background-color': '#4caf50' } },
        { selector: 'node[kind = "unknown"]', style: { shape: 'diamond', 'background-color': '#888', 'font-style': 'italic' } },
        { selector: 'edge', style: { width: 1, 'line-color': '#777', 'target-arrow-color': '#777', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.7, opacity: 0.7 } },
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
    if (graph.nodes.length === 0) $('graphInfo').textContent = 'No JavaScript/TypeScript files found in this folder.';
  }

  function clearHighlight() {
    if (cy) cy.elements().removeClass('faded used inCommit');
  }

  function runLayout() {
    if (!cy) return;
    cy.layout({ name: 'cose', animate: false, nodeRepulsion: 8000, idealEdgeLength: 60, padding: 30 }).run();
  }

  function renderUnknown(label) {
    const info = $('info');
    info.replaceChildren(el('h2', 'Unknown import'), el('p', label, 'mono'),
      el('p', 'The target could not be resolved statically (path alias, dynamic expression, or outside this folder). No edge is guessed.', 'muted'));
  }

  function renderDetails(d) {
    pendingSymbol = '';
    pendingCommit = '';
    const info = $('info');
    const open = el('button', d.group === 'deleted' ? 'Open HEAD version' : 'Open source');
    open.addEventListener('click', () => send({ type: 'open', id: d.id }));
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    row('Path', d.path);
    row('Type', d.fileType);
    row('Git status', d.group ? GROUP_LABELS[d.group] : 'unchanged');
    info.replaceChildren(el('h2', 'Details'), rows, open);
    if (d.note) info.append(el('p', d.note, 'muted'));

    if (d.analyzed) {
      info.append(el('h3', `Imports (${d.imports.length})`));
      const ul = el('ul', undefined, 'files');
      for (const imp of d.imports) ul.append(el('li', `${imp.specifier}${imp.target ? ' → ' + imp.target : ''}  [${imp.kind}]`, 'mono'));
      if (d.dynamicUnknown) ul.append(el('li', `${d.dynamicUnknown} dynamic import(s) with unknown target`, 'muted'));
      info.append(ul);
    }
    if (!d.sensitive && d.group !== 'deleted') {
      info.append(el('h3', `Symbols (${d.symbols.length})`));
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
    box.append(el('h3', `Used in: ${r.symbol} (${r.usages.length}${r.truncated ? '+' : ''} places, ${r.files.length} files)`));
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
    info.replaceChildren(el('h2', 'Commit'), rows, el('h3', 'Message'), el('p', d.message.trim() || '(no message)', 'message'));

    if (!d.filesAvailable) {
      info.append(el('p', 'The file list is not available for this commit. If it is the first commit in the repository, VS Code\'s Git extension has no earlier commit to compare it with.', 'muted'));
    } else {
      info.append(el('h3', `Files changed (${d.files.length}${d.truncated ? '+' : ''})`));
      for (const group of Object.keys(GROUP_LABELS)) {
        const items = d.files.filter((f) => f.group === group);
        if (items.length === 0) continue;
        info.append(el('h3', `${GROUP_LABELS[group]} (${items.length})`, 'group ' + group));
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

  send({ type: 'ready' });
})();
