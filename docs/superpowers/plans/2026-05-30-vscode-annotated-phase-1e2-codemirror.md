# vscode-annotated — Phase 1e-2: CodeMirror Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the annotation editor's plain `<textarea>` internals with **CodeMirror 6** — Markdown syntax highlighting plus two niceties: select text + paste a URL → `[text](url)`, and bold/italic shortcuts (`cmd/ctrl+b` / `+i`). The `MarkdownEditor` component keeps its exact `doc`/`onChange` interface, so `AnnotationView` and the save flow are unchanged. Plus two small cleanups carried over from the 1e-1 review.

**Architecture:** The selection-transform logic stays **pure** (`src/core/markdownTransforms.ts`: `isUrl`, `linkSelection`) and is unit-tested without CodeMirror. A small `editorExtensions.ts` wires those (plus a bold/italic keymap) into CodeMirror via a paste handler + keymap. `MarkdownEditor.svelte` mounts an `EditorView` — it **cannot be jsdom-tested** (CM needs layout APIs), so it becomes glue: covered by a Playwright e2e, and **mocked** in `AnnotationView`'s component test.

**Tech Stack:** TypeScript + Svelte 5. New runtime deps: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-markdown` (modular packages, not the meta-package). Builds on Phase 1e-1.

> **Conventions:** branch `phase-1e2` (already checked out); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + `timeout: 600000` (`pkill -f vscode-test-web` first). After this phase the MVP is complete → merge `phase-1e2` → `main`.

---

## Context (Phase 1e-1)

- `src/webview/detail/MarkdownEditor.svelte` — textarea-backed, props `{ doc?: string; onChange?: (value:string)=>void }`. `MarkdownEditor.svelte.test.ts` tests the textarea (will be removed — CM isn't jsdom-testable).
- `src/webview/detail/AnnotationView.svelte` — renders `<MarkdownEditor doc={draft} onChange={(v)=>draft=v} />` in edit mode. `AnnotationView.svelte.test.ts` has 5 tests; 2 of them (empty→edit, Edit→Save) mount `MarkdownEditor` → will crash once it's CM-backed unless mocked.
- `src/webview/detail/state.ts` — exports `detail`, `handleHostMessage`, `setSelectedAnnotation` (DEAD — unused), `openAnnotationView`, `showGroupView`, `saveAnnotationContent`, `copyToClipboard`.
- `src/webview/detail/DetailApp.svelte` — renders `<AnnotationView annotation={current} … />` in annotation mode (no `{#key}`).
- `esbuild.mjs` webview config bundles `sidebar/main` + `detail/main` (`platform: 'browser'`, esbuild-svelte).
- `vitest-setup.ts` — currently just `import '@testing-library/jest-dom/vitest';`.
- The seed annotation (`test-workspace/.annotations/groups/seed-group.json`) has content `"Seed annotation"`.

---

## File Structure (1e-2)

```
package.json                                  (modify) # + 5 @codemirror/* deps
src/core/markdownTransforms.ts                (new)    # pure: isUrl, linkSelection
src/core/markdownTransforms.unit.test.ts      (new)
src/webview/detail/editorExtensions.ts        (new)    # CM glue: urlPasteHandler + bold/italic keymap (uses transforms)
src/webview/detail/MarkdownEditor.svelte      (modify) # textarea → CodeMirror 6 (same doc/onChange interface)
src/webview/detail/MarkdownEditor.svelte.test.ts (delete) # CM not jsdom-testable
src/webview/detail/__mocks__/MarkdownEditorStub.svelte (new) # textarea stub for AnnotationView tests
src/webview/detail/AnnotationView.svelte.test.ts (modify) # vi.mock MarkdownEditor → stub
src/webview/detail/state.ts                   (modify) # remove dead setSelectedAnnotation
src/webview/detail/DetailApp.svelte           (modify) # {#key selectedAnnotationId} around AnnotationView
e2e/annotation-edit.spec.ts                   (new)    # Edit → CodeMirror editor visible
```

---

## Task 1: Add CodeMirror 6 packages

**Files:** Modify `package.json`

- [ ] **Step 1:** Add to the `"dependencies"` block in `package.json` (alongside `markdown-it`/`dompurify`):

```json
    "@codemirror/commands": "^6.10.3",
    "@codemirror/lang-markdown": "^6.5.0",
    "@codemirror/language": "^6.11.0",
    "@codemirror/state": "^6.6.0",
    "@codemirror/view": "^6.43.0",
```

(Keep `dompurify`/`markdown-it`. Final `dependencies` has 7 entries, comma-separated, valid JSON.)

- [ ] **Step 2: Install**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm install`
Expected: completes; the 5 `@codemirror/*` packages added. (Network — retry with `dangerouslyDisableSandbox: true` if needed.)

- [ ] **Step 3: Verify nothing broke** (deps not imported yet)

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green. Confirm valid JSON: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('OK')"`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add CodeMirror 6 packages for the Markdown editor"
```

---

## Task 2: Pure markdown transforms

**Files:** Create `src/core/markdownTransforms.ts`, `src/core/markdownTransforms.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/markdownTransforms.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { isUrl, linkSelection } from './markdownTransforms';

describe('isUrl', () => {
  it('accepts http/https URLs', () => {
    expect(isUrl('https://example.com')).toBe(true);
    expect(isUrl('http://x.co/a?b=1')).toBe(true);
  });
  it('rejects non-URLs', () => {
    expect(isUrl('hello world')).toBe(false);
    expect(isUrl('example.com')).toBe(false);
    expect(isUrl('ftp://x')).toBe(false);
    expect(isUrl('')).toBe(false);
  });
});

describe('linkSelection', () => {
  it('wraps the selected text as a Markdown link', () => {
    const r = linkSelection('click here now', 6, 10, 'https://x.com');
    expect(r.doc).toBe('click [here](https://x.com) now');
    expect(r.doc.slice(r.selectionFrom, r.selectionTo)).toBe('[here](https://x.com)');
  });
  it('handles a selection at the start', () => {
    const r = linkSelection('here', 0, 4, 'http://a.b');
    expect(r.doc).toBe('[here](http://a.b)');
    expect(r.selectionFrom).toBe(0);
    expect(r.selectionTo).toBe('[here](http://a.b)'.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/markdownTransforms.unit.test.ts`
Expected: FAIL — cannot resolve `./markdownTransforms`.

- [ ] **Step 3: Implement `src/core/markdownTransforms.ts`**

```ts
/** True for an http(s) URL. */
export function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Replace `doc[from..to]` with `[selected](url)`; returns the new doc + the link's range. */
export function linkSelection(
  doc: string,
  from: number,
  to: number,
  url: string,
): { doc: string; selectionFrom: number; selectionTo: number } {
  const selected = doc.slice(from, to);
  const replacement = `[${selected}](${url})`;
  return {
    doc: doc.slice(0, from) + replacement + doc.slice(to),
    selectionFrom: from,
    selectionTo: from + replacement.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/markdownTransforms.unit.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/markdownTransforms.ts src/core/markdownTransforms.unit.test.ts
git commit -m "feat: pure markdown selection transforms (isUrl, linkSelection)"
```

---

## Task 3: CodeMirror editor (swap MarkdownEditor internals)

**Files:** Create `src/webview/detail/editorExtensions.ts`, `src/webview/detail/__mocks__/MarkdownEditorStub.svelte`; Modify `src/webview/detail/MarkdownEditor.svelte`, `src/webview/detail/AnnotationView.svelte.test.ts`; Delete `src/webview/detail/MarkdownEditor.svelte.test.ts`

- [ ] **Step 1: Create the CM glue `src/webview/detail/editorExtensions.ts`**

```ts
import { EditorView, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import { isUrl, linkSelection } from '../../core/markdownTransforms';

/** Select text + paste an http(s) URL → wrap the selection as a Markdown link. */
export const urlPasteHandler: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (!text || !isUrl(text)) {
      return false; // let CodeMirror paste normally
    }
    const { main } = view.state.selection;
    if (main.empty) {
      return false;
    }
    event.preventDefault();
    const result = linkSelection(view.state.doc.toString(), main.from, main.to, text);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.doc },
      selection: EditorSelection.range(result.selectionFrom, result.selectionTo),
    });
    return true;
  },
});

