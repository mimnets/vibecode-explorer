import { strict as assert } from 'assert';
import { test } from 'node:test';
import { browserCsp, checkRequest, GuardInput, newKey } from '../../src/extension/browserGuard';
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
  assert.ok(browser.indexOf('browserBridge.js') < browser.indexOf('dashboard.js'), 'bridge loads first');
  assert.equal((browser.match(/<script /g) ?? []).length, (browser.match(/nonce="N"/g) ?? []).length, 'every script has the nonce');
});
