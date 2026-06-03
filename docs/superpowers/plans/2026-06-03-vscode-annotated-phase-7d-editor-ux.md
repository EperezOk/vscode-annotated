# Phase 7d — Editor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three round-3 editor/comment UX items (spec §G/§K/§L): Cmd/Ctrl+Enter submits from inside any Markdown editor; edit buttons autofocus the input/editor with the cursor at the end; other authors' comment names render in a distinct color.

**Architecture:** `MarkdownEditor` gains an `onSubmit` prop bound to `Mod-Enter` (ahead of the default keymap, which otherwise inserts a blank line); the test stub passes it through (with a Cmd/Ctrl+Enter keydown shim) so host components are testable. `AnnotationView`/`CommentThread` set `autofocus` on every editor they open (MarkdownEditor already places the cursor at the doc end); a new shared `focusAtEnd` Svelte action covers the plain `<input>` (group title). Author-name coloring is a `class:other` toggle + CSS.

**Tech Stack:** TypeScript, Svelte 5 (runes, `use:` actions), CodeMirror keymaps, Vitest component tests.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
The CodeMirror `Mod-Enter` keybinding itself is `vscode`-webview glue (no MarkdownEditor component test exists; CodeMirror-in-jsdom is intentionally avoided) — type-check + manual. Everything downstream (AnnotationView/CommentThread/GroupView wiring, autofocus props, author classes) is component-tested via the stub. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/webview/detail/MarkdownEditor.svelte` — `onSubmit` prop + `Mod-Enter` keybinding.
- **Modify** `src/webview/detail/__mocks__/MarkdownEditorStub.svelte` — pass-through + keydown shim.
- **Modify** `src/webview/detail/AnnotationView.svelte` (+ `.svelte.test.ts`) — autofocus on every edit; `onSubmit={save}`.
- **Modify** `src/webview/detail/CommentThread.svelte` (+ `.svelte.test.ts`) — autofocus composer/edit; `onSubmit`; `class:other` author color.
- **Create** `src/webview/shared/focusAtEnd.ts` — focus-with-cursor-at-end action for `<input>`.
- **Modify** `src/webview/detail/GroupView.svelte` (+ `.svelte.test.ts`) — `use:focusAtEnd` on the title input.

---

### Task 1: `MarkdownEditor` Mod-Enter submit + stub pass-through (§G)

**Files:**
- Modify: `src/webview/detail/MarkdownEditor.svelte`
- Modify: `src/webview/detail/__mocks__/MarkdownEditorStub.svelte`

> Type-check + manual at this layer; host-component tests land in Tasks 2–3.

- [ ] **Step 1: `MarkdownEditor.svelte`.**

(a) Extend the props line:

```ts
  let { doc = '', autofocus = false, onChange, onSubmit }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void; onSubmit?: () => void } = $props();
```

(b) In the `extensions` array, replace the keymap line:

```ts
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
```

with (Mod-Enter must come FIRST — `defaultKeymap` binds it to insertBlankLine):

```ts
          keymap.of([
            // Submit shortcut — ahead of defaultKeymap, which binds Mod-Enter to insertBlankLine.
            { key: 'Mod-Enter', run: () => (onSubmit ? (onSubmit(), true) : false) },
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
```

- [ ] **Step 2: Stub pass-through.** Replace the entire content of `src/webview/detail/__mocks__/MarkdownEditorStub.svelte` with:

```svelte
<script lang="ts">
  let { doc = '', autofocus = false, onChange, onSubmit }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void; onSubmit?: () => void } = $props();
</script>

<textarea
  data-testid="md-editor"
  data-autofocus={autofocus}
  value={doc}
  oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
  onkeydown={(e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    }
  }}
