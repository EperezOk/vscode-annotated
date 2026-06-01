# Phase 4b — Markdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the annotation Markdown editor pleasant to use: visible **theme-aware syntax highlighting**, **clicking in the blank area below the text** focuses the editor with the cursor at the end, and an **`autofocus` prop** so a freshly-opened (empty) annotation lands ready to type (TODO #3, and the editor half of #2).

**Architecture:** All three changes live in the CodeMirror editor component (`src/webview/detail/MarkdownEditor.svelte`) and its extensions module (`src/webview/detail/editorExtensions.ts`). `AnnotationView.svelte` passes `autofocus` only when it auto-enters edit mode for empty content. The create→panel wiring that *uses* this (TODO #2 end-to-end) is a separate sub-plan (4c).

**Tech Stack:** Svelte 5, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@codemirror/lang-markdown`, `@lezer/highlight`), Vitest (jsdom component project), Playwright e2e.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality for this sub-plan (read first)

CodeMirror is browser-only; in jsdom it can't lay out or measure, so the real editor is **stubbed** in component tests (`__mocks__/MarkdownEditorStub.svelte`). Therefore:

- **Hard gate (must pass locally):** `npm run check-types` + `npm run test:unit`. The **autofocus wiring** is verified at the component level by extending the stub (Task 2) — reliable, no browser.
- **Highlighting + click-below** are genuine browser behaviors and are covered by **Playwright e2e** specs (Task 1 & 3). e2e downloads/serves a VSCode web build (network). **Run them best-effort**: `npx playwright test e2e/editor.spec.ts`. If the environment cannot download/serve the web build, note that in your report and proceed — the specs are still committed for CI/manual verification. Do **not** let an environment-only e2e failure block the sub-plan; a *test-logic* failure you can reproduce must be fixed.

---

## File Structure

- **Modify** `src/webview/detail/editorExtensions.ts` — add `markdownHighlightStyle` (theme-aware) + `fillHeightTheme` (click-below fix).
- **Modify** `src/webview/detail/MarkdownEditor.svelte` — use the new style + theme; add `autofocus` prop (focus + cursor-to-end on mount).
- **Modify** `src/webview/detail/AnnotationView.svelte` — pass `autofocus` when auto-editing empty content.
- **Modify** `src/webview/detail/__mocks__/MarkdownEditorStub.svelte` — accept `autofocus`, reflect it as `data-autofocus` for assertions.
- **Modify** `src/webview/detail/AnnotationView.svelte.test.ts` — assert autofocus wiring.
- **Modify** `package.json` — declare the (already-installed, transitive) `@lezer/highlight` dependency.
- **Create** `e2e/editor.spec.ts` — highlighting + click-below behavior.

---

### Task 1: Theme-aware Markdown syntax highlighting

**Why:** the editor already calls `syntaxHighlighting(defaultHighlightStyle)`, but `defaultHighlightStyle` ships CodeMirror's light-theme colors that are nearly invisible on the dark VSCode input background — so it *looks* like there's no highlighting. Replace it with a style mapped to VSCode theme variables (with literal fallbacks) and bold/italic weights.

**Files:**
- Modify: `package.json`
- Modify: `src/webview/detail/editorExtensions.ts`
- Modify: `src/webview/detail/MarkdownEditor.svelte`
- Test: `e2e/editor.spec.ts` (created in this task; see Testing reality note)

- [ ] **Step 1: Declare `@lezer/highlight`.** In `package.json`, add this line to `"dependencies"` immediately after the `"@codemirror/view"` entry:

```json
    "@lezer/highlight": "^1.2.3",
```

It is already present in `node_modules` (transitive dep of `@codemirror/language`), so **no `npm install` is required** — `check-types` will resolve it. Confirm with:

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm ls @lezer/highlight`
Expected: shows `@lezer/highlight@1.2.3` resolved (possibly as a deduped/transitive entry). 

- [ ] **Step 2: Add `markdownHighlightStyle` + `fillHeightTheme` to `editorExtensions.ts`.** Add these imports at the top (keep the existing imports):

```ts
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
```

Then append to the file:

```ts
/**
 * Markdown highlight style tuned for the VSCode webview: colors come from VSCode theme
 * CSS variables (with literal fallbacks so it stays visible if a var is undefined), plus
 * bold/italic weights. Replaces CodeMirror's defaultHighlightStyle, whose light-theme
 * colors are nearly invisible on the dark input background.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: 'bold', color: 'var(--vscode-textPreformat-foreground, #4ec9b0)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--vscode-textLink-foreground, #3794ff)' },
  { tag: t.monospace, color: 'var(--vscode-textPreformat-foreground, #ce9178)' },
  { tag: t.quote, fontStyle: 'italic', color: 'var(--vscode-descriptionForeground, #9a9a9a)' },
  { tag: t.list, color: 'var(--vscode-textLink-foreground, #3794ff)' },
  { tag: t.processingInstruction, color: 'var(--vscode-descriptionForeground, #9a9a9a)' },
]);

/**
 * Make the editable content fill the editor's min-height so a click in the blank area
 * below short content lands on `.cm-content` (CodeMirror then places the cursor at the
 * nearest position — the end of the document) instead of doing nothing.
 */
export const fillHeightTheme: Extension = EditorView.theme({
  '.cm-content': { minHeight: '160px' },
  '.cm-scroller': { minHeight: '160px' },
});
```

(`EditorView` and `type Extension` are already imported at the top of this file.)

- [ ] **Step 3: Use the new style + theme in `MarkdownEditor.svelte`.**

(a) Change the language import line from `import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';` to:

```ts
  import { syntaxHighlighting } from '@codemirror/language';
```

(b) Change the extensions import line from `import { markdownKeymap, urlPasteHandler } from './editorExtensions';` to:

```ts
  import { markdownKeymap, urlPasteHandler, markdownHighlightStyle, fillHeightTheme } from './editorExtensions';
```

(c) In the `extensions` array, replace `syntaxHighlighting(defaultHighlightStyle, { fallback: true }),` with the new style and add the fill-height theme right after `markdown()`:

```ts
          history(),
          syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
          markdown(),
          fillHeightTheme,
          urlPasteHandler,
```

- [ ] **Step 4: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean (no unresolved `@lezer/highlight`, no unused `defaultHighlightStyle`).

- [ ] **Step 5: Create the e2e spec `e2e/editor.spec.ts`** (highlighting test now; click-below test is added in Task 3):

```ts
import { test, expect } from '@playwright/test';

/** Open the seed group's first annotation in the detail panel and click Edit. */
async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();
  await detail.getByTestId('annotation-row').click();
  await detail.getByTestId('edit-btn').click();
  await expect(detail.locator('[data-testid="md-editor"] .cm-content')).toBeVisible({ timeout: 30_000 });
  return detail;
}

test('markdown headings render bold (theme-aware highlighting is applied)', async ({ page }) => {
  const detail = await openEditor(page);
  const content = detail.locator('[data-testid="md-editor"] .cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('# Heading');
  // Some token span is rendered bold by markdownHighlightStyle, and it covers the heading text.
  const boldText = await detail.locator('[data-testid="md-editor"] .cm-content span').evaluateAll(
    (els) => els.filter((e) => Number(getComputedStyle(e).fontWeight) >= 700).map((e) => e.textContent ?? '').join(''),
  );
  expect(boldText).toContain('Heading');
});
```

- [ ] **Step 6: Run the e2e spec (best-effort — see Testing reality note)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx playwright test e2e/editor.spec.ts`
Expected: PASS. If it cannot start the web server / download the VSCode web build (no network in this environment), record that in your report and continue — do not block on an environment-only failure.

- [ ] **Step 7: Commit**

```bash
git add package.json src/webview/detail/editorExtensions.ts src/webview/detail/MarkdownEditor.svelte e2e/editor.spec.ts
git commit -m "feat(editor): theme-aware markdown syntax highlighting (TODO #3)"
```

---

### Task 2: `autofocus` prop + AnnotationView wiring (component-tested)

**Files:**
- Modify: `src/webview/detail/MarkdownEditor.svelte`
- Modify: `src/webview/detail/AnnotationView.svelte`
- Modify: `src/webview/detail/__mocks__/MarkdownEditorStub.svelte`
- Test: `src/webview/detail/AnnotationView.svelte.test.ts`

- [ ] **Step 1: Write the failing component test.** First extend the stub so the prop is observable — replace the entire contents of `src/webview/detail/__mocks__/MarkdownEditorStub.svelte` with:

```svelte
<script lang="ts">
  let { doc = '', autofocus = false, onChange }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void } = $props();
