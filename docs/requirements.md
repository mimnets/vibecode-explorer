# Requirements

## Permanent product requirements

These 12 requirements define the final product. They don't change from phase to phase. Phases deliver them a piece at a time (see [roadmap.md](roadmap.md)). A requirement is marked **Met** only after it has been implemented and verified, with the evidence recorded in [development-log.md](development-log.md).

Status key: **Partial** = some of it is delivered and verified. **Constraint** = a rule every phase must keep, checked each phase. **Planned** = not started.

| # | Requirement | Status after Phase 1 |
| --- | --- | --- |
| 1 | See files created, changed or deleted during AI-assisted coding. | Partial: current working-tree changes against HEAD. Phase 3 adds commit history with the files each commit changed (owner-verified). Phase 4b adds the files changed in each Claude Code session (owner-verified). |
| 2 | Understand modules, functions, classes and variables. | Partial: a per-file symbol list. Phase 2 adds go-to and "used in" (owner-verified). Phase 5 adds plain-language explanations (owner-verified). |
| 3 | Visually explore files, imports, functions, APIs and database relationships. | Partial: a file-import graph for JS/TS relative imports, and Python since Phase 6 (owner-verified). Phase 2 highlights the files that use a symbol. Phase 7 adds routes, HTTP calls and database models with their files (owner-verified). |
| 4 | Understand why important changes were made. | Partial: Phase 3 shows each commit's full message. Phase 4 adds the owner's notes on files and commits (owner-verified). |
| 5 | Preview working websites alongside their code. | Partial: opens a user-configured local URL in Simple Browser. Phase 8 lists the app's pages with the files that make them and previews a page next to its code (owner-verified). |
| 6 | Learn programming incrementally while developing. | Partial: Phase 4b shows rule-based tips for each AI session (owner-verified). Phase 5 adds plain-language file and symbol explanations, a glossary and code tips (owner-verified). Phase 14 adds a review checklist of each AI session's changed files (owner-verified). Phase 11 adds the Learn tab, copy context for AI, folder rules and commit hints (owner-verified). |
| 7 | Preserve educational notes, architecture explanations and decisions. | Partial (owner-verified): Phase 4 saves the owner's notes (what, why, decision) as Markdown in `.vibecode/notes/`, opt-in. Phase 10 adds issues saved as notes, Phase 12 notes written in the browser, and Phase 13 closing and reopening issues (owner-verified). |
| 8 | Work across projects and programming languages. | Partial: any folder, multi-root, no-Git. Graph covers JS/TS and Python (Phase 6, owner-verified), with a language list for adding more. |
| 9 | Support Claude, Qwen, Gemini and other agents without proprietary agent APIs. | Constraint: kept. Data comes from Git and files, never from agent APIs. |
| 10 | Save tokens through local static analysis and Git data. | Constraint: kept. No LLM calls. |
| 11 | Minimise cost with free, open-source dependencies. | Constraint: kept. Runtime deps are MIT/Apache-2.0 only. |
| 12 | Protect private source code, secrets and local project data. | Constraint: kept. See the security requirements below. |

## Phase 1 scope (MVP): complete

The owner accepted this on 2026-10-29 after using it in their own VS Code. The known limitations are listed in [development-log.md](development-log.md).

| # | Requirement | Status |
| --- | --- | --- |
| A | Command "VibeCode Explorer: Open Dashboard"; no startup activation (it also activates when VS Code restores a dashboard tab left open) | Done |
| B | Workspace detection: single/multi-root, no-Git, empty, Windows paths | Done |
| C | Git changes (added/modified/deleted/untracked, repo, branch, refresh, click-to-open/diff), labelled "workspace changes" | Done |
| D | Interactive JS/TS file-import graph (inspect, open, zoom, pan, fit, refresh); unresolved imports shown as unknown | Done |
| E | Info panel: path, type, Git status, imports, symbols, open action; no LLM | Done |
| F | Preview: user-configured local URL, explicit action, scheme/host validation, no server start | Done |

