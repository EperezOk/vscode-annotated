# vscode-annotated — Design Spec

**Date:** 2026-05-29
**Status:** Approved design, ready for implementation planning

## Overview

A VSCode extension for annotating a codebase. Annotations carry Markdown text and
point at a range of full lines in a file. Annotations belong to ordered **groups**;
groups have an author, optional tags, an optional Git ref, and a resolved/open
status. Annotations can carry **comment threads**. Everything is stored as JSON
files committed in the workspace so annotations are shareable and readable/writable
by AI agents.

The extension is intentionally **generic** (not security-review specific). Tags and
the on-disk JSON format let specific workflows — including AI workflows — be built on
top. See `IDEA.md` for the originating use cases.

### Goals

- Create, organize, view, edit, navigate, and share code annotations.
- Plain-JSON, in-repo storage that an AI agent or teammate can read and write.
- Autonomous, agent-runnable testing across the whole stack, including webview UI.

### Non-goals (this spec)

- Complementary extensions (scope manager, progress tracking) — built separately as
  an extension pack, parsing the same JSON.
- Auto-relocating annotations when code moves (we detect drift, we don't relocate).
- Git operations driven by the group's Git ref (no auto-checkout/diff); the ref is
  metadata only.
- Moving an annotation to a different file via the UI (delete + recreate instead).

## Architecture

The extension runs in the **web extension host** (web-compatible), which means it
works in desktop VSCode, github.dev, and vscode.dev, and — critically — makes the UI
testable in a real browser via `@vscode/test-web`. The web-host constraint forbids
Node APIs (`fs`, `child_process`, `os`); all file I/O goes through
`vscode.workspace.fs` and Git data comes from the built-in Git extension API.

```
Webview UIs (Svelte)            Extension host (web-compatible)        Workspace files (committed)
─────────────────────           ───────────────────────────────       ───────────────────────────
Sidebar view                    Pure domain core                      .annotations/groups/<id>.json
  group cards · filters           model · ordering · drift              (group + its annotations)
  · bulk-select                   · tag resolution · thread merge      .annotations/comments/<slug>.json
Detail panel (reused)           Storage layer                           (one file per author)
  group view ⇄ annotation view    vscode.workspace.fs read/write JSON  VSCode user config
        ▲                       FileSystemWatcher                       annotated.tags: name → color
        │ typed postMessage       reloads on AI/teammate/git edits
        ▼                       Commands + editor navigation
                                  Create Annotation · Next/Prev · reveal+highlight
```

**Principles:**

- The **host is the only writer** to disk. Webviews hold no source of truth — they
  render state pushed from the host and send typed intents back over `postMessage`.
- A **pure domain core** with zero VSCode dependencies holds the logic, so most of it
  is unit-testable without a running VSCode. The VSCode layer (commands, views,
  storage adapter, watcher) is kept thin.
- A **shared protocol module** defines the message types used by both host and
  webviews, so the contract is typed and testable on both sides.

### UI surfaces and placement

- **Sidebar (filters + group cards):** a `WebviewView` in the **Primary Side Bar**
  (its own activity-bar container). Small and meant to stay open.
- **Detail panel (group/annotation views):** a single reused `WebviewView` in the
  **Secondary Side Bar**, which VSCode keeps on the opposite side of the primary side
  bar. Larger, opened/closed more frequently. Keeping the detail panel in the
  secondary side bar leaves the **editor area fully free** for the code you navigate
  to. *Implementation note:* manifest `viewsContainers` only target the activity bar
  or panel, so defaulting the detail view into the secondary side bar requires a small
  programmatic reveal on first run; users can move it afterward.

### UI stack

Svelte for both webviews — compiled, tiny output, reactive, and components test
cleanly in isolation. Markdown **rendering** (previews, comment bodies) uses a
Markdown library with sanitization (e.g. `markdown-it` + DOMPurify) inside the
webview. Markdown **editing** uses CodeMirror 6 — see [Markdown editor](#markdown-editor).

### Markdown editor

A single shared `MarkdownEditor` Svelte component, built on **CodeMirror 6**, is used
everywhere Markdown is authored: annotation content, the reply box, and editing an
existing comment.

- **Syntax highlighting** via `@codemirror/lang-markdown`.
- **Niceties** (lightweight, via CodeMirror keymaps/paste handlers):
  - Select text + paste a URL → wraps the selection as `[selection](url)`.
  - Bold / italic shortcuts (`ctrl/cmd+b`, `ctrl/cmd+i`) wrap the selection.
- CodeMirror is tree-shaken; the added weight is modest (~100KB gzipped), far below a
  full editor like Monaco, and acceptable for a webview.
- The selection-transform logic (link wrapping, bold/italic) is implemented as **pure
  functions** over `(text, selectionRange)` so it is unit-testable independently of
  CodeMirror; CodeMirror only hosts it.

## Data model & file layout

In-repo, committed:

```
.annotations/
  groups/<groupId>.json       # a group and all its annotations (no comments)
  comments/<authorSlug>.json  # one file per author, all of that author's comments
```

Rationale (from `IDEA.md`): a file per group and a file per author minimizes write
conflicts and keeps an AI agent editing a group from touching human-authored comments.

### Group JSON

```jsonc
{
  "id": "uuid",
  "title": "Login flow review",
  "author": "Ezequiel Perez",          // git config user.name at creation
  "tags": ["security", "question"],     // tag NAMES (see Tags)
  "gitRef": "feature/login" | null,     // optional, editable metadata
  "status": "open" | "resolved",
  "createdAt": 1730000000,              // epoch seconds
  "updatedAt": 1730000000,
  "annotations": [                       // array order IS the display order
    {
      "id": "uuid",
      "file": "src/auth/login.ts",       // workspace-relative POSIX path
      "range": { "startLine": 42, "endLine": 47 },  // 1-based, inclusive, full lines
      "content": "## markdown body",
      "contentHash": "sha256-hex"        // hash of the anchored lines (drift detection)
    }
  ]
}
```

- Annotation **order** is the array order; reordering rewrites the array.
- `file` is fixed once created; `range` is editable.

### Comment JSON (per author)

```jsonc
{
  "author": "Alice Doe",
  "email": "alice@example.com",          // canonical identity; filename slug may collide
  "comments": [
    {
      "id": "uuid",
      "annotationId": "uuid",            // references an annotation in any group file
      "content": "markdown",
      "timestamp": 1730000050            // epoch seconds, used for ordering
    }
  ]
}
```

A **thread** for an annotation = every comment across all author files whose
`annotationId` matches, sorted by `timestamp`. A user may edit/delete only the
comments in their own author file.

## Tags

- The **palette** (`name → color`) is stored in VSCode user config under
  `annotated.tags` (array of `{ name, color }`).
- Groups store tag **names** (strings), not IDs or colors, so tag assignments travel
  inside the committed group file.
- Rendering resolves each tag's color from the local palette. A tag name not present
  in the local palette renders in a neutral default color, with an "add to my palette"
  affordance.
- This split means **names are shared, colors are personal** — tags survive sharing
  across teammates with different palettes.
- New tags can be created inline during the Create-Annotation flow (`＋ New tag…`
  prompts name + color and writes to `annotated.tags`).

## Author identity (web-safe)

Resolution order:

1. Built-in Git extension API — `user.name` (via `repository.getConfig` /
   `getGlobalConfig`).
2. `annotated.authorName` setting.
3. One-time prompt, stored into `annotated.authorName`.

No `child_process`/`os` (web host). Comment files are named
`comments/<slug-of-name>.json`; the canonical `author` and `email` live inside the
file so a name-slug collision degrades gracefully.

## Drift detection

- At creation and on any range edit, store `contentHash = SHA-256` of the exact text
  of the anchored full lines (joined by `\n`). Hashing uses Web Crypto
  (`crypto.subtle.digest`), available in both web and desktop hosts.
- On load and on file-change events, recompute the hash for the current lines at the
  stored range. A mismatch — or a range now past end-of-file — flags the annotation
  **stale**.
- Stale is surfaced as an amber dot in the group view's annotation list and a banner
  in the annotation view. We never auto-relocate.

## Git ref

- `gitRef` is optional free-form metadata (branch, tag, or SHA) on a group.
- Displayed and editable in the group view; settable in bulk.
- Setting it offers a QuickPick of suggestions from the Git extension API: the
  **current HEAD short SHA**, branches, and tags — with free-text fallback.
- It documents *which version the annotations describe*. It does **not** trigger
  checkout/diff and is independent of drift detection (drift always compares against
  the current working tree).

## Sync & concurrency

- A `FileSystemWatcher` on `.annotations/**` reloads the affected group/author file
  and pushes fresh state to the webviews — AI edits, `git pull`, and manual edits
  appear live.
- All writes are **whole-file** on a single group or single author file, minimizing
  conflicts.
- The host ignores watcher events for files it just wrote (no echo loops).
- Concurrency is optimistic per-file; the per-group/per-author split makes simultaneous
  conflicting edits rare in practice.

## UI: sidebar (Primary Side Bar)

- **Header** with a `Select` link that toggles bulk-select mode (`Done` to exit).
- **Filter bar:** multi-select tag filter, multi-select author filter, and a
  **Show resolved** checkbox. Resolved groups are hidden by default; when shown they
  render dimmed with a `resolved` badge.
- **Group cards:** title, author + annotation count, colored tag chips. Clicking a
  card opens that group in the detail panel.
- **Bulk-select mode:** a checkbox per card and a sticky action bar with **Tags**,
  **Git ref**, **Resolve/Restore**, **Delete**, plus a live selected-count.
- No free-text search and no "new empty group" button — group creation is the editor
  command flow.

## UI: detail panel (Secondary Side Bar)

A single reused webview that swaps between two views.

### Group view

- Editable **title**; meta line (author · status · annotation count).
- **Tag chips** with an `＋ edit tags` affordance.
- **Git ref** with set/edit (suggestions: HEAD short SHA, branches, tags).
- **Resolve** button (becomes **Restore** when resolved).
- **Annotations list:** each row has a drag handle (reorder via drag-and-drop), the
  one-line truncated content, and `file:lines`. An amber dot marks stale annotations.
  Clicking a row opens the annotation view.

### Annotation view

- **Back to group** link.
- Large **Prev / Next** navigation bar with an `n / total` position indicator
  (sized for comfortable repeated navigation).
- `file : range` line where the **line range is inline-editable** (file path is
  fixed); a single **copy** control here copies the relative path + range. Editing the
  range recomputes the content hash.
- **Stale banner** shown only when drift is detected.
- **Toolbar:** Edit (swaps preview → the Markdown editor), Copy markdown.
- **Body:** rendered Markdown; when the annotation is empty the body is the Markdown
  editor instead of a preview.
- **Comment thread:** each comment shows author + relative time + rendered Markdown,
  merged across author files by timestamp. The current user's own comments show
  `edit` / `delete` (editing reopens the comment in the Markdown editor); others' are
  read-only. A **Reply** box uses the same Markdown editor.

## Commands & keybindings

Only frequent/quick actions get commands; everything else lives in the UI.

| Command | Default keybinding | Enablement |
| --- | --- | --- |
| `Annotated: Create Annotation` | `ctrl/cmd+alt+a` | non-empty editor selection |
| `Annotated: Next Annotation` | `ctrl/cmd+alt+]` | a group/annotation open in detail panel |
| `Annotated: Previous Annotation` | `ctrl/cmd+alt+[` | a group/annotation open in detail panel |

All keybindings are user-configurable.

### Create Annotation flow

1. Select line(s) → run the command.
2. QuickPick of existing groups (showing count + tags) with **＋ Create new group…**
   pinned at the top.
3. If creating a new group: InputBox for the group name.
4. If creating a new group: multi-select tag QuickPick from the configured palette —
   **optional** (confirm with none allowed) — with a **＋ New tag…** item that prompts
   name + color and saves to `annotated.tags`.
5. The annotation is appended to the chosen group. Author = `git config user.name` at
   creation. Existing-group selections skip steps 3–4.

## Navigate-to-code

Selecting an annotation (a row in the group view, or via Next/Previous) opens the
file, reveals the range, sets the editor selection to those lines, and applies a
subtle line-background decoration. Per design decision, the decoration is shown
**only for the currently-open annotation** — switching annotations moves it; closing
the detail view clears it. No persistent decorations for other annotations.

## Settings (VSCode user config)

- `annotated.tags`: `Array<{ name: string; color: string }>` — the tag palette.
- `annotated.authorName`: `string` — author identity fallback/override.

## Testing architecture

Layered + E2E smoke, all tiers headless and agent-runnable via `npm` scripts.

**Tier 1 — Unit (Vitest, no VSCode).**
- Domain core: (de)serialization, ordering/reorder, drift hashing, tag-name→color
  resolution, comment-thread merge, sidebar filter logic.
- Markdown editor selection transforms (paste-URL-as-link, bold/italic wrapping) as
  pure functions over `(text, selectionRange)`.
- Storage layer against an in-memory `FileSystem` abstraction over
  `vscode.workspace.fs`.
- Svelte components via `@testing-library/svelte` + jsdom — card rendering, filter
  controls, edit/preview toggle, reorder, comment edit/delete, Prev/Next — with the
  `postMessage` protocol mocked (assert outbound intents, feed inbound state as
  props/stores).

**Tier 2 — Integration (`@vscode/test-web`, Mocha-in-browser).**
- The thin VSCode layer against a real virtual workspace: commands, storage
  round-trips through `vscode.workspace.fs`, `FileSystemWatcher` reload, editor
  navigation/decoration.

**Tier 3 — E2E smoke (`@vscode/test-web` + Playwright).**
- Critical end-to-end flows in browser-hosted VSCode, with Playwright reaching into
  the webview iframes: create annotation → appears in sidebar card → open detail →
  navigate-to-code highlights lines → add a comment.

Supporting: a **shared protocol module** (typed message contract for both sides) and a
**fixture workspace** (tiny repo with a seeded `.annotations/`) for tiers 2–3.

## Build phases

Each phase is independently shippable and testable.

**Phase 0 — Scaffold & test infrastructure.** Web-compatible extension scaffold;
TypeScript + Svelte build for host and webviews; all three test tiers wired and green
on a trivial "hello" webview; shared protocol module skeleton; CI/npm scripts.
Front-loaded because autonomous testing is a core goal — prove the harness first.

**Phase 1 — MVP core (usable end to end).** Domain core + JSON storage over
`vscode.workspace.fs` (`.annotations/groups/`); author identity; Create Annotation
command + QuickPick flow + default keybindings; sidebar group cards (open a group);
detail panel group view + annotation view (Markdown preview, the shared CodeMirror
Markdown editor with highlighting + paste-URL-as-link, Edit toggle, copy controls);
navigate-to-code with active-annotation highlight; tag
palette config + name→color chips; `FileSystemWatcher` live reload.

**Phase 2 — Organization & navigation.** Sidebar filters (tag, author) +
Show-resolved; drag-to-reorder; Next/Previous commands + keybindings + big nav UI;
editable group title, tag editing, editable line range; Git ref set/edit with
HEAD-short-SHA/branch/tag suggestions; drift detection (hash, stale dot + banner).

**Phase 3 — Collaboration.** Comment threads (per-author files, merged by timestamp,
reply, edit/delete own); Resolve/Restore; bulk-select mode + bulk actions (tags, Git
ref, resolve/restore, delete); inline ＋ New tag creation and "add unknown tag to
palette."

## Future / out of scope

- Complementary extension pack (scope manager: parse scope file, mark files/regions
  reviewed, subtle editor highlighting).
- Free-text search in the sidebar.
- Git-ref-driven operations (open file at ref, diff against ref).
