# Phase 6 — Deferrals Cleanup + Skill Tag-Shape Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the recorded review deferrals — one shared `DEFAULT_TAG_COLOR`, a proper ARIA combobox for `FilterPicker`, a debounced file-watcher, an honest CSP comment — and update the annotated-agent skill docs for the new `tags: {name,color}[]` shape.

**Architecture:** Small, independent changes. Two get unit/component tests (`debounce`, `FilterPicker` ARIA); the constant consolidation is value-preserving (verified by the existing suite); CSP + skill are doc-only.

**Tech Stack:** TypeScript, Svelte 5, Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
`debounce` is unit-tested (fake timers); `FilterPicker` ARIA is component-tested. The `DEFAULT_TAG_COLOR` consolidation changes no value, so it's verified by the unchanged suite + type-check. CSP comment + skill docs are doc-only. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure
- **Modify** `src/shared/model.ts` — export `DEFAULT_TAG_COLOR`; use it in `parseTag`.
- **Modify** `src/core/tagResolve.ts`, `src/core/sidebarState.ts`, `src/core/tags.ts`, `src/web/tagPalette.ts`, `src/core/gutterIndicators.ts` — import the shared constant, drop local copies.
- **Modify** `src/webview/sidebar/FilterPicker.svelte` (+ `.svelte.test.ts`, `FilterBar.svelte.test.ts`, `App.svelte.test.ts`) — ARIA combobox roles + option-role test queries.
- **Create** `src/shared/debounce.ts` (+ `.unit.test.ts`); **modify** `src/web/extension.ts` — debounce the watcher.
- **Modify** `src/web/detailPanelProvider.ts` — CSP comment.
- **Modify** `skills/annotated-agent/references/data-contract.md`, `skills/annotated-agent/references/operations.md` — tag shape + optional config writes.

---

### Task 6.1: One `DEFAULT_TAG_COLOR` constant

**Files:** `src/shared/model.ts`, `src/core/tagResolve.ts`, `src/core/sidebarState.ts`, `src/core/tags.ts`, `src/web/tagPalette.ts`, `src/core/gutterIndicators.ts`

- [ ] **Step 1: Add the constant** in `src/shared/model.ts` (right after the `Tag` interface):

```ts
/** Neutral fallback color for a tag with no configured/known color. */
export const DEFAULT_TAG_COLOR = '#888888';
```

- [ ] **Step 2: Use it in `parseTag`** (`src/shared/model.ts`) — replace the two `color: '#888888'` literals with `color: DEFAULT_TAG_COLOR` (the legacy-string branch and the missing-color branch).

- [ ] **Step 3: Replace the local copies** in each file: delete the local `const DEFAULT_COLOR = '#888888';` / `const DEFAULT_BAR_COLOR = '#888888';`, import `DEFAULT_TAG_COLOR` from model, and update its references:
  - `src/core/tagResolve.ts`: add `import { type AnnotationGroup, DEFAULT_TAG_COLOR } from '../shared/model';` (merge with the existing model import), delete the local const, change both `?? DEFAULT_COLOR` → `?? DEFAULT_TAG_COLOR`.
  - `src/core/sidebarState.ts`: import `DEFAULT_TAG_COLOR` from `'../shared/model'`, delete the local const, change the one `?? DEFAULT_COLOR` (in `tagColor`) → `?? DEFAULT_TAG_COLOR`.
  - `src/core/tags.ts`: change `import { type Tag } from '../shared/model';` → `import { type Tag, DEFAULT_TAG_COLOR } from '../shared/model';`, delete the local const, change the one `: DEFAULT_COLOR` (in `parseTagPalette`) → `: DEFAULT_TAG_COLOR`.
  - `src/web/tagPalette.ts`: import `DEFAULT_TAG_COLOR` from `'../shared/model'`, delete the local const, change all three `DEFAULT_COLOR` uses (the `addTagToPalette` default param `color = DEFAULT_TAG_COLOR`, the `showInputBox` `value: DEFAULT_TAG_COLOR`, and the `|| DEFAULT_TAG_COLOR` fallback) → `DEFAULT_TAG_COLOR`.
  - `src/core/gutterIndicators.ts`: merge `DEFAULT_TAG_COLOR` into the existing `'../shared/model'` import, delete the `DEFAULT_BAR_COLOR` const, change `: DEFAULT_BAR_COLOR` (in `groupBarColor`) → `: DEFAULT_TAG_COLOR`.

- [ ] **Step 4: Verify** (value unchanged → suite stays green)

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean; all tests PASS.

- [ ] **Step 5: Confirm no stragglers**