></textarea>
```

- [ ] **Step 3: Type-check + existing suites still green**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean + all PASS (no behavior change yet — `onSubmit` is unused by hosts).

- [ ] **Step 4: Commit**

```bash
git add src/webview/detail/MarkdownEditor.svelte src/webview/detail/__mocks__/MarkdownEditorStub.svelte
git commit -m "feat(editor): Mod-Enter submit hook on MarkdownEditor (TODO #8)"
```

---

### Task 2: `AnnotationView` — autofocus on every edit + Mod-Enter saves (§G, §L)

**Files:**
- Modify: `src/webview/detail/AnnotationView.svelte`
- Test: `src/webview/detail/AnnotationView.svelte.test.ts`

- [ ] **Step 1: Update the tests (contract first).** In `src/webview/detail/AnnotationView.svelte.test.ts`, replace the test `'does not autofocus when manually editing an existing annotation'` with:

```ts
  it('autofocuses the editor when manually editing an existing annotation', async () => {
    render(AnnotationView, { annotation: annotation('original') });
    await userEvent.click(screen.getByTestId('edit-btn'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('saves via Cmd/Ctrl+Enter inside the editor', async () => {
    const onsave = vi.fn();
    render(AnnotationView, { annotation: annotation('original'), onsave });
    await userEvent.click(screen.getByTestId('edit-btn'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.type(editor, '!');
    await userEvent.type(editor, '{Meta>}{Enter}{/Meta}');
    expect(onsave).toHaveBeenCalledWith('a1', 'original!');
  });
```

(The existing `'autofocuses the editor when auto-opening an empty (new) annotation'` test stays — it still passes.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — `data-autofocus` is `'false'` on manual edit; Mod-Enter does nothing.

- [ ] **Step 3: Implement.** In `src/webview/detail/AnnotationView.svelte`:

(a) Delete the `autofocusEditor` const and its comment (the block):

```ts
  // Autofocus the editor only when we auto-open in edit mode because the annotation is
  // empty (the just-created case) — never steal focus on a manual "Edit" of existing content.
  const autofocusEditor = untrack(() => annotation.content.length === 0);
```

(round-3 feedback #13 reverses that round-1 decision: every entry into edit mode focuses the editor.)

(b) Replace the editor line:

```svelte
    <MarkdownEditor doc={draft} autofocus={autofocusEditor} onChange={(v) => (draft = v)} />
```

with:

```svelte
    <MarkdownEditor doc={draft} autofocus onChange={(v) => (draft = v)} onSubmit={save} />
```

(`untrack` stays imported — it is still used by `editing`/`draft`/range state.)

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS (all AnnotationView tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(detail): edit always autofocuses the editor; Mod-Enter saves (TODO #8, #13)"
```

---

### Task 3: `CommentThread` — autofocus, Mod-Enter, author colors (§G, §K, §L)

**Files:**
- Modify: `src/webview/detail/CommentThread.svelte`
- Test: `src/webview/detail/CommentThread.svelte.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the `describe('CommentThread', ...)` block of `src/webview/detail/CommentThread.svelte.test.ts`:

```ts
  it('marks other authors\' names with the "other" class; own name unmarked', () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    const rows = screen.getAllByTestId('comment');
    expect(rows[0].querySelector('.cauthor')).toHaveClass('other'); // Ana
    expect(rows[1].querySelector('.cauthor')).not.toHaveClass('other'); // Me
  });

  it('autofocuses the reply composer when opened', async () => {
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200 });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('autofocuses the editor when editing an own comment', async () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('adds a comment via Cmd/Ctrl+Enter', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.type(editor, 'Quick');
    await userEvent.type(editor, '{Meta>}{Enter}{/Meta}');
    expect(onadd).toHaveBeenCalledWith('Quick');
  });

  it('does not add an empty comment via Cmd/Ctrl+Enter', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    await userEvent.type(screen.getByTestId('md-editor'), '{Meta>}{Enter}{/Meta}');
    expect(onadd).not.toHaveBeenCalled();
  });

  it('saves a comment edit via Cmd/Ctrl+Enter', async () => {
    const onedit = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, onedit });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.type(editor, '!');
    await userEvent.type(editor, '{Meta>}{Enter}{/Meta}');
    expect(onedit).toHaveBeenCalledWith('c2', 'my note!');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/CommentThread.svelte.test.ts`
Expected: FAIL — no `other` class, `data-autofocus` is `'false'`, Mod-Enter does nothing.

- [ ] **Step 3: Implement.** In `src/webview/detail/CommentThread.svelte`:

(a) Author name span — replace:

```svelte
        <span class="cauthor">{c.author}</span>
```

with:

```svelte
        <span class="cauthor" class:other={c.author !== currentAuthor}>{c.author}</span>
```

(b) Edit editor — replace:

```svelte
        <MarkdownEditor doc={editDraft} onChange={(v) => (editDraft = v)} />
```

with:

```svelte
        <MarkdownEditor doc={editDraft} autofocus onChange={(v) => (editDraft = v)} onSubmit={() => saveEdit(c.id)} />
```

(c) Reply composer — replace:

```svelte
      <MarkdownEditor doc={replyDraft} onChange={(v) => (replyDraft = v)} />
```

with:

```svelte
      <MarkdownEditor doc={replyDraft} autofocus onChange={(v) => (replyDraft = v)} onSubmit={addReply} />
```

(`addReply` already no-ops on an empty/whitespace draft, which keeps the empty-Mod-Enter case inert.)

(d) CSS — after the `.cauthor` rule, add:

```css
  .cauthor.other { color: var(--vscode-charts-orange, #d18616); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/CommentThread.svelte.test.ts`
Expected: PASS (all CommentThread tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/CommentThread.svelte src/webview/detail/CommentThread.svelte.test.ts
git commit -m "feat(comments): autofocus + Mod-Enter submit + distinct other-author color (TODO #8, #12, #13)"
```

---

### Task 4: `focusAtEnd` action + group-title input (§L)

**Files:**
- Create: `src/webview/shared/focusAtEnd.ts`
- Modify: `src/webview/detail/GroupView.svelte`
- Test: `src/webview/detail/GroupView.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe('GroupView', ...)` block of `src/webview/detail/GroupView.svelte.test.ts`:

```ts
  it('autofocuses the title input with the cursor at the end when editing', async () => {
    render(GroupView, { group: group(), palette });
    await userEvent.click(screen.getByTestId('title-edit-btn'));
    const input = screen.getByTestId('title-input') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe('Login review'.length);
    expect(input.selectionEnd).toBe('Login review'.length);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/GroupView.svelte.test.ts`
Expected: FAIL — the input is not focused.

- [ ] **Step 3: Implement.**

(a) Create `src/webview/shared/focusAtEnd.ts`:

```ts
/**
 * Svelte action: focus an input on mount and place the cursor at the end of its
 * value (round-3 #13 — edit buttons should drop you straight into the field).
 */
export function focusAtEnd(el: HTMLInputElement): void {
  el.focus();
  const end = el.value.length;
  el.setSelectionRange(end, end);
}
```

(b) In `src/webview/detail/GroupView.svelte`, add the import (with the other script imports):

```ts
  import { focusAtEnd } from '../shared/focusAtEnd';
```

and add `use:focusAtEnd` to the title input:

```svelte
      <input
        class="title-input"
        data-testid="title-input"
        bind:value={titleDraft}
        onkeydown={onTitleKey}
        onblur={commitTitle}
        use:focusAtEnd
      />
```

- [ ] **Step 4: Run to verify it passes (and the rename test still passes — clear/type works on a focused input)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/GroupView.svelte.test.ts`
Expected: PASS (all GroupView tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/shared/focusAtEnd.ts src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts
git commit -m "feat(detail): title edit autofocuses with cursor at end (TODO #13)"
```

---

### Task 5: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** §G → Tasks 1–3 (binding + all three hosts: annotation save, composer add, comment-edit save); §K → Task 3a/3d; §L → Task 2 (annotation editor on every edit — reverses the round-1 comment, intentionally), Task 3b/3c (comment editors + composer), Task 4 (title input). MarkdownEditor already places the CodeMirror cursor at the doc end on autofocus. ✓
- **Type consistency:** `onSubmit?: () => void` identical in component and stub; `focusAtEnd(el: HTMLInputElement): void` matches Svelte's action contract (`use:` accepts `(node) => void`). ✓
- **Stub fidelity:** the stub's keydown shim `preventDefault()`s so no stray newline lands in the draft before unmount; real CodeMirror returns `true` from the keybinding for the same effect. ✓
- **Empty-comment guard:** `addReply` trims and no-ops — covered by a dedicated test. ✓
- **First test in Task 2 Step 1 replaced, not appended** — the old `'does not autofocus…'` contract is gone deliberately. ✓