## Phase 2 scope: inside files

| # | Requirement | Status |
| --- | --- | --- |
| A | Symbols in Details are clickable: jump to the definition | Done |
| B | "Used in" list for the clicked symbol, from `vscode.executeReferenceProvider`. Each entry opens at its line | Done |
| C | Graph highlights the files that use the symbol | Done (owner-verified in the GUI) |
| D | Opaque `s…`/`r…` ids only. Results inside the folder only, excluded and sensitive paths hidden, capped at 100 | Done |
| E | Clear message when no language support answers | Done |

Owner-verified 2026-10-29 (see the development log). Non-goals: a function call graph, code explanations, new language parsers.

## Phase 3 scope: change history

Approved by the owner on 2026-10-29.

| # | Requirement | Status |
| --- | --- | --- |
| A | History tab next to Workspace changes: latest 50 commits (headline, author, date, short id). **Load more** up to 200 | Done (owner-verified in the GUI) |
| B | Click a commit to show its full message and the files it touched (added, modified, deleted, renamed) | Done |
| C | Graph highlights the files of the selected commit | Done (owner-verified in the GUI) |
| D | Click a file to open VS Code's read-only before/after diff. Added files open the new version, deleted files the previous one | Done |
| E | Built-in Git extension API only (`log`, `diffBetween`, `toGitUri`). No shell, no new dependency, read-only | Done |
| F | Opaque `k…` (commit) and `h…` (file) ids. Sensitive files listed but never opened. Files outside the folder hidden. Caps: 200 commits, 300 files per commit. Off in Restricted Mode | Done |

Changed from the plan: commit ids use `k…` because `c…` is already used by the changes list. The first commit's files can't be listed (see the development log). Owner-verified 2026-10-29. Non-goals: diffs drawn inside the dashboard, blame, branch graphs, search, guessing which AI session made a change, notes.

## Phase 4 scope: notes and decisions

Approved by the owner on 2026-10-29 with the recommended choices: the `.vibecode/notes/` folder, and asking once per project.