Run: `grep -rn "DEFAULT_COLOR\|DEFAULT_BAR_COLOR\|'#888888'" src --include='*.ts' | grep -v test`
Expected: matches ONLY `DEFAULT_TAG_COLOR` (definition in `model.ts` + imports/uses). No `'#888888'` literal outside the `model.ts` definition; no `DEFAULT_COLOR`/`DEFAULT_BAR_COLOR`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(tags): single DEFAULT_TAG_COLOR constant (deferral)"
```

---

### Task 6.2: `FilterPicker` ARIA combobox

**Files:** `src/webview/sidebar/FilterPicker.svelte`, `src/webview/sidebar/FilterPicker.svelte.test.ts`, `src/webview/sidebar/FilterBar.svelte.test.ts`, `src/webview/sidebar/App.svelte.test.ts`

- [ ] **Step 1: Update the failing tests first.** The dropdown options become `role="option"` (was an implicit `button`), so option queries must change, and we assert the new roles.

(a) In **`FilterPicker.svelte.test.ts`**, change the five option queries from `'button'` to `'option'` (lines that target option names `security`/`todo`/`perf` — both `getByRole` and the `queryByRole('button', { name: 'todo' })` negative in the "filters the list" test). Then add an ARIA test inside the `describe`:

```ts
  it('exposes combobox/listbox/option ARIA roles', async () => {
    render(FilterPicker, { ...base });
    const input = screen.getByTestId('picker-input-Tags');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('picker-menu-Tags')).toHaveAttribute('role', 'listbox');
    const first = screen.getByRole('option', { name: 'security' });
    expect(first).toHaveAttribute('aria-selected', 'true'); // highlighted index 0
  });
```

(b) In **`FilterBar.svelte.test.ts`**, change the two option clicks `getByRole('button', { name: 'security' })` and `getByRole('button', { name: 'Ana' })` → `getByRole('option', ...)`.

(c) In **`App.svelte.test.ts`**, change the dropdown test's `getByRole('button', { name: 'security' })` → `getByRole('option', { name: 'security' })`.

- [ ] **Step 2: Run them to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/FilterPicker.svelte.test.ts`
Expected: FAIL — no `role="option"` / `role="combobox"` yet.

- [ ] **Step 3: Implement the ARIA roles in `FilterPicker.svelte`.**

(a) The input — add the combobox attributes (keep existing attrs):

```svelte
    <input
      type="text"
      class="picker-input"
      data-testid="picker-input-{label}"
      role="combobox"
      aria-expanded={open}
      aria-controls="picker-listbox-{label}"
      aria-autocomplete="list"
      aria-activedescendant={open && result.visible.length > 0 ? `picker-opt-${label}-${highlighted}` : undefined}
      placeholder={placeholder}
      bind:value={query}
      onfocus={() => (open = true)}
      onblur={() => (open = false)}
      onkeydown={onkeydown}
    />
```

(b) The menu — add `id` + `role="listbox"`:

```svelte
    <ul class="menu" id="picker-listbox-{label}" role="listbox" data-testid="picker-menu-{label}">
```

