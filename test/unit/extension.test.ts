import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
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
  assert.deepEqual(parseWebviewMessage({ type: 'openInBrowser', url: 'http://evil.example' }), { type: 'openInBrowser' });
  assert.deepEqual(parseWebviewMessage({ type: 'symbol', id: 's3' }), { type: 'symbol', id: 's3' });
  assert.deepEqual(parseWebviewMessage({ type: 'goto', id: 'r0' }), { type: 'goto', id: 'r0' });
  assert.deepEqual(parseWebviewMessage({ type: 'history', limit: 50 }), { type: 'history', limit: 50 });
  assert.deepEqual(parseWebviewMessage({ type: 'commit', id: 'k2' }), { type: 'commit', id: 'k2' });
  assert.deepEqual(parseWebviewMessage({ type: 'commitFile', id: 'h0' }), { type: 'commitFile', id: 'h0' });
  assert.deepEqual(parseWebviewMessage({ type: 'addNote', id: 'k1' }), { type: 'addNote', id: 'k1' });
  assert.deepEqual(parseWebviewMessage({ type: 'openNote', id: 'n0' }), { type: 'openNote', id: 'n0' });
  assert.deepEqual(parseWebviewMessage({ type: 'openInEditor', id: 'h3' }), { type: 'openInEditor', id: 'h3' });
  for (const bad of [null, 'open', 42, {}, { type: 'exec', cmd: 'rm -rf /' }, { type: 'open', id: '../../.env' },
    { type: 'open', id: 'C:\\secret' }, { type: 'open' }, { type: 'inspect', id: 7 }, { type: 'symbol', id: 'util' },
    { type: 'goto', id: 'src/util.ts:3' }, { type: 'goto' }, { type: 'selectFolder', index: -1 },
    { type: 'selectFolder', index: 1.5 }, { type: 'selectFolder', index: '0' }, { type: 'history' },
    { type: 'history', limit: 0 }, { type: 'history', limit: 201 }, { type: 'history', limit: '50' },
    { type: 'commit', id: 'HEAD~1' }, { type: 'commit', id: 'a1b2c3d4e5f6' }, { type: 'commitFile', id: 'src/.env' },
    { type: 'openInEditor', id: 'src/util.ts' }, { type: 'openInEditor', path: 'src/util.ts' },
    { type: 'addNote', id: '.vibecode/notes/x.md' }, { type: 'openNote', id: 'C:/notes/a.md' },
    // Phases 10–12: text from the page is limited, and ids stay opaque.
    { type: 'addIssue', title: '   ', text: '' }, { type: 'addIssue', title: 'x'.repeat(201), text: '' }, { type: 'addIssue', title: 'ok', text: 'x'.repeat(8001) },
    { type: 'addIssue', title: 'ok' }, { type: 'saveNote', id: 'src/a.ts', title: 'ok', text: '' }, { type: 'saveNote', id: 'f1', title: '', text: '' },
    { type: 'projectItem', id: 'docs/roadmap.md' }, { type: 'learnItem', id: '../x' }, { type: 'copyContext', id: 'C:/x' },
    // Phase 13: an issue is named by its id and the state must be open or closed.
    { type: 'setIssue', id: 'j1' }, { type: 'setIssue', id: 'j1', state: 'done' }, { type: 'setIssue', id: '.vibecode/notes/a.md', state: 'closed' },
    { type: 'setIssue', state: 'closed' }]) {
    assert.equal(parseWebviewMessage(bad), undefined, JSON.stringify(bad));
  }
  assert.deepEqual(parseWebviewMessage({ type: 'addIssue', title: 'Fix login', text: 'details', path: 'x' }), { type: 'addIssue', title: 'Fix login', text: 'details' });
  assert.deepEqual(parseWebviewMessage({ type: 'saveNote', id: 'k3', title: 'Why', text: '' }), { type: 'saveNote', id: 'k3', title: 'Why', text: '' });
  assert.deepEqual(parseWebviewMessage({ type: 'setIssue', id: 'j4', state: 'closed', path: 'x' }), { type: 'setIssue', id: 'j4', state: 'closed' });
  for (const type of ['project', 'learn', 'hotspots', 'createRules', 'askNotesAgain']) assert.deepEqual(parseWebviewMessage({ type, id: 'x' }), { type });
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
  // Read as a file, not imported, so the project's own graph shows no import leaving the project.
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
  assert.equal(manifest.extensionDependencies, undefined);
  // Activates on its commands, when VS Code restores a dashboard tab, or after startup has
  // finished (for the opt-in browser view on startup), never during startup itself.
  assert.deepEqual(manifest.activationEvents, ['onWebviewPanel:vibecodeExplorer.dashboard', 'onStartupFinished']);
  assert.equal(manifest.contributes.configuration.properties['vibecodeExplorer.openBrowserOnStartup'].default, false);
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
