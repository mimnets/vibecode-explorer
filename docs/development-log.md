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

## 2026-10-29: Owner request: browser view (Phase 6b), and a Python demo project

The owner asked when the dashboard could run as a web page rather than inside VS Code. Options presented: **A**, the extension serves the same dashboard on `localhost` while VS Code runs (about one phase, every feature kept), and **B**, a standalone app with no VS Code (several phases, read-only `git` commands would have to be allowed, and symbols and usages would be limited). **Owner decision:** A, as Phase 6b. B is not planned.

The owner has no Python project, so with their approval a small demo was created **outside this repository**, at `Documents\vibecode-python-demo`. It is a 7-file `shop` package with a test, an intentional `orders.py`/`payments.py` circular import, 2 commits and 1 uncommitted change. A dry run of the graph builder on it found the expected 7 local imports, `os` as a package and the one loop.

## 2026-10-29: Phase 6b: open the dashboard in the browser

**Approved:** the owner approved the plan with the recommended choices: stop on exit, after 30 minutes idle or by command, and a new key per click.

**What:** an **Open in Browser** button and command, plus **Stop Browser View**. The browser shows the same dashboard; clicks on files, diffs and notes open in VS Code, and permission dialogs appear there. **How:** the dashboard logic moved from the panel class into `DashboardSession` (`session.ts`), so the VS Code panel and each browser tab run the same code with their own opaque ids. The page markup moved to `page.ts`, and the editor helpers to `open.ts`, which avoids a `session.ts` ↔ `dashboard.ts` circular import. `browserView.ts` is a Node `http` server: the page, five allow-listed assets, an SSE stream for host-to-page messages and POST for page-to-host. `browserBridge.js` defines `acquireVsCodeApi` on top of these, and asks for the state again after a reconnect. `browser.css` supplies the theme colours VS Code normally injects, following the system's light or dark setting. No new dependency.

**Safety:** listens on 127.0.0.1 only, on a random port. A 32-byte key forms the first path segment of every URL and is compared in constant time; each click adds a new key, and all keys die with the server. The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding). POSTs need this server's `Origin`, `Sec-Fetch-Site: same-origin` when sent, `application/json` (which blocks simple cross-site form posts) and a 32-hex tab id. The body is capped at 64 KB, with at most 5 tabs. Responses carry `no-store`, `nosniff`, `no-referrer`, `X-Frame-Options: DENY` and the page's strict CSP (nonce scripts, `connect-src 'self'`, `frame-ancestors 'none'`). Messages go through the same `parseWebviewMessage` validation. The server is stopped on deactivate, after 30 minutes without requests, or by command, and it refuses to start in Restricted Mode. AGENTS.md now names this as the only server the extension may run.

**Verified automatically:** lint (with the browser globals added to the webview ESLint config). 35 unit tests, including request checks for a missing, wrong or truncated key, DNS rebinding, other ports, cross-site fetches, plain and encoded path traversal, wrong methods, POSTs with no or a foreign Origin, `text/plain` bodies and bad tab ids, plus the CSP and the browser page markup. 56 integration checks against the real server: the page with key and CSP header, 404 without the key, 421 for a foreign Host, assets served, an SSE tab receiving the state after `ready`, 403 for a POST without Origin, a browser `open` message opening `util.ts` in VS Code, no connection from the machine's LAN address, Stop telling the tab and refusing connections, and the idle stop (with a 300 ms test timeout). All existing checks still pass after the refactor. **Not verified automatically:** the page in a real browser (the bridge, the theme colours, the graph). This needs the owner's GUI check.

**Limitations:** needs VS Code running. The browser uses its own colours, not the VS Code theme. `vscode.env.openExternal` may ask the owner to confirm opening the link the first time. One VS Code window owns the server, and another window starts its own on a different port.

## 2026-10-29: Owner's first look at the browser view, and four small fixes

