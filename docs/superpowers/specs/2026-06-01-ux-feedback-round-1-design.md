# Design — UX Feedback Round 1

**Date:** 2026-06-01
**Status:** Proposed
**Source:** `TODO.md` (user feedback after hands-on use of the extension)

## Overview

Ten UX/feature items collected from real use of the Annotated extension. Eight are
polish/bug fixes; two are net-new features (in-editor gutter indicators, searchable tag
filter). Nothing here changes the on-disk annotation format or the core data model — all
work lives in the webview layer (`src/webview`), the thin VSCode layer (`src/web`), a few
new pure helpers in `src/core` / `src/shared`, and the message protocol.

The items cluster into six work areas:

| Cluster | Items | Summary |
|---|---|---|
| A. Markdown editor | #2, #3 | Autofocus after create, click-below-to-focus, theme-aware syntax highlighting |
| B. Tag color & contrast | #1, #7 | Swatch QuickPick for new-tag color; auto black/white text on chips |
| C. Navigation highlight | #6, #8 | Stronger line highlight; clear it when the detail view closes |
| D. Copy feedback | #5 | Inline "Copied ✓" confirmation on copy buttons |
| E. Gutter indicators | #4 | Stacked colored bars in the gutter + overview-ruler marks + hover/cursor click-to-open |
| F. Sidebar | #9, #10 | Searchable tag-filter dropdown; manual refresh button |

## Architectural principles (unchanged from the project)

- Pure logic (color math, gutter-bar computation, SVG generation, filter helpers) lives in
  `src/core` / `src/shared` with **no `vscode` import** and is unit-tested directly.
- The thin `src/web` layer wires pure logic to VSCode APIs.
- Webviews (Svelte) own their own UI state and talk to the host only through the typed
  message protocol in `src/shared/protocol.ts`.
- Web-compatible only: no Node built-ins. Gutter SVGs are built as `data:` URIs (Web Crypto /
  `btoa` available in the web host).

---

## Cluster A — Markdown editor (#2, #3)

