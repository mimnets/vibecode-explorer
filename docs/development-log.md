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
