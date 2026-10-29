# Requirements

## Permanent product requirements

These 12 requirements define the final product. They don't change from phase to phase. Phases deliver them a piece at a time (see [roadmap.md](roadmap.md)). A requirement is marked **Met** only after it has been implemented and verified, with the evidence recorded in [development-log.md](development-log.md).

Status key: **Partial** = some of it is delivered and verified. **Constraint** = a rule every phase must keep, checked each phase. **Planned** = not started.

| # | Requirement | Status after Phase 1 |
| --- | --- | --- |
| 1 | See files created, changed or deleted during AI-assisted coding. | Partial: current working-tree changes against HEAD. Phase 3 adds commit history with the files each commit changed (owner-verified). No per-session view. |
| 2 | Understand modules, functions, classes and variables. | Partial: a per-file symbol list. Phase 2 adds go-to and "used in" (owner-verified). Phase 5 adds plain-language explanations (awaiting owner check). |
| 3 | Visually explore files, imports, functions, APIs and database relationships. | Partial: a file-import graph for JS/TS relative imports. Phase 2 highlights the files that use a symbol. No API or database relationships yet. |
| 4 | Understand why important changes were made. | Partial: Phase 3 shows each commit's full message. Phase 4 adds the owner's notes on files and commits (awaiting owner check). |
| 5 | Preview working websites alongside their code. | Partial: opens a user-configured local URL in Simple Browser. |
| 6 | Learn programming incrementally while developing. | Partial (awaiting owner check): Phase 4b shows rule-based tips for each AI session. Phase 5 adds plain-language file and symbol explanations, a glossary and code tips. |
| 7 | Preserve educational notes, architecture explanations and decisions. | Partial (awaiting owner check): Phase 4 saves the owner's notes (what, why, decision) as Markdown in `.vibecode/notes/`, opt-in. |
| 8 | Work across projects and programming languages. | Partial: any folder, multi-root, no-Git. Graph is JS/TS only. |
| 9 | Support Claude, Qwen, Gemini and other agents without proprietary agent APIs. | Constraint: kept. Data comes from Git and files, never from agent APIs. |
| 10 | Save tokens through local static analysis and Git data. | Constraint: kept. No LLM calls. |
| 11 | Minimise cost with free, open-source dependencies. | Constraint: kept. Runtime deps are MIT/Apache-2.0 only. |
| 12 | Protect private source code, secrets and local project data. | Constraint: kept. See the security requirements below. |

## Phase 1 scope (MVP): complete

The owner accepted this on 2026-10-29 after using it in their own VS Code. The known limitations are listed in [development-log.md](development-log.md).

| # | Requirement | Status |
| --- | --- | --- |
| A | Command "VibeCode Explorer: Open Dashboard"; no startup activation (it also activates when VS Code restores a dashboard tab left open) | Done |
| B | Workspace detection: single/multi-root, no-Git, empty, Windows paths | Done |
| C | Git changes (added/modified/deleted/untracked, repo, branch, refresh, click-to-open/diff), labelled "workspace changes" | Done |
| D | Interactive JS/TS file-import graph (inspect, open, zoom, pan, fit, refresh); unresolved imports shown as unknown | Done |
| E | Info panel: path, type, Git status, imports, symbols, open action; no LLM | Done |
| F | Preview: user-configured local URL, explicit action, scheme/host validation, no server start | Done |

## Phase 2 scope: inside files

| # | Requirement | Status |
| --- | --- | --- |
| A | Symbols in Details are clickable: jump to the definition | Done |
| B | "Used in" list for the clicked symbol, from `vscode.executeReferenceProvider`. Each entry opens at its line | Done |
| C | Graph highlights the files that use the symbol | Done (owner-verified in the GUI) |
| D | Opaque `s…`/`r…` ids only. Results inside the folder only, excluded and sensitive paths hidden, capped at 100 | Done |
| E | Clear message when no language support answers | Done |

Owner-verified 2026-10-29 (see the development log). Non-goals: a function call graph, code explanations, new language parsers.

## Phase 3 scope: change history

Approved by the owner on 2026-10-29.

| # | Requirement | Status |
| --- | --- | --- |
| A | History tab next to Workspace changes: latest 50 commits (headline, author, date, short id). **Load more** up to 200 | Done (owner-verified in the GUI) |
| B | Click a commit to show its full message and the files it touched (added, modified, deleted, renamed) | Done |
| C | Graph highlights the files of the selected commit | Done (owner-verified in the GUI) |
| D | Click a file to open VS Code's read-only before/after diff. Added files open the new version, deleted files the previous one | Done |
| E | Built-in Git extension API only (`log`, `diffBetween`, `toGitUri`). No shell, no new dependency, read-only | Done |
| F | Opaque `k…` (commit) and `h…` (file) ids. Sensitive files listed but never opened. Files outside the folder hidden. Caps: 200 commits, 300 files per commit. Off in Restricted Mode | Done |

