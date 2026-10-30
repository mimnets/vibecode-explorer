// Every message from the webview is untrusted input. Files are referenced only by
// opaque ids issued by the extension host, never by path.

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'preview' }
  /** Show the dashboard in the owner's web browser (Phase 6b). */
  | { type: 'openInBrowser' }
  | { type: 'selectFolder'; index: number }
  | { type: 'open'; id: string }
  | { type: 'inspect'; id: string }
  /** Jump to a symbol (`s…`) and list where it is used. */
  | { type: 'symbol'; id: string }
  /** Jump to a symbol (`s…`) or usage (`r…`) location. */
  | { type: 'goto'; id: string }
  /** Load the latest `limit` commits (Phase 3 history). */
  | { type: 'history'; limit: number }
  /** Show a commit (`k…`) and the files it touched. */
  | { type: 'commit'; id: string }
  /** Open a file of the shown commit (`h…`) as a before/after diff. */
  | { type: 'commitFile'; id: string }
  /** Add a note to the file or commit shown in Details (its `f…`/`c…`/`k…` id). */
  | { type: 'addNote'; id: string }
  /** Browser view (Phase 6c): open a file, commit file or symbol (`f…`/`c…`/`h…`/`s…`/`r…`) in VS Code's editor rather than on the page. */
  | { type: 'openInEditor'; id: string }
  /** Open a note (`n…`) in the editor. */
  | { type: 'openNote'; id: string }
  /** Load the AI session list (Phase 4b); `allowSessions` first asks the owner for permission. */
  | { type: 'sessions' }
  | { type: 'allowSessions' }
  /** List the folder's files for the Files tab (Phase 6d). */
  | { type: 'files' }
  /** Find routes, HTTP calls and database models for the APIs tab (Phase 7). */
  | { type: 'apis' }
  /** Show where a route (`w…`), call (`x…`) or model (`m…`) is defined. */
  | { type: 'apiItem'; id: string }
  /** Health tab (Phase 9): load the checks, open a problem or secret location (`y…`), mark a commit (`k…`) safe. */
  | { type: 'health' }
  | { type: 'healthItem'; id: string }
  | { type: 'markSafe'; id: string }
  /** Project tab (Phase 10): load the plan, open a plan file or issue (`j…`), save a new issue. */
  | { type: 'project' }
  | { type: 'projectItem'; id: string }
  | { type: 'addIssue'; title: string; text: string }
  /** Preview a page (`g…`) at an address the owner may have edited (Phase 8). */
  | { type: 'previewPage'; id: string; path: string }
  /** Show one AI session (`a…`). */
  | { type: 'session'; id: string }
  /** Sent by the webview after drawing the graph, or when a script error occurs. */
  | { type: 'rendered'; nodes: number; edges: number }
  | { type: 'webviewError'; message: string };

const ID_PATTERN = /^[a-z]\d{1,6}$/;

export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'ready':
    case 'refresh':
    case 'preview':
    case 'openInBrowser':
    case 'sessions':
    case 'allowSessions':
    case 'files':
    case 'apis':
    case 'health':
    case 'project':
      return { type: msg.type };
    case 'selectFolder':
      return Number.isInteger(msg.index) && (msg.index as number) >= 0 && (msg.index as number) < 1000
        ? { type: 'selectFolder', index: msg.index as number }
        : undefined;
    case 'history':
      return Number.isInteger(msg.limit) && (msg.limit as number) >= 1 && (msg.limit as number) <= 200
        ? { type: 'history', limit: msg.limit as number }
        : undefined;
    case 'open':
    case 'inspect':
    case 'symbol':
    case 'goto':
    case 'commit':
    case 'commitFile':
    case 'addNote':
    case 'openNote':
    case 'openInEditor':
    case 'apiItem':
    case 'healthItem':
    case 'markSafe':
    case 'projectItem':
    case 'session':
      return typeof msg.id === 'string' && ID_PATTERN.test(msg.id) ? { type: msg.type, id: msg.id } : undefined;
    case 'previewPage':
      return typeof msg.id === 'string' && ID_PATTERN.test(msg.id) && typeof msg.path === 'string' && msg.path.length <= 512
        ? { type: 'previewPage', id: msg.id, path: msg.path }
        : undefined;
    case 'addIssue':
      return typeof msg.title === 'string' && msg.title.trim() && msg.title.length <= 200 && typeof msg.text === 'string' && msg.text.length <= 8000
        ? { type: 'addIssue', title: msg.title, text: msg.text }
        : undefined;
    case 'rendered':
      return Number.isInteger(msg.nodes) && Number.isInteger(msg.edges)
        ? { type: 'rendered', nodes: msg.nodes as number, edges: msg.edges as number }
        : undefined;
    case 'webviewError':
      return typeof msg.message === 'string' ? { type: 'webviewError', message: msg.message.slice(0, 500) } : undefined;
    default:
      return undefined;
  }
}