</script>

<textarea
  data-testid="md-editor"
  data-autofocus={autofocus}
  value={doc}
  oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
></textarea>
```

Then add these two tests inside the `describe('AnnotationView', ...)` block in `src/webview/detail/AnnotationView.svelte.test.ts`:

```ts
  it('autofocuses the editor when auto-opening an empty (new) annotation', () => {
    render(AnnotationView, { annotation: annotation('') });
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('does not autofocus when manually editing an existing annotation', async () => {
    render(AnnotationView, { annotation: annotation('original') });
    await userEvent.click(screen.getByTestId('edit-btn'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'false');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — `data-autofocus` is absent / not `'true'` (AnnotationView doesn't pass the prop yet).

- [ ] **Step 3: Add the `autofocus` prop to `MarkdownEditor.svelte`.**

(a) Change the `@codemirror/state` import line from `import { EditorState } from '@codemirror/state';` to:

```ts
  import { EditorState, EditorSelection } from '@codemirror/state';
```

(b) Change the `$props()` line to add `autofocus`:

```ts
  let { doc = '', autofocus = false, onChange }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void } = $props();
```

(c) Inside `onMount`, right after the `view = new EditorView({ ... });` assignment and before `return () => view?.destroy();`, add:

```ts
    if (autofocus) {
      view.focus();
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    }
```

- [ ] **Step 4: Pass `autofocus` from `AnnotationView.svelte`.**

(a) After the existing `let draft = $state(untrack(() => annotation.content));` line, add a flag captured at mount (the view is keyed by annotation id in `DetailApp`, so this is per-annotation):

```ts
  // Autofocus the editor only when we auto-open in edit mode because the annotation is
  // empty (the just-created case) — never steal focus on a manual "Edit" of existing content.
  const autofocusEditor = untrack(() => annotation.content.length === 0);
```

(b) Change the editor render line from `<MarkdownEditor doc={draft} onChange={(v) => (draft = v)} />` to:

```svelte
    <MarkdownEditor doc={draft} autofocus={autofocusEditor} onChange={(v) => (draft = v)} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS (all AnnotationView tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/MarkdownEditor.svelte src/webview/detail/AnnotationView.svelte src/webview/detail/__mocks__/MarkdownEditorStub.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(editor): autofocus prop + AnnotationView wiring for new annotations (TODO #2)"
```

---

### Task 3: Click-below-content focuses the end (e2e)

The behavior is implemented by `fillHeightTheme` (added in Task 1). This task adds the e2e that proves it.

**Files:**
- Test: `e2e/editor.spec.ts` (append a test)

- [ ] **Step 1: Append this test to `e2e/editor.spec.ts`** (reuses the `openEditor` helper defined in Task 1):

```ts
test('clicking the blank area below the text focuses the editor with the cursor at the end', async ({ page }) => {
  const detail = await openEditor(page);
  const content = detail.locator('[data-testid="md-editor"] .cm-content');
  // Click low in the editor host — below the (short) seed content, in the filled blank area.
  await detail.locator('[data-testid="md-editor"]').click({ position: { x: 12, y: 150 } });
  await page.keyboard.type('Z_END');
  const after = (await content.textContent()) ?? '';
  expect(after.endsWith('Z_END')).toBe(true); // cursor landed at the end → text appended there
});
```

- [ ] **Step 2: Run the e2e spec (best-effort — see Testing reality note)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx playwright test e2e/editor.spec.ts`
Expected: both tests PASS. If the web build can't be served (no network), record it and proceed.

- [ ] **Step 3: Commit**

```bash
git add e2e/editor.spec.ts
git commit -m "test(editor): e2e for click-below-to-end behavior (TODO #3)"
```

---

### Task 4: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest unit + component tests PASS (including the two new AnnotationView autofocus tests).

- [ ] **Step 2: Confirm `defaultHighlightStyle` is fully gone**

Run: `grep -rn "defaultHighlightStyle" src/`
Expected: **no matches** (it was the invisible style we replaced).

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** TODO #3 highlighting → Task 1 (markdownHighlightStyle). TODO #3 click-below → `fillHeightTheme` (Task 1) + e2e (Task 3). TODO #2 editor half (autofocus prop + wiring) → Task 2; the end-to-end create→open flow that *triggers* it is sub-plan 4c. ✓
- **Type consistency:** `autofocus?: boolean` on both `MarkdownEditor` and the stub; `AnnotationView` passes `autofocusEditor: boolean`. `markdownHighlightStyle: HighlightStyle` consumed by `syntaxHighlighting(...)`; `fillHeightTheme: Extension` added to the extensions array. `EditorSelection.cursor(number)` — valid `@codemirror/state` API. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** `tags`/`HighlightStyle`/`EditorSelection` are values (regular import); `type Extension` already type-imported in `editorExtensions.ts`. ✓
- **Testing honesty:** browser-only behaviors are e2e (best-effort in this env); the reliable autofocus contract is component-tested via the stub; the hard gate is check-types + test:unit. ✓