**Owner evidence (partial GUI check of Phase 6b):** the owner's screenshot shows the dashboard in Chrome at `127.0.0.1:<random port>/<key>/`, with the History tab (latest 18 commits), the dependency graph (39 files, 77 imports) and Details for `src/extension/explain.ts` all rendered in the browser's light colours. Not yet shown: clicks opening files in VS Code, notes, the AI sessions tab and Stop. So Phase 6b stays "Awaiting owner check".

**Fixed, from the screenshot:**
1. **Overlapping graph labels.** The layout now counts each label in its node's size (`nodeDimensionsIncludeLabels`) and spreads nodes a little further. Labels get a faint backdrop, so they stay readable where they cross edges.
2. **"explain.ts … uses explain.ts".** In plain words, a file whose name matches the selected file, or another listed file, is now shown with its folder (`src/analysis/explain.ts`).
3. **Imports wrapping mid-word.** `[local]` / `[external]` no longer break across lines, and code text wraps between words before breaking inside one (`overflow-wrap: anywhere` instead of `word-break: break-all`).
4. **A `../../../package.json` "unknown import" node.** It came from the manifest unit test's `require`, which points out of the project from the source folder. The test now reads the file with `fs` instead, so there is no import edge. A dry run of the graph builder on this repository finds no import that is neither local nor a package.

**Verified automatically:** lint, 35 unit tests (one new check for same-name files) and 58 integration checks. **Not verified automatically:** how the new layout and label backdrop look. This needs the owner's GUI check.

## 2026-10-30: Owner GUI check of Phase 6b (browser view)

The VSIX was rebuilt (`npm run package`) and, with the owner's yes, installed into their VS Code (`code --install-extension vibecode-explorer.vsix --force`). The `url.parse()` deprecation warning printed during install comes from the VS Code CLI, not this extension (no `url.parse` in `src/`).

**Owner evidence:** in the browser view, the graph labels no longer overlap; clicking a file opened it in VS Code; **Stop Browser View** stopped the page. Phase 6b is now owner-verified. Next: the Phase 4 notes check.

## 2026-10-30: Owner GUI check of Phase 4 (notes)

**Owner evidence:** in the VS Code dashboard, **Add note** on a file showed the "Save notes in .vibecode/notes/" question once; after **Yes** a new Markdown note opened in the editor; Details then listed it as Notes (1); a second **Add note** skipped the question. The note was created as `.vibecode/notes/2026-10-30-note-about-agentlogs-test-ts-testing-notes.md`, and no other file changed. It is left uncommitted, as designed. Not explicitly checked: clicking a listed note to open it. Phase 4 is now owner-verified. Next: the Phase 4b AI sessions check.

## 2026-10-30: Owner request: view code in the browser (Phase 6c)

The owner asked whether the code itself could be seen in the browser view instead of opening in VS Code. **Owner decisions:** code **and** diffs shown in the browser (notes keep opening in VS Code), plain text with line numbers (no syntax-highlighting dependency), and planned **after** the three remaining GUI checks (4b, 5, 6), before Phase 7. Added to the roadmap as Phase 6c. Not yet planned in detail or approved for building.

The owner also asked whether notes could be done fully in the browser. Today **Add note** works from the browser, but the permission question, the title box and the editor appear in VS Code. Kept as an open idea, not part of 6c.

## 2026-10-30: Owner GUI check of Phase 4b (AI sessions)

**Owner evidence:** the AI sessions tab asked for permission in VS Code, then showed the totals and session list; a session's prompts, tokens and changed files were shown; the owner saw no secrets in clear text. Phase 4b is now owner-verified. Next: the Phase 5 learning aids check.

## 2026-10-30: Owner question: browser only, without VS Code?

The owner found VS Code crowded with the agent chat, code and dashboard together, and asked whether to drop the VS Code side and use only the browser. Explained: the browser view depends on the extension for Git, symbols and usages, permissions and opening files; browser-only means option B (rejected 2026-10-29: several phases, needs `git` commands, fewer symbol features). **Owner decision:** keep the extension running in the background and make the browser the main screen. Phase 6c now also includes an option to open the browser view automatically when the project opens. Option B stays not planned.

## 2026-10-30: Owner GUI check of Phase 5 (learning aids)

