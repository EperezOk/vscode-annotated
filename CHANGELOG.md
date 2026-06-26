# Changelog

All notable changes to the **vscode-annotated** extension. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