Changed from the plan: commit ids use `k…` because `c…` is already used by the changes list. The first commit's files can't be listed (see the development log). Owner-verified 2026-10-29. Non-goals: diffs drawn inside the dashboard, blame, branch graphs, search, guessing which AI session made a change, notes.

## Phase 4 scope: notes and decisions

Approved by the owner on 2026-10-29 with the recommended choices: the `.vibecode/notes/` folder, and asking once per project.

| # | Requirement | Status |
| --- | --- | --- |
| A | Details shows **Notes (n)** for the selected file or commit, with title and date. Clicking a note opens it | Done (UI not auto-tested) |
| B | **Add note** asks once per folder (modal Yes/No; only Yes is remembered, in VS Code's storage, not the project), asks for a title, creates the note from a What / Why / Decision template and opens it in the editor | Done (dialogs not auto-tested) |
| C | Writes only new files inside `.vibecode/notes/`, never overwrites, never commits. File names are generated by the extension (`YYYY-MM-DD-slug.md`). The webview sends opaque ids only (`n…` for notes) | Done |
| D | Notes shown as plain text. Header reader for `about:`, `commit:`, `created:` with no new dependency. Up to 500 notes, 64 KB each | Done |
| E | Off in Restricted Mode | Done |

Owner verification is pending. Non-goals: editing inside the dashboard, line-level notes, graph markers, search, sync, following renamed files.

## Phase 4b scope: AI session overview

Requested by the owner and approved on 2026-10-29 with the recommended choices: a third tab, secrets hidden, no money estimate.

| # | Requirement | Status |
| --- | --- | --- |
| A | **AI sessions** tab: project totals (sessions, prompts, input, output and cache tokens, most-edited files) and a session list (title, date, prompts, tokens) | Done (UI not auto-tested) |
| B | Session details: times, model, replies, tokens, files changed (outlined in the graph), commits made during the session, security mentions, prompts (expandable), tips | Done (UI not auto-tested) |
| C | Reads only `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project path with dashes>/*.jsonl` (top level only), read-only, and keeps only lines whose `cwd` is inside the project. Up to 200 sessions, 50 MB per file | Done |
| D | Never kept: tool output, the agent's reasoning, sub-agent prompts. Secret-looking text is shown as `[hidden]` | Done |
| E | Modal permission per folder before the first read (only Yes is remembered, in VS Code's storage). The **Reset Permissions** command withdraws it, and the notes permission too. Off in Restricted Mode | Done (dialog not auto-tested) |
| F | Claude Code reader behind an `AgentLogReader` interface, ready for other agents. No new dependency, no network | Done |

Changed from the plan: commits made during a session are listed as text, with a pointer to the History tab, rather than as links. Owner verification is pending. Non-goals: money cost, live updates, other agents' readers, search, export.

## Phase 5 scope: learning aids

Approved by the owner on 2026-10-29 with the recommended choices: inline glossary explanations, and circular imports outlined in red.

| # | Requirement | Status |
| --- | --- | --- |
| A | **In plain words** for the selected file: type, lines, local imports and packages, the files that use it, role (entry point, hub with 5 or more importers, leaf), top-level symbol counts, commit count and latest date, note count | Done (UI not auto-tested) |
| B | Symbol explanation: kind, line, declaration and doc comment (VS Code hover provider), usage count. Says "may be unused" when only the definition is found | Done |
| C | Glossary of about 55 hand-written terms, with a **?** button that shows the explanation inline. A unit test checks that every term the dashboard explains has an entry | Done (UI not auto-tested) |
| D | Up to 3 code tips: circular import (naming the other files), large file (over 400 lines), hub without a matching `.test`/`.spec` file | Done |
| E | Circular imports (strongly connected groups) outlined in red in the graph, with a legend entry | Done (UI not auto-tested) |
| F | Static facts only: no AI, no network, no new dependency, read-only | Done |

Owner verification is pending. Non-goals: AI-written explanations, tutorials, other languages, line-by-line explanations.

## Non-goals for Phase 1

Function/API/database graphs, agent attribution, change explanations, embedded browser, marketplace publishing, servers, databases, cloud sync, plugin framework.

## Security requirements

Local-first; no telemetry or uploads; read-only; Workspace Trust respected; strict webview CSP; validated messages; no path-based file access from the webview; sensitive files never read; scan limits; no shell execution.
