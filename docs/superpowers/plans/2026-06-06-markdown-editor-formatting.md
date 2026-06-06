# Markdown Editor: Toggle Formatting + Cancel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Cmd/Ctrl+B`/`I`/`E` toggle bold/italic/inline-code in the Markdown editor (instead of only adding markers), stop those shortcuts from leaking to VS Code keybindings, and add ghost **Cancel** buttons to discard edits.

**Architecture:** Pure marker-toggle logic lives in `src/core/markdownTransforms.ts` (string in → change ops out, DOM-free, unit-tested in node). The CodeMirror glue in `src/webview/detail/editorExtensions.ts` maps each selection range through it and binds the keys; a small `keydown` DOM handler stops the combos propagating out of the webview. Cancel buttons are local edit-state toggles in the two Svelte editors.

**Tech Stack:** TypeScript, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Svelte 5 (runes), Vitest (node `*.unit.test.ts` + jsdom `*.svelte.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-06-markdown-editor-formatting-design.md`

**Build/test note (every test/typecheck step):** prefix node commands with
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH"` (machine default Node is too old). Local gate
is `check-types` + `test:unit`; integration/e2e need network and are out of scope here.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/core/markdownTransforms.ts` | add `MarkerEdit` + pure `toggleMarker` | 1 |
| `src/core/markdownTransforms.unit.test.ts` | `toggleMarker` cases | 1 |
| `src/webview/detail/editorExtensions.ts` | `toggleMarkerSpec`, `toggleCommand`, `Mod-e`, `isFormattingShortcut`, `stopFormattingShortcuts`; remove `wrapCommand` | 2, 3 |
| `src/webview/detail/editorExtensions.unit.test.ts` *(new)* | `toggleMarkerSpec` (headless state) + `isFormattingShortcut` | 2, 3 |
| `src/webview/detail/MarkdownEditor.svelte` | wire `stopFormattingShortcuts` | 3 |
| `src/webview/detail/AnnotationView.svelte` (+ `.svelte.test.ts`) | ghost Cancel button | 4 |
| `src/webview/detail/CommentThread.svelte` (+ `.svelte.test.ts`) | ghost Cancel buttons + `.btn.ghost` style | 5 |

**Dependencies / ordering:** Task 2 depends on Task 1 (imports `toggleMarker`). Task 3 depends on
Task 2 (same file `editorExtensions.ts`). Tasks 4 and 5 are independent of 1–3 and of each other
(disjoint files, no shared interface) — safe to pipeline their reviews.

---

### Task 1: Pure `toggleMarker` transform (core)

**Files:**
- Modify: `src/core/markdownTransforms.ts`
- Test: `src/core/markdownTransforms.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/core/markdownTransforms.unit.test.ts` (keep existing imports; add `toggleMarker` to the import from `./markdownTransforms`, and `type MarkerEdit` if you want the annotation — optional):

```ts
import { isUrl, linkSelection, toggleMarker, type MarkerEdit } from './markdownTransforms';

/** Apply an edit's change ops to `doc` and return the new doc + the selected slice. */
function apply(doc: string, e: MarkerEdit): { doc: string; sel: string } {
  const out = [...e.changes]
    .sort((a, b) => b.from - a.from) // right-to-left keeps earlier indices valid
    .reduce((acc, c) => acc.slice(0, c.from) + c.insert + acc.slice(c.to), doc);
  return { doc: out, sel: out.slice(e.selectionFrom, e.selectionTo) };
}

describe('toggleMarker', () => {
  it('wraps a bold selection and re-selects the inner text', () => {
    const r = apply('foo bar', toggleMarker('foo bar', 0, 3, '**'));
    expect(r.doc).toBe('**foo** bar');
    expect(r.sel).toBe('foo');
  });
  it('unwraps bold when markers sit just outside the selection', () => {
    const r = apply('**foo** bar', toggleMarker('**foo** bar', 2, 5, '**'));
    expect(r.doc).toBe('foo bar');
    expect(r.sel).toBe('foo');
  });
  it('unwraps bold when the selection includes the markers', () => {
    const r = apply('**foo** bar', toggleMarker('**foo** bar', 0, 7, '**'));
    expect(r.doc).toBe('foo bar');
    expect(r.sel).toBe('foo');
  });
  it('inserts an empty bold pair at a bare cursor, caret between', () => {
    const e = toggleMarker('ab', 1, 1, '**');
    const r = apply('ab', e);
    expect(r.doc).toBe('a****b');
    expect(e.selectionFrom).toBe(3);
    expect(e.selectionTo).toBe(3);
  });
  it('removes an empty bold pair when pressed again on it', () => {
    const e = toggleMarker('a****b', 3, 3, '**');
    const r = apply('a****b', e);
    expect(r.doc).toBe('ab');
    expect(e.selectionFrom).toBe(1);
    expect(e.selectionTo).toBe(1);
  });
  it('wraps an italic selection', () => {
    const r = apply('foo', toggleMarker('foo', 0, 3, '*'));
    expect(r.doc).toBe('*foo*');
    expect(r.sel).toBe('foo');
  });
  it('italic on bold text wraps (does not mistake ** for *)', () => {
    const r = apply('**foo**', toggleMarker('**foo**', 2, 5, '*'));
    expect(r.doc).toBe('***foo***');
    expect(r.sel).toBe('foo');
  });
  it('unwraps italic', () => {
    const r = apply('*foo*', toggleMarker('*foo*', 1, 4, '*'));
    expect(r.doc).toBe('foo');
    expect(r.sel).toBe('foo');
  });
  it('bold on bold+italic removes only the bold layer', () => {
    const r = apply('***foo***', toggleMarker('***foo***', 3, 6, '**'));
    expect(r.doc).toBe('*foo*');
    expect(r.sel).toBe('foo');
  });
  it('wraps inline code', () => {
    const r = apply('foo', toggleMarker('foo', 0, 3, '`'));
    expect(r.doc).toBe('`foo`');
    expect(r.sel).toBe('foo');
  });
  it('unwraps inline code', () => {
    const r = apply('`foo`', toggleMarker('`foo`', 1, 4, '`'));
    expect(r.doc).toBe('foo');
    expect(r.sel).toBe('foo');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/markdownTransforms.unit.test.ts`
Expected: FAIL — `toggleMarker is not a function` / no export named `toggleMarker`.

- [ ] **Step 3: Implement `toggleMarker`**

Append to `src/core/markdownTransforms.ts`:

```ts
/** A toggle edit: change ops in ORIGINAL-doc coordinates + the resulting selection. */
export interface MarkerEdit {
  /** Non-overlapping change ops; `insert: ''` deletes `[from,to)`. */
  changes: { from: number; to: number; insert: string }[];
  /** New selection, in the coordinate space AFTER this edit's own changes apply. */
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Toggle a symmetric inline marker (`**` bold, `*` italic, `` ` `` code) over `doc[from..to]`.
 *
 * Selection present: unwrap if the markers sit just outside the selection, else if the
 * selected slice itself is wrapped, else wrap (re-selecting the inner text). Bare cursor:
 * remove an empty marker pair around the caret, else insert one with the caret between.
 *
 * Disambiguation: because `*` is a prefix of `**`, an italic (`*`) marker only counts for
 * UNWRAP when the neighbouring char isn't another `*` (so it never strips the inner star of
 * a bold `**` boundary). Toggling italic over `**foo**` therefore wraps → `***foo***`.
 */
export function toggleMarker(doc: string, from: number, to: number, marker: string): MarkerEdit {
  const len = marker.length;
  const at = (pos: number): boolean =>
    pos >= 0 && pos + len <= doc.length && doc.slice(pos, pos + len) === marker;
  const italic = marker === '*';

  if (from < to) {
    // Markers immediately outside the selection?
    const left = from - len;
    if (at(left) && at(to) && (!italic || (doc[left - 1] !== '*' && doc[to + len] !== '*'))) {
      return {
        changes: [
          { from: left, to: from, insert: '' },
          { from: to, to: to + len, insert: '' },
        ],
        selectionFrom: from - len,
        selectionTo: to - len,
      };
    }
    // Selection itself wrapped?
    const slice = doc.slice(from, to);
    if (
      slice.length >= 2 * len &&
      slice.startsWith(marker) &&
      slice.endsWith(marker) &&
      (!italic || (slice[len] !== '*' && slice[slice.length - len - 1] !== '*'))
    ) {
      return {
        changes: [
          { from, to: from + len, insert: '' },
          { from: to - len, to, insert: '' },
        ],
        selectionFrom: from,
        selectionTo: to - 2 * len,
      };
    }
    // Otherwise wrap, re-selecting the inner text.
    return {
      changes: [
        { from, to: from, insert: marker },
        { from: to, to, insert: marker },
      ],
      selectionFrom: from + len,
      selectionTo: to + len,
    };
  }

  // Bare cursor.
  const left = from - len;
  if (at(left) && at(from) && (!italic || (doc[left - 1] !== '*' && doc[from + len] !== '*'))) {
    return {
      changes: [
        { from: left, to: from, insert: '' },
        { from, to: from + len, insert: '' },
      ],
      selectionFrom: left,
      selectionTo: left,
    };
  }
  return {
    changes: [{ from, to: from, insert: marker + marker }],
    selectionFrom: from + len,
    selectionTo: from + len,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/markdownTransforms.unit.test.ts`
Expected: PASS (all `toggleMarker` cases + the existing `isUrl`/`linkSelection` cases).

- [ ] **Step 5: Type-check + commit**

```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
npm run check-types
git add src/core/markdownTransforms.ts src/core/markdownTransforms.unit.test.ts
git commit -m "feat(editor): pure toggleMarker transform for bold/italic/code"
```

---

### Task 2: CodeMirror toggle commands + `Mod-e` (editorExtensions)

**Files:**
- Modify: `src/webview/detail/editorExtensions.ts` (replace `wrapCommand`/`markdownKeymap`, lines 28–47)
- Test: `src/webview/detail/editorExtensions.unit.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/webview/detail/editorExtensions.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { toggleMarkerSpec } from './editorExtensions';

/** Build a state with the given selection ranges, apply the toggle, return doc + selected slices. */
function run(doc: string, ranges: [number, number][], marker: string): { doc: string; sels: string[] } {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))),
  });
  const next = state.update(toggleMarkerSpec(state, marker)).state;
  const text = next.doc.toString();
  return { doc: text, sels: next.selection.ranges.map((r) => text.slice(r.from, r.to)) };
}

describe('toggleMarkerSpec', () => {
  it('toggles bold for a single selection', () => {
    const r = run('foo bar', [[0, 3]], '**');
    expect(r.doc).toBe('**foo** bar');
    expect(r.sels).toEqual(['foo']);
  });
  it('un-toggles bold on a second application', () => {
    const r = run('**foo** bar', [[2, 5]], '**');
    expect(r.doc).toBe('foo bar');
    expect(r.sels).toEqual(['foo']);
  });
  it('applies to every range of a multi-cursor selection', () => {
    const r = run('foo bar', [[0, 3], [4, 7]], '**');
    expect(r.doc).toBe('**foo** **bar**');
    expect(r.sels).toEqual(['foo', 'bar']);
  });
  it('inserts an empty code pair at a bare cursor', () => {
    const state = EditorState.create({ doc: 'ab', selection: EditorSelection.cursor(1) });
    const next = state.update(toggleMarkerSpec(state, '`')).state;
    expect(next.doc.toString()).toBe('a``b');
    expect(next.selection.main.head).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/editorExtensions.unit.test.ts`
Expected: FAIL — no export named `toggleMarkerSpec`.

- [ ] **Step 3: Replace `wrapCommand`/`markdownKeymap` with the toggle**

In `src/webview/detail/editorExtensions.ts`, update the imports on lines 1–2 to:

```ts
import { EditorView, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
```

Add to the import from `../../core/markdownTransforms` (line 5):

```ts
import { isUrl, linkSelection, toggleMarker } from '../../core/markdownTransforms';
```

Replace the whole `wrapCommand` + `markdownKeymap` block (the current lines 28–47) with:

```ts
/** Build the transaction that toggles `marker` over every selection range (pure — no view). */
export function toggleMarkerSpec(state: EditorState, marker: string): TransactionSpec {
  const doc = state.doc.toString();
  return state.changeByRange((range) => {
    const edit = toggleMarker(doc, range.from, range.to, marker);
    return {
      changes: edit.changes,
      range: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
    };
  });
}

/** A command that toggles `marker` around the current selection(s). */
function toggleCommand(marker: string) {
  return (view: EditorView): boolean => {
    view.dispatch(view.state.update(toggleMarkerSpec(view.state, marker), { scrollIntoView: true }));
    return true;
  };
}

/** Bold (Mod-b), italic (Mod-i), inline code (Mod-e) toggle shortcuts. */
export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleCommand('**') },
  { key: 'Mod-i', run: toggleCommand('*') },
  { key: 'Mod-e', run: toggleCommand('`') },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/editorExtensions.unit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check + commit**

```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
npm run check-types
git add src/webview/detail/editorExtensions.ts src/webview/detail/editorExtensions.unit.test.ts
git commit -m "feat(editor): toggle bold/italic + add Mod-e inline-code shortcut"
```

---

### Task 3: Stop the shortcuts leaking to VS Code

**Files:**
- Modify: `src/webview/detail/editorExtensions.ts` (add predicate + handler)
- Modify: `src/webview/detail/MarkdownEditor.svelte` (wire the handler)
- Test: `src/webview/detail/editorExtensions.unit.test.ts` (add predicate tests)

- [ ] **Step 1: Write the failing test**

Append to `src/webview/detail/editorExtensions.unit.test.ts` (extend the import on line 3):

```ts
import { toggleMarkerSpec, isFormattingShortcut } from './editorExtensions';

const key = (over: Partial<Record<'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', unknown>>) =>
  ({ key: 'b', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as Parameters<typeof isFormattingShortcut>[0];

describe('isFormattingShortcut', () => {
  it('matches Cmd/Ctrl + b/i/e with no other modifiers', () => {
    expect(isFormattingShortcut(key({ metaKey: true, key: 'b' }))).toBe(true);
    expect(isFormattingShortcut(key({ ctrlKey: true, key: 'i' }))).toBe(true);
    expect(isFormattingShortcut(key({ metaKey: true, key: 'E' }))).toBe(true); // case-insensitive
  });
  it('ignores other keys, plain keys, and shift/alt combos', () => {
    expect(isFormattingShortcut(key({ metaKey: true, key: 's' }))).toBe(false);
    expect(isFormattingShortcut(key({ key: 'b' }))).toBe(false);
    expect(isFormattingShortcut(key({ metaKey: true, shiftKey: true, key: 'b' }))).toBe(false);
    expect(isFormattingShortcut(key({ metaKey: true, altKey: true, key: 'b' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/editorExtensions.unit.test.ts`
Expected: FAIL — no export named `isFormattingShortcut`.

- [ ] **Step 3: Add the predicate + DOM handler**

Append to `src/webview/detail/editorExtensions.ts`:

```ts
/** True for the editor's formatting combos (Cmd/Ctrl + b/i/e, no shift/alt). */
export function isFormattingShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  const k = e.key.toLowerCase();
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === 'b' || k === 'i' || k === 'e');
}

/**
 * Keep the formatting combos inside the editor. VS Code webviews forward keydowns to the
 * workbench so global keybindings still fire in a webview — which is why Cmd+B also toggled
 * the sidebar. The keymap still runs the toggle + preventDefault; we add stopPropagation so
 * the event never reaches the window-level forwarder.
 */
export const stopFormattingShortcuts: Extension = EditorView.domEventHandlers({
  keydown(event) {
    if (isFormattingShortcut(event)) {
      event.stopPropagation();
    }
    return false; // let the keymap run the command
  },
});
```

- [ ] **Step 4: Wire it into the editor**

In `src/webview/detail/MarkdownEditor.svelte`, extend the import on line 8:

```ts
import { markdownKeymap, urlPasteHandler, stopFormattingShortcuts, markdownHighlightStyle, fillHeightTheme } from './editorExtensions';
```

Add `stopFormattingShortcuts` to the extensions array, right after `urlPasteHandler` (line 60):

```ts
          fillHeightTheme,
          urlPasteHandler,
          stopFormattingShortcuts,
          keymap.of([
```

- [ ] **Step 5: Run the test + type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/editorExtensions.unit.test.ts && npm run check-types`
Expected: PASS (6 tests) and a clean type-check.

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/editorExtensions.ts src/webview/detail/editorExtensions.unit.test.ts src/webview/detail/MarkdownEditor.svelte
git commit -m "fix(editor): stop Cmd+B/I/E from triggering VS Code keybindings"
```

- [ ] **Step 7: Manual verification (record for the user — needs a real webview)**

Cannot be unit-tested. After merge, in the running extension: focus the Markdown editor, then
press `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, `Cmd/Ctrl+E`. Expect: text toggles bold/italic/code and the
**sidebar does not toggle**. If the sidebar still toggles (VS Code listening in capture phase),
fall back to a window-capture keydown listener added on mount in `MarkdownEditor.svelte` that
calls `stopPropagation()` when `isFormattingShortcut(event)` — note this in the PR and revisit.

---

### Task 4: Ghost Cancel button in the annotation editor

**Files:**
- Modify: `src/webview/detail/AnnotationView.svelte` (script + toolbar)
- Test: `src/webview/detail/AnnotationView.svelte.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('AnnotationView', …)` block in `src/webview/detail/AnnotationView.svelte.test.ts`:

```ts
  it('Cancel discards edits, restores the preview, and does not call onsave', async () => {
    const onsave = vi.fn();
    render(AnnotationView, { annotation: annotation('original'), onsave });
    await userEvent.click(screen.getByTestId('edit-btn'));
    await userEvent.type(screen.getByTestId('md-editor'), ' changed');
    await userEvent.click(screen.getByTestId('cancel-btn'));
    expect(onsave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('md-editor')).toBeNull();
    expect(screen.getByTestId('md-preview')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — `Unable to find an element by: [data-testid="cancel-btn"]`.

- [ ] **Step 3: Add `cancelEdit` + the Cancel button**

In `src/webview/detail/AnnotationView.svelte`, add `cancelEdit` right after `save()` (currently ends at line 71):

```ts
  function cancelEdit(): void {
    draft = annotation.content;
    editing = false;
  }
```

In the toolbar, change the editing branch (currently line 122) to render Save **and** Cancel:

```svelte
    {#if editing}
      <button type="button" class="btn" data-testid="save-btn" onclick={save}>Save</button>
      <button type="button" class="btn ghost" data-testid="cancel-btn" onclick={cancelEdit}>Cancel</button>
    {:else}
```

(`.btn.ghost` is already defined in this component's `<style>`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS (the new test + all existing AnnotationView tests).

- [ ] **Step 5: Type-check + commit**

```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
npm run check-types
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(editor): add Cancel button to the annotation editor"
```

---

### Task 5: Ghost Cancel buttons in the comment editors

**Files:**
- Modify: `src/webview/detail/CommentThread.svelte` (two `cancel` links → ghost buttons; add `.btn.ghost` style)
- Test: `src/webview/detail/CommentThread.svelte.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('CommentThread', …)` block in `src/webview/detail/CommentThread.svelte.test.ts`:

```ts
  it('Cancel closes the reply composer without adding', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    await userEvent.type(screen.getByTestId('md-editor'), 'draft');
    await userEvent.click(screen.getByTestId('reply-cancel-btn'));
    expect(onadd).not.toHaveBeenCalled();
    expect(screen.queryByTestId('md-editor')).toBeNull();
    expect(screen.getByTestId('comment-reply-trigger')).toBeInTheDocument();
  });

  it('Cancel closes the comment editor without saving', async () => {
    const onedit = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, onedit });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    await userEvent.click(screen.getByTestId('comment-cancel-btn'));
    expect(onedit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('md-editor')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/CommentThread.svelte.test.ts`
Expected: FAIL — `reply-cancel-btn` / `comment-cancel-btn` not found.

- [ ] **Step 3: Replace the two `cancel` links with ghost buttons**

In `src/webview/detail/CommentThread.svelte`, the edit-comment branch (currently line 67):

```svelte
          <button type="button" class="btn ghost" data-testid="comment-cancel-btn" onclick={() => (editingId = null)}>Cancel</button>
```

The reply branch (currently line 80):

```svelte
        <button type="button" class="btn ghost" data-testid="reply-cancel-btn" onclick={() => (replying = false)}>Cancel</button>
```

Add the ghost variant to this component's `<style>`, right after the `.btn` rule (currently line 108):

```css
  .btn.ghost { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/CommentThread.svelte.test.ts`
Expected: PASS (the two new tests + all existing CommentThread tests).

- [ ] **Step 5: Full local gate + commit**

```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
npm run check-types && npm run test:unit
git add src/webview/detail/CommentThread.svelte src/webview/detail/CommentThread.svelte.test.ts
git commit -m "feat(editor): standardize comment Cancel as ghost buttons"
```

---

## Final verification (after all tasks)

```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
npm run check-types && npm run test:unit
```
Expected: type-check clean; all unit + component tests pass. Then perform the **Task 3 Step 7**
manual webview check before considering the feature done.
