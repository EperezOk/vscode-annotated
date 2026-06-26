# Local Links — Design

**Date:** 2026-06-25
**Status:** Approved (pending spec review)

## Summary

Let an annotation's markdown reference other places in the codebase with
**local links** — `[label](src/core/foo.ts#L10-L20)`. Clicking a local link in
the rendered annotation opens that file, selects + reveals the lines, and applies
a distinct highlight, **without changing the annotation view** (the detail panel
keeps focus and stays on the same annotation). A persistent **"↩ Refocus code"**
button returns the editor to the annotation's own file:lines.

This reuses the extension's existing reveal/highlight machinery
(`revealAnnotation` in `navigateToCode.ts`) and the typed webview↔host protocol,
so it slots into established patterns rather than introducing new infrastructure.

## Goals

- Author local links easily: a "Copy location" command (producer) + paste-to-link
  wrapping in the markdown editor (consumer).
- Clicking a local link reveals the target file:lines with a highlight that is
  visually **distinct** from the annotation's own line highlight.
- The annotation view (detail webview) is never mutated by link navigation —
  focus and shown annotation are untouched.
- Returning to the annotation's code is one click ("↩ Refocus code"); VS Code's
  native Back (`Cmd+-`) also works.
- Local links are **visually distinguishable** from external web links in the
  rendered markdown.

## Non-goals (v1)

- **Drift / staleness of link line numbers.** Link line numbers are not anchored
  or re-validated against file edits (annotations already have their own drift
  story; links are best-effort). Out of range lines are clamped by VS Code.
- **A keybinding for the copy command** (the `cmd+alt+…` namespace is crowded;
  trivially added later).
- **Cross-workspace / absolute-path links.** Targets resolve strictly within the
  (first) workspace folder; escapes are rejected.
- **Authoring links from a picker / autocomplete.** Copy + paste only.

## Link syntax

GitHub-style, workspace-relative path with an `#L` line fragment:

```
src/core/foo.ts#L42        single line  (line 42)
src/core/foo.ts#L10-L20    range        (lines 10–20, inclusive)
```

- Markdown has no native "open file at line" concept — a link target is opaque
  text the renderer interprets. `#L10-L20` is the recognizable GitHub convention;
  we define and own it.
- Line numbers are 1-based inclusive, matching the model's `LineRange`.
- Anything that is an http(s) URL, has no `#L` fragment, or fails to parse is
  **not** a local link and is left to normal handling.

## Components

### 1. Pure parser/formatter — `src/shared/locationLink.ts` (new)

Single source of truth, no `vscode` dependency. Sibling to `path.ts` / `model.ts`.
Imported by the webview (click detection + cue + paste guard) and the host (copy
command + navigation).

```ts
import { type LineRange } from './model';

/** Format a workspace-relative file + range as `path#L10-L20` (or `path#L42`). */
export function formatLocationLink(file: string, range: LineRange): string;

/** Parse `path#L10-L20` / `path#L42` → { file, range }, or null if not a local link. */
export function parseLocationLink(href: string): { file: string; range: LineRange } | null;

/** True when `text` parses as a local link (paste guard convenience). */
export function isLocationLink(text: string): boolean;
```

Parsing rules / `null` cases:
- Reject anything with a URL scheme (`http://`, `https://`, or any `scheme://`) —
  an http(s) URL is never a local link even with a fragment. This check is
  **self-contained** in `locationLink.ts` (a simple `scheme://` test); the module
  does NOT import `isUrl` from `core` (that would make the base `shared` layer
  depend upward on `core`).
- Require a trailing `#L<start>` optionally `-L<end>`; `start >= 1`, and if `end`
  present `end >= start` (else `null`).
