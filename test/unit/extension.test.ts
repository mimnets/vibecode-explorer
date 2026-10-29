import { strict as assert } from 'assert';
import { test } from 'node:test';
import { parseWebviewMessage } from '../../src/extension/messages';
import { validatePreviewUrl } from '../../src/extension/previewUrl';
import { groupForStatus, moreSignificant } from '../../src/git/status';

test('preview URL accepts only local http(s)', () => {
  for (const ok of ['http://localhost:3000', 'https://127.0.0.1:8443/app', 'http://[::1]:5173', 'http://app.localhost']) {
    assert.ok(validatePreviewUrl(ok).ok, ok);
  }
  for (const bad of ['', '   ', 'file:///C:/x.html', 'javascript:alert(1)', 'http://example.com', 'http://user:pw@localhost',
    'http://localhost.evil.com', 'vscode://x', 'not a url', 'http://192.168.1.5:3000']) {
    assert.ok(!validatePreviewUrl(bad).ok, bad);
  }
});

test('webview messages are validated strictly', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'open', id: 'f12' }), { type: 'open', id: 'f12' });
  assert.deepEqual(parseWebviewMessage({ type: 'selectFolder', index: 1 }), { type: 'selectFolder', index: 1 });
  assert.deepEqual(parseWebviewMessage({ type: 'refresh', extra: 'ignored' }), { type: 'refresh' });
  for (const bad of [null, 'open', 42, {}, { type: 'exec', cmd: 'rm -rf /' }, { type: 'open', id: '../../.env' },
    { type: 'open', id: 'C:\\secret' }, { type: 'open' }, { type: 'inspect', id: 7 }, { type: 'selectFolder', index: -1 },
    { type: 'selectFolder', index: 1.5 }, { type: 'selectFolder', index: '0' }]) {
    assert.equal(parseWebviewMessage(bad), undefined, JSON.stringify(bad));
  }
});

test('git status codes map to change groups', () => {
  assert.equal(groupForStatus(1), 'added');
  assert.equal(groupForStatus(5), 'modified');
  assert.equal(groupForStatus(6), 'deleted');
  assert.equal(groupForStatus(7), 'untracked');
  assert.equal(groupForStatus(8), undefined); // ignored
  assert.equal(groupForStatus(18), 'conflict');
  assert.equal(moreSignificant('added', 'modified'), 'added');
  assert.equal(moreSignificant('modified', 'deleted'), 'deleted');
});
