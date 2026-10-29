# Architecture

```
 Webview (sandboxed, src/webview/)        Extension host (Node, src/extension/)
 ┌──────────────────────────────┐  msg   ┌───────────────────────────────────────┐
 │ dashboard.js + Cytoscape     │ ─────▶ │ messages.ts  validate (opaque ids)    │
 │ renders state, sends ids     │        │ dashboard.ts panel, CSP, open/diff    │
 │ no file/Git/shell access     │ ◀───── │ state.ts     collect + describe       │
 └──────────────────────────────┘ state  └──────┬──────────────────┬─────────────┘
                                                │                  │
                                   src/git/gitChanges.ts   src/analysis/graph.ts
                                   (built-in vscode.git    (TypeScript parser,
                                    extension API)          relative-import resolver)
```

## Key decisions

- **Activation:** happens only when a command runs (`activationEvents: []`), so the extension adds no VS Code startup cost.
- **Git:** uses the built-in `vscode.git` extension API, a minimal typed subset in `gitChanges.ts`. We never run git commands ourselves. Changes are filtered to the selected workspace folder, so separate folders are never mixed. History (Phase 3) uses the same API: `log` for commits, `diffBetween(parent, commit)` for the files of a commit, and `toGitUri` for read-only before/after content; `src/extension/history.ts` issues the opaque `k…`/`h…` ids.
- **Notes (Phase 4):** the only write path. `src/extension/notes.ts` lists `.vibecode/notes/*.md` and creates new note files there, after the owner's per-folder consent, which is kept in `workspaceState`. `src/analysis/notes.ts` holds the pure header reader and file-name rules. The note writer is exported to tests only in `ExtensionMode.Test`.
- **Import parsing:** `typescript` (Apache-2.0) `createSourceFile` gives a syntax-only AST that handles TS, TSX, JS and JSX. It finds `import`, `export … from`, `require`, `import x = require` and `import()`. A non-literal `import()` or `require()` counts as *unknown*.
- **Resolution:** only relative specifiers resolve, trying extensions, `index.*` files and `.js` → `.ts`. Anything that can't be proven (aliases, absolute paths, paths outside the folder) becomes an *unknown* node, and no edge is guessed.
- **Graph rendering:** Cytoscape.js (MIT, zero dependencies), loaded from the local `node_modules` with the built-in `cose` layout. There's no bundler: the webview is plain JS.
- **Symbols:** come from `vscode.executeDocumentSymbolProvider`, so whichever language extensions are installed provide them.
- **Usages (Phase 2):** `vscode.executeReferenceProvider` runs on the clicked symbol's name position, and only when the user clicks. `analysis/usages.ts` (pure) drops locations outside the folder, excluded or sensitive, then de-duplicates them and caps them at 100. Symbols get `s…` ids and usages get `r…` ids. These are valid only for the current Details panel and last lookup, and a refresh clears them. No new dependency: any language with VS Code reference support works.
- **Preview:** `simpleBrowser.show`, falling back to `env.openExternal`. URLs are limited to http/https on loopback hosts.
- **Security boundary:** the webview gets opaque ids such as `f3` and `c1` and never sees file paths for access. The host rejects any id it didn't issue in the current state. The CSP is `default-src 'none'`, with nonce-only scripts and styles from the extension origin. Cytoscape's runtime `<style>` injection is avoided by giving our stylesheet the id it checks for.
- **Limits:** at most `maxGraphFiles` files (default 500, capped at 5000), at most 512 KB per file and 200 symbols per file. Excluded directories and sensitive names are filtered before any read.

## Extending later

Add another language by writing a parser and resolver next to `imports.ts` and choosing one per file extension in `graph.ts`. No plugin framework is needed until a second language exists.
