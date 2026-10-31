# VibeCode Explorer

A free, local-first VS Code extension for seeing what changed during AI-assisted coding and how your files connect.

- **Workspace changes:** added, modified, deleted and untracked files, plus repository and branch. Click a file to open it or its diff against HEAD.
- **History:** the latest commits with their messages. Click one to see the files it changed, highlighted in the graph, and open a before/after diff of any of them.
- **Notes:** attach your own notes (what, why, decision) to a file or a commit. They are saved as Markdown files in `.vibecode/notes/`, only after you allow it.
- **AI sessions:** your prompts to Claude Code, the security points in its replies, tokens used, files it changed (as a review checklist to tick off), and short learning tips. Read from Claude Code's own logs on your computer, only after you allow it.
- **Files:** a tree of the project's folders and files that you can open and close. Click a file for its details, or a folder to see its files in the graph.
- **Learn:** how to run the project, a reading order, which files have tests, TODOs, packages and hotspots. Plus **Copy context for AI** in Details and folder rules in Health.
- **Project:** the plan's phases and current stage, each phase's steps, folders outside the intended layout, and issues you add.
- **Health:** a project checklist, VS Code's problems explained in plain words, secret-looking text (location only), possibly unused and near-duplicate files, and safe points to go back to.
- **Pages & APIs:** the pages of your app with the files that make each one (preview a page next to its code), the web routes your code defines, the HTTP calls it makes (matched to routes), and its database tables and models, all found by reading the code. Nothing is run or connected.
- **Dependency graph:** an interactive graph of JavaScript, TypeScript and Python files and their local imports. Click a node to inspect it, double-click to open it, and zoom, pan or fit the view.
- **Details panel:** path, type, Git status, imports and code symbols for the selected file, with an **In plain words** summary (what it uses, what uses it, its role, history and notes) and code tips.
- **Learning aids:** click **?** next to a term for a short explanation. Clicking a symbol explains it from its declaration and usages. Circular imports are outlined in red in the graph. No AI is used.
- **Open in Browser:** shows the same dashboard in your web browser (this computer only) while VS Code runs. Files, changes and symbols you click are shown right on the page, with line numbers and before/after comparisons, so the browser can be your main screen.
- **Preview:** opens your configured local app URL in VS Code's Simple Browser.

Nothing is uploaded and no AI is called. The extension only reads your project. The one exception is your own notes, which it saves in `.vibecode/notes/` only after you allow it.

## Install

You need VS Code 1.100 or later, or an editor built on it (Cursor, Windsurf, VSCodium). Pick one of the three ways below.

### From the extension store (easiest)

