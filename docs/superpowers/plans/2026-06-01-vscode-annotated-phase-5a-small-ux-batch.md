# Phase 5a — Small UX Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small, independent UX fixes (round-2 TODO §A/§B/§D/§E): color swatches in the tag-selection QuickPicks, "✓ Refreshed" feedback on the sidebar refresh button, group-view rows showing the filename (not the full path), and gutter hovers showing the annotation content snippet (not the file path).

**Architecture:** Two new pure helpers (`fileName`, `hoverItems`) are unit-tested; the Svelte/`vscode` glue around them is component-tested or type-checked. No data-model changes (that's 5b/5c).

**Tech Stack:** TypeScript, Svelte 5, Vitest (unit + jsdom component), VSCode QuickPick API.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
`fileName` and `hoverItems` are unit-tested; `AnnotationRow` and the refresh button are component-tested. The QuickPick swatch icons (§A) are `vscode`-glue — type-check + manual. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Create** `src/shared/path.ts` (+ `.unit.test.ts`) — `fileName(path)`.
- **Modify** `src/webview/detail/AnnotationRow.svelte` (+ `.svelte.test.ts`) — basename + full-path title.
- **Modify** `src/core/gutterIndicators.ts` (+ `.unit.test.ts`) — `hoverItems` helper.
- **Modify** `src/web/gutterDecorations.ts` — use `hoverItems` in `hoverFor`.
- **Modify** `src/webview/sidebar/App.svelte` (+ `.svelte.test.ts`) — refresh "✓ Refreshed".
- **Modify** `src/web/createAnnotationCommand.ts`, `src/web/extension.ts` — swatch `iconPath` in tag QuickPicks.

---

### Task 1: `fileName` helper (§D)

**Files:**
- Create: `src/shared/path.ts`
- Test: `src/shared/path.unit.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/shared/path.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileName } from './path';

describe('fileName', () => {
  it('returns the last segment of a POSIX path', () => {
    expect(fileName('src/auth/login.ts')).toBe('login.ts');
    expect(fileName('src/base/Nonce.sol')).toBe('Nonce.sol');
  });
  it('returns the input unchanged when there is no slash', () => {
    expect(fileName('file.ts')).toBe('file.ts');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/path.unit.test.ts`
Expected: FAIL — cannot resolve `./path`.

- [ ] **Step 3: Implement** — create `src/shared/path.ts`:

```ts
/** The last segment (basename) of a POSIX path; the input itself if it has no slash. */
export function fileName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/path.unit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/path.ts src/shared/path.unit.test.ts
git commit -m "feat(path): fileName basename helper (TODO #4)"
```

---

### Task 2: `AnnotationRow` shows the filename + full path on hover (§D)

**Files:**
- Modify: `src/webview/detail/AnnotationRow.svelte`
- Test: `src/webview/detail/AnnotationRow.svelte.test.ts`

- [ ] **Step 1: Update the test (TDD: change the contract first).** In `src/webview/detail/AnnotationRow.svelte.test.ts`, replace the first test with:

```ts
  it('renders the one-line content and filename:range (full path on hover)', () => {
    render(AnnotationRow, { annotation: annotation('## First line\nsecond') });
    const row = screen.getByTestId('annotation-row');
    expect(row).toHaveTextContent('## First line');
    expect(row).toHaveTextContent('login.ts:42–47');
    expect(row).not.toHaveTextContent('src/auth/login.ts');
    expect(screen.getByTestId('annotation-loc')).toHaveAttribute('title', 'src/auth/login.ts:42–47');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts`
Expected: FAIL — the row still shows the full path and there's no `annotation-loc` testid.

- [ ] **Step 3: Implement.** In `src/webview/detail/AnnotationRow.svelte`:

(a) Add the import after `import { oneLine } from '../../core/detailState';`:

```ts
  import { fileName } from '../../shared/path';
```

(b) Replace the `location` derived line:

```ts
  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);
```

with:

```ts
  const range = $derived(`${annotation.range.startLine}–${annotation.range.endLine}`);
  const shortLoc = $derived(`${fileName(annotation.file)}:${range}`);
  const fullLoc = $derived(`${annotation.file}:${range}`);
```

(c) Replace the loc span:

```svelte
  <span class="loc">{location}</span>
```

with:

```svelte
  <span class="loc" data-testid="annotation-loc" title={fullLoc}>{shortLoc}</span>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts`
Expected: PASS (all AnnotationRow tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/AnnotationRow.svelte src/webview/detail/AnnotationRow.svelte.test.ts
git commit -m "feat(detail): group-view rows show filename + range, full path on hover (TODO #4)"
```

---

### Task 3: Gutter hover shows content snippet, not path (§E)

**Files:**
- Modify: `src/core/gutterIndicators.ts`
- Test: `src/core/gutterIndicators.unit.test.ts`
- Modify: `src/web/gutterDecorations.ts`

- [ ] **Step 1: Write the failing test** — append to `src/core/gutterIndicators.unit.test.ts` (add `hoverItems` to the import from `./gutterIndicators`):

```ts
describe('hoverItems', () => {
  it('labels each item with group title + a one-line content snippet', () => {
    const g = group({ id: 'g1', title: 'Login', annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '# Heading\nmore', contentHash: 'h' },
    ] });
    expect(hoverItems([{ group: g, annotation: g.annotations[0] }])).toEqual([
      { label: 'Login · # Heading', groupId: 'g1', annotationId: 'a1' },
    ]);
  });

  it('uses (empty) for blank content', () => {
    const g = group({ id: 'g1', title: 'T', annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(hoverItems([{ group: g, annotation: g.annotations[0] }])[0].label).toBe('T · (empty)');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: FAIL — `hoverItems` not exported.

- [ ] **Step 3: Implement.** In `src/core/gutterIndicators.ts`:

(a) Add the import near the top (after the existing `import { tagColor } from './sidebarState';`):

```ts
import { oneLine } from './detailState';
```

(b) Append the helper:

```ts
/**
 * Build the hover command-link items for a line's annotations: each label is the group
 * title plus a one-line snippet of the annotation content (or '(empty)').
 */
export function hoverItems(
  matches: { group: AnnotationGroup; annotation: Annotation }[],
): { label: string; groupId: string; annotationId: string }[] {
  return matches.map(({ group, annotation }) => ({
    label: `${group.title} · ${oneLine(annotation.content) || '(empty)'}`,
    groupId: group.id,
    annotationId: annotation.id,
  }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: PASS (all gutterIndicators tests).

- [ ] **Step 5: Use `hoverItems` in the manager.** In `src/web/gutterDecorations.ts`:

(a) Add `hoverItems` to the existing import from `../core/gutterIndicators` (it already imports `annotationsAtLine`, `hoverMarkdown`, etc.).

(b) Replace the body of `hoverFor` so it delegates label construction to the helper:

```ts
  private hoverFor(groups: AnnotationGroup[], file: string, line: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString(hoverMarkdown(hoverItems(annotationsAtLine(groups, file, line))));
    md.isTrusted = true;
    return md;
  }
```

- [ ] **Step 6: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean (no unused imports — the old inline label map is gone).

- [ ] **Step 7: Commit**

```bash
git add src/core/gutterIndicators.ts src/core/gutterIndicators.unit.test.ts src/web/gutterDecorations.ts
git commit -m "feat(gutter): hover shows group + content snippet instead of path (TODO #5)"
```

---

### Task 4: Refresh "✓ Refreshed" feedback (§B)

**Files:**
- Modify: `src/webview/sidebar/App.svelte`
- Test: `src/webview/sidebar/App.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — add inside `describe('App.svelte', ...)` in `src/webview/sidebar/App.svelte.test.ts`:

```ts
  it('shows transient "Refreshed" feedback after clicking refresh', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One')], palette: [] });
    render(App);
    const btn = screen.getByTestId('refresh-btn');
    expect(btn).toHaveTextContent('↻ Refresh');
    await userEvent.click(btn);
    expect(btn).toHaveTextContent('✓ Refreshed');
    expect(postToHost).toHaveBeenCalledWith({ type: 'refresh' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL — the button never shows "✓ Refreshed".

- [ ] **Step 3: Implement.** In `src/webview/sidebar/App.svelte`:

(a) Add the Svelte import at the top of `<script>`:

```ts
  import { onDestroy } from 'svelte';
```

(b) Replace the `refreshFiles` function with the feedback version:

```ts
  let refreshed = $state(false);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  function refreshFiles(): void {
    postToHost({ type: 'refresh' });
    refreshed = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => (refreshed = false), 1500);
  }
  onDestroy(() => clearTimeout(refreshTimer));
```

(c) Change the refresh button label:

```svelte
    <button type="button" class="link" data-testid="refresh-btn" title="Reload annotations from disk" onclick={refreshFiles}>↻ Refresh</button>
```

to:

```svelte
    <button type="button" class="link" data-testid="refresh-btn" title="Reload annotations from disk" onclick={refreshFiles}>{refreshed ? '✓ Refreshed' : '↻ Refresh'}</button>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/App.svelte.test.ts`
Expected: PASS (all App tests, including the existing refresh-posts-message test).

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts
git commit -m "feat(sidebar): inline 'Refreshed' feedback on the refresh button (TODO #2)"
```

---

### Task 5: Tag-color swatches in the selection QuickPicks (§A)

**Files:**
- Modify: `src/web/createAnnotationCommand.ts`
- Modify: `src/web/extension.ts`

> Type-check + manual only (the QuickPick UI isn't unit-testable). Mirrors the swatch icons already used in `promptNewTag`.

- [ ] **Step 1: `createAnnotationCommand.ts` (`pickTags`).** Add the import (with the other `./` imports near the top):

```ts
import { swatchIconSvg } from '../shared/svgIcon';
```

Then change the palette item map in `pickTags`:

```ts
    ...palette.map((t) => ({ label: t.name })),
```

to:

```ts
    ...palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
```

- [ ] **Step 2: `extension.ts` (`onBulkEditTags` + `onEditTags`).** Add the import near the top:

```ts
import { swatchIconSvg } from '../shared/svgIcon';
```

In `onBulkEditTags`, change:

```ts
      ...palette.map((t) => ({ label: t.name })),
```

to:

```ts
      ...palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
```

In `onEditTags`, change:

```ts
      ...palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name) })),
```

to:

```ts
      ...palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name), iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
```

- [ ] **Step 3: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/createAnnotationCommand.ts src/web/extension.ts
git commit -m "feat(tags): show color swatch in tag-selection QuickPicks (TODO #1)"
```

---

### Task 6: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** §A → Task 5 (swatch in 3 QuickPicks); §B → Task 4 (refresh feedback); §D → Tasks 1–2 (`fileName` + AnnotationRow basename/title); §E → Task 3 (`hoverItems` + manager). ✓
- **Type consistency:** `fileName(path): string`; `hoverItems(matches): {label,groupId,annotationId}[]` matches `hoverMarkdown`'s input; `iconPath: vscode.Uri.parse(swatchIconSvg(t.color))` (`t.color` from the `Tag` palette). `onEditTags` keeps `group.tags.includes(t.name)` — correct because `group.tags` is still `string[]` until 5b. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** new imports (`fileName`, `oneLine`, `hoverItems`, `swatchIconSvg`, `onDestroy`) are all value imports. ✓
- **No model change here:** `AnnotationRow`/`hoverItems` use `annotation.content`/`annotation.file` (unchanged); tags stay `string[]` (5b changes them). ✓
