# AGENTS.md — VibeCode Explorer project rules

Canonical rules for every AI coding agent (Claude, Qwen, Gemini, …) working in this repository.
The owner is the final decision-maker.

## Before planning any feature

Read these first, in this order:
1. `docs/requirements.md`: the 12 permanent requirements and their current status.
2. `docs/roadmap.md`: the phases and which one is current.
3. `docs/development-log.md`: the latest status, decisions and known limitations.

Plan only the current approved phase. Mark a requirement Met only after it has been implemented and verified, with the evidence logged.

## Principles

- **MVP first.** Build the smallest thing that works; don't implement roadmap items early.
- **Reuse before writing.** Prefer VS Code APIs, then small maintained permissive-licensed (MIT/Apache-2.0/BSD) packages, then new code.
- **Framework-independent.** No assumptions about a specific project, framework, agent, user path or GitHub account.
- **Local-first.** No telemetry, no cloud uploads, no remote AI API calls, no direct database connections.
- **Read-only by default.** The extension never modifies the project it inspects. The one exception is the owner's own notes (Phase 4): new files in `.vibecode/notes/` only, after the owner allows it for that folder. Under the same permission, the folder-rules file `.vibecode/rules.md` (Phase 11) may be created once with examples; it is never overwritten.
- **Minimal dependencies.** Justify each new package (license, maintenance, advisories) in `docs/development-log.md`.
- **Focused testing.** Compile, lint and test what changed. Say clearly what was verified automatically vs. in the GUI.
- **Short educational explanations.** After each meaningful checkpoint: WHAT / WHY / WHERE / HOW / DATABASE impact / HOW TO PREVIEW, in ~5–10 lines.
- **Don't touch unrelated projects.** Never read or modify other repositories on this machine without approval.

## Security rules

- Respect Workspace Trust: no Git reads or file analysis in Restricted Mode.
- Webview: strict CSP, nonce scripts, no remote scripts/CDNs, DOM built with `textContent` only.
- Treat every webview message as untrusted; files are referenced by host-issued opaque ids, never paths.
- Never read `.env`, keys, credentials or other sensitive files (`src/analysis/sensitive.ts`).
- Outside the project, read only the open project's own agent log folder (Phase 4b, `src/extension/agentSessions.ts`), read-only and after the owner allows it. Never show tool output; hide anything that looks like a secret.
- Skip `node_modules`, `.git`, build outputs; cap scan size.
- Never expose shell execution; never start user servers.
- The only server the extension may run is its own browser view (Phase 6b, `src/extension/browserView.ts`): bound to 127.0.0.1, random port, secret key in every URL, Host/Origin checks, started only by the owner (a click, a command, or the owner's opt-in startup setting), stopped on exit, by command, or 30 minutes after its last tab closed.

## Approval boundaries

| Action | Permission |
| --- | --- |
| Read/analyze this repository | Allowed |
| Create/edit source files within the current phase | Allowed |
| Install reviewed free dev dependencies within scope | Allowed |
| Run local tests / Extension Development Host | Allowed |
| Create local Git commits (Conventional Commits) | Allowed |
| Push to GitHub | Ask first |
| Open or merge a PR | Ask first |
| Publish the extension | Ask first |
| Install globally / into the owner's VS Code | Ask first |
| Access other project files | Not allowed without approval |
| Deploy / cloud upload | Not allowed |

Never rewrite history or force-push. Preserve the owner's recorded approvals and decisions.

## Explanation modes (convention only)

- **QUICK**: 3–5 lines, what changed and how to see it.
- **BALANCED** (default): WHAT / WHY / WHERE / HOW / DATABASE / PREVIEW, ~5–10 lines.
- **DEEP**: walkthrough of key functions and trade-offs, on request only.

## Layout

- `src/extension/`: activation, dashboard webview host, preview, message validation
- `src/analysis/`: import parsing/resolution, sensitive-path rules (no `vscode` import, unit-testable)
- `src/git/`: wrapper over the built-in Git extension API
- `src/webview/`: dashboard UI (plain JS + CSS, runs sandboxed)
- `test/unit/`: Node test runner; `test/integration/`: Extension Development Host suite
- `docs/`: requirements, architecture, development log
