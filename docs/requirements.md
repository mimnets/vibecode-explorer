# Requirements

## Long-term vision (roadmap, not all in Phase 1)

1. See files created, changed or deleted during AI-assisted coding.
2. Understand modules, functions, classes and variables.
3. Visually explore files, imports, functions, APIs and database relationships.
4. Understand why important changes were made.
5. Preview working websites alongside their code.
6. Learn programming incrementally while developing.
7. Preserve educational notes, architecture explanations and decisions.
8. Work across projects and programming languages.
9. Support Claude, Qwen, Gemini and other agents without proprietary agent APIs.
10. Save tokens through local static analysis and Git data.
11. Minimise cost with free, open-source dependencies.
12. Protect private source code, secrets and local project data.

## Phase 1 scope (MVP)

| # | Requirement | Status |
| --- | --- | --- |
| A | Command "VibeCode Explorer: Open Dashboard"; no startup activation | Done |
| B | Workspace detection: single/multi-root, no-Git, empty, Windows paths | Done |
| C | Git changes (added/modified/deleted/untracked, repo, branch, refresh, click-to-open/diff), labelled "workspace changes" | Done |
| D | Interactive JS/TS file-import graph (inspect, open, zoom, pan, fit, refresh); unresolved imports shown as unknown | Done |
| E | Info panel: path, type, Git status, imports, symbols, open action; no LLM | Done |
| F | Preview: user-configured local URL, explicit action, scheme/host validation, no server start | Done |

## Non-goals for Phase 1

Function/API/database graphs, agent attribution, change explanations, embedded browser, marketplace publishing, servers, databases, cloud sync, plugin framework.

## Security requirements

Local-first; no telemetry or uploads; read-only; Workspace Trust respected; strict webview CSP; validated messages; no path-based file access from the webview; sensitive files never read; scan limits; no shell execution.
