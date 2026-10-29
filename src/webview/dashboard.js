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
      ],
    });
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      selectedId = node.id();
      cy.elements().addClass('faded');
      node.closedNeighborhood().removeClass('faded');
      if (node.data('kind') === 'file') send({ type: 'inspect', id: selectedId });
      else renderUnknown(node.data('label'));
    });
    cy.on('tap', (evt) => { if (evt.target === cy) cy.elements().removeClass('faded'); });
    cy.on('dbltap', 'node[kind = "file"]', (evt) => send({ type: 'open', id: evt.target.id() }));
    runLayout();
    send({ type: 'rendered', nodes: cy.nodes().length, edges: cy.edges().length });
    if (graph.nodes.length === 0) $('graphInfo').textContent = 'No JavaScript/TypeScript files found in this folder.';
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
      const ul = el('ul', undefined, 'files');
      for (const s of d.symbols) {
        const li = el('li', `${'  '.repeat(s.depth)}${s.kind} ${s.name}  :${s.line}`, 'mono');
        ul.append(li);
      }
      info.append(ul);
    }
  }

  send({ type: 'ready' });
})();
