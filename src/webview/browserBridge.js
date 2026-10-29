// @ts-check
// Browser view only (Phase 6b). Stands in for VS Code's webview API so dashboard.js runs
// unchanged: messages to the extension go out as same-origin POSTs, and messages from the
// extension arrive over a same-origin event stream. Loaded before dashboard.js.
(function () {
  let client = '';
  let connectedOnce = false;
  /** Messages sent before the stream said hello. */
  const queue = [];

  function deliver(message) {
    void fetch('./message?c=' + encodeURIComponent(client), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      credentials: 'omit',
      cache: 'no-store',
    }).catch(() => undefined);
  }

  /** @type {any} */ (window).acquireVsCodeApi = () => ({
    postMessage: (message) => (client ? deliver(message) : queue.push(message)),
    getState: () => undefined,
    setState: () => undefined,
  });

  function banner(text) {
    const b = document.getElementById('banner');
    if (!b) return;
    b.textContent = text;
    b.hidden = !text;
  }

  const events = new EventSource('./events');
  events.addEventListener('hello', (e) => {
    client = JSON.parse(/** @type {MessageEvent} */ (e).data).client;
    banner('');
    // After a reconnect the extension has a fresh session: ask it for the state again.
    if (connectedOnce) queue.push({ type: 'ready' });
    connectedOnce = true;
    for (const m of queue.splice(0)) deliver(m);
  });
  events.onmessage = (e) => window.dispatchEvent(new MessageEvent('message', { data: JSON.parse(e.data) }));
  events.addEventListener('stopped', () => {
    events.close();
    banner('The browser view has stopped. In VS Code, click "Open in Browser" again.');
  });
  events.onerror = () => {
    client = '';
    if (events.readyState === EventSource.CLOSED) banner('The browser view has stopped. In VS Code, click "Open in Browser" again.');
    else banner('Lost the connection to VS Code. Trying again…');
  };
})();
