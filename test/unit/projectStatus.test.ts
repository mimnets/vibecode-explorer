import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText, cleanTitle, currentPhase, foldersOf, logMentions, parsePlan, phaseState, plannedFolders, structureDrift, summarizeRequirements, workflowSteps,
} from '../../src/analysis/projectStatus';
import { noteTemplate, parseNote, setIssueState } from '../../src/analysis/notes';

const ROADMAP = `# Roadmap

| Phase | Goal | Serves | Status |
| --- | --- | --- | --- |
| 0 | Tooling | — | Done |
| 1 | **MVP** dashboard | R1, R2 | Done, owner-verified 2026-10-29 |
| 6b | Open in [browser](x.md) | R8 | Implemented and auto-tested (plan approved). Awaiting owner check |
| 7 | APIs | R3 | Planned |
| 8 | Standalone app | R8 | Not planned |
`;

test('the plan table is read with each phase\'s state', () => {
  const phases = parsePlan(ROADMAP);
  assert.deepEqual(phases.map((p) => `${p.id}:${p.state}`), ['0:done', '1:done', '6b:active', '7:todo', '8:skipped']);
  assert.equal(phases[1].goal, 'MVP dashboard');
  assert.equal(phases[2].goal, 'Open in browser');
  assert.deepEqual(phases[1].extra, [{ name: 'Serves', value: 'R1, R2' }]);
  assert.deepEqual(phases[0].extra, []);
  assert.equal(currentPhase(phases)?.id, '6b');
  assert.equal(currentPhase(phases.filter((p) => p.state !== 'active'))?.id, '7');
  assert.equal(currentPhase(phases.filter((p) => p.state === 'done')), undefined);
  assert.deepEqual(parsePlan('| A | B |\n| - | - |\n| 1 | 2 |'), [], 'a table without phase and status columns is not a plan');
  assert.deepEqual(parsePlan('| Step | Status |\n| --- | --- |\n| Login | ✅ |\n| Shop | in progress |').map((p) => `${p.id}:${p.state}`), ['Login:done', 'Shop:active']);
  assert.equal(phaseState('WIP'), 'active');
});

test('workflow steps are ticked from the status and the log', () => {
  const [, done, active, todo] = parsePlan(ROADMAP);
  const log = '## Phase 1: MVP\n## Phase 6: Python\n';
  const ticks = (p: typeof done) => workflowSteps(p, log).map((s) => (s.done ? 'x' : '.')).join('');
  assert.equal(ticks(done), 'xxxxxx');
  assert.equal(ticks(active), 'xxxx..', 'built and tested, waiting for the owner; "Phase 6" is not "Phase 6b"');
  assert.equal(ticks(todo), 'x.....');
  assert.equal(workflowSteps(todo, undefined).length, 5, 'without a log there is no log step');
  assert.ok(logMentions('see phase 10.', '10') && !logMentions('Phase 10', '1'));
});

test('the requirements table is counted by status', () => {
  const md = '| # | Requirement | Status after Phase 1 |\n| --- | --- | --- |\n| 1 | A | Partial: x |\n| 2 | B | **Met** |\n| 3 | C | partial |\n| 4 | D | Constraint: kept |';
  assert.deepEqual(summarizeRequirements(md), { total: 4, counts: [{ status: 'Partial', count: 2 }, { status: 'Met', count: 1 }, { status: 'Constraint', count: 1 }] });
  assert.equal(summarizeRequirements(ROADMAP), undefined);
});