**Owner evidence (in the browser view):** for `src/extension/explain.ts`, the **In plain words** box, the inline **?** explanations and the **About <symbol>** details all showed. This repository has no circular imports in its real code, so the red outline is checked with the Python demo in the Phase 6 check. Phase 5 is now owner-verified apart from that.

## 2026-10-30: Owner GUI check of Phase 6 (Python), and Phase 5's red outline

**Owner evidence:** with `Documentsibecode-python-demo` open, the graph showed the `shop` package's Python files and the test, `orders.py` and `payments.py` were outlined in red as a circular import, and the remaining steps (the circular-import tip, 1 workspace change, 2 commits) worked. Phase 6 is owner-verified, and so is Phase 5's red outline. All implemented phases (0–6b) are now owner-verified. Next: plan Phase 6c.

## 2026-10-30: Phase 6c: code and diffs in the browser

**Approved:** the owner approved the plan with these choices: our own line comparison instead of the `diff` package, and the browser view stopping 30 minutes after its last tab closes, instead of after 30 minutes without requests. Earlier choices: code and diffs, plain text with line numbers, open-on-startup option.

**What:** in the browser view, opening a file, a change, a commit's file, a symbol or a usage now shows it on the page in place of the graph. That is code with line numbers, or a one-column before/after comparison (red removed, green added, distant unchanged lines folded), with the line highlighted for symbols and usages. **Back to graph** and **Open in VS Code** sit above it. A new setting, **Open browser view on startup** (off by default), opens the browser view when a trusted project opens. The VS Code panel works as before. **How:** `DashboardSession` takes a `codeInPage` flag (set for browser tabs), and `codeView.ts` builds the views. Files are read with `workspace.fs` and older versions through VS Code Git's `git:` URIs. `src/analysis/codeText.ts` is pure: line splitting, binary detection, size caps, and Myers' shortest-edit comparison (trimming common start and end lines first, at most 2,000 changed lines, memory kept small). A new `openInEditor` message reuses the existing editor helpers. No new dependency.

**Changed from the plan:** to open on startup, the extension now activates on `onStartupFinished`, after VS Code has started, so startup itself is not slowed. To keep that light in every window, `imports.ts` now loads the TypeScript parser on first use (about 250 ms saved per window). The manifest unit test now expects the two activation events.

**Safety:** sensitive files are refused before reading, in the working tree and in commits, including a rename's old name. Binary files are not shown. Files are cut off at 1 MB or 20,000 lines. Code reaches the page only over the existing keyed 127.0.0.1 connection and is drawn with `textContent`, so nothing in a file can run. The page still sends opaque ids only. The idle stop now waits for the last tab to close, so a page left open for reading keeps working. It still stops on VS Code exit and by command.

**Verified automatically:** lint. 42 unit tests: line endings, binary files, size caps, 400 random comparisons checked against a longest-common-subsequence reference (correct and smallest), the give-up limit, folding and numbering, a 20,000-line file compared in about 20 ms, the `openInEditor` message, and the code view existing only on the browser page. 64 integration checks: a modified file compared with HEAD, a deleted file's HEAD version, a new file, a renamed and a deleted commit file, a symbol's highlighted line, `.env` never shown (working tree, commit, or over the browser stream), a browser click delivering code without opening an editor, **Open in VS Code** opening `util.ts`, and an open tab keeping the server alive past the idle time until it closes. **Not verified automatically:** the code view in a real browser (layout, colours, scrolling to the line, Back to graph) and the startup setting. These need the owner's GUI check.

**Limitations:** no syntax colours. Comparisons are one column, not side by side. Very different versions show only the new version. Text that isn't UTF-8 may show odd characters. With the startup setting on, each VS Code window (and each Reload Window) opens a new browser tab.

## 2026-10-30: Owner GUI check of Phase 6c, and a file-tree request

**Owner evidence:** after reinstalling the VSIX, in the browser view: a file's code with line numbers, **Back to graph**, a commit file's red/green comparison, a symbol's highlighted line and **Open in VS Code** all worked. The **Open Browser On Startup** step was unclear to the owner and is not checked yet. It gets clearer steps.

