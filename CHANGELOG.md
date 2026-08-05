# Changelog

All notable changes to the **vscode-annotated** extension. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added
- Annotations can target a **whole file** instead of a line range: new command
  "Annotated: Create File Annotation" (command palette + Explorer context menu), a
  "whole file" toggle in the annotation's range editor, and `"range": null` on disk.
  Whole-file annotations open the file when clicked, never go "lines changed" stale, and
  draw no gutter indicator.
- Local links in annotation and comment bodies may omit the line fragment —
  `[the session module](src/auth/session.ts)` opens the file.

### Fixed
- Top-level lists and blockquotes in the detail panel are no longer indented (nesting still
  indents one step per level).
- Gutter-hover entries whose snippet contained `]`, a trailing `\`, or a backtick code span
  showed raw Markdown instead of a clickable link.

## [0.4.1] — 2026-07-21

### Fixed
- **Git ref now works on the desktop app.** New groups auto-capture the current branch (or
  commit), and the Git-ref picker lists branches, remote branches, tags, and recent commits. The
  extension now reads the repository's `.git` directly instead of relying on an API a web extension
  can't reach across VS Code's extension-host boundary — so the field, which was previously always
  empty, is now populated. On the web (github.dev / vscode.dev) it still falls back to free-text.
- **Annotating a diff/preview view no longer shows a false "lines changed."** Annotations created
  from a diff (e.g. a GitLens diff) are now anchored to the working-tree file — the same source the
  staleness check reads — so a fresh annotation isn't immediately flagged. A view with no file on
  disk now warns instead of creating a mis-anchored annotation.
- **Git-based author detection.** Your annotation author name/email is picked up from the
  repository's local `.git/config` when set (this used the same unreachable API and had gone inert);
  a global-only git identity continues to fall back to the `annotated.authorName` setting or your
  GitHub sign-in.

## [0.4.0] — 2026-07-20

### Added
- **Filter groups by Git ref** — the sidebar filter bar has a new **Git ref** picker (alongside
  Tags and Authors). New annotation groups now **auto-capture** the branch (or short HEAD SHA) they
  were created on, and the Git-ref picker suggests **remote branches and recent commits** in addition
  to local branches, tags, and HEAD. (Git-ref features are desktop-only — the web build has no Git
  extension and falls back to free-text.)
- **Select all / Clear in bulk mode** — when selecting multiple groups, a one-click
  **Select all (N)** / **Clear** control over the currently visible (filtered) groups.
- **Absolute paths accepted for locations and links** — annotation locations and internal links may
  be given as absolute paths inside the workspace; they are normalized to workspace-relative when
  resolved (targets outside the workspace are rejected with a warning). Relative paths remain the
  portable, recommended form.

### Changed
- **The bundled `annotated` agent skill now documents internal links** — the `[label](src/file.ts#L10-L20)`
  local-link syntax is explained (with a drift-guard test), so agents reference other code with links
  instead of spawning extra annotations.

### Fixed
- **Undo (Cmd+Z)** in the annotation and comment editors no longer double-fires VS Code's global
  Undo — the CodeMirror history shortcuts stay inside the editor.
- **Long unbroken words / URLs** in the detail panel and sidebar cards now wrap instead of
  overflowing the container (fenced code blocks still scroll horizontally).
- Annotation navigation **warns instead of failing silently** when a target file can't be opened.
- Legacy `<id>.json` group files now load correctly when the id isn't a UUID.

## [0.3.0] — 2026-06-26

### Added
- **Local links in annotations** — write `[label](src/file.ts#L10-L20)` to link to code; clicking
  opens the file and highlights the lines with a distinct colour. New **Copy Location for Annotation
  Link** command (+ editor menu) generates a link, and pasting it over a selection wraps it. Links
  work in comment threads too, with a **Refocus code** button.
- **Annotation line highlighting** — toggle a tint over annotated lines in the editor via the sidebar
  button or `cmd+alt+h`; the open annotation stands out from the ambient tint.

### Changed
- **Group files are now named `<title-slug>-<idseg>.json`** (e.g. `misleading-docs-550e8400.json`)
  instead of `<uuid>.json`, so groups are easy to identify and reference. Backward compatible —
  existing `<uuid>.json` files are still read, and migrate on next edit.
- The "add annotation" group picker now excludes resolved groups.

## [0.2.1] — 2026-06-08

### Added
- Markdown editor: toggle **bold/italic** and an inline-code shortcut (`Mod+E`); **Cancel** button for
  the annotation and comment editors.

### Fixed
- Stop `Cmd+B`/`Cmd+I`/`Cmd+E` from triggering VS Code keybindings while editing an annotation.