(c) The option — convert the inner `<button>` to the `<li>` itself carrying `role="option"` (the ARIA combobox pattern keeps focus on the input; options are non-interactive option elements activated via click / the input's keyboard). Replace the whole `{#each result.visible ...}` option block:

```svelte
      {#each result.visible as option, i (option)}
        {@const obg = colorFor ? colorFor(option) : undefined}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <li
          class="option"
          class:highlighted={i === highlighted}
          id="picker-opt-{label}-{i}"
          role="option"
          aria-selected={i === highlighted}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => choose(option)}
        >
          {#if obg}<span class="swatch" style="background:{obg}"></span>{/if}
          {option}
        </li>
      {/each}
```

(Keyboard activation stays on the combobox input — `onkeydown` already handles ↑/↓/Enter/Esc via `highlighted` + `choose` — so the ignore comment is justified. The `.menu .option` CSS rule still applies to `li.option`; leave the styles as they are.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/FilterPicker.svelte.test.ts src/webview/sidebar/FilterBar.svelte.test.ts src/webview/sidebar/App.svelte.test.ts`
Expected: PASS (all three files).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sidebar): FilterPicker ARIA combobox/listbox roles (deferral)"
```

---

### Task 6.3: Debounce the file-watcher

**Files:** Create `src/shared/debounce.ts` (+ `.unit.test.ts`); modify `src/web/extension.ts`.

- [ ] **Step 1: Write the failing test** — create `src/shared/debounce.unit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invokes once after the quiet window despite rapid calls', () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('invokes again for a call after the window', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    vi.advanceTimersByTime(100);
    d();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes the most recent arguments', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('a');
    d('b');
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith('b');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/debounce.unit.test.ts`
Expected: FAIL — cannot resolve `./debounce`.

- [ ] **Step 3: Implement** — create `src/shared/debounce.ts`:

```ts
/** Trailing-edge debounce: invoke `fn` once, `ms` after the last call, with the latest args. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/debounce.unit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into `extension.ts`.** Add the import near the top:

```ts
import { debounce } from '../shared/debounce';
```

Wrap the existing `onAnnotationsChanged` handler in `debounce(..., 200)` (the `watcher.onDidCreate/Change/Delete(onAnnotationsChanged)` registrations are unchanged):

```ts
  const onAnnotationsChanged = debounce((): void => {
    void reconcile();
    void provider.refresh();
    void refreshDecorations();
  }, 200);
```

(Leave the activation-time `void reconcile();` + `void refreshDecorations();` and the manual `provider.onRefreshRequested` immediate — only the watcher is debounced.)

- [ ] **Step 6: Type-check + tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "perf(watcher): debounce .annotations file-watcher refresh/reconcile (deferral)"
```

---

### Task 6.4: CSP comment + skill docs (doc-only)

**Files:** `src/web/detailPanelProvider.ts`, `skills/annotated-agent/references/data-contract.md`, `skills/annotated-agent/references/operations.md`

- [ ] **Step 1: Rewrite the CSP comment** in `src/web/detailPanelProvider.ts` — replace the 3-line `// CodeMirror injects … EditorView.cspNonce …` comment (just above the `const csp =`) with:

```ts
    // 'unsafe-inline' on style-src is required for BOTH CodeMirror's runtime-injected <style>
    // elements AND the webview's inline style="" attributes (tag chips/pills/swatches). A CSP
    // nonce covers <style> elements but NOT style attributes, so dropping 'unsafe-inline' would
    // mean eliminating all inline styles — not worth it given the threat model (extension-owned
    // DOM, DOMPurify-sanitized markdown, script-src is nonce-locked).
```

(Leave the `style-src ${webview.cspSource} 'unsafe-inline';` line itself unchanged.)

- [ ] **Step 2: Update `data-contract.md`.**

(a) Change the group `tags` example line (~line 22) from:

```jsonc
  "tags": ["security"],                            // tag names (colors live in config)
```

to:

```jsonc
  "tags": [{ "name": "security", "color": "#E5484D" }], // tags carry their color (self-contained)
```

(b) Immediately after the group JSON code block, add a short note:

```markdown
> **Tags** are objects `{ name, color }` — colors travel with the group so it's self-contained.
> The displayed color resolves **local config > global config > this JSON**. Legacy `"tags":
> ["security"]` string arrays still load (auto-migrated), but write the object form.
```

(c) In the `## Config — VSCode settings` section, soften the `annotated.tags` bullet: the extension
**reconciles** group tags missing from settings into the **workspace** config automatically on
load, so writing colors into the group JSON is sufficient and updating `annotated.tags` is
**optional** (use it only to set/override a tag's color centrally). Keep the read-merge-write
mechanics for the optional case; you may drop the "ask the user which target" requirement from the
required path. **Do not touch the `## Node-free recipes` section** (the `contentHash`/IDs/slug
recipes are asserted verbatim by a contract test).

- [ ] **Step 3: Update `operations.md`.**

(a) In the create-group write template (~line 44), change the tags line from
`"tags": [<tag names — must exist in the palette, or add them first (op 5)>],` to:

```jsonc
     "tags": [{ "name": "...", "color": "#rrggbb" }, …],  // include each tag's color; no need to pre-register in config
```

(b) In **op 5 (Update config)**, reframe the "Add a tag to `annotated.tags`" step as **optional**:
note that group tags written into the JSON are auto-reconciled into the workspace config by the
extension on load, so this step is only needed to set/override a tag's color centrally. Keep the
read-merge-write-dedup mechanics.

- [ ] **Step 4: Confirm the skill contract test still passes** (the hash RECIPE + the `{name,color}` round-trip are untouched)

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/skillContract.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: honest CSP comment + skill tag shape ({name,color}) and optional config (deferral, skill)"
```

---

### Task 6.5: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** §B → 6.1; §C → 6.2; §D → 6.3; §E → 6.4 Step 1; §A → 6.4 Steps 2–3; §F (heading/multi-root) → no-op, no task. ✓
- **Type consistency:** `DEFAULT_TAG_COLOR: string` (value import everywhere); `debounce<A>(fn, ms)` returns the same signature; FilterPicker ids `picker-listbox-{label}` / `picker-opt-{label}-{i}` referenced consistently by `aria-controls`/`aria-activedescendant`. ✓
- **Test churn called out:** option-role queries change `'button'`→`'option'` in exactly three test files (enumerated); pill-remove (`aria-label "Remove …"`) and the input stay non-option. ✓
- **No placeholders:** exact code/edits for every code step; doc steps give the exact replacement text. ✓
- **Skill-test safety:** the `Node-free recipes` block (hash recipe) is explicitly left untouched; `skillContract.unit.test` verified in 6.4 Step 4. ✓
- **`verbatimModuleSyntax`:** `DEFAULT_TAG_COLOR`/`debounce` are value imports; types stay `import { type … }`. ✓
