# Development log

## 2026-10-29: Phase 0 + Phase 1 MVP

**Environment:** Windows 11, Node 24.21, npm 11.19, Git 2.56, VS Code 1.143. The integration tests use an isolated VS Code 1.144 download.

**Dependencies (reviewed: license, deps, `npm audit`):**

| Package | Use | License | Notes |
| --- | --- | --- | --- |
| cytoscape 3.34 | graph rendering in webview | MIT | zero dependencies |
| typescript ~6.0 | import parsing at runtime; compiler | Apache-2.0 | 6.0 kept: TS 7 is the native port (no JS API) and typescript-eslint requires <6.1 |
| @types/vscode 1.100 | types; sets `engines.vscode ^1.100.0` | MIT | dev |
| @vscode/test-electron | Extension Development Host tests | MIT | dev |
| eslint, @eslint/js, typescript-eslint | lint | MIT | dev |
| @vscode/vsce | build the VSIX | MIT | dev |

**Known advisory:** `npm audit` reports GHSA-xcx6-jx8p-x3h5 (high) in `@azure/msal-node`, pulled in by `@vscode/vsce` → `@azure/identity`. That code runs only during `vsce publish` with Azure sign-in, which this project never uses, and it is not shipped in the VSIX. The fix needs msal-node 7.x, outside `@azure/identity`'s `^6` range, so no override was forced. Revisit when vsce updates. Runtime dependencies: 0 vulnerabilities.

**Decisions:**
- Rejected `es-module-lexer`: it can't parse TS/TSX type syntax.
- Rejected regex parsing: it miscounts imports in comments and strings.
- Restricted Mode can't be automated with `@vscode/test-electron`, which hard-codes `--disable-workspace-trust`, so it's a manual check.
- The webview reports back after rendering so the integration test can verify that the graph really draws under the CSP.

**Rename:** the owner renamed the project from *VibeDev Explorer* to *VibeCode Explorer* before the first commit. That changed the extension id to `mimnets.vibecode-explorer`, the commands and settings to `vibecodeExplorer.*`, and the VSIX to `vibecode-explorer.vsix`. The GitHub repository and the local folder are still named `vibedev-explorer` until the owner renames them on GitHub.

## 2026-10-29: Fix: dashboard command missing in the Extension Development Host

**Cause:** the owner's VS Code profile has built-in Git disabled (`extensionsIdentifiers/disabled` contains `vscode.git`). Because the manifest declared `extensionDependencies: ["vscode.git"]`, VS Code marked VibeCode Explorer *DisabledByExtensionDependency* (`_isDisabledByExtensionDependency` in the workbench), so none of its commands were contributed. **Fix:** removed the hard dependency. Git is optional, and without it the changes pane reports Git as unavailable while the graph still works. **Testing:** test runs keep extension enablement in memory, so the disabled-Git state can't be reproduced automatically. A unit test now guards the manifest.

## 2026-10-29: Fix: installed VSIX was built before the dependency fix

**Cause:** `vibecode-explorer.vsix` was packaged at 15:39, before commit 143b726 (15:58) removed `extensionDependencies: ["vscode.git"]`. The VSIX was never rebuilt, and that stale package was installed at 16:07. Its `package.json` and `extension.vsixmanifest` still declared the dependency, so with `vscode.git` disabled in the owner's profile the extension stayed disabled and its commands never appeared. **Fix:** rebuilt the VSIX from the current source and reinstalled it with `--force`. No source code changed. **Verified:** the installed VSIX ran in an isolated profile of the real VS Code 1.144 with `--disable-extension=vscode.git`: it loads, the command activates it, the dashboard opens, and the graph renders. Git is reported as unavailable. With Git enabled, changes are listed. The full integration suite (22 checks) also passed on the same binary. The browser fallback was not needed.

## 2026-10-29: Phase 1 accepted by owner

**Acceptance:** the owner restarted VS Code with the rebuilt VSIX installed, opened the dashboard and reported that everything works. Automated evidence is in the entries above: unit tests and 22 integration checks. The owner reported success overall but did not list each feature they tried.

