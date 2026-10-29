# Requirements

## Permanent product requirements

These 12 requirements define the final product. They don't change from phase to phase. Phases deliver them a piece at a time (see [roadmap.md](roadmap.md)). A requirement is marked **Met** only after it has been implemented and verified, with the evidence recorded in [development-log.md](development-log.md).

Status key: **Partial** = some of it is delivered and verified. **Constraint** = a rule every phase must keep, checked each phase. **Planned** = not started.

| # | Requirement | Status after Phase 1 |
| --- | --- | --- |
| 1 | See files created, changed or deleted during AI-assisted coding. | Partial: current working-tree changes against HEAD. No history or per-session view yet. |
| 2 | Understand modules, functions, classes and variables. | Partial: a per-file symbol list. Phase 2 adds go-to and "used in" (awaiting owner check). No explanations yet. |
| 3 | Visually explore files, imports, functions, APIs and database relationships. | Partial: a file-import graph for JS/TS relative imports. Phase 2 highlights the files that use a symbol. No API or database relationships yet. |
| 4 | Understand why important changes were made. | Planned |
| 5 | Preview working websites alongside their code. | Partial: opens a user-configured local URL in Simple Browser. |
| 6 | Learn programming incrementally while developing. | Planned |
| 7 | Preserve educational notes, architecture explanations and decisions. | Planned (in-product). The repo's `docs/` covers this project only. |
| 8 | Work across projects and programming languages. | Partial: any folder, multi-root, no-Git. Graph is JS/TS only. |
| 9 | Support Claude, Qwen, Gemini and other agents without proprietary agent APIs. | Constraint: kept. Data comes from Git and files, never from agent APIs. |
| 10 | Save tokens through local static analysis and Git data. | Constraint: kept. No LLM calls. |
| 11 | Minimise cost with free, open-source dependencies. | Constraint: kept. Runtime deps are MIT/Apache-2.0 only. |
| 12 | Protect private source code, secrets and local project data. | Constraint: kept. See the security requirements below. |

## Phase 1 scope (MVP): complete

The owner accepted this on 2026-10-29 after using it in their own VS Code. The known limitations are listed in [development-log.md](development-log.md).

| # | Requirement | Status |
| --- | --- | --- |
| A | Command "VibeCode Explorer: Open Dashboard"; no startup activation | Done |
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
| C | Graph highlights the files that use the symbol | Done (UI not auto-tested) |
| D | Opaque `s…`/`r…` ids only. Results inside the folder only, excluded and sensitive paths hidden, capped at 100 | Done |
| E | Clear message when no language support answers | Done |

Owner verification is pending. Non-goals: a function call graph, code explanations, new language parsers.

## Non-goals for Phase 1

Function/API/database graphs, agent attribution, change explanations, embedded browser, marketplace publishing, servers, databases, cloud sync, plugin framework.

## Security requirements

Local-first; no telemetry or uploads; read-only; Workspace Trust respected; strict webview CSP; validated messages; no path-based file access from the webview; sensitive files never read; scan limits; no shell execution.
