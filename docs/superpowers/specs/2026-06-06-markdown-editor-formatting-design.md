# Design — Markdown Editor: toggle formatting + Cancel

**Date:** 2026-06-06
**Status:** Approved (brainstormed + approved in session)
**Source:** User request — improve the Markdown editor (annotation + comment editors).

## Overview

Four improvements to the CodeMirror-backed Markdown editor (`src/webview/detail/`):

| # | Item |
|---|------|
| 1 | `Cmd/Ctrl+B` / `Cmd/Ctrl+I` **toggle** bold/italic (currently they only ever *add* markers, so repeated presses pile up `*`). |
| 2 | New `Cmd/Ctrl+E` toggles inline code (`` ` ``). |
| 3 | These shortcuts must **not** leak to VS Code's keybindings (today `Cmd+B` also toggles the sidebar). |
| 4 | A ghost **Cancel** button to discard edits, in the annotation editor and (standardized) the comment editors. |

## Decisions locked during brainstorming

- **No-selection behavior:** insert an empty marker pair with the cursor between (`` **|** ``);
  pressing the same shortcut again on the now-empty pair **removes** it. With a selection, it
  wraps / unwraps. This is what kills the "keeps adding `*`" complaint.
- **Cancel control:** a **ghost button** (`class="btn ghost"`), **standardized** across the
  annotation editor and the two comment editors (the existing lowercase `cancel` *links* become
  ghost `Cancel` buttons). Those links are already `<button>`s, so this is purely visual.

---

## §1 — Toggle-formatting commands

### Pure transform (lives in `core/markdownTransforms.ts`)

Follows the existing pattern in that file (`linkSelection` is a pure string transform; the
CodeMirror glue lives in `editorExtensions.ts`). New function:

```ts
export interface MarkerEdit {
  /** Change ops in ORIGINAL-doc coordinates (non-overlapping). */
  changes: { from: number; to: number; insert: string }[];
  /** New selection, in the coordinate space AFTER this range's own changes apply. */
  selectionFrom: number;
  selectionTo: number;
}

/** Toggle a symmetric inline marker (`**`, `*`, or `` ` ``) over doc[from..to]. */
export function toggleMarker(doc: string, from: number, to: number, marker: string): MarkerEdit;
```

Decision logic for one range `[from, to]`:

1. **Non-empty selection (`from < to`):**
   - **Outer-wrapped?** `doc[from-len..from] === marker` && `doc[to..to+len] === marker` →
     **remove** those outer markers; new selection stays on the (now unwrapped) inner text.
   - else **Inner-wrapped?** the selected slice itself starts and ends with `marker` (length
     allows it) → **remove** the inner markers; selection shrinks to the inner text.
   - else **wrap:** insert `marker` at `from` and at `to`; re-select the inner text (i.e.
     `selectionFrom = from + len`, `selectionTo = to + len`) — matching today's wrap behavior.
2. **Empty selection (`from === to`, a bare cursor):**
   - **Empty pair around cursor?** `doc[from-len..from] === marker` && `doc[to..to+len] === marker`
     → **remove** both markers (this is the "re-press undoes it" case); cursor collapses to `from-len`.
   - else **insert** `marker + marker` and place the cursor between them
     (`selectionFrom = selectionTo = from + len`).

### Bold / italic disambiguation (the `*` ⊂ `**` problem)

Because `*` is a prefix of `**`, the **unwrap** checks for **italic** (`marker === '*'`) must not
match the inner star of a bold `**` boundary. Guard: a candidate `*` only counts as an italic
marker to remove if the character just beyond it is **not** another `*`. Concretely:

- `Cmd+I` on `**foo**` (selection = inner `foo`) → guard fails (neighbor is `*`) → **wraps** →
  `***foo***`.
- `Cmd+I` on `*foo*` (selection = inner `foo`) → guard passes → **unwraps** → `foo`.
- `Cmd+B` on `***foo***` (selection = inner `foo`) → outer two chars are `**` → **unwraps bold** →
  `*foo*` (italic preserved).

Bold (`**`) needs no extra guard: stripping `**` from a `***…***` run correctly leaves the `*`.

### Concrete cases (these become unit tests in `markdownTransforms.unit.test.ts`)

Notation: `doc` / selection `[from,to]` / `marker` → resulting `doc` with `‹…›` marking the new selection, `|` marking a collapsed cursor.

- Wrap bold: `foo bar` `[0,3]` `**` → `‹**foo**› bar` (sel = inner `foo`).
- Unwrap bold (outer, sel=inner): `**foo** bar` `[2,5]` `**` → `‹foo› bar`.
- Unwrap bold (inner, sel includes markers): `**foo** bar` `[0,7]` `**` → `‹foo› bar`.
- Insert bold at cursor: `ab` `[1,1]` `**` → `a**|**b`.
- Re-press removes empty pair: `a****b` `[3,3]` `**` → `a|b`.
- Wrap italic: `foo` `[0,3]` `*` → `‹*foo*›`.
- Italic on bold (guard → wrap): `**foo**` `[2,5]` `*` → `**‹*foo*›**` (= `***foo***`).
- Unwrap italic: `*foo*` `[1,4]` `*` → `‹foo›`.
- Bold on bold+italic (unwrap bold only): `***foo***` `[3,6]` `**` → `*‹foo›*`.
- Wrap code: `foo` `[0,3]` `` ` `` → `` ‹`foo`› ``.
- Unwrap code: `` `foo` `` `[1,4]` `` ` `` → `‹foo›`.

### CodeMirror glue (`editorExtensions.ts`)

Replace `wrapCommand` + `markdownKeymap` with a toggle that maps every selection range through
`toggleMarker` (preserving multi-cursor support, as the old `wrapCommand` had):

```ts
// Pure: build the transaction spec from a state (testable with a headless EditorState).
export function toggleMarkerSpec(state: EditorState, marker: string): TransactionSpec {
  const doc = state.doc.toString();
  return state.changeByRange((range) => {
    const e = toggleMarker(doc, range.from, range.to, marker);
    return { changes: e.changes, range: EditorSelection.range(e.selectionFrom, e.selectionTo) };
  });
}

function toggleCommand(marker: string) {
  return (view: EditorView): boolean => {
    view.dispatch(view.state.update(toggleMarkerSpec(view.state, marker), { scrollIntoView: true }));
    return true;
  };
}

export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleCommand('**') },
  { key: 'Mod-i', run: toggleCommand('*') },
  { key: 'Mod-e', run: toggleCommand('`') },
];
```

`EditorState`/`EditorSelection`/`state.changeByRange` are DOM-free, so `toggleMarkerSpec` is
unit-testable (build a state, apply the spec, assert doc + selection) without mounting a view.

---

## §2 — Stop the shortcuts leaking to VS Code

**Root cause:** the webview iframe forwards keydown events up to VS Code so global keybindings
still fire when focus is in a webview. CodeMirror's keymap calls `preventDefault` when a binding
runs, but that does **not** stop the forward — so `Cmd+B` both wraps text *and* toggles the
sidebar (`workbench.action.toggleSidebarVisibility`).

**Fix:** add a bubble-phase `keydown` DOM handler (a second `EditorView.domEventHandlers`, like
the existing `urlPasteHandler`) that calls **`event.stopPropagation()`** for our combos, so the
event never reaches the window-level forwarder. The keymap still runs the toggle and
`preventDefault`s; we only add `stopPropagation`.

```ts
export const stopFormattingShortcuts: Extension = EditorView.domEventHandlers({
  keydown(event) {
    const k = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
        && (k === 'b' || k === 'i' || k === 'e')) {
      event.stopPropagation(); // keep it inside the editor; keymap still handles + preventDefaults
    }
    return false; // let the keymap run the command
  },
});
```

Matching `metaKey || ctrlKey` covers both macOS (Cmd) and Win/Linux (Ctrl) harmlessly; the keymap
(`Mod-…`) still decides per-platform what actually runs. Wired into `MarkdownEditor.svelte`'s
extension list.

**Verification:** this can't be unit-tested (needs a real webview), so it's a **manual** check:
in the running extension, focus the editor, press `Cmd+B`/`Cmd+I`/`Cmd+E` → text toggles and the
sidebar does **not**. *Fallback if it still leaks* (VS Code listening in capture phase): handle
the combo entirely in a window-capture listener added on mount — noted, not expected to be needed.

---

## §3 — Ghost Cancel buttons

### `AnnotationView.svelte`

- New `cancelEdit()`: `draft = annotation.content; editing = false;` (drop the draft, restore the
  `MarkdownPreview`). For a brand-new empty annotation this just exits to an empty preview.
- Toolbar while editing: `[Save] [Cancel]` then the existing `⧉ Copy markdown` ghost button.
  Cancel = `class="btn ghost"`, `data-testid="cancel-btn"`.

### `CommentThread.svelte`

- Replace the edit `cancel` link → `<button class="btn ghost" data-testid="comment-cancel-btn"
  onclick={() => (editingId = null)}>Cancel</button>`.
- Replace the reply `cancel` link → `<button class="btn ghost" data-testid="reply-cancel-btn"
  onclick={() => (replying = false)}>Cancel</button>`.
- Add a `.btn.ghost` rule to this component's `<style>` (it has `.btn` but not the ghost variant),
  matching `AnnotationView`'s (`--vscode-button-secondaryBackground` / `…secondaryForeground`).
- Discard semantics already hold: `editDraft`/`replyDraft` are reset by `startEdit`/`startReply`
  on next open, and the editor remounts each time — no extra reset needed.

---

## File-by-file changes

- **`src/core/markdownTransforms.ts`** — add `MarkerEdit` + `toggleMarker`.
- **`src/core/markdownTransforms.unit.test.ts`** — add the §1 cases above.
- **`src/webview/detail/editorExtensions.ts`** — `toggleMarkerSpec` + `toggleCommand`, `Mod-e`
  binding, `stopFormattingShortcuts` handler; remove `wrapCommand`.
- **`src/webview/detail/editorExtensions.unit.test.ts`** *(new)* — `toggleMarkerSpec` over a
  headless `EditorState`: single + multi-range; asserts resulting doc & selection.
- **`src/webview/detail/MarkdownEditor.svelte`** — add `stopFormattingShortcuts` to extensions.
- **`src/webview/detail/AnnotationView.svelte`** — `cancelEdit()` + Cancel button.
- **`src/webview/detail/AnnotationView.svelte.test.ts`** — Cancel exits edit mode, restores
  original content, does not call `onsave`.
- **`src/webview/detail/CommentThread.svelte`** — ghost Cancel buttons + `.btn.ghost` style.
- **`src/webview/detail/CommentThread.svelte.test.ts`** — Cancel closes reply/edit editors,
  does not call `onadd`/`onedit`.

## Testing strategy

- **Unit:** `toggleMarker` (pure) and `toggleMarkerSpec` (headless `EditorState`).
- **Component:** Cancel behavior in `AnnotationView` and `CommentThread` (MarkdownEditor stubbed,
  per existing convention).
- **Manual:** §2 propagation (Cmd+B/I/E don't toggle the sidebar) + a quick toggle smoke test.
- Local gate (per project memory): `check-types` + `test:unit` (integration/e2e need network).

## Non-goals

- Word-under-cursor detection (chose empty-marker insert instead).
- Fenced/triple-backtick code blocks, link/heading/list shortcuts, multi-char marker handling
  beyond `**`/`*`/`` ` ``.
- Backtick-aware escaping for code spans that themselves contain backticks.