**Known limitations carried forward:**
- Graph covers JS/TS **relative** imports only. Path aliases, package imports and absolute paths appear as *unknown* nodes.
- Changes are the current working tree against HEAD only. There's no commit history or per-session view.
- The changes pane needs VS Code's built-in Git extension. The owner's profile has it disabled, so the pane shows "Git unavailable" until they enable it.
- Restricted Mode (an untrusted folder) is checked by hand only. See the README.
- Scan caps: 500 files by default (configurable up to 5000), 512 KB per file, 200 symbols per file.
- Preview opens only loopback http/https URLs and never starts the app.
- Dev-only advisory GHSA-xcx6-jx8p-x3h5 in `@vscode/vsce`'s dependency tree remains open (it's not shipped).

**Docs:** permanent requirements now carry a per-requirement status (`docs/requirements.md`). Added `docs/roadmap.md`. `AGENTS.md` now tells agents to read requirements, roadmap and log before planning. No application code changed.

## 2026-10-29: Phase 2: inside files (symbols and usages)

**Pushed first:** the 6 Phase 0–1 commits went to GitHub as they were (`origin/main`). Their `Co-Authored-By` trailers were kept, because removing them would rewrite history. The owner's new global attribution setting applies to commits from this one on.

**What:** symbols in the Details panel are now clickable. A click opens the definition and lists where the symbol is used. Each usage opens at its line, and the files that use it are outlined in the graph. **How:** `vscode.executeReferenceProvider` (built in, no new dependency) runs on demand. The new pure helper `src/analysis/usages.ts` filters out locations outside the folder, excluded or sensitive, then de-duplicates them and caps them at 100. New webview messages are `symbol` and `goto`, which carry opaque `s…`/`r…` ids only.

**Verified automatically:** lint. 12 unit tests, including the usage filtering and the new message validation. 25 integration checks in VS Code 1.144, including symbols listed with opaque ids and usages of `util` found in `index.ts`, `new.ts` and `util.ts`. The sample workspace stayed unchanged.
**Not verified automatically:** the webview click handlers, the "Used in" rendering and the graph highlight. These need the owner's GUI check.

**Limitations:** usages depend on the installed language support. For JS/TS that's VS Code's built-in TypeScript extension, and if it's disabled the panel says usages are not available. The first lookup can be slow while the TypeScript server starts. A list of more than 100 places is cut off.

## 2026-10-29: GitHub repository renamed

The owner renamed the GitHub repository to `mimnets/vibecode-explorer`. The `origin` remote and the `repository.url` field in `package.json` now point to it. The local folder is still named `vibedev-explorer`.

## 2026-10-29: Phase 2 owner check

The owner installed the rebuilt VSIX, restarted VS Code and reported that Phase 2 works. Their screenshot shows the dashboard on this repository with `src/extension/dashboard.ts` selected: Details lists "Imports (7)" and "Symbols (64)" with the hint "Click a symbol to jump to it and see where it is used", and the graph legend includes "uses selected symbol". This covers the GUI items the automated tests could not: the symbol click handlers, the "Used in" list and the graph highlight. Phase 2 is marked Done. Phase 3 (change history) is next and needs the owner's approval before work starts.

## 2026-10-29: Phase 3: change history

**Approved:** the owner approved the Phase 3 plan with the recommended choices: a History tab that swaps with Workspace changes, and 50 commits on first load.

**What:** a History tab lists the latest commits, with **Load more** up to 200. Clicking a commit shows its full message and changed files in Details and outlines those files in blue in the graph. Clicking a file opens VS Code's read-only diff of the file before and after that commit. **How:** the built-in Git extension API: `log`, `diffBetween(parent, commit)` and `toGitUri`. There's no new dependency and no shell. The new pure helper `src/git/history.ts` keeps files inside the folder, flags sensitive names, sorts and caps the list. `src/extension/history.ts` issues opaque ids: `k…` for commits (`c…` was already used by the changes list) and `h…` for commit files. New validated messages are `history` (limit 1–200), `commit` and `commitFile`.