The extension is being listed in the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mimnets.vibecode-explorer) and on [Open VSX](https://open-vsx.org/extension/mimnets/vibecode-explorer). Until those links work, use the release file below.

1. Open the Extensions view: press `Ctrl+Shift+X` (`Cmd+Shift+X` on a Mac).
2. Type **VibeCode Explorer** in the search box.
3. Click **Install** on the result from publisher **mimnets**.

VS Code installs from the Marketplace; Cursor, Windsurf and VSCodium install from Open VSX. Updates arrive on their own.

### From a release file

1. Open the [Releases page](https://github.com/mimnets/vibecode-explorer/releases) and download `vibecode-explorer-<version>.vsix` from the newest release.
2. In VS Code, open the Extensions view (`Ctrl+Shift+X`).
3. Click the **…** menu at the top of the Extensions view and choose **Install from VSIX…**.
4. Pick the file you downloaded. VS Code installs it and may ask you to reload.

To update, install the newer file the same way. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

### From the source code

See [Build and install from source](#build-and-install-from-source) below (needs Node.js).

## User guide

All commands are in the Command Palette: press `Ctrl+Shift+P` and type **VibeCode**.

### Open it in VS Code

1. Open a project folder (**File → Open Folder**). Any project works: VibeCode Explorer reads it where it is and never copies or moves its files.
2. If VS Code asks whether you trust the folder, click **Yes, I trust the authors**. In Restricted Mode the dashboard shows a banner and no data.
3. Press `Ctrl+Shift+P`, type **VibeCode Explorer: Open Dashboard**, and press Enter.
4. The dashboard opens as an editor tab. Running the command again brings that tab to the front.

### Close it in VS Code

- Click the **×** on the dashboard's tab, or click the tab and press `Ctrl+F4`.
- Closing the dashboard doesn't stop the browser view. Stop that separately (see below).

### Use it

- **Workspace changes** (left, first tab): click a file to open its diff, or the HEAD version if it was deleted.
- **History** (left, second tab): the latest 50 commits, and **Load more** shows up to 200. Click a commit to see its full message and changed files in Details. Those files are outlined in blue in the graph. Click a file to open its before/after diff.
- **AI sessions** (left, third tab): click **Allow reading Claude Code logs** once per project. You'll see totals and a list of sessions. Click one for its prompts, tokens, changed files (outlined in blue in the graph), commits made during it, security mentions and tips. The changed files form a **Review checklist**: tick each file once you've looked at it (click its name to see the change), and read the automatic checks (tests changed, anything not committed, security mentions, sensitive files). Ticks are kept in VS Code, not in your project, and the session list shows "reviewed 3/7".
- **Files** (left, fourth tab): the project's folders and files as a tree. Click a folder's arrow to open or close it, or use **Expand all** and **Collapse all**. Click a file to see its Details; if it's in the graph, the graph shows it selected and centred. Double-click a file to open it. Click a folder to outline its files in the graph and zoom to them. Changed files are coloured, a small dot marks files that are in the graph, and sensitive files are marked and never opened. `node_modules`, `.git` and build folders are skipped.
- **Pages & APIs** (left, fifth tab), **Pages** first: every page your code defines (Next.js `app/` and `pages/`, React or Vue Router routes, HTML files, and server pages rendered by Express, Flask, FastAPI or Django) with the files that make it. Click a page to outline its files in the graph. In Details, edit the address if it has a part like `:id`, then click **Preview**: in VS Code the page's code opens with the running page beside it in the Simple Browser; in the browser view the code and the page appear side by side. Set `vibecodeExplorer.previewUrl` and start your app first. Below the pages: **Routes** (for example `GET /api/users/:id`, from Express, Fastify, Hono, Next.js, FastAPI, Flask or Django), **HTTP calls** (`fetch`, `axios`, `requests`, `httpx`, with the route each one reaches, or "no matching route found" / "another server"), and **Database** (SQL tables, Prisma models and ORM models, with the files that use them). Click an item to outline its files in the graph and see its details. Double-click it, or click **Open code**, to open its line. A `*` in an address stands for a part computed while the program runs.
- **Health** (left, sixth tab): **Checklist** (README, .gitignore, license, code checker, tests, locked versions, .env files ignored by Git), **Problems** (errors and warnings VS Code found, each with a plain explanation; files with problems get a red or yellow halo in the graph; click one to open the line), **Secret-looking text** (file and line only, never the value; opens in VS Code), **Possibly unused files** and **Near-duplicate names** (like `utils.ts` and `utils2.ts`), and **Safe points**: tagged commits, the commit before each AI session, and commits you mark with **Mark as safe point** in History. Each safe point lists the `git` commands to go back; you copy and run them yourself, the extension never does.
- **Project** (left, seventh tab): the **current stage** and progress, read from your plan table (for example `docs/roadmap.md` with Phase and Status columns). Click a phase to see its steps ticked: plan, approved, built, tested, checked by you, logged. It also shows how many requirements are met, warns about **folders that are not in your intended layout** (a "Layout" section in `AGENTS.md`, `CLAUDE.md` or `docs/structure.md`), and lists **issues**. Type a title and details and click **Add issue**: it's saved as a note in `.vibecode/notes/`, and your plan files are never changed. To close an issue, change `issue: open` to `issue: closed` in its file.
- **Learn** (left, eighth tab): **How to run** (the commands to install, start, build and test, from `package.json`, Python files and the README; copy them into a terminal yourself), **Reading order** (where to start reading), **Test map** (which files have a test; **Show test colours in the graph** paints tested files green, untested grey and tests blue), **TODO list**, **Packages** (what each one is, its license, and whether anything uses it) and **Hotspots** (click **Find hotspots**: the files changed most often).
- **Copy context for AI** (Details, under "In plain words"): copies a short summary of the file to paste into your AI chat, so the agent needs to read less.
- **Folder rules** (Health tab): click **Create rules file**, then write lines like `` `src/ui/` must not import `src/database/` `` in `.vibecode/rules.md`. Imports that break a rule are listed and get a dashed orange ring in the graph.
- **Commit messages** (History): a ✎ hint appears under commits whose message doesn't follow the usual `type: what changed` form, such as `fix: stop the login loop`.
- **Notes in the browser:** under **Notes** in Details, type a title and text and click **Save note**. Click a note to read it on the page. If you answered **No, don't ask again** to the notes question, click **Ask me again** to turn notes back on.
- **Syntax colours:** the browser's code view colours keywords, text in quotes, comments and numbers.
- **Graph** (centre): click a node to see details, double-click to open the file. Use **Fit**, **+**/**−** and **Re-layout**, scroll to zoom and drag to pan. Circular imports are outlined in red.
- **Details** (right): **In plain words** at the top describes the selected file, its role (entry point, hub or leaf), and up to 3 tips. Click **?** next to a term for an explanation. **Open source** jumps to the file. Click a symbol to jump to it, see an explanation, and list where it is used (**Used in**). The files that use it are outlined in purple in the graph. Symbols need VS Code's language support for that file type (built-in for JS/TS; for Python, install the Python extension).
- **Notes** (in Details, for a file or a commit): **Add note** asks once per project whether notes may be saved in `.vibecode/notes/`, asks for a title, then opens the new note in the editor. Click a note to open it. Edit or delete notes like any other file. Whether to commit them is up to you.
- **Refresh** (toolbar) re-reads Git status and rescans imports. The dashboard doesn't update by itself. **Folder** switches between workspace folders.
- **Open Preview** (toolbar): opens the app's start page. To open a particular page next to its code, use **Preview** on a page in the Pages & APIs tab. First set `vibecodeExplorer.previewUrl` (for example `http://localhost:3000`) in Settings, and start your app yourself.

### Open it in the browser

1. Keep VS Code open with the project. The browser view only works while VS Code runs.
2. Click **Open in Browser** in the dashboard toolbar, or run **VibeCode Explorer: Open Dashboard in Browser**.
3. If VS Code asks whether to open the link, click **Open**.
4. Your default browser opens a private `http://127.0.0.1:<port>/<secret key>/` link. Only this computer can reach it, and each click makes a new secret link. Don't share the link.

### Use it in the browser

- The page works like the VS Code dashboard: same tabs, graph and Details.
- **Code shows on the page.** Double-click a file in the graph, click **Open source**, or click a file under Workspace changes. The graph area then shows the code with line numbers.
- **Changes show as a comparison.** A changed file, or a file in a commit (History tab), shows removed lines in red and added lines in green. Unchanged lines far from a change are folded into "… N unchanged lines".
- **Symbols jump to their line.** Click a symbol or a "Used in" place in Details: the file opens on the page with that line highlighted.
- Click **Back to graph** to see the graph again, or **Open in VS Code** to open the same file or comparison in VS Code.
- Sensitive files (`.env`, keys and so on) and binary files are never shown. Very large files show only their first part.
- Notes still open in VS Code, and permission questions (notes, AI session logs) also appear there.
- Colours follow your system's light or dark setting, not the VS Code theme. Up to 5 browser tabs can be open at once.

### Make the browser your main screen

1. Open Settings (`Ctrl+,`) and search for **VibeCode**.
2. Tick **Open Browser On Startup**.
3. From now on, when you open a trusted project in VS Code, the dashboard opens in your browser by itself. Keep VS Code open in the background (for the agent chat and editing) and work in the browser, for example on a second monitor.

Each VS Code window, and each **Reload Window**, opens a new browser tab.

### Close the browser view

- Run **VibeCode Explorer: Stop Browser View**. The page shows "The browser view has stopped". Closing the browser tab alone leaves the view running for 30 more minutes, then it stops by itself.
- It also stops by itself when VS Code closes, or 30 minutes after its last browser tab was closed. While a tab is open it keeps running.
- To open it again, click **Open in Browser** again. Old links stop working.

### Permissions

- VibeCode Explorer asks before it reads Claude Code's logs and before it saves the first note in a project. Only a "Yes" is remembered.
- **VibeCode Explorer: Reset Permissions** makes it ask again for both.

### Uninstall

Open the Extensions view (`Ctrl+Shift+X`), find **VibeCode Explorer**, and click **Uninstall**.

## Build and install from source

For developers. You need [Node.js](https://nodejs.org/) 22 or later and VS Code (with its `code` command on your PATH).

```bash
git clone https://github.com/mimnets/vibecode-explorer.git
cd vibecode-explorer
npm install
npm run package                                  # builds vibecode-explorer.vsix
code --install-extension vibecode-explorer.vsix --force   # installs into your VS Code
```

To update, rebuild and run the install command again, then run **Developer: Reload Window**. Always rebuild after pulling changes: an old `.vsix` keeps its old manifest. The changes pane needs VS Code's built-in **Git** extension to be enabled. Without it the graph still works and Git is shown as unavailable.

## Run during development

1. `npm install`
2. Open this folder in VS Code and press **F5** (the "Run VibeCode Explorer" launch config).
3. In the new **Extension Development Host** window, open any project folder (File → Open Folder).
4. `Ctrl+Shift+P` → **VibeCode Explorer: Open Dashboard**.

Then use it as described in the [User guide](#user-guide).

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
| `vibecodeExplorer.openBrowserOnStartup` | `false` | Open the browser view by itself when a trusted project opens. |
| `vibecodeExplorer.maxGraphFiles` | `500` | Upper bound on files scanned for the graph. |

## Known limitations (Phase 1)

- The graph covers JS/TS and Python. Python imports are found from the project root, a `src/` folder and the file's own folder. `sys.path` changes and installed packages are not followed, and modules that aren't found are listed as packages. Path aliases (`@/…`, tsconfig `paths`), and `node_modules` packages are not resolved. Aliases and dynamic imports appear as **unknown** nodes, and packages are listed only in the details panel.
- Changes are labelled **workspace changes**. The extension does not know which agent made a change.
- The graph and Git data refresh only when you press **Refresh**, not live.
- Symbols depend on the language support installed in VS Code.
- Files whose names look sensitive (`.env*`, keys, `secrets.*`, `credentials.*`) are never read. A source file named `secrets.ts` is therefore skipped too.
- History needs VS Code's built-in Git extension. It can't list the files of a repository's first commit, because there is no earlier commit to compare with. Merge commits are compared with their first parent.
- Notes are linked to a file by its path. If the file is renamed or moved, its notes lose the link (edit `about:` in the note to fix it).
- AI sessions read Claude Code only for now. Security mentions are found by keywords, not by reviewing your code. Token counts come from the logs, and there's no money estimate. Secret hiding uses patterns and can miss unusual formats.
- The browser view needs VS Code running and uses its own light/dark colours (it follows your system setting, not the VS Code theme). Up to 5 browser tabs at once. Code in the browser has no syntax colours, comparisons are one column, and versions that differ in more than 2,000 lines show only the new version.
- The APIs tab reads common patterns, not every possible way to define a route. Routes registered in loops or from configuration are missed, and SQL tables used only inside query strings show no users.
- Pages are what the code shows, not what the running app does: the dashboard can't see which page you open inside the preview. Apps that forbid being shown inside another page stay blank in the browser view's preview; use its "open in a new tab" link. After changing the preview URL, reload the browser page.
- Health shows the problems VS Code already found, which for TypeScript are mostly in files you have opened. Secret detection is pattern-based and also lists fake keys in tests. "Possibly unused" can't see files loaded by scripts or configs.
- Preview uses VS Code's Simple Browser. It does not start servers or inject code into your app.

See [docs/architecture.md](docs/architecture.md) and [docs/requirements.md](docs/requirements.md).

## Publish a new version (maintainers)

Releases are built and published by GitHub Actions. Nothing is uploaded from your own computer.

1. Raise `"version"` in `package.json` (for example `1.0.2`) and run `npm install` so `package-lock.json` matches.
2. Add a `## 1.0.2 (date)` section at the top of [CHANGELOG.md](CHANGELOG.md). Its text becomes the release notes.
3. Commit and push, then push a matching tag: `git tag -a v1.0.2 -m "VibeCode Explorer 1.0.2"` and `git push origin v1.0.2`.
4. The **Release** workflow runs every check. If they pass, it creates the GitHub release with the `.vsix` file attached, then sends the same file to Open VSX.
5. Upload the same `.vsix` file to the VS Code Marketplace by hand (see below).

### One-time setup: Open VSX

1. Go to [open-vsx.org](https://open-vsx.org), click **Log In** and sign in with GitHub.
2. Create a free account at [accounts.eclipse.org](https://accounts.eclipse.org) and enter your GitHub username in its profile.
3. On open-vsx.org, click your picture, then **Settings**. Under **Profile**, click **Log in with Eclipse**, then **Show Publisher Agreement** and **Agree**.
4. Under **Access Tokens**, click **Generate New Token** and copy it (it is shown once).
5. In the GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**. Name `OVSX_TOKEN`, paste the token, **Add secret**.

The namespace (`mimnets`, the `publisher` in `package.json`) is created on the first upload. If the Open VSX step of a release fails, fix the cause, then open the **Actions** tab, choose **Publish to Open VSX**, click **Run workflow** and enter the tag (for example `v1.0.1`). It sends that release's file again.

### One-time setup and each release: VS Code Marketplace

Publishing is free. Azure DevOps personal access tokens stop working on 1 December 2026, so this project uploads by hand instead of storing a token.

1. Open the [Marketplace management page](https://marketplace.visualstudio.com/manage) and sign in with a Microsoft account.
2. The first time: click **Create publisher**, use the ID `mimnets` (it must match `publisher` in `package.json`) and a display name, and save.
3. Download the `.vsix` file from the GitHub release.
4. First version: click **New extension → Visual Studio Code** and upload the file. Later versions: click **…** next to the extension, choose **Update** and upload the new file.
5. The Marketplace checks the file for a few minutes; then it appears in VS Code's Extensions search.

## License

[MIT](LICENSE): free to use, change and share, as long as the copyright notice is kept.
