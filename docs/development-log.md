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