**Bug found by the tests:** in VS Code 1.144 the Git extension's repository object has its own `kind` property, so a `'kind' in repo` check took a real repository for an error. The lookup now returns an explicit tagged result.

**Verified automatically:** lint. 13 unit tests, including commit-file filtering and the new message validation. 33 integration checks in VS Code 1.144. The sample repository now has 3 commits (an add, a rename, a deletion and a committed `.env`), and the checks cover the newest-first list, renamed, deleted and sensitive files, the full message, the first commit, before/after diffs, sensitive files not opening, and no history without Git. The webview loaded without script errors, and the sample workspace stayed unchanged.
**Not verified automatically:** the History tab, clicking commits and files in the webview, **Load more** and the blue graph outline. These need the owner's GUI check.

**Limitations:** the Git extension API can only compare two commits (its `diffBetween` runs `git diff a...b`), and its empty-tree helper isn't public. So the first commit of a repository shows its message but not its files. Merge commits are compared with their first parent. Sensitive files in a commit are listed but never opened. Without the built-in Git extension the tab says Git is unavailable.

## 2026-10-29: Phase 3 owner check

The owner installed the rebuilt VSIX and checked History on this repository. Their screenshot shows the History tab listing all 10 commits newest first, with short id, author and date. **Load more** is hidden, correctly, because there are fewer than 50 commits. Selecting `feat: add Phase 3 change history` shows its full message and "Files changed (16)" (2 added, 14 modified), which matches the commit, and the commit's JS/TS files are outlined in blue in the graph. The owner also confirmed that clicking a file opens the before/after diff. **Load more** with more than 50 commits was not exercised in the GUI. Phase 3 is marked Done.

**Noticed:** after reloading the extension, a stale dashboard tab from the previous session can stay open next to the new one. This is a candidate for a small fix (a webview panel serializer) and is not part of Phase 3.

## 2026-10-29: Fix: stale dashboard tab after a reload

**Problem:** after the extension was reinstalled and reloaded, VS Code kept the old dashboard tab open next to a new one. The extension had no webview serializer, so the restored tab was not connected to the extension and showed stale content. **Fix:** a `WebviewPanelSerializer` for `vibecodeExplorer.dashboard` reconnects a restored tab, which becomes the live dashboard and reloads its data. If more than one tab is restored, the extras are closed, because there is only one dashboard. The manifest adds the activation event `onWebviewPanel:vibecodeExplorer.dashboard`, so the extension activates at startup only when a dashboard tab was left open.

**Verified automatically:** lint. 13 unit tests, including a manifest guard that the restore event is the only activation event. 36 integration checks, including that a second restored tab is closed and that a restored tab renders the graph. **Not verified automatically:** VS Code actually calling the serializer during a real window reload. This needs the owner's GUI check.

## 2026-10-29: Owner request: AI session overview (Phase 4b)