**Component:** `src/webview/detail/MarkdownEditor.svelte`, `editorExtensions.ts`,
`AnnotationView.svelte`, plus create-flow plumbing (Cluster A overlaps with #2's host wiring).

### A1. Autofocus after creating an annotation (#2)

Today `runCreateAnnotation` only shows a toast; the detail panel is never opened. But
`AnnotationView` already auto-enters edit mode when `annotation.content.length === 0`, so a
freshly-created annotation is one step from "ready to type" — it just needs the panel opened
and the editor focused.

Flow after a successful create:

1. `runCreateAnnotation` returns the **created annotation's id** in addition to the group
   (today it returns only the group). Add `{ group, annotationId }` to the return type.
2. The command (now wired through `extension.ts` so it can reach `detailProvider`) calls:
   - `showGroupWithStale(group.id)` — load + push the group to the detail panel,
   - post a new **`openAnnotation`** host→detail message with `annotationId`,
   - `executeCommand('annotated.detail.focus')` — reveal the panel,
   - `revealAnnotation(folder.uri, created)` — navigate + highlight the code (Cluster C).
3. The detail webview handles `openAnnotation` by setting `mode='annotation'` +
   `selectedAnnotationId`. `AnnotationView` auto-edits (empty content) and passes
   `autofocus` to `MarkdownEditor`.

**Plumbing change:** `registerCreateAnnotationCommand()` gains an `onCreated(groupId,
annotationId)` callback parameter, supplied by `extension.ts`. This keeps the command's
QuickPick logic intact while giving the host a hook to open the panel. The command is
currently registered standalone; `extension.ts` already owns `showGroupWithStale` and
`detailProvider`, so it provides the callback.

### A2. Click-below-content focuses end of content (#3a)

CodeMirror only places the cursor when a click lands on `.cm-content`. The blank area below
short content belongs to `.cm-scroller`, so clicks there do nothing. Fix: make the content
region fill the editor's `min-height` so CodeMirror's native click handling covers the blank
space (cursor goes to the end of the nearest line — i.e. end of content). Implement via an
`EditorView.theme({ '.cm-content': { minHeight: '160px' } })` (and ensure the scroller fills
the host). A fallback DOM `mousedown` handler on the editor host — "if the target is the
scroller/editor itself, focus and move the cursor to `doc.length`" — is the explicit-behavior
backstop if the theme alone proves flaky across the web build.

### A3. Theme-aware syntax highlighting (#3b)

The editor already loads `markdown()` + `syntaxHighlighting(defaultHighlightStyle)`, but
`defaultHighlightStyle` ships CodeMirror's light-theme token colors, which are nearly
invisible on the dark VSCode input background — hence "no highlighting." Replace it with a
**custom `HighlightStyle`** that maps markdown-relevant Lezer tags to VSCode theme CSS
variables (with hard-coded fallbacks), defined in `editorExtensions.ts`:

| Token | Style |
|---|---|
| `heading` (1–6) | bold, `var(--vscode-textPreformat-foreground)` |
| `strong` | bold |
| `emphasis` | italic |
| `link` / `url` | `var(--vscode-textLink-foreground)` |
| `monospace` / inline code | `var(--vscode-textPreformat-foreground)` |
| `quote` | italic, `var(--vscode-descriptionForeground)` |
| `list` marks | `var(--vscode-textLink-foreground)` |
| `processingInstruction` (`*`, `#`, `` ` `` marks) | `var(--vscode-descriptionForeground)` |

This gives visible, theme-consistent highlighting that adapts to light/dark themes.

### A4. `autofocus` prop on `MarkdownEditor` (supports A1)

Add `autofocus?: boolean`. On mount, when `autofocus`, call `view.focus()` and set the
selection to `EditorSelection.cursor(doc.length)`. `AnnotationView` passes `autofocus=true`
**only** when it auto-enters edit mode for empty content (the new-annotation case), so we
never steal focus on a normal "✎ Edit" click.

---

## Cluster B — Tag color & contrast (#1, #7)

### B1. Swatch QuickPick for new-tag color (#1)

The new-tag color is currently a raw hex `showInputBox`, duplicated in **three** places
(`createAnnotationCommand.pickTags`, `extension.onEditTags`, `extension.onBulkEditTags`).

- Add a curated swatch list to `src/core/tags.ts` (pure data):
  `TAG_SWATCHES: { name: string; hex: string }[]` — exactly these eight, in order:
  **Red, Amber, Yellow, Green, Teal, Blue, Indigo, Gray** (representative hexes, tunable:
  `#E5484D`, `#F5A623`, `#E5C100`, `#3FB950`, `#14B8A6`, `#3794FF`, `#5B5BD6`, `#8B949E`).
- Add a tiny shared `src/core/svgIcon.ts` with a `svgDataUri(svg: string): string` encoder and
  a pure `swatchIconSvg(hex: string): string` that renders a small filled rounded square
  `data:` URI for use as a QuickPick item `iconPath` — so **each color option is shown
  visually** in the picker. (4g's `buildGutterSvg` reuses `svgDataUri` from here, so this
  module lands in 4a before the gutter work.)
- Add a shared host helper `promptNewTag(): Promise<Tag | undefined>` in
  `src/web/tagPalette.ts` that:
  1. prompts for the tag **name** (`showInputBox`),
  2. shows a `showQuickPick` of the eight swatches — `label` = name, `description` = hex,
     `iconPath` = `swatchIconSvg(hex)` (the colored square), each item carrying its hex —
     plus a pinned **"Custom hex…"** item that falls back to the hex `showInputBox`,
  3. returns the resulting `Tag`, or `undefined` if cancelled.
- Replace all three duplicated blocks with `promptNewTag()`. This removes the duplication and
  is the single behavioral change point.

### B2. Automatic black/white chip text for contrast (#7)

- Add a pure helper `contrastColor(hex: string): '#000000' | '#ffffff'` to
  `src/core/tags.ts` (or a small `src/shared/color.ts`) using relative-luminance (WCAG):
  parse `#rgb`/`#rrggbb`, compute luminance, return black for light backgrounds and white for
  dark. Unit-tested across light/dark/edge colors and malformed input (default to white).
- Apply it wherever a tag color is a chip background: `GroupView.svelte` (`.chip` hardcodes
  `color:#fff`), `GroupCard.svelte` (sidebar), and the new filter pills (Cluster F). Replace
  the hardcoded `#fff` with `style="background:{color}; color:{contrastColor(color)}"`.

---

## Cluster C — Navigation highlight (#6, #8)

**Component:** `src/web/navigateToCode.ts`, `detailPanelProvider.ts`, `AnnotationView.svelte`.

### C1. Make the highlight noticeably stronger (#6)

`editor.rangeHighlightBackground` is too subtle. Strengthen the decoration:

- stronger whole-line `backgroundColor` (a visibly tinted theme color, e.g.
  `editor.findMatchHighlightBackground`, tuned during implementation with a quick visual
  check),
- add a colored **left border** accent: `borderWidth: '0 0 0 3px'`, `borderStyle: 'solid'`,
  `borderColor: new ThemeColor('focusBorder')`,
- add an **overview-ruler** mark (`overviewRulerColor` + `overviewRulerLane.Full`) so the
  highlighted range is visible on the scrollbar.

Exact theme colors are tunable; the requirement is "clearly visible at a glance."

### C2. Clear the highlight when the detail view closes (#8)

Today `clearHighlight()` only runs on the *next* `revealAnnotation`, so the highlight
lingers after closing. Add two triggers:

- **Back button:** when `AnnotationView` "‹ Back" is clicked (`showGroupView`), post a new
  **`navigationClosed`** detail→host message; the host calls `clearHighlight()`.
- **Panel hidden:** in `DetailPanelProvider.resolveWebviewView`, subscribe to
  `webviewView.onDidChangeVisibility` and call `clearHighlight()` (via an
  `onNavigationClosed?` callback) when the panel becomes not-visible.

(We intentionally do *not* clear on active-editor change — that would be noisy.)

---

## Cluster D — Copy feedback (#5)

**Component:** `src/webview/detail/AnnotationView.svelte`.

The clipboard write already happens reliably in the host (`copyText` handler). Add **inline**
confirmation rather than a toast (quieter, co-located with the action): each copy button
(`⧉ path`, `⧉ Copy markdown`) shows a transient "Copied ✓" label for ~1.5s after click, then
reverts. Implemented with local Svelte state + a timeout per button; no host/protocol change.
Component-tested: click → label flips to "Copied ✓" → reverts.

---

## Cluster E — In-editor gutter indicators (#4)

**New module:** `src/core/gutterIndicators.ts` (pure) + `src/web/gutterDecorations.ts`
(VSCode wiring). **The headline feature.**

### E1. Feasibility (verified)

VSCode does **not** support stacking multiple gutter *decoration types* on one line — they
conflict/hide each other (vscode #114776, #5923, #169051). The proven approach (Coverage
Gutters) is to render a **single SVG** per line as a `data:image/svg+xml;base64,…`
`gutterIconPath`. We therefore draw **N colored bars inside one composed SVG** per line to
achieve stacking. This works in the web extension host.

### E2. Scope

Indicators are shown for **all annotation groups except resolved ones** (per decision). They
do **not** follow the sidebar tag/author filter — they're a persistent "this code is
annotated" signal. One bar per annotation covering the line; the bar color is the group's
**first tag** color (via the palette), falling back to a neutral default (`#888888`) for
groups with no tags. Annotated lines are also marked on the **overview ruler** (the scrollbar
lane) so they're visible while scrolling — using the line's **primary** (first) bar color
when multiple annotations stack.

### E3. Pure logic (`src/core/gutterIndicators.ts`)

- `gutterBarsByLine(groups: AnnotationGroup[], file: string, palette: TagColor[]): Map<number, string[]>`
  — for the given workspace-relative file, return a map of **1-based line number → ordered
  list of bar colors** (one entry per annotation in a non-resolved group whose range covers
  that line). Deterministic ordering (e.g. by group/annotation creation order) so colors are
  stable.
- `buildGutterSvg(colors: string[]): string` — return a `data:image/svg+xml;base64,…` URI
  (via `svgDataUri` from `svgIcon.ts`) drawing thin vertical bars side by side (each ~3px
  wide, full height, 1px gap), sized to the gutter. **Cap** at `MAX_BARS` (e.g. 4); beyond the
  cap, render the cap'd bars only (extra annotations still navigable via the sidebar/hover).
  The cap is documented, not silent.

Both functions are pure and unit-tested (coverage logic, color mapping, ordering, cap,
empty/edge cases, SVG well-formedness).

### E4. VSCode wiring (`src/web/gutterDecorations.ts`)

- A `GutterDecorationManager` holds a cache of `TextEditorDecorationType` keyed by **color
  signature** (the joined color list) so lines sharing a signature reuse one decoration type
  (decoration types are limited/expensive). Each type sets:
  - `gutterIconPath` = the composed multi-bar SVG `data:` URI for that signature,
    `gutterIconSize: 'contain'`;
  - `overviewRulerColor` = the signature's **first** color + `overviewRulerLane: Center`, so
    annotated lines also appear on the scrollbar ruler (a different lane from the transient
    navigation highlight in Cluster C, to avoid clobbering it).
- The **per-line** `hoverMessage` (which lists *that line's* specific annotations as
  clickable command links — see E6) cannot live on the type, so each line is applied as a
  `DecorationOptions{ range, hoverMessage }`. The gutter SVG comes from the type (keyed by
  signature); the hover comes from the per-line option. The decoration range is the full line
  (no background tint — the bar is the only visible mark).
- `refresh(editors, groups, palette)` recomputes `gutterBarsByLine` per visible editor and
  applies decorations (grouping the editor's lines by signature, building each line's
  `DecorationOptions`). Stale signatures are disposed.
- **Update triggers** (wired in `extension.ts`):
  - `window.onDidChangeActiveTextEditor` / `onDidChangeVisibleTextEditors`,
  - the existing `.annotations/**/*.json` file watcher (already drives sidebar refresh),
  - group status changes / palette (config) changes,
  - the new manual refresh (Cluster F).

### E5. Testing note (honest)

VSCode exposes **no read-back** for applied decorations, so rendering can't be asserted via
the integration API. We unit-test all pure logic (`gutterBarsByLine`, `buildGutterSvg`,
`swatchIconSvg`, the hover-markdown builder, `annotationsAtLine` — see E6) and keep the wiring
thin; visual correctness (bars appear, stack, colored correctly; ruler marks) is verified by
a Playwright screenshot and/or manual check. This limitation is called out so coverage isn't
overstated.

### E6. Click-to-open from the gutter (#4 follow-up)

VSCode's public API has **no gutter-icon click/hover event** (open requests: vscode #224134,
#5455), so we can't intercept a raw click on the bar. We deliver the same outcome two ways:

- **Hover command links.** Each annotated line's `hoverMessage` (E4) is a *trusted*
  `MarkdownString` listing the annotations covering that line as `command:` links. Clicking a
  link runs a new command `annotated.openAnnotation` with `{ groupId, annotationId }` args,
  which reuses the create-flow open path (Cluster A1): load the group → `openAnnotation`
  message → focus the panel → reveal + highlight the code.
  - 1 annotation on the line → a single "📝 Open annotation" link.
  - N annotations → one link per annotation, labeled `group title · file:lines`.
  - `isTrusted` is enabled; args are our own ids and are validated in the command handler.
  - Known minor UX wrinkle (vscode #158711): the hover can dismiss while moving the mouse to
    the link; VSCode's sticky-hover default makes it usable in practice.
- **Cursor command + QuickPick.** A command `annotated.openAnnotationAtCursor` (Command
  Palette + keybinding) reads the active editor's cursor line and the annotations covering it:
  **0** → info message; **1** → open directly; **N** → a **QuickPick** (`group title ·
  file:lines`) to choose, then open. This is the keyboard path and the explicit QuickPick
  behavior requested.

Pure helper `annotationsAtLine(groups, file, line): { group, annotation }[]` (non-resolved
only) backs both paths and is unit-tested. The hover-markdown builder (annotations → command
links) is pure and unit-tested. The two commands are registered in `extension.ts` and added
to `package.json` `contributes.commands` (+ a keybinding for the cursor command).

---

## Cluster F — Sidebar: filter dropdown (#9) + refresh (#10)

**Component:** `src/webview/sidebar/FilterBar.svelte` (+ new `FilterPicker.svelte`),
`App.svelte`, `sidebarViewProvider.ts`, protocol.

### F1. Searchable tag-filter dropdown (#9)

Replace the always-rendered chip rows with a compact, searchable picker. New reusable
`FilterPicker.svelte`:

- Collapsed default: a slim input/placeholder ("＋ Filter by tag") — **no chip spam**.
- **On focus (before typing), the dropdown shows the full list** of available options (minus
  already-selected ones), so the menu is browsable without typing. If the list is long it's
  **truncated to a cap** (e.g. 50) with a "+N more — type to filter…" hint at the bottom.
  Typing narrows the list by case-insensitive substring; selecting an option adds it.
- Selected values render as **removable pills** (✕ to remove). Tag pills use the tag color +
  `contrastColor` text (Cluster B2).
- Pure filtering helper `filterOptions(all, selected, query, cap)` (returns the visible slice
  + a "more" count; empty query → all, capped) lives in `core` and is unit-tested; the
  component handles open/close + keyboard (Esc closes, Enter selects highlighted, ↑/↓ move).

Apply the same picker to the **authors** filter for consistency (the chip-spam problem is
identical), keeping the existing "Show resolved" checkbox. Selection state (`selectedTags`,
`selectedAuthors`) and `filterGroups` in `sidebarState.ts` are unchanged — only the
presentation changes.

### F2. Manual refresh button (#10)

- `App.svelte` header: add a refresh button (↻, next to "Select") → posts a new **`refresh`**
  webview→host message.
- `sidebarViewProvider.ts`: handle `refresh` by calling the existing `this.refresh()` (reloads
  groups + palette from disk and re-posts state). `extension.ts` also triggers a gutter
  decoration refresh on this message, so a manual refresh re-syncs both the sidebar and the
  editor indicators.

---

## Protocol additions (`src/shared/protocol.ts`)

| Direction | Message | Purpose |
|---|---|---|
| Host → detail | `{ type: 'openAnnotation'; annotationId: string }` | #2 — open a specific annotation in the detail panel |
| Detail → host | `{ type: 'navigationClosed' }` | #8 — clear the code highlight on Back |
| Webview → host (sidebar) | `{ type: 'refresh' }` | #10 — manual reload |

All three get validation arms in `parseDetailMessage` / `parseWebviewMessage` and protocol
unit tests.

## Command additions (`package.json` `contributes.commands`)

| Command | Trigger | Behavior |
|---|---|---|
| `annotated.openAnnotation` | Hover command links (E6) | Open the annotation given `{ groupId, annotationId }` args |
| `annotated.openAnnotationAtCursor` | Command Palette + keybinding | Open the annotation at the cursor line; QuickPick if multiple (E6) |

## Out of scope / non-goals

- No change to the on-disk annotation/comment format or the core model.
- No light/dark theme work beyond using `--vscode-*` variables and theme colors.
- Raw mouse-click capture on a gutter icon (not exposed by VSCode; delivered via hover links +
  cursor command instead — E6).
- Filtering gutter indicators by the sidebar filter (decision: show all non-resolved).

## Testing strategy

- **Unit (Vitest):** `contrastColor`, `TAG_SWATCHES`, `swatchIconSvg`, `gutterBarsByLine`,
  `buildGutterSvg`, `annotationsAtLine`, the hover-markdown builder, `filterOptions`
  (default-all + cap + substring), `runCreateAnnotation` returning the new annotation id, new
  protocol validation arms.
- **Svelte component tests:** `FilterPicker` (full-list-on-focus, typing filters, add/remove
  pill, keyboard), `AnnotationView` copy "Copied ✓" transient, `MarkdownEditor` autofocus prop
  wiring, sidebar refresh button posts `refresh`.
- **Integration (`@vscode/test-web`):** create → detail opens the new annotation in edit mode;
  `refresh` reloads; `navigationClosed` / panel-hidden invokes the clear-highlight callback;
  `annotated.openAnnotation` / `annotated.openAnnotationAtCursor` open the right annotation
  (single vs QuickPick path) — decoration state itself isn't queryable, so assert the wiring.
- **E2E (Playwright):** screenshot the gutter bars (single + stacked) and the strengthened
  navigation highlight for visual confirmation.

## Decomposition into sub-plans (single branch, e.g. `phase-4`)

Built subagent-driven (fresh subagent per task, spec + code-quality review between tasks),
proceeding autonomously across sub-plans per the project working agreement.

1. **4a — Tag color & contrast (#1, #7):** `src/core/svgIcon.ts` (`svgDataUri` +
   `swatchIconSvg`), `contrastColor`, `TAG_SWATCHES` (the 8 named colors), `promptNewTag` with
   visual swatch icons, de-duplicate the 3 call sites, apply contrast to chips. *(No webview
   round-trips; safe first step; lands the shared SVG helper used by 4g.)*
2. **4b — Markdown editor (#3 + #2's editor prop):** theme-aware highlight style,
   click-below-to-end, `autofocus` prop.
3. **4c — Create → focus flow (#2):** `runCreateAnnotation` return shape, `openAnnotation`
   message, `onCreated` callback wiring, autofocus on the new annotation.
4. **4d — Navigation highlight (#6, #8):** strengthen decoration, `navigationClosed` +
   panel-visibility clear.
5. **4e — Copy feedback (#5):** inline "Copied ✓".
6. **4f — Sidebar (#9, #10):** `FilterPicker`, refresh button + `refresh` message.
7. **4g — Gutter indicators + click-to-open (#4):** pure `gutterIndicators.ts`
   (`gutterBarsByLine`, `buildGutterSvg`, `annotationsAtLine`, hover-markdown builder) →
   `GutterDecorationManager` (gutter SVG + overview-ruler marks + per-line hover) → wiring +
   update triggers → `annotated.openAnnotation` / `annotated.openAnnotationAtCursor` commands
   (+ keybinding). *(Largest; verify SVG render + hover links early.)*
