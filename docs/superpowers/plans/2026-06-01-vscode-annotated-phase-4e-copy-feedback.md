# Phase 4e — Copy Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give visible confirmation when copying. The two copy buttons in the annotation view (`⧉ path`, `⧉ Copy markdown`) briefly show **"✓ Copied"** for ~1.5s after a click, then revert (TODO #5).

**Architecture:** Pure webview change in `AnnotationView.svelte` — local Svelte 5 state per button + a timeout. The actual clipboard write already happens reliably in the host (`copyText` handler), so no host/protocol change is needed; this is optimistic inline feedback co-located with the action.

**Tech Stack:** Svelte 5 (runes), Vitest jsdom component tests.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality

Component-tested in jsdom: clicking each copy button flips its label to "Copied" (and still invokes the existing callback). The ~1.5s auto-revert relies on a real timer and is not asserted (low value, timer-flush fragility); the flip + callback are the meaningful contract. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/webview/detail/AnnotationView.svelte` — transient copied-state per button + cleanup.
- **Modify** `src/webview/detail/AnnotationView.svelte.test.ts` — assert the feedback flips.

---

### Task 1: Inline "Copied" feedback on the two copy buttons

**Files:**
- Modify: `src/webview/detail/AnnotationView.svelte`
- Test: `src/webview/detail/AnnotationView.svelte.test.ts`

- [ ] **Step 1: Write the failing tests** — add inside the `describe('AnnotationView', ...)` block in `src/webview/detail/AnnotationView.svelte.test.ts`:

```ts
  it('shows transient "Copied" feedback after Copy markdown (and still calls oncopy)', async () => {
    const oncopy = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), oncopy });
    const btn = screen.getByTestId('copy-md-btn');
    expect(btn).toHaveTextContent('Copy markdown');
    await userEvent.click(btn);
    expect(oncopy).toHaveBeenCalledWith('# Note');
    expect(btn).toHaveTextContent('Copied');
  });

  it('shows transient "Copied" feedback after copying the path (and still calls oncopyloc)', async () => {
    const oncopyloc = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), oncopyloc });
    const btn = screen.getByTestId('copy-loc-btn');
    await userEvent.click(btn);
    expect(oncopyloc).toHaveBeenCalledWith('src/x.ts:2–4');
    expect(btn).toHaveTextContent('Copied');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — buttons never show "Copied" (they still show the static labels).

- [ ] **Step 3: Implement.** In `src/webview/detail/AnnotationView.svelte`:

(a) Change the top-of-script import from `import { untrack } from 'svelte';` to:

```ts
  import { untrack, onDestroy } from 'svelte';
```

(b) Add the copied-state + handlers near the other `function` declarations in the `<script>` (e.g. after the `save()` function):

```ts
  let copiedPath = $state(false);
  let copiedMd = $state(false);
  let pathTimer: ReturnType<typeof setTimeout> | undefined;
  let mdTimer: ReturnType<typeof setTimeout> | undefined;

  function copyPath(): void {
    oncopyloc?.(location);
    copiedPath = true;
    clearTimeout(pathTimer);
    pathTimer = setTimeout(() => (copiedPath = false), 1500);
  }
  function copyMd(): void {
    oncopy?.(annotation.content);
    copiedMd = true;
    clearTimeout(mdTimer);
    mdTimer = setTimeout(() => (copiedMd = false), 1500);
  }

  onDestroy(() => {
    clearTimeout(pathTimer);
    clearTimeout(mdTimer);
  });
```

(c) Change the **copy path** button (in the `.bar` div) from:

```svelte
    <button type="button" class="link" data-testid="copy-loc-btn" onclick={() => oncopyloc?.(location)}>⧉ path</button>
```

to:

```svelte
    <button type="button" class="link" data-testid="copy-loc-btn" onclick={copyPath}>{copiedPath ? '✓ Copied' : '⧉ path'}</button>
```

(d) Change the **copy markdown** button (in the `.toolbar` div) from:

```svelte
    <button type="button" class="btn ghost" data-testid="copy-md-btn" onclick={() => oncopy?.(annotation.content)}>⧉ Copy markdown</button>
```

to:

```svelte
    <button type="button" class="btn ghost" data-testid="copy-md-btn" onclick={copyMd}>{copiedMd ? '✓ Copied' : '⧉ Copy markdown'}</button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS (all AnnotationView tests, including the two new ones and the pre-existing "Copy markdown calls oncopy" test).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(detail): inline 'Copied' feedback on copy buttons (TODO #5)"
```

---

### Task 2: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** TODO #5 (copy gives feedback) → Task 1, both buttons. No host change needed (clipboard write already happens host-side via the existing `copyText` handler). ✓
- **Type consistency:** `copiedPath`/`copiedMd: boolean` ($state); `pathTimer`/`mdTimer: ReturnType<typeof setTimeout>`; `location` is the existing `$derived` string; handlers reuse the existing `oncopy`/`oncopyloc` props. ✓
- **Lifecycle:** timers cleared on `onDestroy` so a revert can't fire on an unmounted (annotation-switched) component; the component is keyed by annotation id, so copied-state resets naturally on switch. ✓
- **No placeholders / behavior preserved:** the pre-existing "Copy markdown calls oncopy with the content" test still passes (the handler still calls `oncopy(annotation.content)`). ✓