- `file` is the part before `#`; must be non-empty after trimming. Backslashes are
  normalized to `/` (POSIX, consistent with the model's stored paths).
- Round-trip: `parseLocationLink(formatLocationLink(f, r))` ⇒ `{ file: f, range: r }`.

### 2. Authoring

**Copy command (producer)** — `src/web/copyLocationLinkCommand.ts` (new) +
registration in `extension.ts`:

- Command id `annotated.copyLocationLink`, title *"Annotated: Copy Location for
  Annotation Link"*.
- Reads `vscode.window.activeTextEditor`; if none, no-op (optionally an info
  message). Computes the workspace-relative path via
  `vscode.workspace.asRelativePath(editor.document.uri, false)`. Takes the
  selection's 1-based line range; if the selection is empty, uses the cursor's
  line as a single-line range.
- Formats via `formatLocationLink` and writes to the clipboard
  (`vscode.env.clipboard.writeText`).
- Clipboard result example: `src/core/foo.ts#L10-L20`.

**Paste-to-link (consumer)** — extend `urlPasteHandler` in
`src/webview/detail/editorExtensions.ts`:

- Change the accept guard from `isUrl(text)` to `isUrl(text) || isLocationLink(text)`.
- The existing `linkSelection(doc, from, to, target)` already emits
  `[selected](target)`, so pasting a location over a non-empty selection yields
  `[selected](src/core/foo.ts#L10-L20)` — no new wrapping logic. Empty selection
  still falls through to default paste (unchanged).

Workflow:
1. In `foo.ts`, select lines 10–20 → right-click → *Copy Location for Annotation
   Link* → clipboard holds `src/core/foo.ts#L10-L20`.
2. In the annotation editor, select the words *the retry helper* → paste →
   `[the retry helper](src/core/foo.ts#L10-L20)`.

### 3. Rendering + click interception + cue — `src/webview/detail/MarkdownPreview.svelte`

- DOMPurify already permits `<a href>` / `title`. No markup is injected into the
  markdown; the component post-processes the rendered DOM.
- **Click interception:** a delegated click handler on the wrapper `<div>` (not on
  sanitized content). On click, `event.target.closest('a')`, read `href`, run
  `parseLocationLink(href)`. If local → `event.preventDefault()` and invoke a new
  callback prop `onlocallink?(file, range)`. External http links fall through to
  VS Code's normal open-in-browser; non-link clicks ignored.
- **Visual cue (v1):** an effect keyed on the rendered `html` queries
  `.md-preview a`, and for each whose `href` parses as a local link, adds a
  `local-link` class and a `title` attribute set to the resolved `file:lines`.
  CSS gives `.local-link` a small leading glyph (`::before { content: '⤷ ' }`) and
  may tweak the underline so it reads as a code link distinct from an external
  link. Applied via DOM, so it is independent of DOMPurify's allowed-attr list.
- The component stays presentation-only (the parent wires `onlocallink` to the
  host) and unit-testable.

### 4. Host navigation — `src/web/navigateToCode.ts`

Add a second, independently-tracked decoration for link targets.

```ts
export async function revealLocation(
  folderUri: vscode.Uri,
  file: string,
  range: LineRange,
): Promise<void>;

export function clearAllHighlights(): void; // clears annotation + link highlights
```

- `revealLocation` mirrors `revealAnnotation`'s open/reveal/select dance but
  applies the **link** decoration type and tracks its own `lastLinkEditor`.
  `preserveFocus: true` so the detail panel keeps focus.
- **Distinct decoration** (vs annotation's find-match + focus-border):
  - background `editor.rangeHighlightBackground`
  - left border `textLink.foreground` (3px)
  - overview ruler `editorOverviewRuler.infoForeground`
- **Path safety:** resolve strictly within the workspace folder. Reject absolute
  paths and any `..` segment that escapes the folder; on rejection or open
  failure (file not found), `vscode.window.showWarningMessage(...)` and return —
  never throw.

**Highlight lifecycle:**

| Trigger | Annotation highlight | Link highlight |
|---|---|---|
| `revealAnnotation` (open annotation / Refocus) | (re)applied | **cleared** |
| `revealLocation` (click local link) | untouched | (re)applied |
| `onNavigationClosed` (Back / panel hidden) | cleared | cleared |

So in the *same* file, the annotation lines and a clicked link target show
simultaneously in distinct colors; refocusing or opening another annotation drops
the stale link highlight. `onNavigationClosed` calls `clearAllHighlights()`
instead of today's annotation-only `clearHighlight`.

### 5. "↩ Refocus code" button — `src/webview/detail/AnnotationView.svelte`

- A persistent small link-styled button in the `.bar` row (alongside `edit range`
  / `⧉ path`), labeled **"↩ Refocus code"**.
- Calls a new `onrevealcode?(id)` prop. `DetailApp` implements it by re-sending the
  existing **`selectAnnotation`** message for the current annotation id, which
  already routes host-side to `revealAnnotation` — re-revealing + re-highlighting
  the annotation's lines and clearing the link highlight. No new host protocol for
  the return path; idempotent; does not change which annotation the panel shows.

### 6. Protocol + wiring

- `src/shared/protocol.ts`: add `DetailToHost` variant
  `{ type: 'openLocalLink'; file: string; startLine: number; endLine: number }`
  plus validation in `parseDetailMessage` (mirrors `updateAnnotationRange`:
  `file` string, `startLine`/`endLine` numbers).
- `src/web/detailPanelProvider.ts`: handle `openLocalLink` → new `onOpenLocalLink?`
  hook.
- `src/web/extension.ts`:
  - `detailProvider.onOpenLocalLink = (file, s, e) => revealLocation(folder.uri, file, { startLine: s, endLine: e })`.
  - `detailProvider.onNavigationClosed = () => clearAllHighlights()`.
  - register `annotated.copyLocationLink`.
- `package.json` `contributes`:
  - `commands`: `annotated.copyLocationLink` (title above).
  - `menus.editor/context`: the command (e.g. group `9_cutcopypaste` or
    `navigation`), `when: editorTextFocus`.

### 7. Webview message flow

```
[annotation markdown]  user clicks  [the retry helper](src/core/foo.ts#L10-L20)
        │ MarkdownPreview: parseLocationLink(href) → { file, range }
        │ onlocallink(file, range)  →  DetailApp
        ▼ postToHost({ type:'openLocalLink', file, startLine, endLine })
   detailPanelProvider.onDidReceiveMessage → parseDetailMessage
        ▼ onOpenLocalLink(file, s, e)
   extension.ts → revealLocation(folder.uri, file, range)   [link highlight]

[↩ Refocus code]  →  onrevealcode(id)  →  postToHost({ type:'selectAnnotation', id })
        ▼ onSelectAnnotation → revealAnnotation   [annotation highlight; clears link]
```

## Edge cases

- **Not a local link** (http URL, no fragment, malformed) → not intercepted; no
  cue; normal link behavior.
- **File not found / path escapes workspace** → warning message, no navigation,
  no throw.
- **Lines beyond EOF / reversed** → reversed rejected at parse (`null`, treated as
  non-local); beyond-EOF clamped by VS Code on reveal.
- **No active editor when copying** → command is a no-op (optional info message).
- **Same-file link** → annotation + link highlights coexist (distinct colors).

## Testing (TDD)

- `src/shared/locationLink.unit.test.ts` — format/parse round-trips; single vs
  range; http URL / no-fragment / `..` / reversed range / empty file → `null`.
- `src/core` or `editorExtensions.unit.test.ts` — paste-to-link wraps a pasted
  location into `[sel](path#L..)`; non-location/non-url paste unaffected.
- `MarkdownPreview.svelte.test.ts` — local link click fires `onlocallink` with the
  parsed file+range and prevents default; external link does **not**; the cue
  class/`title` is applied to local-link `<a>`s only.
- `AnnotationView.svelte.test.ts` — "↩ Refocus code" fires `onrevealcode(id)`.
- `protocol.unit.test.ts` — `openLocalLink` valid/invalid parsing.
- `navigate.integration.test.ts` — `revealLocation` opens the target + applies the
  link decoration; `clearAllHighlights` clears both; `revealAnnotation` clears the
  link highlight.
- Copy command: formatting is covered by `formatLocationLink`; the thin command
  wiring (active editor → clipboard) covered in the integration tier.

## Considered & rejected

- **`command:annotated.openLocalLink?args` URIs** (VS Code native command links):
  requires enabling command URIs + DOMPurify/CSP allowances for a `command:`
  scheme — more fragile than owning the click in our own webview DOM. Rejected.
- **Reuse the `⧉ path` format (`file:10–20`, colon + en-dash)** for the href:
  rejected in favor of GitHub-style `#L10-L20` (unambiguous, won't read as a URI
  scheme, web-standard).

## File change summary

New:
- `src/shared/locationLink.ts` (+ unit test)
- `src/web/copyLocationLinkCommand.ts`

Changed:
- `src/shared/protocol.ts` — `openLocalLink` message + validation
- `src/webview/detail/editorExtensions.ts` — paste guard accepts locations
- `src/webview/detail/MarkdownPreview.svelte` — click interception + cue
- `src/webview/detail/AnnotationView.svelte` — "↩ Refocus code" button
- `src/webview/detail/DetailApp.svelte` — wire `onlocallink` / `onrevealcode`
- `src/web/navigateToCode.ts` — `revealLocation`, link decoration, `clearAllHighlights`
- `src/web/detailPanelProvider.ts` — `onOpenLocalLink` hook + message handling
- `src/web/extension.ts` — wire hooks, register command
- `package.json` — command + `editor/context` menu
