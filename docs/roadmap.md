# Roadmap

Each phase is the smallest useful step toward the 12 permanent requirements in [requirements.md](requirements.md) (R1–R12). There are no dates. The phases' order and scope are proposals, and the owner approves each phase before work starts. R9–R12 (agent-independent, local and token-saving, free dependencies, privacy) are constraints that every phase must keep.

Before each phase: write a short plan, get owner approval, implement, verify, record the evidence in [development-log.md](development-log.md), and update the status column in `requirements.md`.

| Phase | Goal | Serves | Status |
| --- | --- | --- | --- |
| 0 | Governance, docs, TypeScript tooling | — | Done |
| 1 | MVP dashboard: workspace changes, JS/TS file-import graph, details panel, local preview | R1, R2, R3, R5, R8 (partial) | Done, owner-verified 2026-10-29 |
| 2 | Inside files: clickable functions and classes per file, and where each one is used (VS Code reference provider) | R2, R3 | Done, owner-verified 2026-10-29 |
| 3 | Change history: browse commits, see the files each one touched and the commit message | R1, R4 | Done, owner-verified 2026-10-29 |
| 4 | Notes and decisions: attach the owner's notes to files or changes, stored as plain files in the project only if the owner opts in | R4, R6, R7 | Done, owner-verified 2026-10-30 |
| 4b | AI session overview: the prompts given, the agent's suggestions and feedback (including security), tokens spent, a short overview, and learning tips. Read-only from the agent's own local log files, opt-in. Claude Code first, other agents later | R1, R4, R6, R9, R10 | Done, owner-verified 2026-10-30 |
| 5 | Learning aids: plain-language explanations built from static facts (what a symbol is, where it is used), no LLM | R6, R2 | Done, owner-verified 2026-10-30 |
| 6 | More languages: add a second language parser (for example Python) behind the existing per-extension hook | R8, R3 | Done, owner-verified 2026-10-30 |
| 6b | Open in browser: the extension shows the same dashboard in the owner's web browser on `localhost` while VS Code runs (option A). A standalone app without VS Code (option B) is not planned | R8, R12 | Done, owner-verified 2026-10-30 |
| 6c | View code in the browser: clicking a file or a change in the browser view shows its code (plain text, line numbers) or its before/after diff on the page, with an **Open in VS Code** button. An option to open the browser view automatically when the project opens, so the browser can be the main screen. Sensitive files never shown. Notes still open in VS Code | R8, R2, R1 | Done, owner-verified 2026-10-30 |
| 6d | Files tab: the project's folders and files as a tree that opens and closes, with changed and sensitive files marked. Clicking a file shows its details, a folder highlights its files in the graph | R3, R2 | Done, owner-verified 2026-10-30 |
| 7 | API and database relationships: detect routes, HTTP calls and schema or ORM files statically. No database connections | R3 | Done, owner-verified 2026-10-30 |
| 8 | Preview alongside code: link preview pages to the source files that serve them, where this can be proven statically | R5 | Done, owner-verified 2026-10-30 |
| 9 | Safety and learning checks: a Health tab with VS Code's problems in plain words, a project checklist, secret-looking text (location only), possibly unused and near-duplicate files, and safe points to go back to | R6, R12, R1 | Done, owner-verified 2026-10-30 |
| 10 | Project status: a Project tab with the plan's phases and current stage, each phase's steps (plan, approve, build, test, owner check, log), the requirements count, folders outside the intended layout, and issues added from the dashboard (saved as notes) | R4, R6, R7 | Implemented and auto-tested (plan approved 2026-10-30). Awaiting owner check |
| 11 | Learning aids: reading order, test map, copy context for AI, folder rules, commit message check, TODO list, package list, hotspots, how-to-run card, prompt tips | R6, R2, R10 | Implemented and auto-tested (plan approved 2026-10-30). Awaiting owner check |
| 12 | Small fixes: notes written in the browser, syntax colours in the code view, remembering a "No" to the notes question, graph labels that don't touch | R7, R8, R3 | Implemented and auto-tested (plan approved 2026-10-30). Awaiting owner check |

## Guardrails for every phase

- MVP first: build only the current phase. Later rows are ideas, not commitments.
- Reuse VS Code APIs and small permissive packages before writing new code.
- Read-only toward the inspected project, unless the owner explicitly opts in to a write (Phase 4 notes).
- No telemetry, cloud, remote AI calls, agent-specific APIs or database connections.
- Ask the owner before pushing, opening or merging a PR, publishing, or installing globally.