During Phase 4 the owner asked for a dashboard view of the prompts given, the agent's suggestions and feedback (especially on security), tokens spent, a minimal but complete overview, and learning tips. It was not in the roadmap. **Owner decisions:** build it as a new phase after Phase 4, and read the data from the agents' own local log files, read-only and only after the owner opts in (Claude Code's session logs under the user folder first, other agents through their own readers later). **Note for the plan:** this reads files outside the project, in the user's home folder. The owner approved this in principle, and the Phase 4b plan must spell out exactly which files are read. Agent-specific readers are a deliberate, owner-approved exception to R9's agent independence. They read local files only, and no agent APIs or network calls are used.

## 2026-10-29: Phase 4: notes and decisions

**Approved:** the owner approved the plan with the recommended choices: `.vibecode/notes/`, and asking once per project.

**What:** Details shows **Notes (n)** for the selected file or commit, with **Add note**. The first Add asks a modal Yes/No question for that folder. Only "Yes" is remembered, in VS Code's `workspaceState` rather than the project. It then asks for a title, writes `.vibecode/notes/YYYY-MM-DD-slug.md` from a What / Why / Decision template, and opens it in the editor. A file watcher refreshes the list when notes are created, edited or deleted. **How:** `src/analysis/notes.ts` (pure: header reader, commit-hash matching, safe file names, template) and `src/extension/notes.ts` (list, consent, create). New validated messages are `addNote` (the id must equal the subject shown in Details) and `openNote` (`n…`). No new dependency.

**Safety:** this is the extension's first and only write into a project. It creates new files only, inside `.vibecode/notes/`, and never overwrites (it checks for an existing file first, and names get a `-2` suffix). The file name is generated and checked against `^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,60}\.md$`. The webview can't supply a path. `createNote` is exported to the integration tests only in `ExtensionMode.Test`, so other extensions can't skip the consent dialog through our API. AGENTS.md and the README now name this one exception to read-only.

**Verified automatically:** lint. 14 unit tests, including the header reader, commit matching, path-traversal titles producing safe names, and the new message validation. 39 integration checks: nothing is written before a note is added, notes are created inside `.vibecode/notes` with generated names and no overwrite, and notes are listed for their file and their commit (short hash matched by the full one). The test runner now checks that the sample workspace is unchanged outside `.vibecode/notes` and that the folder holds only the 3 test notes.
**Not verified automatically:** the consent dialog, the title box, the Notes section and the Add note and open clicks in the webview. These need the owner's GUI check.

**Limitations:** notes link to a file by path, so a rename breaks the link until `about:` is edited. Answering "No" is not remembered, so the question comes back next time. There's no command yet to withdraw a "Yes" (VS Code's workspace storage keeps it).

## 2026-10-29: Phase 4b: AI session overview

**Approved:** the owner approved the plan with the recommended choices: a third tab, secrets hidden, no money estimate.

**Log format (checked on this project's own logs, structure only):** one `.jsonl` file per session in `~/.claude/projects/<cwd with non-alphanumerics as '-'>/`. `user` lines with string content are prompts. Messages typed while Claude is working are `attachment` lines of type `queued_command` (this was found when the first version missed the owner's mid-task request). `assistant` lines carry `message.usage`, and one reply is split over several lines sharing `message.id`, so usage is counted once per id. `ai-title` gives the session title, and `cwd` gives the working folder.

**What:** an **AI sessions** tab with project totals and a session list. A session's Details show its times, model, replies, tokens, files changed (outlined in the graph), commits during the session, security mentions, prompts and tips. A new command, **VibeCode Explorer: Reset Permissions**, withdraws the log and notes permissions. **How:** `src/analysis/agentLogs.ts` (pure: summariser, folder naming, project matching, secret hiding, security sentences, tips) and `src/extension/agentSessions.ts` (locate, permission, stream, cache, describe). New validated messages are `sessions`, `allowSessions` and `session` (`a…`). No new dependency.

**Safety:** reads only the open project's log folder (top-level `.jsonl` files, at most 50 MB each), read-only, after a modal Yes. Lines whose `cwd` is outside the project are dropped. Tool results, thinking blocks and sub-agent prompts are never kept. Secret-looking text (API keys, AWS, GitHub and Slack tokens, JWTs, private keys, `password=`-style values) is shown as `[hidden]`. The raw reader is exported to tests only in `ExtensionMode.Test`. AGENTS.md now names this one read outside the project.