/** A command that wraps each selection range with `before`/`after`. */
function wrapCommand(before: string, after: string) {
  return (view: EditorView): boolean => {
    const tr = view.state.changeByRange((range) => ({
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    }));
    view.dispatch(view.state.update(tr, { scrollIntoView: true }));
    return true;
  };
}

/** Bold (Mod-b) and italic (Mod-i) shortcuts. */
export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: wrapCommand('**', '**') },
  { key: 'Mod-i', run: wrapCommand('*', '*') },
];
```

- [ ] **Step 2: Replace `src/webview/detail/MarkdownEditor.svelte`** (CodeMirror, same `doc`/`onChange` interface)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
  import { markdown } from '@codemirror/lang-markdown';
  import { markdownKeymap, urlPasteHandler } from './editorExtensions';

  let { doc = '', onChange }: { doc?: string; onChange?: (value: string) => void } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown(),
          urlPasteHandler,
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    return () => view?.destroy();
  });
</script>

<div class="md-editor" data-testid="md-editor" bind:this={host}></div>

<style>
  .md-editor {
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    background: var(--vscode-input-background, #2a2a2a);
    min-height: 160px;
    font-size: 12.5px;
  }
  .md-editor :global(.cm-editor) { min-height: 160px; }
  .md-editor :global(.cm-editor.cm-focused) { outline: none; }
  .md-editor :global(.cm-content) {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-input-foreground, #ddd);
    caret-color: var(--vscode-editorCursor-foreground, #ddd);
  }
  .md-editor :global(.cm-scroller) { overflow: auto; }
</style>
```

