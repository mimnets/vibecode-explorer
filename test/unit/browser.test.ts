import { strict as assert } from 'assert';
import { test } from 'node:test';
import { browserCsp, checkRequest, framableOrigin, GuardInput, newKey } from '../../src/extension/browserGuard';
import { dashboardHtml } from '../../src/extension/page';

const key = newKey();
const port = 51234;
const client = 'a'.repeat(32);
const base: GuardInput = {
  method: 'GET', url: `/${key}/`, host: `127.0.0.1:${port}`, origin: undefined, secFetchSite: undefined,
  contentType: undefined, port, keys: new Set([key]),
};
const post: GuardInput = {
  ...base, method: 'POST', url: `/${key}/message?c=${client}`, origin: `http://127.0.0.1:${port}`,
  secFetchSite: 'same-origin', contentType: 'application/json',
};

test('keys are long and random', () => {
  assert.ok(key.length >= 43);
  assert.notEqual(newKey(), newKey());
});

test('requests with the key, the right Host and the right Origin are allowed', () => {
  assert.deepEqual(checkRequest(base), { ok: true, route: 'page' });
  assert.deepEqual(checkRequest({ ...base, host: `localhost:${port}` }), { ok: true, route: 'page' });
  assert.deepEqual(checkRequest({ ...base, url: `/${key}/events` }), { ok: true, route: 'events' });
  assert.deepEqual(checkRequest({ ...base, url: `/${key}/a/dashboard.js`, secFetchSite: 'same-origin' }), { ok: true, route: 'asset', asset: 'dashboard.js' });
  assert.deepEqual(checkRequest(post), { ok: true, route: 'message', client });
});

test('everything else is refused', () => {
  const status = (over: Partial<GuardInput>) => {
    const r = checkRequest({ ...base, ...over });
    return r.ok ? 'ok' : r.status;
  };
  assert.equal(status({ url: '/' }), 404, 'no key');
  assert.equal(status({ url: `/${newKey()}/` }), 404, 'wrong key');
  assert.equal(status({ url: `/${key.slice(0, -1)}/` }), 404, 'almost the key');
  assert.equal(status({ host: `evil.example:${port}` }), 421, 'DNS rebinding');
  assert.equal(status({ host: '127.0.0.1:80' }), 421, 'other port');
  assert.equal(status({ host: undefined }), 421);
  assert.equal(status({ secFetchSite: 'cross-site' }), 403, 'loaded by another site');
  assert.equal(status({ url: `/${key}/a/package.json` }), 404, 'not an allowed asset');
  assert.equal(status({ url: `/${key}/a/../../package.json` }), 404, 'path traversal');
  assert.equal(status({ url: `/${key}/a/%2e%2e/%2e%2e/package.json` }), 404, 'encoded traversal');
  assert.equal(status({ method: 'PUT' }), 405);
  assert.equal(status({ method: 'DELETE', url: `/${key}/message` }), 405);
  assert.equal(status({ ...post, origin: undefined }), 403, 'POST without Origin');
  assert.equal(status({ ...post, origin: 'https://evil.example' }), 403, 'POST from another site');
  assert.equal(status({ ...post, origin: `http://127.0.0.1:${port + 1}` }), 403, 'POST from another local port');
  assert.equal(status({ ...post, secFetchSite: 'same-site' }), 403);
  assert.equal(status({ ...post, contentType: 'text/plain' }), 415, 'simple cross-site form posts are text/plain');
  assert.equal(status({ ...post, url: `/${key}/message?c=../x` }), 400);
  assert.equal(status({ ...post, url: `/${key}/message` }), 400);
});

test('the browser page keeps the strict CSP and swaps the VS Code button for the bridge', () => {
  const csp = browserCsp('N');
  for (const part of ["default-src 'none'", "script-src 'nonce-N'", "connect-src 'self'", "frame-ancestors 'none'"]) assert.ok(csp.includes(part), part);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp));
  const asset = (...p: string[]) => `./a/${p[p.length - 1]}`;
  const browser = dashboardHtml({ mode: 'browser', nonce: 'N', csp, asset });
  const vscodePage = dashboardHtml({ mode: 'vscode', nonce: 'N', csp: 'x', asset });
  assert.ok(browser.includes('./a/browserBridge.js') && browser.includes('./a/browser.css') && !browser.includes('id="openBrowser"'));
  assert.ok(!vscodePage.includes('browserBridge.js') && vscodePage.includes('id="openBrowser"'));
  // Phase 6c: only the browser page shows code on the page; VS Code uses its own editor.
  assert.ok(browser.includes('id="codeView"') && browser.includes('id="codeEditor"') && !vscodePage.includes('id="codeView"'));
  assert.ok(browser.indexOf('browserBridge.js') < browser.indexOf('dashboard.js'), 'bridge loads first');
  assert.equal((browser.match(/<script /g) ?? []).length, (browser.match(/nonce="N"/g) ?? []).length, 'every script has the nonce');
});

test('only the owner\'s local preview server may be shown inside the browser page', () => {
  assert.match(browserCsp('N'), /frame-src 'none'/);
  assert.match(browserCsp('N', 'http://localhost:3000'), /frame-src http:\/\/localhost:3000(;|$)/);
  for (const bad of ['https://evil.example', 'http://localhost:3000 https://evil.example', "'self'", 'javascript:alert(1)']) {
    assert.match(browserCsp('N', bad), /frame-src 'none'/, bad);
  }
  assert.equal(framableOrigin('http://localhost:3000/app/', 51234), 'http://localhost:3000');
  assert.equal(framableOrigin('http://127.0.0.1:51234/', 51234), undefined, 'never this server itself');
  assert.equal(framableOrigin('http://localhost:51234', 51234), undefined);
  assert.equal(framableOrigin(undefined, 51234), undefined);
  assert.equal(framableOrigin('not a url', 51234), undefined);
  const asset = (...p: string[]) => `./a/${p[p.length - 1]}`;
  const browser = dashboardHtml({ mode: 'browser', nonce: 'N', csp: 'x', asset });
  const vscodePage = dashboardHtml({ mode: 'vscode', nonce: 'N', csp: 'x', asset });
  assert.match(browser, /<iframe id="previewFrame"[^>]*sandbox="allow-scripts allow-same-origin allow-forms allow-popups"/);
  assert.ok(!vscodePage.includes('previewFrame'), 'the VS Code panel uses the Simple Browser instead');
});
