// The dashboard page, shared by the VS Code panel and the browser view (Phase 6b).

export interface PageOptions {
  mode: 'vscode' | 'browser';
  nonce: string;
  /** Content-Security-Policy for the page. */
  csp: string;
  /** URL of a file under the extension folder, e.g. asset('src', 'webview', 'dashboard.js'). */
  asset: (...parts: string[]) => string;
}

export function dashboardHtml(o: PageOptions): string {
  const browser = o.mode === 'browser';
  // The stylesheet id stops Cytoscape from injecting an inline <style>, which the CSP would block.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${o.csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
${browser ? `<link rel="stylesheet" href="${o.asset('src', 'webview', 'browser.css')}">\n` : ''}<link id="__________cytoscape_stylesheet" rel="stylesheet" href="${o.asset('src', 'webview', 'dashboard.css')}">
<title>VibeCode Explorer</title>
</head>
<body data-mode="${o.mode}">
<header class="toolbar">
  <strong>VibeCode Explorer</strong>
  <label>Folder <select id="folder"></select></label>
  <button id="refresh" title="Re-read Git status and rescan imports">Refresh</button>
  <button id="preview" title="Open the configured local app URL">Open Preview</button>
  ${browser ? '' : '<button id="openBrowser" title="Show this dashboard in your web browser (this computer only)">Open in Browser</button>'}
  <span id="status" class="muted"></span>
</header>
<div id="banner" class="banner" hidden></div>
<main class="layout">
  <section class="pane" id="changesPane">
    <div class="tabs" role="tablist">
      <button id="tabChanges" class="tab active" role="tab" aria-selected="true">Workspace changes</button>
      <button id="tabHistory" class="tab" role="tab" aria-selected="false">History</button>
      <button id="tabSessions" class="tab" role="tab" aria-selected="false">AI sessions</button>
      <button id="tabFiles" class="tab" role="tab" aria-selected="false">Files</button>
      <button id="tabApis" class="tab" role="tab" aria-selected="false">Pages &amp; APIs</button>
      <button id="tabHealth" class="tab" role="tab" aria-selected="false">Health</button>
    </div>
    <div id="changesView">
      <div id="repo" class="muted"></div>
      <div id="changes"></div>
    </div>
    <div id="historyView" hidden>
      <div id="historyInfo" class="muted"></div>
      <ul id="commits" class="commits"></ul>
      <button id="moreHistory" hidden>Load more</button>
    </div>
    <div id="sessionsView" hidden></div>
    <div id="filesView" hidden>
      <div class="file-tools">
        <button id="expandAll" title="Open every folder">Expand all</button>
        <button id="collapseAll" title="Close every folder">Collapse all</button>
      </div>
      <div id="filesInfo" class="muted"></div>
      <div id="fileTree" class="file-tree" role="tree"></div>
    </div>
    <div id="apisView" hidden></div>
    <div id="healthView" hidden></div>
  </section>
  <section class="pane graph-pane">
    <div class="graph-tools" id="graphTools">
      <h2>File dependencies</h2>
      <button id="fit" title="Fit graph to screen">Fit</button>
      <button id="zoomIn" title="Zoom in">+</button>
      <button id="zoomOut" title="Zoom out">−</button>
      <button id="layout" title="Re-run layout">Re-layout</button>
      <span id="graphInfo" class="muted"></span>
    </div>
    <div id="graph"></div>
    <div class="legend muted" id="legend">
      <span class="dot file"></span>file <span class="dot changed"></span>changed <span class="dot untracked"></span>new <span class="dot unknown"></span>unknown import <span class="dot used"></span>uses selected symbol <span class="dot commit"></span>in selected commit, session or folder <span class="dot cycle"></span>circular import <span class="dot problem"></span>has problems (Health tab)
    </div>
${browser ? `    <div id="codeView" class="code-view" hidden>
      <div class="graph-tools">
        <button id="codeBack" title="Show the dependency graph again">Back to graph</button>
        <button id="codeEditor" title="Open the same file or comparison in VS Code">Open in VS Code</button>
        <strong id="codeTitle" class="mono"></strong>
      </div>
      <p id="codeNote" class="muted code-note" hidden></p>
      <div id="codeBody" class="code-body" role="region" aria-label="Code"></div>
    </div>
    <div id="previewView" class="preview-view" hidden>
      <div class="graph-tools">
        <strong>Preview</strong>
        <a id="previewOpen" class="mono small" target="_blank" rel="noopener noreferrer" title="Open this page in a new browser tab"></a>
        <button id="previewReload" title="Load the page again">Reload</button>
        <button id="previewClose" title="Close the preview">Close preview</button>
      </div>
      <iframe id="previewFrame" class="preview-frame" title="App preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>
      <p class="muted small preview-note">Blank? Start your app first. Some apps don't allow being shown inside another page; then use the link above.</p>
    </div>
` : ''}  </section>
  <aside class="pane" id="info"><h2>Details</h2><p class="muted">Select a file in the graph or the changes list.</p></aside>
</main>
${browser ? `<script nonce="${o.nonce}" src="${o.asset('src', 'webview', 'browserBridge.js')}"></script>\n` : ''}<script nonce="${o.nonce}" src="${o.asset('node_modules', 'cytoscape', 'dist', 'cytoscape.min.js')}"></script>
<script nonce="${o.nonce}" src="${o.asset('src', 'webview', 'dashboard.js')}"></script>
</body>
</html>`;
}