test('planned folders come from a Layout section or a text tree', () => {
  const agents = '# Rules\n\nUse `src/other/` never.\n\n## Layout\n\n- `src/extension/`: host\n- `src/analysis/`: pure\n- `test/unit/`: tests; `docs/`: docs\n\n## Other\n\n- `scripts/` is not here\n';
  assert.deepEqual(plannedFolders(agents), ['docs', 'src/analysis', 'src/extension', 'test/unit']);
  const tree = '## Project structure\n\n```\nmy-app/\n├── src/\n│   ├── api/      # routes\n│   └── ui/\n└── tests/\n    README.md\n```\n';
  assert.deepEqual(plannedFolders(tree), ['my-app', 'my-app/src', 'my-app/src/api', 'my-app/src/ui', 'my-app/tests']);
  const flat = '## Folders\n\n```\nsrc/\n  api/\n  ui/\ntests/\n```\n';
  assert.deepEqual(plannedFolders(flat), ['src', 'src/api', 'src/ui', 'tests']);
  assert.deepEqual(plannedFolders('# Readme\n\nNo layout.'), []);
});

test('folders that are not in the plan are flagged', () => {
  const planned = ['docs', 'src/analysis', 'src/extension', 'test/unit', 'test/integration'];
  const files = ['docs/a.md', 'docs/img/x.png', 'src/analysis/a.ts', 'src/extension/b.ts', 'src/extension/deep/c.ts', 'src/utils/d.ts',
    'test/unit/x.ts', 'scripts/build.js', '.vscode/settings.json', 'README.md'];
  assert.deepEqual(foldersOf(['a/b/c.ts', 'a/d.ts']), ['a', 'a/b']);
  assert.deepEqual(structureDrift(planned, foldersOf(files)), { unplanned: ['scripts', 'src/utils'], missing: ['test/integration'] });
});

test('issues are notes with an open or closed state, and page text is cleaned', () => {
  const text = noteTemplate(undefined, '2026-10-30', 'Fix login', { issue: true, body: 'It fails\non Safari' });
  assert.ok(text.startsWith('---\nissue: open\ncreated: 2026-10-30\n---\n\n# Fix login\n\nIt fails\non Safari\n'));
  assert.deepEqual(parseNote(text), { issue: 'open', created: '2026-10-30', title: 'Fix login' });
  assert.equal(parseNote(text.replace('issue: open', 'issue: closed')).issue, 'closed');
  assert.equal(parseNote(noteTemplate({ about: 'a.ts' }, '2026-10-30', 'x')).issue, undefined);
  assert.ok(noteTemplate({ about: 'a.ts' }, '2026-10-30', 'Why', { body: 'Because.' }).endsWith('# Why\n\nBecause.\n'));
  assert.equal(cleanTitle('  Fix\nthe\u0007 bug  '), 'Fix the bug');
  assert.equal(cleanText('a\r\nb\u0000c\t'), 'a\nbc');
});

test('closing or reopening an issue changes only its issue line', () => {
  const text = noteTemplate({ about: 'a.ts' }, '2026-10-31', 'Fix login', { issue: true, body: 'issue: open in the text stays' });
  const closed = setIssueState(text, 'open', 'closed');
  assert.equal(closed, text.replace('issue: open\n', 'issue: closed\n'));
  assert.equal(parseNote(closed!).issue, 'closed');
  assert.equal(setIssueState(closed!, 'closed', 'open'), text);
  // Windows line endings, a byte-order mark and the older word "done" are kept as they are.
  const crlf = '\uFEFF---\r\nissue:  done \r\ncreated: 2026-10-31\r\n---\r\n\r\n# Old\r\n';
  assert.equal(setIssueState(crlf, 'closed', 'open'), '\uFEFF---\r\nissue:  open \r\ncreated: 2026-10-31\r\n---\r\n\r\n# Old\r\n');
  // Changed since it was read, not an issue, or the line is outside the header: nothing to write.
  assert.equal(setIssueState(text, 'closed', 'open'), undefined);
  assert.equal(setIssueState(noteTemplate({ about: 'a.ts' }, '2026-10-31', 'x'), 'open', 'closed'), undefined);
  assert.equal(setIssueState('# Title\n\nissue: open\n', 'open', 'closed'), undefined);
  assert.equal(setIssueState('---\ncreated: 2026-10-31\n---\nissue: open\n', 'open', 'closed'), undefined);
});
