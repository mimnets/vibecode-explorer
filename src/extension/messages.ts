// Every message from the webview is untrusted input. Files are referenced only by
// opaque ids issued by the extension host, never by path.

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'preview' }
  | { type: 'selectFolder'; index: number }
  | { type: 'open'; id: string }
  | { type: 'inspect'; id: string }
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
      return { type: msg.type };
    case 'selectFolder':
      return Number.isInteger(msg.index) && (msg.index as number) >= 0 && (msg.index as number) < 1000
        ? { type: 'selectFolder', index: msg.index as number }
        : undefined;
    case 'open':
    case 'inspect':
      return typeof msg.id === 'string' && ID_PATTERN.test(msg.id) ? { type: msg.type, id: msg.id } : undefined;
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