**Owner request:** a file and folder hierarchy that can be opened and closed when needed, so the project's structure can be seen and files chosen from it. Plan to be proposed for approval.

## 2026-10-30: Phase 6d: Files tab

**Approved:** the owner approved the plan with the recommended choices: a fourth tab on the left, listing all project files.

**What:** a **Files** tab shows the project's folders and files as a tree that opens and closes, with **Expand all** and **Collapse all**. Each folder shows how many files it holds. Clicking a file shows its Details (and selects it in the graph). Double-clicking opens it: on the page in the browser view, in the editor in VS Code. Clicking a folder outlines its files in the graph. Changed files use the change colours, graph files have a small dot, and sensitive files are marked and never opened from the tree. **How:** `src/extension/files.ts` lists names with `workspace.findFiles`, skipping the same dependency and build folders as the graph but still listing sensitive names. `src/analysis/fileTree.ts` (pure) builds the tree. Graph and change ids are reused, so the graph highlight and the HEAD comparison work; other files get `p…` ids. Deleted files come from Git. The page builds a folder's contents only when it is opened, so large projects stay quick. No new dependency.

**Found while building:** Details asks VS Code's language support for symbols, which would open any file as text. For files from the tree that aren't in the graph, it now asks only for small text files, so images and other binary files are described but never opened as text.

**Verified automatically:** lint. 48 unit tests, including tree order (folders first, by name), file counts, ids and marks kept, duplicates and `..` paths ignored, the exclude glob (skips `node_modules` and `.git`, keeps `.env` names listed), and 5,000 files built in about 20 ms. 68 integration checks: in the sample repository the tree has `src/util.ts` with its graph id marked modified, the deleted `src/old.ts`, and `.env` marked sensitive with its change id, and no `.git` content. In the Python project it has `README.md` and `logo.png` with new ids and skips `.venv`. A binary `logo.png` is described with no symbols and shown as "binary". A browser tab receives the listing. **Not verified automatically:** the tree in the webview (opening and closing folders, expand and collapse, folder highlight, double-click). This needs the owner's GUI check.

**Correction:** the Phase 6c entry said 66 integration checks. That count included two setup lines of the test runner; the real number was 64.

**Limitations:** the listing refreshes with **Refresh** or when the tab is opened, not live. No file icons or search. At most 5,000 files. Explanations for non-code files are short, because the graph knows nothing about them.

## 2026-10-30: Owner GUI check of Phase 6d, and select-and-centre from the tree

**Owner evidence:** after reinstalling the VSIX, the Files tab, its folders, opening and closing, and the file and folder clicks all worked. Phase 6d is owner-verified.

**Owner request, done straight away (small, within 6d):** clicking a file in the tree should show it selected in the graph. Now a click on a graph file brings the graph back (in the browser it may have been showing code), selects the file, and centres it with a short animation. A folder click also zooms to fit its files. Webview-only change. **Verified automatically:** lint and the existing tests. **Not verified automatically:** the selection and animation in the webview.

## 2026-10-30: Owner check of the startup setting

**Owner evidence:** with **Open Browser On Startup** ticked, reloading VS Code opened the dashboard in the browser by itself. Phase 6c is now fully owner-verified. The owner also reported that clicking files in the Files tab didn't change the graph. That was on the version installed before the select-and-centre change (`76c3518`), which has now been installed for a re-check.

## 2026-10-30: Owner check of select-and-centre

**Owner evidence:** after reinstalling, clicking a graph file in the Files tab selected and centred it in the graph. The earlier "graph won't change" report was from the previous version. Phases 0–6d are now all owner-verified.

## 2026-10-30: Phase 7: APIs and databases

**Approved:** the owner approved the plan with the recommended display (an **APIs** tab) and all four areas: JS/TS servers, Python web frameworks, HTTP calls and databases. The 14 local commits were pushed to GitHub with the owner's yes (`358b314..17e672f`).

