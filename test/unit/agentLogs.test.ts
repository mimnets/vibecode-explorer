import { strict as assert } from 'assert';
import { test } from 'node:test';
import { claudeProjectDirName, isInsideProject, redactSecrets, securitySentences, sessionTips, summarizeClaudeSession } from '../../src/analysis/agentLogs';

const PROJECT = 'C:\\work\\shop';
const line = (o: object) => JSON.stringify({ cwd: PROJECT, timestamp: '2026-10-29T10:00:00.000Z', ...o });
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };

const SAMPLE = [
  JSON.stringify({ type: 'ai-title', aiTitle: 'Add checkout page', sessionId: 'x' }),
  line({ type: 'user', timestamp: '2026-10-29T10:00:00.000Z', message: { role: 'user', content: '<system-reminder>ignore me</system-reminder>Add a checkout page. My key is sk-abcdefghijklmnop1234' } }),
  line({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
  line({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'also add a coupon field', humanTurn: true } }),
  line({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'automated follow-up', humanTurn: false } }),
  // One reply written as two lines that repeat the same usage: counted once.
  line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'private reasoning about validation security' }], usage } }),
  line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.\n\nValidate every form field on the server because browser input is untrusted.\n```js\nconst secret = 1;\n```' }], usage } }),
  line({ type: 'assistant', timestamp: '2026-10-29T10:05:00.000Z', message: { id: 'm2', model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\work\\shop\\src\\checkout.ts' } }, { type: 'tool_use', name: 'Bash', input: { command: 'rm -rf /' } }], usage: { input_tokens: 1, output_tokens: 2 } } }),
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'password=hunter22 FILE CONTENTS' }] } }),
  line({ type: 'user', isSidechain: true, message: { role: 'user', content: 'helper agent prompt' } }),
  JSON.stringify({ type: 'user', cwd: 'C:\\work\\shop2', timestamp: '2026-10-29T11:00:00.000Z', message: { role: 'user', content: 'another project' } }),
  '{ not json',
];

test('Claude Code log folder names and project matching', () => {
  assert.equal(claudeProjectDirName('C:\\Users\\dev\\Documents\\my-app'), 'C--Users-dev-Documents-my-app');
  assert.equal(claudeProjectDirName('/home/me/my_app'), '-home-me-my-app');
  assert.ok(isInsideProject('c:\\work\\shop', 'C:\\work\\shop'));
  assert.ok(isInsideProject('C:/work/shop/src', 'C:\\work\\shop'));
  assert.ok(!isInsideProject('C:\\work\\shop2', 'C:\\work\\shop'));
  assert.ok(!isInsideProject('/home/Me/app', '/home/me/app'), 'POSIX paths stay case-sensitive');
});

test('a session keeps prompts, counts tokens once per reply, and skips tool output and other projects', () => {
  const s = summarizeClaudeSession(SAMPLE, PROJECT);
  assert.equal(s.title, 'Add checkout page');
  assert.deepEqual(s.prompts.map((p) => p.text), ['Add a checkout page. My key is [hidden]', 'also add a coupon field']);
  assert.deepEqual(s.tokens, { input: 11, output: 7, cacheRead: 100, cacheWrite: 20 });
  assert.equal(s.replies, 2);
  assert.deepEqual(s.models, ['claude-opus-5-5']);
  assert.deepEqual(s.filesEdited, ['C:\\work\\shop\\src\\checkout.ts']);
  assert.deepEqual(s.securityMentions, ['Validate every form field on the server because browser input is untrusted.']);
  assert.equal(s.foreignLines, 1);
  assert.equal(s.start, '2026-10-29T10:00:00.000Z');
  assert.equal(s.end, '2026-10-29T10:05:00.000Z');
  const all = JSON.stringify(s);
  for (const leaked of ['hunter22', 'FILE CONTENTS', 'private reasoning', 'another project', 'helper agent prompt', 'ignore me', 'rm -rf']) {
    assert.ok(!all.includes(leaked), leaked);
  }
});

test('a log from another project yields no project lines', () => {
  const s = summarizeClaudeSession(SAMPLE.slice(-2), PROJECT);
  assert.equal(s.projectLines, 0);
  assert.deepEqual(s.prompts, []);
});

test('secrets are hidden', () => {
  assert.equal(redactSecrets('use password=hunter22 here'), 'use password=[hidden] here');
  assert.equal(redactSecrets('API_KEY: "abcd1234"'), 'API_KEY: [hidden]');
  assert.equal(redactSecrets('id AKIAABCDEFGHIJKLMNOP ok'), 'id [hidden] ok');
  assert.equal(redactSecrets('ghp_' + 'a'.repeat(36)), '[hidden]');
  assert.equal(redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'), '[hidden]');
  assert.equal(redactSecrets('nothing secret about this sentence'), 'nothing secret about this sentence');
});

test('security sentences and tips', () => {
  assert.deepEqual(securitySentences('Fixed the layout. The CSP blocks inline scripts, which is safer.'), ['The CSP blocks inline scripts, which is safer.']);
  const s = summarizeClaudeSession(SAMPLE, PROJECT);
  const tips = sessionTips(s, ['src/checkout.ts', '.env']);
  assert.ok(tips.some((t) => t.includes('no test files')), JSON.stringify(tips));
  assert.ok(tips.some((t) => t.includes('.gitignore')));
  assert.ok(tips.some((t) => t.includes('security point')));
  assert.ok(!sessionTips(s, ['src/checkout.ts', 'test/checkout.test.ts']).some((t) => t.includes('no test files')));
  assert.ok(sessionTips(s, []).some((t) => t.includes('No files were changed')));
});