| # | Requirement | Status |
| --- | --- | --- |
| A | Details shows **Notes (n)** for the selected file or commit, with title and date. Clicking a note opens it | Done (list owner-verified in the GUI; clicking a listed note not yet checked) |
| B | **Add note** asks once per folder (modal Yes/No; only Yes is remembered, in VS Code's storage, not the project), asks for a title, creates the note from a What / Why / Decision template and opens it in the editor | Done (owner-verified in the GUI) |
| C | Writes only new files inside `.vibecode/notes/`, never overwrites, never commits. File names are generated by the extension (`YYYY-MM-DD-slug.md`). The webview sends opaque ids only (`n…` for notes) | Done |
| D | Notes shown as plain text. Header reader for `about:`, `commit:`, `created:` with no new dependency. Up to 500 notes, 64 KB each | Done |
| E | Off in Restricted Mode | Done |

Owner-verified 2026-10-30 (see the development log). Non-goals: editing inside the dashboard, line-level notes, graph markers, search, sync, following renamed files.

## Phase 4b scope: AI session overview

Requested by the owner and approved on 2026-10-29 with the recommended choices: a third tab, secrets hidden, no money estimate.

| # | Requirement | Status |
| --- | --- | --- |
| A | **AI sessions** tab: project totals (sessions, prompts, input, output and cache tokens, most-edited files) and a session list (title, date, prompts, tokens) | Done (owner-verified in the GUI) |
| B | Session details: times, model, replies, tokens, files changed (outlined in the graph), commits made during the session, security mentions, prompts (expandable), tips | Done (owner-verified in the GUI) |
| C | Reads only `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project path with dashes>/*.jsonl` (top level only), read-only, and keeps only lines whose `cwd` is inside the project. Up to 200 sessions, 50 MB per file | Done |
| D | Never kept: tool output, the agent's reasoning, sub-agent prompts. Secret-looking text is shown as `[hidden]` | Done |
| E | Modal permission per folder before the first read (only Yes is remembered, in VS Code's storage). The **Reset Permissions** command withdraws it, and the notes permission too. Off in Restricted Mode | Done (dialog owner-verified in the GUI) |
| F | Claude Code reader behind an `AgentLogReader` interface, ready for other agents. No new dependency, no network | Done |

Changed from the plan: commits made during a session are listed as text, with a pointer to the History tab, rather than as links. Owner-verified 2026-10-30 (see the development log). Non-goals: money cost, live updates, other agents' readers, search, export.

## Phase 5 scope: learning aids

Approved by the owner on 2026-10-29 with the recommended choices: inline glossary explanations, and circular imports outlined in red.

| # | Requirement | Status |
| --- | --- | --- |
| A | **In plain words** for the selected file: type, lines, local imports and packages, the files that use it, role (entry point, hub with 5 or more importers, leaf), top-level symbol counts, commit count and latest date, note count | Done (owner-verified in the GUI) |
| B | Symbol explanation: kind, line, declaration and doc comment (VS Code hover provider), usage count. Says "may be unused" when only the definition is found | Done (owner-verified in the GUI) |
| C | Glossary of about 55 hand-written terms, with a **?** button that shows the explanation inline. A unit test checks that every term the dashboard explains has an entry | Done (owner-verified in the GUI) |
| D | Up to 3 code tips: circular import (naming the other files), large file (over 400 lines), hub without a matching `.test`/`.spec` file | Done |
| E | Circular imports (strongly connected groups) outlined in red in the graph, with a legend entry | Done (owner-verified in the GUI with the Python demo) |
| F | Static facts only: no AI, no network, no new dependency, read-only | Done |

Owner-verified 2026-10-30 (see the development log). Non-goals: AI-written explanations, tutorials, other languages, line-by-line explanations.

## Phase 6 scope: a second language (Python)

Approved by the owner on 2026-10-29 with the recommended choices: Python, and a small built-in import reader with no new dependency.

| # | Requirement | Status |
| --- | --- | --- |
| A | Python files in the graph with their imports. Mixed JS/TS and Python projects work, and so do Python-only ones | Done (Python-only owner-verified in the GUI) |
| B | Reader: `import a.b`, `import a as x, b`, relative `from .`/`..` imports, imports in parentheses over several lines, `\` continuations, one-line `if`/`try` bodies, and `importlib.import_module`/`__import__` with a fixed name. Comments, strings and docstrings are ignored. Computed dynamic imports count as unknown | Done |
| C | Resolution: relative imports from the file's package. Absolute ones from the folder root, `src/` and the file's own folder (`a/b.py` or `a/b/__init__.py`). `from pkg import sub` checks for a submodule first. Anything not found is a package. The package `__init__.py` is linked only when a name comes from it | Done |
| D | Python build folders skipped (`__pycache__`, `.venv`, `venv`, `.tox`, `.nox`, caches, `site-packages`, `*.egg-info`, `.eggs`) | Done |
| E | Roles, circular imports, tips and explanations work for Python. `test_x.py` and `x_test.py` count as tests | Done (circular import owner-verified in the GUI) |
| F | Languages sit behind `src/analysis/languages.ts` (`LanguageSupport`: extensions plus analyze), and JS/TS behaviour is unchanged | Done |

Owner-verified 2026-10-30 with the Python demo (see the development log). Non-goals: more languages, `sys.path` or tsconfig `paths` handling, installed-package resolution, call graphs.

## Phase 6b scope: open in browser

Approved by the owner on 2026-10-29 with the recommended choices: stop on VS Code exit, after 30 minutes idle or by command, and a new secret link on every click.

| # | Requirement | Status |
| --- | --- | --- |
| A | **Open in Browser** button and command open the same dashboard in the default browser. A **Stop Browser View** command | Done (owner-verified in the GUI) |
| B | Same page, script and stylesheet as the VS Code panel (`page.ts`). `browserBridge.js` replaces VS Code's message channel with same-origin POSTs and an event stream. `browser.css` supplies theme colours | Done (owner-verified in the GUI) |
| C | Each browser tab gets its own `DashboardSession` (own opaque ids, same validation). Clicks open files, diffs and notes in VS Code | Done (owner-verified in the GUI) |
| D | Server on `127.0.0.1` only, random port, 256-bit key as the first path segment (timing-safe check), Host check against DNS rebinding, Origin, `Sec-Fetch-Site` and JSON content-type checks on POST, allow-listed assets, 64 KB body cap, at most 5 tabs, strict CSP header with `frame-ancestors 'none'`, `no-store` and `nosniff` | Done |
| E | Stops on VS Code exit or extension deactivate, after 30 minutes without requests, or by command. Open tabs are told it stopped. Off in Restricted Mode | Done |
| F | No new dependency (Node `http`), read-only, no shell | Done |

Owner-verified 2026-10-30 (see the development log). Non-goals: a standalone app without VS Code, access from other devices, several users, logins.

## Phase 6c scope: code and diffs in the browser

Requested by the owner on 2026-10-30, and approved the same day with these choices: code and diffs in the browser (notes still open in VS Code), plain text with line numbers, our own line comparison (no new dependency), an opt-in "open on startup" setting, and the browser view stopping 30 minutes after its last tab closes.

| # | Requirement | Status |
| --- | --- | --- |
| A | In the browser view, opening a file (graph double-click, **Open source**, changes list) shows its code with line numbers in place of the graph. A changed file shows its comparison with HEAD; a deleted file its HEAD version. **Back to graph** returns | Done (owner-verified in the GUI) |
| B | A commit's file shows what the commit changed (added: new version, deleted: previous version, else a comparison). Removed lines red, added lines green, both line numbers, unchanged lines more than 3 lines from a change folded | Done (owner-verified in the GUI) |
| C | Clicking a symbol or a "Used in" place shows the file with that line highlighted and scrolled into view | Done (owner-verified in the GUI) |
| D | **Open in VS Code** opens the same file, comparison or line in VS Code (`openInEditor`, opaque ids only). The VS Code panel is unchanged | Done (owner-verified in the GUI) |
| E | Read-only. Sensitive files (now or in a commit, including a rename's old name) are never read or sent. Binary files are not shown. Over 1 MB or 20,000 lines is cut off with a note. Over 2,000 changed lines shows the new version with a note. Text is shown with `textContent` only | Done |
| F | Setting `vibecodeExplorer.openBrowserOnStartup` (default off) opens the browser view when a trusted folder opens, or when the folder becomes trusted | Done (owner-verified in the GUI) |
| G | The browser view keeps running while a tab is open and stops 30 minutes after the last tab closes (or a link is never opened), on VS Code exit, or by command | Done |
| H | No new dependency | Done |

Owner-verified 2026-10-30 (see the development log). Non-goals: syntax colours, editing in the browser, notes in the browser, side-by-side comparisons, search.

## Phase 6d scope: Files tab

Requested by the owner on 2026-10-30, and approved the same day with the recommended choices: a fourth tab on the left, listing all project files.

| # | Requirement | Status |
| --- | --- | --- |
| A | **Files** tab after AI sessions: folders and files as a tree, folders first, sorted by name, each folder with its file count. Folders open and close; top-level folders start open. **Expand all** and **Collapse all** | Done (owner-verified in the GUI) |
| B | Clicking a file shows its Details and, for graph files, selects it in the graph. Double-clicking opens it (on the page in the browser, in the editor in VS Code). Clicking a folder outlines its graph files. After the owner's check: clicking a graph file also brings the graph back, selects and centres the file, and a folder zooms to its files | Done (owner-verified in the GUI, including select-and-centre) |
| C | All files, skipping dependency, build and virtual-environment folders (`node_modules`, `.git`, `out`, `.venv`, …). At most 5,000 files, with a note when cut. Files deleted in the working tree are listed from Git | Done |
| D | Graph files keep their graph id, changed files their change id (so opening shows the diff), other files get new `p…` ids. Changed files are coloured, graph files dotted, sensitive files marked and never opened from the tree | Done |
| E | Names only for the listing. Symbols are asked for only for small text files; binary files are described but not shown. Off in Restricted Mode | Done |
| F | No new dependency | Done |

Owner-verified 2026-10-30 (see the development log). Non-goals: renaming, moving or deleting files, search, file icons, opening files outside the folder.

## Phase 7 scope: APIs and databases

Approved by the owner on 2026-10-30 with the recommended display (an APIs tab) and all four areas: JS/TS servers, Python web frameworks, HTTP calls, and databases.

| # | Requirement | Status |
| --- | --- | --- |
| A | **APIs** tab with Routes, HTTP calls and Database sections. Click: outline the files involved in the graph and show details. Double-click or **Open code**: open the line (on the page in the browser, in the editor in VS Code) | Done (owner-verified in the GUI) |
| B | JS/TS routes: Express-style `app.get('/x', handler)` and `router.post(...)` (Express, Koa router, Hono), `app.route('/x').get(...)`, Fastify `route({ method, url })`, Next.js `app/**/route.ts` exports and `pages/api/**`. Mounts: `app.use('/api', router)`, Hono `app.route('/api', x)`, Fastify `register(x, { prefix })`, followed across files | Done |
| C | Python routes: FastAPI and Flask decorators with `APIRouter(prefix=…)` / `Blueprint(url_prefix=…)`, `include_router` / `register_blueprint` prefixes, Django `path()` / `re_path()` with `include("x.urls")` | Done |
| D | HTTP calls: `fetch`, `axios` (and `axios.create` instances), `requests`, `httpx`. Computed parts become `*`. Calls to `localhost` or relative paths are matched to routes by method and path (`:id`, `{id}`, `<int:id>`, `[id]`, `[...slug]`); other servers are marked as such | Done |
| E | Databases: `CREATE TABLE` in `.sql` files, Prisma `model` blocks (with `@@map`), TypeORM `@Entity`, Sequelize, Mongoose, SQLAlchemy, Flask-SQLAlchemy, SQLModel and Django models (with `__tablename__` / `db_table`). Users: importers of a model's file, and `prisma.<model>.<operation>()` calls | Done |
| F | Read-only: source text only, nothing is run, no server is called, no database is opened. Sensitive files are skipped. Files over 512 KB are skipped, at most 200 schema files and 2,000 items per list. No new dependency | Done |

Owner-verified 2026-10-30 with `Documents\vibecode-api-demo` (see the development log). Non-goals: GraphQL and gRPC, OpenAPI files, routes registered in loops or from configuration, query-level table use, request and response shapes.

## Phase 8 scope: preview alongside code

Approved by the owner on 2026-10-30 with the recommended choices: a Pages section in the APIs tab (renamed **Pages & APIs**), the preview beside the code, and all four kinds of pages.

| # | Requirement | Status |
| --- | --- | --- |
| A | **Pages** section first in the **Pages & APIs** tab: address, kind, main file and the number of files. Click: outline the page's files in the graph and show details. Double-click or **Open code**: open the main file | Done (owner-verified in the GUI) |
| B | Pages: Next.js `app/**/page.*` (with parent `layout.*`) and `pages/**` (not `pages/api`, `_app`, `_document`), only when a `package.json` lists `next`; React Router `<Route path element>` (nested and index) and route objects (`element`, `Component`, `lazy`); Vue Router `{ path, component }`; HTML files (`public/`, `static/` and `www/` are the site root) with the local scripts and styles they load; Express `res.render` / `res.sendFile`, Flask `render_template`, FastAPI `TemplateResponse`, Django `render` / `template_name` linked through `urls.py` | Done |
| C | A page's files: its main file, its direct local imports, Next.js layouts, the router file, the template. Names in the code that can't be found are shown as not found | Done |
| D | **Preview**: the address (editable, for `:id`-style parts) is joined to `vibecodeExplorer.previewUrl` and must stay on that server. In VS Code: the main file opens and the page opens in the Simple Browser beside it. In the browser view: the code and the running page side by side, with **Reload**, **Close preview** and a link to open it in a new tab | Done (owner-verified in the GUI) |
| E | Browser view CSP: `frame-src` allows only the configured loopback preview origin, never the dashboard's own port, otherwise `'none'`. The frame is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups`) with `no-referrer`. The page checks the address again before showing it | Done |
| F | Read-only; never starts the app. Names only for listing; `package.json` and HTML files (at most 20 and 300, 512 KB each) are read. Sensitive files skipped. No new dependency | Done |

Owner-verified 2026-10-30 with `Documents\vibecode-api-demo` (see the development log). Non-goals: following clicks inside the running app, starting dev servers, guessing values for `:id`, Svelte/Nuxt/Astro file routes, server-side includes inside templates.

## Phase 9 scope: Health tab

Chosen by the owner on 2026-10-30 from the saved "safety and learning" ideas (the recommended top 5), approved with a new **Health** tab and three kinds of safe points: before each AI session, tagged commits, and commits the owner marks.

| # | Requirement | Status |
| --- | --- | --- |
| A | **Health** tab (sixth): Checklist, Problems, Secret-looking text, Possibly unused files, Near-duplicate names, Safe points. Glossary terms for each | Done (owner-verified in the GUI) |
| B | Problems: errors and warnings VS Code already reported (`languages.getDiagnostics`), per file, with a plain explanation of common messages; graph files get a red or yellow halo; clicking opens the line. Messages are passed through the secret filter. Nothing extra is checked or run | Done |
| C | Checklist: README, `.gitignore` covering `.env` and `node_modules`/`.venv`, license, linter, tests, lock file, and `.env` files ignored by Git (VS Code Git's `checkIgnore`; example env files skipped). Reads file names, plus the root `.gitignore`, `package.json` and `pyproject.toml` | Done |
| D | Secret-looking text in project text files: file, line and kind only, never the value; one finding per line; placeholders and types (`password: string`) skipped; sensitive-named files never opened; a finding opens only in VS Code's editor, never on the browser page | Done |
| E | Possibly unused: graph files nothing imports, except entry names, tests, configs, framework files, scripts and `package.json` `main`/`bin`. Near-duplicates: names in one folder that differ only by copy, old, backup, a number or a plural | Done |
| F | Safe points: tags, the last commit before each AI session (only when session logs are already allowed), and commits marked with **Mark as safe point** in History (a small note in `.vibecode/notes/` with `safe: true`, under the existing notes permission). Each shows plain steps with `git` commands to copy; nothing is run | Done |
| G | Read-only apart from the opt-in safe-point note. No new dependency | Done |

Owner-verified 2026-10-30 on this repository (see the development log). Non-goals: running tests or linters, fixing problems, deleting files, removing secrets, checking out commits.

## Phase 10 scope: Project tab

Approved by the owner on 2026-10-30 ("all, one by one", for the saved project-tracking ideas, then the learning aids and the small fixes). Built as the read-only part of the saved plan, plus issues. Editing the AI's memory and rule files stays a saved idea, not scheduled.

| # | Requirement | Status |
| --- | --- | --- |
| A | **Project** tab (seventh): current stage, a progress bar, "N of M phases done, K left", open issues | Done (owner-verified in the GUI) |
| B | Plan: the first Markdown table with a Phase (or Step, Milestone, Stage) and a Status column in `docs/roadmap.md`, `ROADMAP.md` or `docs/plan.md` and similar. Each status is read as done, in progress, not started or not planned. The current stage is the first phase in progress, else the first not started | Done |
| C | Workflow steps for each phase (plan written, approved, built, tested automatically, checked by the owner, recorded in the log), ticked from the status words and whether the development log mentions the phase | Done |
| D | Requirements: the first table with a Requirement and a Status column, counted by its first word (Met, Partial, …) | Done |
| E | Intended structure: folders listed in a "Layout"/"Structure" section (backticked `folder/` paths, or a text tree in a code block) of `docs/structure.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md` or `README.md`. Folders outside it are flagged and can be shown in the graph; planned folders that don't exist yet are listed | Done |
| F | Issues: a title and optional details typed on the page, saved as a new note with `issue: open` in `.vibecode/notes/` under the existing notes permission. Plan files are never changed. Closing an issue = changing the word to `closed` in the file | Done |
| G | Plan files and issues open on the page in the browser view, or in VS Code's editor. No new dependency | Done |

Owner-verified 2026-10-31 (see the development log). Non-goals: editing the plan, memory or rule files; closing issues from the dashboard; guessing a plan from anything but a table.

## Phase 11 scope: learning aids

Approved by the owner on 2026-10-30 together with Phases 10 and 12 ("all, one by one").

| # | Requirement | Status |
| --- | --- | --- |
| A | **Learn** tab (eighth) with How to run, Reading order, Test map, TODO list, Packages and Hotspots. Glossary terms for each | Done (owner-verified in the GUI) |
| B | How to run: an install step and the package.json scripts in a sensible order with plain labels; Python `requirements.txt`, `pyproject.toml`, `manage.py`, `main.py`/`app.py`; command lines from the README's install/run sections. Shown only, never run | Done |
| C | Reading order: start files (entry points, or files nothing imports but that import others), then what they use level by level; tests left out; unconnected files last | Done |
| D | Test map: a file has a test when a test file imports it or is named after it (same language). Lists, plus a button that colours the graph (green tested, grey not, blue tests) | Done |
| E | TODO list: TODO/FIXME/HACK/XXX/BUG comments with file, line and text (secret-looking text hidden, sensitive files never opened); click opens the line | Done |
| F | Packages: npm and pip packages with version, dev or not, license and description from the installed package's own `package.json`, and whether the code imports them, a script runs them, they are type information, or nothing uses them | Done |
| G | Hotspots: on request, the files changed most in the latest 100 commits, with the count in fix commits | Done |
| H | Copy context for AI: a button under "In plain words" copies a short summary of the file (sentences, imports, packages, imported by, symbols, tests, note titles) to the clipboard and shows it | Done (owner-verified in the GUI) |
| I | Folder rules in the Health tab: lines like "`src/ui/` must not import `src/db/`" or a package name, in `.vibecode/rules.md`; breaking imports are listed and dashed orange in the graph. **Create rules file** writes the file once with examples (notes permission, never overwritten); AGENTS.md updated | Done |
| J | Commit message check in History: a hint under commits whose first line doesn't follow Conventional Commits | Done |
| K | Prompt tips in AI sessions: prompts sent again with the same words, and prompts that name no file or folder | Done |

Owner-verified 2026-10-31 (see the development log). Non-goals: running scripts or tests, installing or removing packages, fixing TODOs, checking licenses beyond what the package says, rewriting commit messages.

## Phase 12 scope: small fixes

Approved by the owner on 2026-10-30 with Phases 10 and 11. These four come from the "open ideas" in the development log.

| # | Requirement | Status |
| --- | --- | --- |
| A | Notes in the browser: a title and text box under Notes in Details; **Save note** creates the note file (same permission, never overwrites). Clicking a note shows it on the page, with **Open in VS Code** | Done (owner-verified in the GUI) |
| B | Syntax colours in the code view and diffs: keywords, strings, comments and numbers for JS/TS, Python, CSS, HTML-like, JSON and shell/config files, using VS Code's theme colours (browser: light and dark sets). Text is still set with `textContent` | Done (owner-verified in the GUI) |
| C | The notes question now has **No, don't ask again**, which is remembered for the folder (in VS Code's storage). Notes then show "turned off" with **Ask me again**. Closing the question without answering still asks next time | Done (owner-verified in the GUI) |
| D | Graph: files without imports are placed in a grid under the rest, spaced by their label length, so their labels don't touch | Done (owner-verified in the GUI) |

Owner-verified 2026-10-31 (see the development log). Non-goals: editing existing notes, full syntax parsing, themes of their own.

## Phase 13 scope: close and reopen issues

Approved by the owner on 2026-10-31, together with the AGENTS.md change that allows it.

| # | Requirement | Status |
| --- | --- | --- |
| A | Project tab: each open issue has **Close**; closed issues are listed under **Closed (n)** with **Reopen**; the open count updates. Same in the browser view | Done (owner-verified in VS Code; the browser view was not checked separately) |
| B | Only the `issue:` line in the note's header changes (`open` ↔ `closed`; the older word `done` counts as closed). Line endings, a byte-order mark and the rest of the file are kept | Done |
| C | Only issues the Project tab listed (`j…` ids), only inside `.vibecode/notes/`, only under the notes permission. The file is read again first; if it no longer says the state the page showed, or is gone, nothing is written and the owner is told | Done |
| D | No new dependency | Done |

Owner-verified 2026-10-31 (see the development log). Non-goals: deleting issues, editing their title or text, a closed date.

## Phase 14 scope: review checklist for AI sessions

Approved by the owner on 2026-10-31 ("approve").

| # | Requirement | Status |
| --- | --- | --- |
| A | Session details show **Review checklist (n)** instead of the plain file list: a tick box per file, "n of m files reviewed" with a progress bar | Done (owner-verified in the GUI) |
| B | Labels per file: not committed yet (in the workspace changes), test file, deleted since, ⚠ sensitive. Clicking a name shows the change (diff when uncommitted) in VS Code or on the browser page; sensitive files are never opened | Done |
| C | Automatic checks: test files added or changed, files not committed, security mentions to read, sensitive files changed | Done |
| D | The session list shows "reviewed n/m", or "✔ all files reviewed" | Done (owner-verified in the GUI) |
| E | Ticks in VS Code's storage (`workspaceState`), per folder and session log file, only for that session's files, capped. Nothing written into the project; opaque `v…` ids; no new dependency | Done |

Owner-verified 2026-10-31 (see the development log). Non-goals: review notes per file, line-by-line review, approving a session for others.

## Phase 15 scope: first release

Approved by the owner on 2026-10-31 ("yes").

| # | Requirement | Status |
| --- | --- | --- |
| A | Version 1.0.0 in `package.json` and the lockfile | Done |
| B | `CHANGELOG.md` with a short section per version, included in the VSIX | Done |
| C | README: an **Install** section with plain steps (download the VSIX from Releases, **Install from VSIX…**); the source build kept below for developers | Done |
| D | `.github/workflows/release.yml`: on a `v*` tag, checks the tag matches the version, runs lint, unit and integration tests, builds `vibecode-explorer-<version>.vsix` and creates the GitHub release with it and that version's changelog notes. Only GitHub's own actions and `gh`; `contents: write` only | Done (the v1.0.0 run passed every step) |
| E | The tag is pushed only after the owner says yes | Done ("publish") |

Owner-verified 2026-10-31 (see the development log). Non-goals: the VS Code Marketplace and Open VSX, an icon or screenshots, automatic updates.

## Non-goals for Phase 1

Function/API/database graphs, agent attribution, change explanations, embedded browser, marketplace publishing, servers, databases, cloud sync, plugin framework.

## Security requirements

Local-first; no telemetry or uploads; read-only; Workspace Trust respected; strict webview CSP; validated messages; no path-based file access from the webview; sensitive files never read; scan limits; no shell execution.