**What:** a fifth tab, **APIs**, lists the routes the project defines (method, path, framework, file:line, calling files), the HTTP calls it makes (method, address with `*` for computed parts, matched routes, or "another server" / "no matching route found"), and its database tables and models (kind, table name, file, users). Clicking an item outlines its files in the graph and shows details on the right. Double-clicking, or **Open code**, opens the exact line. Four glossary terms were added: route, HTTP call, HTTP method, database model.

**How:** `src/extension/apis.ts` gathers the text; the readers are pure and unit-tested. JS/TS uses the TypeScript parser already used for imports (`loadTs` is now shared). Route rules: a method call whose first argument is a path starting with `/`, with a function argument or a server/router-like receiver. `axios` and its instances count as clients, not routers. Python reuses the comment- and string-aware scanner, which now also reports where each line and string starts. Mount prefixes are followed across files (up to 5 levels) using the existing JS and Python import resolution. Calls are matched by method and path across parameter styles. No new dependency.

**Safety:** read-only. Nothing is executed, no server is called, no database is opened. Sensitive files are never read (the test project's `.env` with a database URL is checked). Size caps as listed in the requirements.

**Verified automatically:** lint. 61 unit tests, 13 of them new: path joining and matching (`:id`, `{id}`, `<int:id>`, `[id]`, catch-alls, partly computed segments), call addresses (relative, `localhost`, other servers), Express/Fastify/route-chain routes with false positives rejected (`app.get('env')`, `map.get('/x')`), fetch and axios calls including instances and config objects, Next.js app and pages routes (route groups dropped), TypeORM/Sequelize/Mongoose models and Prisma uses, the scanner's line numbers, FastAPI/Flask prefixes and included routers, Django patterns and `include`, requests/httpx calls and Python ORM models (Pydantic `BaseModel` rejected), SQL and Prisma with comments ignored, and a cross-file combination. 73 integration checks: a new fourth sample folder `api-project` (Express with a mounted router, a Next.js route, FastAPI with a prefix, fetch and requests calls, SQL, Prisma and TypeORM) checks the routes with prefixes, a call matched to `GET /api/users/:id`, an unmatched call, another server, models with their users, the `.env` never read, a route opening at its line, and a browser tab receiving the listing. A dry run on this repository found one real call (the browser page's own `fetch('./message…')`, shown as unmatched) and no false routes or models. The Python demo has none, as expected. **Not verified automatically:** the APIs tab in the webview.

**Limitations:** pattern-based, so routes registered in loops, from configuration or through wrappers are missed, and unusual receivers named like a router may be counted. Addresses built entirely while running are listed without a match. SQL table use inside query strings is not traced. GraphQL, gRPC and OpenAPI files are not read.

## 2026-10-30: API demo project for the Phase 7 check

With the owner's approval, a small demo was created **outside this repository**, at `Documentsibecode-api-demo` (10 files, no Git, never run). It has an Express server with two routers mounted at `/api`, a web client with `fetch` calls (one to a missing route, one to another server), Prisma models used through the client, and a SQL table. A dry run of the readers on it found the expected 6 routes (with the `/api` mounts), 6 calls and 3 models. The VSIX with Phase 7 was installed with the owner's yes.

## 2026-10-30: Owner GUI check of Phase 7

**Owner evidence:** with `Documentsibecode-api-demo` open, the APIs tab showed the routes, HTTP calls and database models; the owner reported that all check steps worked (lists and counts, graph outline and "Called from", unmatched and other-server calls, model users, double-click opening the line). Phase 7 is owner-verified.

## Handoff for the next session (updated 2026-10-30)

**Where things stand:** Phases 0–7 are Done and owner-verified. GitHub is up to date to `17e672f`; later commits are local (pushing needs the owner's yes).

**Next:**
1. Plan **Phase 8** (preview alongside code: link preview pages to the source files that serve them, where provable statically).

**Open ideas, not scheduled:** notes written fully in the browser; syntax colours; a "No" answer to the notes question isn't remembered; notes break on file rename; AI sessions read Claude Code logs only; clicking a listed note wasn't explicitly owner-checked.
