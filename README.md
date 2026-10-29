# VibeCode Explorer

A private, local-first VS Code extension for seeing what changed during AI-assisted coding and how your files connect.

- **Workspace changes:** added, modified, deleted and untracked files, plus repository and branch. Click a file to open it or its diff against HEAD.
- **Dependency graph:** an interactive graph of JavaScript/TypeScript files and their local imports. Click a node to inspect it, double-click to open it, and zoom, pan or fit the view.
- **Details panel:** path, type, Git status, imports and code symbols for the selected file.
- **Preview:** opens your configured local app URL in VS Code's Simple Browser.

Nothing is uploaded and no AI is called. The extension only reads your project and never writes to it.

## How to use it with other projects

1. Install VibeCode Explorer into VS Code from a locally built VSIX package (see below).
2. Open Assurer, OpenHRApp or another project's folder.
3. Run **VibeCode Explorer: Open Dashboard** from the Command Palette (`Ctrl+Shift+P`).
4. Explore changes and code relationships without moving or copying that project's source files.

## Install from a VSIX

```bash
npm install
npm run package                                  # builds vibecode-explorer.vsix
code --install-extension vibecode-explorer.vsix --force   # installs into your VS Code
```

To update, rebuild and run the install command again, then run **Developer: Reload Window**. Always rebuild after pulling changes: an old `.vsix` keeps its old manifest. The changes pane needs VS Code's built-in **Git** extension to be enabled. Without it the graph still works and Git is shown as unavailable. To remove it, open the Extensions view and uninstall **VibeCode Explorer**.

## Run during development

1. `npm install`
2. Open this folder in VS Code and press **F5** (the "Run VibeCode Explorer" launch config).
3. In the new **Extension Development Host** window, open any project folder (File → Open Folder).
4. `Ctrl+Shift+P` → **VibeCode Explorer: Open Dashboard**.

What to click:
- **Workspace changes** (left): click a file to open its diff, or the HEAD version if it was deleted.
- **Graph** (centre): click a node to see details, double-click to open the file. Use **Fit**, **+**/**−** and **Re-layout**, scroll to zoom and drag to pan.
- **Details** (right): **Open source** jumps to the file.
- **Refresh** re-reads Git status and rescans imports. **Folder** switches between workspace folders.
- **Open Preview**: first set `vibecodeExplorer.previewUrl` (for example `http://localhost:3000`) in Settings and start your app yourself.

## Test

```bash
npm run lint              # ESLint
npm run test:unit         # pure logic (Node test runner)
npm run test:integration  # Extension Development Host against a disposable sample workspace
npm test                  # all of the above
```

The first integration run downloads an isolated VS Code into `.vscode-test/`. It builds a throwaway multi-root workspace in your temp folder: one Git repo with modified, deleted, untracked and `.env` changes, plus one folder without Git. It checks the dashboard against that workspace, then confirms that no sample file changed.

**Manual check (not automatable with `@vscode/test-electron`, which always disables Workspace Trust):** open an untrusted folder. The dashboard should show the Restricted Mode banner and no Git or graph data.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `vibecodeExplorer.previewUrl` | `""` | Local URL for **Open Preview**. Only http/https on localhost, 127.0.0.1 or [::1]. |
| `vibecodeExplorer.maxGraphFiles` | `500` | Upper bound on files scanned for the graph. |

## Known limitations (Phase 1)

- The graph covers JS/TS only. Path aliases (`@/…`, tsconfig `paths`), and `node_modules` packages are not resolved. Aliases and dynamic imports appear as **unknown** nodes, and packages are listed only in the details panel.
- Changes are labelled **workspace changes**. The extension does not know which agent made a change.
- The graph and Git data refresh only when you press **Refresh**, not live.
- Symbols depend on the language support installed in VS Code.
- Files whose names look sensitive (`.env*`, keys, `secrets.*`, `credentials.*`) are never read. A source file named `secrets.ts` is therefore skipped too.
- Preview uses VS Code's Simple Browser. It does not start servers or inject code into your app.

See [docs/architecture.md](docs/architecture.md) and [docs/requirements.md](docs/requirements.md).

License: UNLICENSED (private, proprietary).
