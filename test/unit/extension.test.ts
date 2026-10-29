import { strict as assert } from 'assert';
import { test } from 'node:test';
import { parseWebviewMessage } from '../../src/extension/messages';
import { validatePreviewUrl } from '../../src/extension/previewUrl';
import { commitHeadline, summarizeCommitFiles } from '../../src/git/history';
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
  assert.deepEqual(parseWebviewMessage({ type: 'symbol', id: 's3' }), { type: 'symbol', id: 's3' });
  assert.deepEqual(parseWebviewMessage({ type: 'goto', id: 'r0' }), { type: 'goto', id: 'r0' });
  assert.deepEqual(parseWebviewMessage({ type: 'history', limit: 50 }), { type: 'history', limit: 50 });
  assert.deepEqual(parseWebviewMessage({ type: 'commit', id: 'k2' }), { type: 'commit', id: 'k2' });
  assert.deepEqual(parseWebviewMessage({ type: 'commitFile', id: 'h0' }), { type: 'commitFile', id: 'h0' });
  for (const bad of [null, 'open', 42, {}, { type: 'exec', cmd: 'rm -rf /' }, { type: 'open', id: '../../.env' },
    { type: 'open', id: 'C:\\secret' }, { type: 'open' }, { type: 'inspect', id: 7 }, { type: 'symbol', id: 'util' },
    { type: 'goto', id: 'src/util.ts:3' }, { type: 'goto' }, { type: 'selectFolder', index: -1 },
    { type: 'selectFolder', index: 1.5 }, { type: 'selectFolder', index: '0' }, { type: 'history' },
    { type: 'history', limit: 0 }, { type: 'history', limit: 201 }, { type: 'history', limit: '50' },
    { type: 'commit', id: 'HEAD~1' }, { type: 'commit', id: 'a1b2c3d4e5f6' }, { type: 'commitFile', id: 'src/.env' }]) {
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

test('manifest has no hard extension dependencies', () => {
  // VS Code disables an extension whose dependency is disabled, hiding all its commands.
  // Git is optional: gitChanges.ts reports it as unavailable instead.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manifest = require('../../../package.json');
  assert.equal(manifest.extensionDependencies, undefined);
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'vibecodeExplorer.openDashboard'));
});

test('commit files are kept inside the folder, flagged, sorted and capped', () => {
  const s = summarizeCommitFiles([
    { relPath: 'src/b.ts', oldRelPath: '', group: 'modified' },
    { relPath: '../other/x.ts', oldRelPath: '', group: 'added' },
    { relPath: '.env', oldRelPath: '', group: 'modified' },
    { relPath: 'src/a.ts', oldRelPath: 'src/secrets.pem', group: 'renamed' },
  ], 2);
  assert.deepEqual(s.files.map((f) => [f.relPath, f.sensitive]), [['.env', true], ['src/a.ts', true]]);
  assert.equal(s.hidden, 1);
  assert.equal(s.truncated, true);
  assert.equal(commitHeadline('fix: thing\r\n\nbody'), 'fix: thing');
  assert.equal(commitHeadline('   \n'), '(no message)');
});
