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
  /** 'changes' | 'history' | 'sessions' | 'files' | 'apis' | 'health' | 'project' | 'learn' */
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
  const CODE_REQUESTS = new Set(['open', 'commitFile', 'symbol', 'goto', 'apiItem', 'previewPage', 'projectItem', 'learnItem', 'openNote']);

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
  $('tabApis').addEventListener('click', () => showTab('apis'));
  $('tabHealth').addEventListener('click', () => showTab('health'));
  $('tabProject').addEventListener('click', () => showTab('project'));
  $('tabLearn').addEventListener('click', () => showTab('learn'));
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
    for (const [tab, view, key] of [['tabChanges', 'changesView', 'changes'], ['tabHistory', 'historyView', 'history'], ['tabSessions', 'sessionsView', 'sessions'], ['tabFiles', 'filesView', 'files'], ['tabApis', 'apisView', 'apis'], ['tabHealth', 'healthView', 'health'], ['tabProject', 'projectView', 'project'], ['tabLearn', 'learnView', 'learn']]) {
      $(tab).classList.toggle('active', key === name);
      $(tab).setAttribute('aria-selected', String(key === name));
      $(view).hidden = key !== name;
    }
    clearHighlight();
    if (name === 'history') requestHistory();
    else if (name === 'sessions') requestSessions();
    else if (name === 'files') requestFiles();
    else if (name === 'apis') requestApis();
    else if (name === 'health') requestHealth();
    else if (name === 'project') requestProject();
    else if (name === 'learn') requestLearn();
  }

  function requestApis() {
    $('apisView').replaceChildren(el('p', 'Looking for pages, routes, HTTP calls and database models…', 'muted'));
    send({ type: 'apis' });
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
    else if (msg.type === 'apis') renderApis(msg.result);
    else if (msg.type === 'pagePreview') renderPagePreview(msg);
    else if (msg.type === 'health') renderHealth(msg.result);
    else if (msg.type === 'project') renderProject(msg.result);
    else if (msg.type === 'learn') renderLearn(msg.result);
    else if (msg.type === 'hotspots') renderHotspots(msg.result);
    else if (msg.type === 'contextCopied') renderContextCopied(msg);
    else if (msg.type === 'noteSaved') renderNoteSaved(msg);
    else if (msg.type === 'rulesCreated') { if (activeTab === 'health') requestHealth(); }
    else if (msg.type === 'issueSaved') { const p = document.getElementById('issueStatus'); if (p) p.textContent = msg.message; }
    else if (msg.type === 'markedSafe') { const b = document.getElementById('markSafe'); if (b) { b.textContent = 'Marked as a safe point'; b.setAttribute('disabled', ''); } }
    else if (msg.type === 'previewError') renderPreviewError(msg);
  });

  // ---- code and before/after views (browser view only, Phase 6c) ----
  /** Id of the file, commit file or symbol shown in the code view. */
  let codeFor = '';

  function showGraph() {
    const view = document.getElementById('codeView');
    if (!view) return;
    view.hidden = true;
    hidePreview();
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
    // A new code view replaces the preview; a page's preview follows its code right after.
    hidePreview();
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
    const lang = langFor(v.path);
    const state = { open: null };
    if (v.mode === 'file') {
      v.lines.forEach((line, i) => {
        const row = codeRow(i + 1 === v.highlight ? 'hl' : '', [[String(i + 1), 'ln']]);
        row.append(codeCell(line, lang, state));
        if (i + 1 === v.highlight) highlighted = row;
        rows.append(row);
      });
    } else if (v.mode === 'diff') {
      for (const r of v.rows) {
        // Each diff line is coloured on its own: a comment can't run on across skipped lines.
        const fresh = { open: null };
        if (r.k === '…') rows.append(el('div', `… ${r.count} unchanged line${r.count === 1 ? '' : 's'}`, 'code-row skip'));
        else if (r.k === '+') rows.append(codeRow('add', [['', 'ln'], [String(r.n), 'ln'], ['+', 'sign']]));
        else if (r.k === '-') rows.append(codeRow('del', [[String(r.o), 'ln'], ['', 'ln'], ['−', 'sign']]));
        else rows.append(codeRow('', [[String(r.o), 'ln'], [String(r.n), 'ln'], ['', 'sign']]));
        if (r.k !== '…') /** @type {HTMLElement} */ (rows.lastChild).append(codeCell(r.t, lang, fresh));
      }
    }
    body.replaceChildren(rows);
    body.scrollTop = 0;
    if (highlighted) highlighted.scrollIntoView({ block: 'center' });
  }

  // ---- Syntax colours for the code view (Phase 12) ----
  // A small line-by-line tokenizer: keywords, strings, comments and numbers. It only adds
  // colour; text is always set with textContent.
  const JS_WORDS = new Set(('abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield').split(' '));
  const PY_WORDS = new Set(('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return self try while with yield match case').split(' '));
  const LANGS = {
    js: { words: JS_WORDS, line: '//', block: ['/*', '*/'], quotes: '\'"`' },
    py: { words: PY_WORDS, line: '#', block: null, quotes: '\'"', triple: true },
    css: { words: new Set(['important', 'media', 'import', 'from', 'to']), line: null, block: ['/*', '*/'], quotes: '\'"' },
    // Only double quotes: an apostrophe in page text ("don't") must not colour the rest of the line.
    html: { words: new Set(), line: null, block: ['<!--', '-->'], quotes: '"', tags: true },
    json: { words: new Set(['true', 'false', 'null']), line: null, block: null, quotes: '"' },
    sh: { words: new Set(('if then else elif fi for do done while case esac function in export return local echo').split(' ')), line: '#', block: null, quotes: '\'"' },
  };

  function langFor(path) {
    const ext = (/\.([a-z0-9]+)$/i.exec(path || '') || ['', ''])[1].toLowerCase();
    if (/^(m|c)?[jt]sx?$/.test(ext)) return LANGS.js;
    if (ext === 'py') return LANGS.py;
    if (/^(css|scss|less)$/.test(ext)) return LANGS.css;
    if (/^(html?|vue|svelte|xml|svg|ejs)$/.test(ext)) return LANGS.html;
    if (ext === 'json') return LANGS.json;
    if (/^(sh|bash|ps1|ya?ml|toml|ini|env)$/.test(ext)) return LANGS.sh;
    return null;
  }

  /**
   * Splits one line into [text, class] parts. `state` carries an open block comment or
   * Python triple-quoted string to the next line.
   */
  function tokenize(line, lang, state) {
    const parts = [];
    let i = 0;
    const push = (text, cls) => { if (text) parts.push([text, cls]); };
    if (state.open) {
      const end = line.indexOf(state.open.close);
      if (end < 0) { push(line, state.open.cls); return parts; }
      push(line.slice(0, end + state.open.close.length), state.open.cls);
      i = end + state.open.close.length;
      state.open = null;
    }
    let plain = '';
    const flush = () => { push(plain, ''); plain = ''; };
    while (i < line.length) {
      const rest = line.slice(i);
      if (lang.line && rest.startsWith(lang.line) && !(lang === LANGS.sh && i > 0 && /\S/.test(line[i - 1]))) { flush(); push(rest, 'tok-c'); return parts; }
      if (lang.block && rest.startsWith(lang.block[0])) {
        flush();
        const end = rest.indexOf(lang.block[1], lang.block[0].length);
        if (end < 0) { push(rest, 'tok-c'); state.open = { close: lang.block[1], cls: 'tok-c' }; return parts; }
        push(rest.slice(0, end + lang.block[1].length), 'tok-c');
        i += end + lang.block[1].length;
        continue;
      }
      const ch = line[i];
      if (lang.triple && (rest.startsWith('"""') || rest.startsWith('\'\'\''))) {
        flush();
        const q = rest.slice(0, 3);
        const end = rest.indexOf(q, 3);
        if (end < 0) { push(rest, 'tok-s'); state.open = { close: q, cls: 'tok-s' }; return parts; }
        push(rest.slice(0, end + 3), 'tok-s');
        i += end + 3;
        continue;
      }
      if (lang.quotes.includes(ch)) {
        flush();
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        push(line.slice(i, j + 1), 'tok-s');
        i = j + 1;
        continue;
      }
      if (lang.tags && ch === '<' && /^<\/?[A-Za-z]/.test(rest)) {
        flush();
        const m = /^<\/?[A-Za-z][\w:-]*/.exec(rest);
        push(m[0], 'tok-k');
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const m = /^[A-Za-z_$][\w$]*/.exec(rest);
        if (lang.words.has(m[0])) { flush(); push(m[0], 'tok-k'); } else plain += m[0];
        i += m[0].length;
        continue;
      }
      if (/\d/.test(ch) && !/[\w$]/.test(line[i - 1] || '')) {
        const m = /^(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)/i.exec(rest);
        flush();
        push(m[0], 'tok-n');
        i += m[0].length;
        continue;
      }
      plain += ch;
      i++;
    }
    flush();
    return parts;
  }

  /** The code cell of a row: coloured parts when the language is known, else plain text. */
  function codeCell(text, lang, state) {
    if (!lang || text.length > 2000) return el('span', text, 'text');
    const cell = el('span', undefined, 'text');
    for (const [t, cls] of tokenize(text, lang, state)) cell.append(cls ? el('span', t, cls) : document.createTextNode(t));
    return cell;
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
    else if (activeTab === 'apis') requestApis();
    else if (activeTab === 'health') requestHealth();
    else if (activeTab === 'project') requestProject();
    else if (activeTab === 'learn') requestLearn();
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
        // Phase 9: files with problems get a soft red (errors) or yellow (warnings) halo.
        { selector: 'node.hasError', style: { 'underlay-color': '#f14c4c', 'underlay-opacity': 0.45, 'underlay-padding': 5, 'underlay-shape': 'ellipse' } },
        { selector: 'node.hasWarning', style: { 'underlay-color': '#cca700', 'underlay-opacity': 0.4, 'underlay-padding': 5, 'underlay-shape': 'ellipse' } },
        // Phase 11: test colours (Learn tab) and imports that break a folder rule (Health tab).
        { selector: 'node.tested', style: { 'background-color': '#3fb950' } },
        { selector: 'node.untested', style: { 'background-color': '#8b949e' } },
        { selector: 'node.isTest', style: { 'background-color': '#58a6ff', shape: 'round-rectangle' } },
        { selector: 'node.breaksRule', style: { 'border-width': 3, 'border-color': '#e3742f', 'border-style': 'dashed' } },
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
    applyTestColours();
    send({ type: 'rendered', nodes: cy.nodes().length, edges: cy.edges().length });
    if (graph.nodes.length === 0) $('graphInfo').textContent = 'No JavaScript, TypeScript or Python files found in this folder.';
  }

  function clearHighlight() {
    if (cy) cy.elements().removeClass('faded used inCommit');
  }

  function runLayout() {
    if (!cy) return;
    // Counting labels in each node's size keeps file names from landing on top of each other.
    // Files without imports are laid out in a grid below the rest, so their labels never touch (Phase 12).
    const isolated = cy.nodes().filter((n) => n.degree(false) === 0);
    const connected = cy.elements().not(isolated);
    if (connected.nodes().length) connected.layout({ name: 'cose', animate: false, nodeDimensionsIncludeLabels: true, nodeRepulsion: 12000, idealEdgeLength: 70, padding: 30 }).run();
    if (isolated.length) {
      const bb = connected.nodes().length ? connected.boundingBox() : { x1: 0, y2: 0, w: 0 };
      const widest = Math.max(...isolated.map((n) => String(n.data('label')).length)) * 6 + 30;
      const width = Math.max(bb.w, 500);
      const cols = Math.max(1, Math.floor(width / widest));
      const rows = Math.ceil(isolated.length / cols);
      isolated.layout({ name: 'grid', animate: false, cols, avoidOverlap: true, nodeDimensionsIncludeLabels: true, condense: false,
        boundingBox: { x1: bb.x1, y1: bb.y2 + 50, w: cols * widest, h: rows * 45 } }).run();
    }
    cy.fit(undefined, 30);
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
      // Phase 11: a hint when the message doesn't follow the usual "type: what changed" form.
      if (c.hint) {
        const hint = el('div', '✎ ' + c.hint, 'small commit-hint');
        hint.title = 'Conventional Commits: a common way to write commit messages, like "fix: stop the login loop"';
        li.append(hint);
      }
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
    const markSafe = el('button', 'Mark as safe point');
    markSafe.id = 'markSafe';
    markSafe.title = 'Saves a small note in .vibecode/notes/ saying this commit is a good point to go back to (see the Health tab)';
    markSafe.addEventListener('click', () => send({ type: 'markSafe', id: d.id }));
    info.append(markSafe);
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
    addCopyContext(box, msg.subject);
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
    box.append(ul);
    // Phase 12: after a "No", notes stay off until the owner asks for the question again.
    if (msg.declined) {
      const again = el('button', 'Ask me again');
      again.title = 'You chose not to save notes in this folder. Click to be asked again.';
      again.addEventListener('click', () => send({ type: 'askNotesAgain' }));
      box.append(el('p', 'Notes are turned off for this folder.', 'muted small'), again);
      return;
    }
    // Phase 12: in the browser the note is written right here, on the page.
    if (msg.inPage) {
      const subject = msg.subject;
      const form = el('div', undefined, 'note-form');
      const title = /** @type {HTMLInputElement} */ (el('input'));
      title.placeholder = 'Note title';
      title.maxLength = 200;
      title.setAttribute('aria-label', 'Note title');
      const text = /** @type {HTMLTextAreaElement} */ (el('textarea'));
      text.placeholder = 'What changed, why, and what you decided';
      text.rows = 4;
      text.maxLength = 8000;
      text.setAttribute('aria-label', 'Note text');
      const save = el('button', 'Save note');
      save.title = 'Saved as a Markdown file in .vibecode/notes/';
      const status = el('p', '', 'muted small note-status');
      save.addEventListener('click', () => {
        if (!title.value.trim()) { status.textContent = 'Write a title first.'; return; }
        status.textContent = 'Saving…';
        send({ type: 'saveNote', id: subject, title: title.value.trim(), text: text.value });
      });
      form.append(title, text, save, status);
      box.append(form);
      return;
    }
    const add = el('button', 'Add note');
    add.title = 'Write down what, why and the decision. Saved as a Markdown file in .vibecode/notes/';
    add.addEventListener('click', () => send({ type: 'addNote', id: currentSubject }));
    box.append(add);
  }

  /** The message after saving a note written on the page; the list above is refreshed separately. */
  function renderNoteSaved(msg) {
    if (msg.subject !== currentSubject) return;
    const status = $('info').querySelector('.notes .note-status');
    if (status) status.textContent = msg.message;
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

  // ---- Health tab (Phase 9) ----
  function requestHealth() {
    $('healthView').replaceChildren(el('p', 'Checking the project…', 'muted'));
    send({ type: 'health' });
  }

  function renderHealth(r) {
    const view = $('healthView');
    view.replaceChildren();
    if (cy) cy.nodes().removeClass('hasError hasWarning breaksRule');
    if (r.state === 'restricted') { view.append(el('p', 'Health checks are off in Restricted Mode. Trust the workspace to see them.', 'muted')); return; }
    if (r.state !== 'ok') { view.append(el('p', 'No folder is open.', 'muted')); return; }
    view.append(el('p', 'Read-only checks: nothing is run, fixed or changed for you.', 'muted small'));

    // Checklist
    view.append(withHelp(el('h3', 'Checklist'), 'health checklist'));
    for (const c of r.checklist) {
      const row = el('div', undefined, 'check ' + c.status);
      row.append(el('span', c.status === 'ok' ? '✔' : c.status === 'warn' ? '✖' : 'i', 'mark'), el('span', `${c.title}: ${c.detail}`));
      if (c.tip) row.append(el('span', c.tip, 'tip muted small'));
      view.append(row);
    }

    // Problems
    const errors = r.problems.files.reduce((n, f) => n + f.errors, 0);
    const warnings = r.problems.files.reduce((n, f) => n + f.warnings, 0);
    const probs = el('div', undefined, 'health-section');
    probs.append(withHelp(el('h3', `Problems (${errors} errors, ${warnings} warnings)`), 'problems'));
    probs.append(el('p', 'What VS Code already found. TypeScript checks mostly the files you have opened, so open a file to check it.', 'muted small'));
    if (r.problems.files.length === 0) probs.append(el('p', 'No problems reported.', 'muted small'));
    for (const f of r.problems.files) {
      const details = /** @type {HTMLDetailsElement} */ (el('details'));
      const summary = el('summary');
      summary.append(el('span', f.file, 'mono'), el('span', ` ${f.errors ? f.errors + ' errors ' : ''}${f.warnings ? f.warnings + ' warnings' : ''}`, f.errors ? 'sev-error small' : 'sev-warning small'));
      summary.addEventListener('click', () => {
        if (!f.node || !cy) return;
        showGraph();
        highlightNodes([f.node]);
      });
      details.append(summary);
      const ul = el('ul', undefined, 'files');
      for (const p of f.items) {
        const li = el('li');
        const btn = el('button', `${p.line}: ${p.plain}`, 'link small sev-' + p.severity);
        btn.title = `${p.source ? p.source + ': ' : ''}${p.message}\nClick to open the line.`;
        btn.addEventListener('click', () => send({ type: 'healthItem', id: p.id }));
        li.append(btn, el('div', p.message, 'muted small mono'));
        ul.append(li);
      }
      details.append(ul);
      probs.append(details);
      if (f.node && cy) cy.getElementById(f.node).addClass(f.errors ? 'hasError' : 'hasWarning');
    }
    if (r.problems.truncated) probs.append(el('p', 'Only the first problems are listed.', 'muted small'));
    view.append(probs);

    // Secrets
    const sec = el('div', undefined, 'health-section');
    sec.append(withHelp(el('h3', `Secret-looking text (${r.secrets.length})`), 'secret'));
    if (r.secrets.length === 0) sec.append(el('p', 'Nothing that looks like a key or password was found in the project files.', 'muted small'));
    else sec.append(el('p', 'The values are never shown here. Click to open the line in VS Code. Move real secrets to a .env file that Git ignores, and change any that were committed.', 'muted small'));
    const sl = el('ul', undefined, 'files');
    for (const s of r.secrets) {
      const li = el('li');
      const btn = el('button', `${s.file}:${s.line}`, 'link mono small');
      btn.title = 'Opens in VS Code (never on this page)';
      btn.addEventListener('click', () => send({ type: 'healthItem', id: s.id }));
      li.append(btn, el('span', ` ${s.kind}`, 'muted small'));
      sl.append(li);
    }
    sec.append(sl);
    if (r.secretsTruncated) sec.append(el('p', 'Only the first findings are listed.', 'muted small'));
    view.append(sec);

    // Unused and duplicates
    const tidy = el('div', undefined, 'health-section');
    tidy.append(withHelp(el('h3', `Possibly unused files (${r.unused.length})`), 'possibly unused'));
    if (r.unused.length === 0) tidy.append(el('p', 'Every code file is imported by another, or is an entry point, test or config.', 'muted small'));
    const ul = el('ul', undefined, 'files');
    for (const u of r.unused) {
      const btn = el('button', u.file, 'link mono small');
      btn.addEventListener('click', () => {
        if (!u.node) return;
        showGraph();
        highlightNodes([u.node]);
        send({ type: 'inspect', id: u.node });
      });
      const li = el('li');
      li.append(btn);
      ul.append(li);
    }
    tidy.append(ul);
    tidy.append(withHelp(el('h3', `Near-duplicate names (${r.duplicates.length})`), 'near-duplicate'));
    if (r.duplicates.length === 0) tidy.append(el('p', 'No files with almost the same name in the same folder.', 'muted small'));
    for (const d of r.duplicates) {
      const btn = el('button', d.files.join('  ·  '), 'link mono small');
      btn.addEventListener('click', () => { showGraph(); highlightNodes(d.nodes); });
      tidy.append(el('div'), btn);
    }
    view.append(tidy);

    // Folder rules (Phase 11)
    const rules = el('div', undefined, 'health-section');
    const broken = r.rules.rules.reduce((n, x) => n + x.violations.length, 0);
    rules.append(withHelp(el('h3', `Folder rules (${r.rules.rules.length} rules, ${broken} broken)`), 'folder rule'));
    if (!r.rules.exists) {
      rules.append(el('p', 'Write rules like "`src/ui/` must not import `src/database/`" and every import that breaks one is listed here and marked in the graph.', 'muted small'));
      const create = el('button', 'Create rules file');
      create.title = `Creates ${r.rules.file} with two example rules and opens it in VS Code. Nothing else is changed.`;
      create.addEventListener('click', () => send({ type: 'createRules' }));
      rules.append(create);
    } else {
      const open = el('button', r.rules.file, 'link mono small');
      open.title = 'Open the rules file';
      open.addEventListener('click', () => send({ type: 'healthItem', id: r.rules.id }));
      rules.append(open);
      if (r.rules.rules.length === 0) rules.append(el('p', 'No rules in the form "`folder/` must not import `other/`" yet.', 'muted small'));
    }
    for (const rule of r.rules.rules) {
      const row = el('div', undefined, 'check ' + (rule.violations.length ? 'warn' : 'ok'));
      const btn = el('button', rule.text, 'link small');
      btn.addEventListener('click', () => send({ type: 'healthItem', id: rule.id }));
      row.append(el('span', rule.violations.length ? '✖' : '✔', 'mark'), btn);
      rules.append(row);
      const ul = el('ul', undefined, 'files');
      for (const v of rule.violations) {
        const li = el('li');
        const b = el('button', v.file, 'link mono small');
        b.addEventListener('click', () => {
          if (v.node) { showGraph(); highlightNodes([v.node]); send({ type: 'inspect', id: v.node }); }
        });
        li.append(b, el('span', ` imports ${v.imports}`, 'muted small'));
        ul.append(li);
        if (v.node && cy) cy.getElementById(v.node).addClass('breaksRule');
      }
      rules.append(ul);
    }
    view.append(rules);

    // Safe points
    const safe = el('div', undefined, 'health-section');
    safe.append(withHelp(el('h3', `Safe points (${r.safePoints.length})`), 'safe point'));
    if (!r.safeSources.git) safe.append(el('p', 'No Git history for this folder, so there are no safe points.', 'muted small'));
    else {
      safe.append(el('p', 'Commits worth going back to: tagged ones, the last commit before each AI session, and ones you marked in the History tab. The steps are only shown; nothing is run for you.', 'muted small'));
      if (!r.safeSources.sessionsAllowed) safe.append(el('p', 'Allow reading AI session logs (AI sessions tab) to also see the commit before each session.', 'muted small'));
    }
    for (const p of r.safePoints) {
      const details = /** @type {HTMLDetailsElement} */ (el('details'));
      const summary = el('summary');
      summary.append(el('span', `${p.short} ${p.headline}`, 'mono'), el('div', `${p.date ? new Date(p.date).toLocaleString() + ' · ' : ''}${p.reasons.join(' · ')}`, 'muted small'));
      details.append(summary);
      const ol = el('ol', undefined, 'steps');
      for (const step of p.steps) {
        const li = el('li', step.text);
        if (step.command) li.append(el('code', step.command));
        ol.append(li);
      }
      details.append(ol);
      safe.append(details);
    }
    view.append(safe);
  }

  // ---- Project tab (Phase 10) ----
  function requestProject() {
    $('projectView').replaceChildren(el('p', 'Reading the plan…', 'muted'));
    send({ type: 'project' });
  }

  const PHASE_MARK = { done: '✔', active: '●', todo: '○', skipped: '–' };
  const PHASE_WORD = { done: 'done', active: 'in progress', todo: 'not started', skipped: 'not planned' };

  function docLink(doc, label) {
    const btn = el('button', label || doc.file, 'link mono small');
    btn.title = 'Open ' + doc.file;
    btn.addEventListener('click', () => send({ type: 'projectItem', id: doc.id }));
    return btn;
  }

  function phaseName(p) {
    return /^\d/.test(p.id) ? `Phase ${p.id}` : p.id;
  }

  function renderProject(r) {
    const view = $('projectView');
    view.replaceChildren();
    if (r.state === 'restricted') { view.append(el('p', 'The project status is off in Restricted Mode. Trust the workspace to see it.', 'muted')); return; }
    if (r.state !== 'ok') { view.append(el('p', 'No folder is open.', 'muted')); return; }
    view.append(el('p', 'Read from the project\'s own plan files. Nothing is changed, except the issues you add, close or reopen.', 'muted small'));

    // Stage
    const stage = el('div', undefined, 'summary');
    if (r.plan) {
      const phases = r.plan.phases;
      const done = phases.filter((p) => p.state === 'done').length;
      const counted = phases.filter((p) => p.state !== 'skipped').length;
      const current = phases.find((p) => p.id === r.plan.current);
      stage.append(withHelp(el('div', current ? `Current stage: ${phaseName(current)}` : 'Every phase in the plan is done.', 'strong'), 'current stage'));
      if (current) stage.append(el('div', `${current.goal ? current.goal + ' · ' : ''}${current.status || PHASE_WORD[current.state]}`, 'muted small'));
      const bar = el('div', undefined, 'progress');
      const fill = el('div', undefined, 'progress-fill');
      fill.style.width = `${counted ? Math.round((100 * done) / counted) : 0}%`;
      bar.append(fill);
      const left = phases.filter((p) => p.state === 'active' || p.state === 'todo').length;
      const open = r.issues.filter((i) => i.state === 'open').length;
      stage.append(bar, el('div', `${done} of ${counted} phases done · ${left} left${open ? ` · ${open} open issue${open === 1 ? '' : 's'}` : ''}`, 'small'));
    } else {
      stage.append(el('div', 'No plan found.', 'strong'), el('p', 'Add a Markdown table with a "Phase" and a "Status" column to one of: ' + r.lookedFor.plan.join(', '), 'muted small'));
    }
    view.append(stage);

    // Phases
    if (r.plan) {
      const head = el('h3', `Plan (${r.plan.phases.length} phases) `);
      head.append(docLink(r.plan));
      view.append(withHelp(head, 'plan'));
      const ul = el('ul', undefined, 'commits phases');
      for (const p of r.plan.phases) {
        const li = el('li', undefined, 'phase ' + p.state + (p.id === r.plan.current ? ' current' : ''));
        const btn = el('button', `${PHASE_MARK[p.state]} ${phaseName(p)}`, 'link');
        btn.title = 'Show this phase\'s steps';
        btn.addEventListener('click', () => {
          for (const b of ul.querySelectorAll('button.selected')) b.classList.remove('selected');
          btn.classList.add('selected');
          renderPhaseDetails(p, r);
        });
        li.append(btn, el('div', p.goal, 'muted small'));
        ul.append(li);
      }
      view.append(ul);
    }

    // Requirements and log
    if (r.requirements) {
      const head = el('h3', `Requirements (${r.requirements.total}) `);
      head.append(docLink(r.requirements));
      view.append(head, el('p', r.requirements.counts.map((c) => `${c.count} ${c.status}`).join(' · '), 'small'));
    }
    if (r.log) {
      const p = el('p', 'Development log: ', 'small');
      p.append(docLink(r.log));
      view.append(p);
    }

    // Intended structure
    view.append(withHelp(el('h3', 'Intended structure'), 'intended structure'));
    if (!r.structure) {
      view.append(el('p', 'No planned folder layout found. Add a "Layout" or "Structure" section listing folders like `src/api/` to one of: ' + r.lookedFor.structure.join(', '), 'muted small'));
    } else {
      const from = el('p', `${r.structure.planned.length} planned folders, from `, 'muted small');
      from.append(docLink(r.structure));
      view.append(from);
      if (r.structure.unplanned.length === 0) view.append(el('p', '✔ Every folder is in the plan.', 'small'));
      else {
        view.append(el('p', `✖ ${r.structure.unplanned.length} folder${r.structure.unplanned.length === 1 ? ' is' : 's are'} not in the plan. If an AI made them, check they belong there; otherwise add them to the plan.`, 'small sev-warning'));
        const ul = el('ul', undefined, 'files');
        for (const f of r.structure.unplanned) {
          const btn = el('button', f + '/', 'link mono small');
          btn.title = 'Show this folder\'s files in the graph';
          btn.addEventListener('click', () => {
            showGraph();
            highlightNodes(cy ? cy.nodes().filter((n) => (n.data('path') || '').startsWith(f + '/')).map((n) => n.id()) : []);
          });
          const li = el('li');
          li.append(btn);
          ul.append(li);
        }
        view.append(ul);
      }
      if (r.structure.missing.length) view.append(el('p', `Planned but not created yet: ${r.structure.missing.map((m) => m + '/').join(', ')}`, 'muted small'));
    }

    // Issues
    const openIssues = r.issues.filter((i) => i.state === 'open');
    const closedIssues = r.issues.filter((i) => i.state === 'closed');
    view.append(withHelp(el('h3', `Issues (${openIssues.length} open)`), 'issue'));
    if (r.issues.length === 0) view.append(el('p', 'No issues yet.', 'muted small'));
    else if (openIssues.length === 0) view.append(el('p', 'No open issues.', 'muted small'));
    view.append(issueList(openIssues));
    if (closedIssues.length) view.append(el('h3', `Closed (${closedIssues.length})`), issueList(closedIssues));
    view.append(issueForm());
  }

  /** Phase 13: each issue opens on click and has a Close or Reopen button. */
  function issueList(issues) {
    const ul = el('ul', undefined, 'files');
    for (const i of issues) {
      const closed = i.state === 'closed';
      const li = el('li', undefined, closed ? 'closed' : '');
      const btn = el('button', `${closed ? '✔ ' : ''}${i.title}`, 'link');
      btn.title = 'Open ' + i.path;
      btn.addEventListener('click', () => send({ type: 'projectItem', id: i.id }));
      const toggle = el('button', closed ? 'Reopen' : 'Close', 'issue-toggle');
      toggle.title = `${closed ? 'Reopen' : 'Close'} this issue: changes only the "issue:" line of ${i.path}`;
      toggle.addEventListener('click', () => {
        toggle.setAttribute('disabled', '');
        send({ type: 'setIssue', id: i.id, state: closed ? 'open' : 'closed' });
      });
      li.append(btn);
      if (i.created) li.append(el('span', i.created, 'muted small note-date'));
      li.append(toggle);
      ul.append(li);
    }
    return ul;
  }

  function issueForm() {
    const form = el('div', undefined, 'note-form');
    const title = /** @type {HTMLInputElement} */ (el('input'));
    title.placeholder = 'New issue: what needs doing?';
    title.maxLength = 200;
    title.setAttribute('aria-label', 'Issue title');
    const text = /** @type {HTMLTextAreaElement} */ (el('textarea'));
    text.placeholder = 'Details (optional)';
    text.rows = 3;
    text.maxLength = 8000;
    text.setAttribute('aria-label', 'Issue details');
    const save = el('button', 'Add issue');
    save.title = 'Saved as a Markdown file in .vibecode/notes/. Your plan files are never changed.';
    const status = el('p', '', 'muted small');
    status.id = 'issueStatus';
    save.addEventListener('click', () => {
      if (!title.value.trim()) { status.textContent = 'Write a title first.'; return; }
      status.textContent = 'Saving…';
      send({ type: 'addIssue', title: title.value.trim(), text: text.value });
    });
    form.append(title, text, save, status);
    return form;
  }

  function renderPhaseDetails(p, r) {
    currentSubject = '';
    pendingSymbol = '';
    pendingCommit = '';
    pendingSession = '';
    const info = $('info');
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    row('Status', p.status || PHASE_WORD[p.state]);
    if (p.goal) row('Goal', p.goal);
    for (const x of p.extra) row(x.name, x.value);
    info.replaceChildren(el('h2', phaseName(p)), rows);
    info.append(withHelp(el('h3', 'Steps'), 'workflow'));
    for (const s of p.steps) {
      const line = el('div', undefined, 'check ' + (s.done ? 'ok' : 'warn'));
      line.append(el('span', s.done ? '✔' : '○', 'mark'), el('span', s.name));
      info.append(line);
    }
    info.append(el('p', 'Ticked from the words in the status column and the development log, so they are only as up to date as those files.', 'muted small'));
    if (r.plan) info.append(docLink(r.plan, 'Open the plan'));
  }

  // ---- Learn tab (Phase 11) ----
  function requestLearn() {
    $('learnView').replaceChildren(el('p', 'Working out a reading order, tests, TODOs, packages and how to run…', 'muted'));
    send({ type: 'learn' });
  }

  /** A file name that selects its graph node and shows its details. */
  function fileButton(file, node, extra) {
    const btn = el('button', file, 'link mono small');
    btn.addEventListener('click', () => {
      if (!node) return;
      showGraph();
      highlightNodes([node]);
      send({ type: 'inspect', id: node });
    });
    const li = el('li');
    li.append(btn);
    if (extra) li.append(el('span', ' ' + extra, 'muted small'));
    return li;
  }

  /** A list that shows the first `max` items and a "Show all" button for the rest. */
  function shortList(items, max, render) {
    const ul = el('ul', undefined, 'files');
    const show = (n) => ul.replaceChildren(...items.slice(0, n).map(render));
    show(max);
    if (items.length <= max) return ul;
    const wrap = el('div');
    const more = el('button', `Show all ${items.length}`, 'link small');
    more.addEventListener('click', () => { show(items.length); more.remove(); });
    wrap.append(ul, more);
    return wrap;
  }

  let testColours = false;
  /** @type {any} */
  let lastTests;
  function applyTestColours() {
    if (!cy) return;
    cy.nodes().removeClass('tested untested isTest');
    if (!testColours || !lastTests) return;
    for (const t of lastTests.tested) if (t.node) cy.getElementById(t.node).addClass('tested');
    for (const t of lastTests.untested) if (t.node) cy.getElementById(t.node).addClass('untested');
    for (const t of lastTests.testFiles) if (t.node) cy.getElementById(t.node).addClass('isTest');
  }

  function renderLearn(r) {
    const view = $('learnView');
    view.replaceChildren();
    if (r.state === 'restricted') { view.append(el('p', 'Learning aids are off in Restricted Mode. Trust the workspace to see them.', 'muted')); return; }
    if (r.state !== 'ok') { view.append(el('p', 'No folder is open.', 'muted')); return; }
    view.append(el('p', 'Worked out from the code and Git: nothing is run or changed. Commands are only shown, for you to copy.', 'muted small'));

    // How to run
    view.append(withHelp(el('h3', 'How to run'), 'how to run'));
    if (r.run.length === 0 && r.readme.length === 0) view.append(el('p', 'No package.json scripts, Python entry files or README commands found.', 'muted small'));
    const ol = el('ol', undefined, 'steps');
    for (const step of r.run) {
      const li = el('li', step.text);
      if (step.command) li.append(el('code', step.command));
      ol.append(li);
    }
    view.append(ol);
    if (r.readme.length) {
      view.append(el('p', 'From the README:', 'muted small'));
      const pre = el('pre', r.readme.join('\n'), 'readme-commands');
      view.append(pre);
    }

    // Reading order
    view.append(withHelp(el('h3', `Reading order (${r.reading.length})`), 'reading order'));
    if (r.reading.length === 0) view.append(el('p', 'No code files in the graph.', 'muted small'));
    else view.append(el('p', 'Start at the top: files that start things, then what they use, down to small helpers.', 'muted small'));
    view.append(shortList(r.reading, 15, (s) => {
      const li = fileButton(s.file, s.node, s.reason);
      li.classList.add('depth-' + Math.min(Math.max(s.depth, 0), 4));
      return li;
    }));

    // Test map
    lastTests = r.tests;
    const total = r.tests.tested.length + r.tests.untested.length;
    view.append(withHelp(el('h3', `Test map (${r.tests.tested.length} of ${total} files have a test)`), 'test map'));
    const toggle = el('button', testColours ? 'Hide test colours in the graph' : 'Show test colours in the graph');
    toggle.addEventListener('click', () => {
      testColours = !testColours;
      toggle.textContent = testColours ? 'Hide test colours in the graph' : 'Show test colours in the graph';
      showGraph();
      applyTestColours();
    });
    view.append(toggle, el('p', 'A file has a test when a test file imports it or is named after it (app.ts → app.test.ts, test_app.py).', 'muted small'));
    if (r.tests.untested.length) {
      view.append(el('div', `No test found (${r.tests.untested.length})`, 'small strong'));
      view.append(shortList(r.tests.untested, 10, (t) => fileButton(t.file, t.node)));
    }
    if (r.tests.tested.length) {
      view.append(el('div', `Tested (${r.tests.tested.length})`, 'small strong'));
      view.append(shortList(r.tests.tested, 10, (t) => fileButton(t.file, t.node, '← ' + t.tests.map((x) => x.split('/').pop()).join(', '))));
    }
    applyTestColours();

    // TODO list
    view.append(withHelp(el('h3', `TODO list (${r.todos.length}${r.todosTruncated ? '+' : ''})`), 'todo'));
    if (r.todos.length === 0) view.append(el('p', 'No TODO, FIXME or HACK comments found.', 'muted small'));
    view.append(shortList(r.todos, 20, (t) => {
      const li = el('li');
      const btn = el('button', `${t.file}:${t.line}`, 'link mono small');
      btn.title = 'Open the line';
      btn.addEventListener('click', () => send({ type: 'learnItem', id: t.id }));
      li.append(el('span', t.tag + ' ', 'tag'), btn, el('div', t.text || '(no text)', 'muted small'));
      return li;
    }));

    // Packages
    view.append(withHelp(el('h3', `Packages (${r.packages.length})`), 'package'));
    if (r.packages.length === 0) view.append(el('p', 'No package.json or requirements.txt packages found.', 'muted small'));
    const USED = { imported: 'imported by the code', types: 'type information for another package', scripts: 'used by a script', 'not found': 'not imported anywhere: maybe unused, or used by a tool or config' };
    view.append(shortList(r.packages, 25, (p) => {
      const li = el('li');
      li.append(el('span', `${p.name} `, 'mono small'), el('span', `${p.version}${p.dev ? ' · dev' : ''}${p.license ? ' · ' + p.license : ''}`, 'muted small'));
      if (p.description) li.append(el('div', p.description, 'small'));
      li.append(el('div', (p.used === 'not found' ? '? ' : '') + USED[p.used] + (p.ecosystem === 'npm' && p.installed === false ? ' · not installed' : ''), p.used === 'not found' ? 'small sev-warning' : 'muted small'));
      return li;
    }));

    // Hotspots
    view.append(withHelp(el('h3', 'Hotspots'), 'hotspot'));
    const box = el('div');
    box.id = 'hotspots';
    const find = el('button', 'Find hotspots');
    find.title = 'Looks through the latest 100 commits (this can take a few seconds)';
    find.addEventListener('click', () => {
      box.replaceChildren(el('p', 'Reading the latest commits…', 'muted small'));
      send({ type: 'hotspots' });
    });
    box.append(find, el('p', 'Files changed most often. Files often changed in "fix" commits are worth a closer look or a test.', 'muted small'));
    view.append(box);
  }

  function renderHotspots(r) {
    const box = document.getElementById('hotspots');
    if (!box) return;
    box.replaceChildren();
    if (r.state !== 'ok') { box.append(el('p', r.state === 'noGit' ? 'No Git history for this folder.' : 'Off in Restricted Mode.', 'muted small')); return; }
    box.append(el('p', `From the latest ${r.commits} commits.`, 'muted small'));
    if (r.hotspots.length === 0) box.append(el('p', 'No file changed more than once.', 'muted small'));
    const nodeOf = new Map(cy ? cy.nodes().map((n) => [n.data('path'), n.id()]) : []);
    const ul = el('ul', undefined, 'files');
    for (const h of r.hotspots) ul.append(fileButton(h.file, nodeOf.get(h.file), `${h.changes} changes${h.fixes ? ` · ${h.fixes} in fixes` : ''}`));
    box.append(ul);
  }

  /** "Copy context for AI" below a file's plain-words explanation. */
  function addCopyContext(box, subject) {
    const btn = el('button', 'Copy context for AI');
    btn.title = 'Copies a short summary of this file (what it does, what it uses and what uses it) to paste into an AI chat, so the agent needs to read less';
    btn.addEventListener('click', () => send({ type: 'copyContext', id: subject }));
    box.append(btn);
  }

  function renderContextCopied(msg) {
    if (msg.id !== currentSubject) return;
    const box = /** @type {HTMLElement | null} */ ($('info').querySelector('.explain'));
    if (!box) return;
    box.querySelector('.copied')?.remove();
    const wrap = el('div', undefined, 'copied');
    wrap.append(el('p', 'Copied. Paste it into your AI chat:', 'small'), el('pre', msg.text, 'context-text'));
    box.append(wrap);
  }

  // ---- Preview next to the code (Phase 8, browser view only) ----
  /** Address of the page shown in the preview. */
  let previewUrl = '';

  function hidePreview() {
    const view = document.getElementById('previewView');
    if (!view) return;
    view.hidden = true;
    /** @type {HTMLIFrameElement} */ ($('previewFrame')).removeAttribute('src');
    $('codeView').parentElement?.classList.remove('split');
  }

  /** Only local http(s) pages are shown; the extension already checked this, the page checks again. */
  function isLocalUrl(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) && /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  function renderPagePreview(msg) {
    const view = document.getElementById('previewView');
    if (!view || msg.for !== pendingCode || !isLocalUrl(msg.url)) return;
    previewUrl = msg.url;
    const link = /** @type {HTMLAnchorElement} */ ($('previewOpen'));
    link.href = msg.url;
    link.textContent = msg.url;
    /** @type {HTMLIFrameElement} */ ($('previewFrame')).src = msg.url;
    view.hidden = false;
    $('codeView').parentElement?.classList.add('split');
  }
  document.getElementById('previewClose')?.addEventListener('click', () => hidePreview());
  document.getElementById('previewReload')?.addEventListener('click', () => {
    if (previewUrl) /** @type {HTMLIFrameElement} */ ($('previewFrame')).src = previewUrl;
  });

  function renderPreviewError(msg) {
    const box = /** @type {HTMLElement | null} */ ($('info').querySelector('.preview-error'));
    if (box && msg.for === box.dataset.for) {
      box.textContent = msg.message;
      box.hidden = false;
    }
  }

  function renderPageDetails(item) {
    currentSubject = '';
    pendingSymbol = '';
    pendingCommit = '';
    pendingSession = '';
    const info = $('info');
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    info.replaceChildren(withHelp(el('h2', 'Page'), 'page'));
    row('Address', item.path);
    row('Kind', item.kind);
    row('Main file', `${item.file}:${item.line}`);
    if (item.template) row('Template', item.template);
    info.append(rows);
    if (item.missing) info.append(el('p', `Named in the code but not found in this folder: ${item.missing}`, 'muted small'));

    // The address can be edited, for example to give `:id` a value.
    const form = el('div', undefined, 'page-path');
    const input = /** @type {HTMLInputElement} */ (el('input'));
    input.value = item.path;
    input.setAttribute('aria-label', 'Page address to preview');
    input.spellcheck = false;
    const preview = el('button', 'Preview');
    preview.title = 'Open this page in your running app, next to its code';
    const go = () => send({ type: 'previewPage', id: item.id, path: input.value.trim() });
    preview.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') go(); });
    form.append(input, preview);
    info.append(form);
    if (item.needsValue) info.append(el('p', 'This address has a part that needs a value (like :id or [id]). Replace it before previewing.', 'muted small'));
    const err = el('p', '', 'preview-error small');
    err.dataset.for = item.id;
    err.hidden = true;
    const open = el('button', 'Open code');
    open.addEventListener('click', () => send({ type: 'apiItem', id: item.id }));
    info.append(err, open, el('p', 'Preview uses the address in the vibecodeExplorer.previewUrl setting. Start your app yourself first.', 'muted small'));

    info.append(el('h3', `Files that make this page (${item.files.length + 1})`));
    const ul = el('ul', undefined, 'files');
    for (const f of [item.file, ...item.files]) ul.append(el('li', f, 'mono'));
    info.append(ul);
  }

  // ---- APIs tab (Phase 7) ----
  function renderApis(r) {
    const view = $('apisView');
    view.replaceChildren();
    if (r.state === 'restricted') { view.append(el('p', 'APIs are off in Restricted Mode. Trust the workspace to see them.', 'muted')); return; }
    if (r.state !== 'ok') { view.append(el('p', 'No folder is open.', 'muted')); return; }
    view.append(el('p', 'Found by reading the code: nothing is run, called or connected. Click an item to see its files in the graph, double-click to open its code.', 'muted small'));
    if (r.truncated) view.append(el('p', 'This project has many items; only the first ones are listed.', 'muted small'));
    const routeById = new Map(r.routes.map((x) => [x.id, x]));
    const routeLabel = (id) => { const rt = routeById.get(id); return rt ? `${rt.method} ${rt.path}` : ''; };
    const section = (title, term, items, empty, row) => {
      view.append(withHelp(el('h3', `${title} (${items.length})`), term));
      if (items.length === 0) { view.append(el('p', empty, 'muted small')); return; }
      const ul = el('ul', undefined, 'commits api-list');
      for (const item of items) {
        const li = el('li');
        const [label, sub] = row(item);
        const btn = el('button', label, 'link mono');
        btn.title = 'Click: show in the graph. Double-click: open the code.';
        btn.addEventListener('click', () => {
          for (const b of view.querySelectorAll('button.selected')) b.classList.remove('selected');
          btn.classList.add('selected');
          showGraph();
          highlightNodes(item.nodes);
          if (item.id.startsWith('g')) renderPageDetails(item);
          else renderApiDetails(item, routeById);
        });
        btn.addEventListener('dblclick', () => send({ type: 'apiItem', id: item.id }));
        li.append(btn, el('div', sub, 'muted small'));
        ul.append(li);
      }
      view.append(ul);
    };
    const where = (x) => `${x.file}:${x.line}`;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    section('Pages', 'page', r.pages, 'No pages found (Next.js, React or Vue Router, HTML files, server templates).',
      (x) => [x.path, `${x.kind} · ${where(x)} · ${plural(x.files.length + 1, 'file')}` + (x.missing ? ' · something not found' : '')]);
    section('Routes', 'route', r.routes, 'No routes found (Express, Fastify, Hono, Next.js, FastAPI, Flask, Django).',
      (x) => [`${x.method} ${x.path}`, `${x.framework} · ${where(x)} · ${plural(x.callers.length, 'calling file')}`]);
    section('HTTP calls', 'http call', r.calls, 'No fetch, axios, requests or httpx calls found.',
      (x) => [`${x.method} ${x.url || '(address computed while running)'}`,
        `${x.client} · ${where(x)} · ` + (x.routes.length ? `→ ${x.routes.map(routeLabel).join(', ')}` : x.external ? 'another server' : 'no matching route found')]);
    section('Database', 'database model', r.models, 'No SQL tables, Prisma models or ORM models found.',
      (x) => [`${x.name}${x.table && x.table !== x.name ? ` (table ${x.table})` : ''}`, `${x.kind} · ${where(x)}` + (x.usedBy.length ? ` · used by ${plural(x.usedBy.length, 'file')}` : '')]);
  }

  function renderApiDetails(item, routeById) {
    currentSubject = '';
    pendingSymbol = '';
    pendingCommit = '';
    pendingSession = '';
    const info = $('info');
    const rows = el('dl');
    const row = (k, v) => rows.append(el('dt', k), el('dd', v));
    const list = (title, files) => {
      info.append(el('h3', `${title} (${files.length})`));
      const ul = el('ul', undefined, 'files');
      for (const f of files) ul.append(el('li', f, 'mono'));
      info.append(ul);
    };
    const open = el('button', 'Open code');
    open.addEventListener('click', () => send({ type: 'apiItem', id: item.id }));
    if (item.id.startsWith('w')) {
      info.replaceChildren(withHelp(el('h2', 'Route'), 'route'));
      rows.append(withHelp(el('dt', 'Method'), 'http method'), el('dd', item.method));
      row('Path', item.path);
      row('Framework', item.framework);
      row('Defined in', `${item.file}:${item.line}`);
      info.append(rows, open);
      list('Called from', item.callers);
      if (item.callers.length === 0) info.append(el('p', 'No call to this route was found in this folder. It may be called by another app, or with an address built while the program runs.', 'muted small'));
    } else if (item.id.startsWith('x')) {
      info.replaceChildren(withHelp(el('h2', 'HTTP call'), 'http call'));
      rows.append(withHelp(el('dt', 'Method'), 'http method'), el('dd', item.method));
      row('Address', item.url || '(computed while running)');
      row('Client', item.client);
      row('In', `${item.file}:${item.line}`);
      info.append(rows, open);
      info.append(el('h3', `Matching routes (${item.routes.length})`));
      const ul = el('ul', undefined, 'files');
      for (const id of item.routes) {
        const rt = routeById.get(id);
        if (rt) ul.append(el('li', `${rt.method} ${rt.path} (${rt.file}:${rt.line})`, 'mono'));
      }
      info.append(ul);
      if (item.routes.length === 0) info.append(el('p', item.external ? 'This calls another server, not this project.' : 'No route in this folder matches. The server may be another project, or the address is built while the program runs. A * stands for a part computed while running.', 'muted small'));
    } else {
      info.replaceChildren(withHelp(el('h2', 'Database model'), 'database model'));
      row('Name', item.name);
      if (item.table) row('Table', item.table);
      row('Kind', item.kind);
      row('Defined in', `${item.file}:${item.line}`);
      info.append(rows, open);
      list('Used by', item.usedBy);
      if (item.kind === 'SQL table') info.append(el('p', 'Files that use a SQL table are not traced: queries are text inside the code.', 'muted small'));
    }
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
