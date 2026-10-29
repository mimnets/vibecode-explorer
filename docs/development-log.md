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