- [ ] **Step 3: Delete the old textarea test**

```bash
git rm src/webview/detail/MarkdownEditor.svelte.test.ts
```

- [ ] **Step 4: Create the test stub `src/webview/detail/__mocks__/MarkdownEditorStub.svelte`** (textarea so `AnnotationView` tests don't mount CodeMirror in jsdom)

```svelte
<script lang="ts">
  let { doc = '', onChange }: { doc?: string; onChange?: (value: string) => void } = $props();
</script>

<textarea
  data-testid="md-editor"
  value={doc}
  oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
></textarea>
```

- [ ] **Step 5: Mock `MarkdownEditor` in `src/webview/detail/AnnotationView.svelte.test.ts`** — add this `vi.mock` at the top of the file, right after the imports (before the `describe`):

```ts
vi.mock('./MarkdownEditor.svelte', async () => ({
  default: (await import('./__mocks__/MarkdownEditorStub.svelte')).default,
}));
```

(The existing tests are unchanged otherwise — they already use `data-testid="md-editor"`, which the stub provides. `vi` is already imported from `vitest` in that file.)

- [ ] **Step 6: Run the AnnotationView tests (with the mocked editor)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS — 5 tests pass (editor is the textarea stub; no CodeMirror in jsdom).

- [ ] **Step 7: Build + type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit && test -f dist/webview/detail/main.js && echo OK`
Expected: exit 0; the detail bundle builds with CodeMirror; all unit/component tests pass; `OK`. (The `state_referenced_locally` warning for `MarkdownEditor.svelte` is gone now that CM owns its state; `AnnotationView.svelte`'s two warnings remain until Task 4.)

- [ ] **Step 8: Commit**

```bash
git add src/webview/detail/editorExtensions.ts src/webview/detail/MarkdownEditor.svelte src/webview/detail/__mocks__/MarkdownEditorStub.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat: CodeMirror 6 Markdown editor (highlighting + paste-link + bold/italic)"
```

---

## Task 4: Cleanups (dead export + key the annotation view)

**Files:** Modify `src/webview/detail/state.ts`, `src/webview/detail/DetailApp.svelte`

- [ ] **Step 1: Remove the dead `setSelectedAnnotation` export** from `src/webview/detail/state.ts`. Delete this function (it's unused — superseded by `openAnnotationView`):

```ts
/** Record the locally-selected annotation. */
export function setSelectedAnnotation(id: string): void {
  detail.update((state) => ({ ...state, selectedAnnotationId: id }));
}
```

(Confirm nothing imports it first: `grep -rn "setSelectedAnnotation" src/` should show only the definition. If anything imports it, do NOT delete — report instead.)

- [ ] **Step 2: Key the AnnotationView in `src/webview/detail/DetailApp.svelte`** so switching annotations remounts it (resets the editor's `editing`/`draft` seed-once state). Wrap the `<AnnotationView …/>` in the annotation-mode branch with `{#key $detail.selectedAnnotationId}`:

```svelte
  {:else if $detail.mode === 'annotation' && current}
    {#key $detail.selectedAnnotationId}
      <AnnotationView
        annotation={current}
        onback={showGroupView}
        onsave={(id, content) => saveAnnotationContent(id, content)}
        oncopy={(content) => copyToClipboard(content)}
        oncopyloc={(loc) => copyToClipboard(loc)}
      />
    {/key}
  {:else}
```

(Only that branch changes; the rest of `DetailApp.svelte` is unchanged.)

- [ ] **Step 3: Verify type-check + full unit suite + build**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit && npm run compile`
Expected: exit 0; all green. (`AnnotationView.svelte`'s `state_referenced_locally` warnings may persist — they're now harmless because the `{#key}` forces a remount on annotation switch, which re-seeds `editing`/`draft`. The build has 0 errors.)

- [ ] **Step 4: Commit**

```bash
git add src/webview/detail/state.ts src/webview/detail/DetailApp.svelte
git commit -m "refactor: drop dead setSelectedAnnotation; key AnnotationView by annotation id"
```

---

## Task 5: E2E (CodeMirror editor) + full suite

**Files:** Create `e2e/annotation-edit.spec.ts`

- [ ] **Step 1: Create `e2e/annotation-edit.spec.ts`** — opens the seeded annotation, clicks Edit, and asserts the CodeMirror editor is shown (proves CM mounts in the real webview):

```ts
import { test, expect } from '@playwright/test';

test('clicking Edit shows the CodeMirror editor', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();
  await detail.getByTestId('annotation-row').click();

  // The seed annotation has content, so it opens in preview; click Edit to reveal the editor.
  await detail.getByTestId('edit-btn').click();

  // CodeMirror renders a .cm-editor element inside our md-editor host.
  await expect(detail.locator('[data-testid="md-editor"] .cm-editor')).toBeVisible({ timeout: 30_000 });
  // The existing content is loaded into the editor.
  await expect(detail.locator('[data-testid="md-editor"] .cm-content')).toContainText('Seed annotation', { timeout: 30_000 });
});
```

- [ ] **Step 2: Run the e2e (verify it passes)**

Run (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:e2e`
Expected: 4 passed — `sidebar.spec`, `detail.spec`, `annotation.spec`, `annotation-edit.spec`.

> If `.cm-editor`/`.cm-content` selectors don't match the rendered CodeMirror DOM, inspect the served webview in headed mode and adjust (CodeMirror's structure is `.cm-editor > .cm-scroller > .cm-content`). Keep the assertion meaningful (the editor is visible + shows the content). Do NOT weaken it.

- [ ] **Step 3: Run the full suite (Definition of Done)**

Run (same settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**6 passing**) → `test:e2e` (**4 passed**) all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/annotation-edit.spec.ts
git commit -m "test: e2e for the CodeMirror annotation editor"
```

---

## Phase 1e-2 Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (markdownTransforms + earlier suites; MarkdownEditor textarea test removed; AnnotationView uses the mocked editor).
- [ ] `npm run test:integration` passes — 6 passing.
- [ ] `npm run test:e2e` passes — 4 passed (incl. the CodeMirror editor).
- [ ] All work committed on the `phase-1e2` branch.
- [ ] Manual sanity (optional): open an annotation → Edit → see Markdown syntax highlighting; select a word + `cmd/ctrl+b` → wrapped in `**`; select text + paste an `https://` URL → becomes `[text](url)`; Save → preview shows it.

**Phase 1 MVP complete.** Merge `phase-1e2` → `main` (the finishing-a-development-branch flow): verify the full suite green, fast-forward `main`, delete `phase-1e2`. The MVP — create / view / navigate / edit annotations with a real Markdown editor — is done. Remaining roadmap (separate phases): **Phase 2** (filters, reorder, Prev/Next, editable title/tags/range, Git ref, drift detection) and **Phase 3** (comment threads, resolve/restore, bulk operations).
```
