# VibeCode Explorer

A private, local-first VS Code extension for seeing what changed during AI-assisted coding and how your files connect.

- **Workspace changes:** added, modified, deleted and untracked files, plus repository and branch. Click a file to open it or its diff against HEAD.
- **History:** the latest commits with their messages. Click one to see the files it changed, highlighted in the graph, and open a before/after diff of any of them.
- **Notes:** attach your own notes (what, why, decision) to a file or a commit. They are saved as Markdown files in `.vibecode/notes/`, only after you allow it.
- **AI sessions:** your prompts to Claude Code, the security points in its replies, tokens used, files it changed, and short learning tips. Read from Claude Code's own logs on your computer, only after you allow it.
- **Dependency graph:** an interactive graph of JavaScript/TypeScript files and their local imports. Click a node to inspect it, double-click to open it, and zoom, pan or fit the view.
- **Details panel:** path, type, Git status, imports and code symbols for the selected file, with an **In plain words** summary (what it uses, what uses it, its role, history and notes) and code tips.
- **Learning aids:** click **?** next to a term for a short explanation. Clicking a symbol explains it from its declaration and usages. Circular imports are outlined in red in the graph. No AI is used.
- **Preview:** opens your configured local app URL in VS Code's Simple Browser.

Nothing is uploaded and no AI is called. The extension only reads your project. The one exception is your own notes, which it saves in `.vibecode/notes/` only after you allow it.

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
- **History** (left, second tab): the latest 50 commits, and **Load more** shows up to 200. Click a commit to see its full message and changed files in Details. Those files are outlined in blue in the graph. Click a file to open its before/after diff.
- **Graph** (centre): click a node to see details, double-click to open the file. Use **Fit**, **+**/**−** and **Re-layout**, scroll to zoom and drag to pan.
- **Details** (right): **Open source** jumps to the file. Click a symbol to jump to it and list where it is used (**Used in**). The files that use it are outlined in purple in the graph. This needs VS Code's language support for that file type (built-in for JS/TS).
- **Notes** (in Details, for a file or a commit): **Add note** asks once per project whether notes may be saved in `.vibecode/notes/`, asks for a title, then opens the new note in the editor. Click a note to open it. Edit or delete notes like any other file. Whether to commit them is up to you.
- **AI sessions** (left, third tab): click **Allow reading Claude Code logs** once per project. You'll see totals and a list of sessions. Click one for its prompts, tokens, changed files (outlined in blue in the graph), commits made during it, security mentions and tips. **VibeCode Explorer: Reset Permissions** in the Command Palette makes it ask again (for notes too).
- **In plain words** (top of Details): facts about the selected file, its role (entry point, hub or leaf), and up to 3 tips (circular import, large file, hub without a test). Click **?** next to any term for an explanation.
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
- History needs VS Code's built-in Git extension. It can't list the files of a repository's first commit, because there is no earlier commit to compare with. Merge commits are compared with their first parent.
- Notes are linked to a file by its path. If the file is renamed or moved, its notes lose the link (edit `about:` in the note to fix it).
- AI sessions read Claude Code only for now. Security mentions are found by keywords, not by reviewing your code. Token counts come from the logs, and there's no money estimate. Secret hiding uses patterns and can miss unusual formats.
- Preview uses VS Code's Simple Browser. It does not start servers or inject code into your app.

See [docs/architecture.md](docs/architecture.md) and [docs/requirements.md](docs/requirements.md).

License: UNLICENSED (private, proprietary).