**Verified automatically:** lint. 19 unit tests, including a made-up log covering prompts, a queued prompt, token de-duplication, tool output, reasoning, a sub-agent prompt, another project's line, malformed JSON and secret hiding. 42 integration checks with a fake `CLAUDE_CONFIG_DIR`: nothing is read before permission, only this project's log is read (another project's folder and a sub-folder are ignored), and secrets and tool output never appear. A summariser dry run on this project's 4 real sessions printed counts only (for example 10 prompts, 81 replies and 23 edited files in the current session). **Not verified automatically:** the tab, the permission dialog, the session details, and the graph outline in the webview. These need the owner's GUI check.

**Limitations:** Claude Code only. Security mentions are keyword matches, not a review. Secret hiding is pattern-based and may miss unusual formats. Token counts are the agent's own numbers, with no money estimate. Commits during a session are matched by time, and the list isn't clickable. Log format changes in future Claude Code versions may need reader updates.

## 2026-10-29: Phase 5: learning aids

**Approved:** the owner approved the plan with the recommended choices: inline glossary explanations, and circular imports outlined in red.

**What:** Details now starts with **In plain words**: sentences built from static facts about the selected file (type and lines, what it imports, what imports it, its role, top-level symbols, commits, notes), with up to 3 code tips. Clicking a symbol adds **About <symbol>**: its kind, line, declaration and doc comment from VS Code's hover provider, and its usage count, with "may be unused" when only the definition is found. A **?** next to terms shows a short explanation inline (about 55 terms in `src/analysis/glossary.ts`). Circular imports are found with an iterative Tarjan search and outlined in red in the graph. **How:** pure `src/analysis/explain.ts` and `glossary.ts`, and `src/extension/explain.ts` for the facts. The Git API's `log({ path })` gives per-file commit counts (capped at 100, shown as "at least"). No new dependency, no AI and no network.

**Verified automatically:** lint. 25 unit tests, including roles, cycle groups (plus a 20,000-file chain that must not overflow the stack), exact sentences, tips, test-file matching, hover parsing, and a check that every term the dashboard explains has a glossary entry. 46 integration checks: the sample now has a `ping.ts`/`pong.ts` loop marked in the graph and named in a tip, `util.ts` is explained as a leaf used by 2 files and changed in 1 commit, and `util`'s declaration comes from the TypeScript hover. **Not verified automatically:** the In plain words box, the **?** buttons, the symbol explanation and the red outline in the webview. These need the owner's GUI check.

**Limitations:** roles and tips only cover what the JS/TS import graph knows. The declaration and doc comment depend on the language support installed. Tips are simple rules, not a code review. Dates use the computer's locale.

## 2026-10-29: Phase 6: Python in the dependency graph

**Approved:** the owner approved the plan with the recommended choices: Python, and a built-in reader (no tree-sitter).

**What:** Python files now appear in the graph with their imports, so roles, circular imports, tips, history and session highlights all work for Python projects. **How:** a new language list (`src/analysis/languages.ts`) puts JS/TS and Python behind one `LanguageSupport` interface, and `buildGraph` dispatches by file extension. `src/analysis/python.ts` scans the source into logical lines, with comments removed, strings replaced by placeholders, and brackets and `\` continuations joined. It then reads `import`/`from` statements (including one-line `if`/`try` bodies and imports inside functions) and literal `importlib.import_module`/`__import__` calls. Resolution follows Python's rules for relative imports and tries the root, `src/` and the file's own folder for absolute ones. Python build and virtual-environment folders are skipped, and Python test-file names are recognised. No new dependency.

**Found by the tests:** `from . import ping` also linked the importing file to the package's `__init__.py`. That is correct Python but clutters the graph, so the package file is now linked only when a name actually comes from it.

**Verified automatically:** lint. 31 unit tests, including docstrings and comments containing the word "import", multi-line and continued imports, CRLF endings, unterminated strings, relative imports above the folder, submodules versus package names, a mixed JS/TS and Python graph with a loop, skipped folders and test-file names. The existing JS/TS tests are unchanged and pass. 50 integration checks: a third workspace folder `py-project` checks the Python nodes and edges, that docstring and `.venv` imports are ignored, the ping/pong loop marking, and `models.py` being explained as a leaf used by `main.py` and `test_models.py`. **Not verified automatically:** a real Python project in the GUI, and symbols and usages for Python, which need the Python/Pylance extension.

**Limitations:** `sys.path` changes, `.pth` files, namespace-package edge cases and installed packages are not followed. An absolute module that isn't found is listed as a package, even if it's a typo. f-strings that nest the same quote character (Python 3.12+) can confuse the scanner in rare cases.
