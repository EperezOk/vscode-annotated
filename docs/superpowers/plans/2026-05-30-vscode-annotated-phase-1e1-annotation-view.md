# vscode-annotated — Phase 1e-1: Annotation View + Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When you click an annotation row, the detail panel switches to an **annotation view** showing the Markdown content: an empty annotation opens an editor; a non-empty one shows a rendered preview with an **Edit** toggle. You can write content and **Save** it (persisted to the group's JSON), **Copy markdown**, **Copy path+range**, and go **Back** to the group view.

**Architecture:** The detail panel gains a `mode: 'group' | 'annotation'` (webview-local). The annotation view uses a `MarkdownPreview` (markdown-it + DOMPurify) and a `MarkdownEditor` component whose interface is `doc`/`onChange` — **backed by a plain `<textarea>` in 1e-1** (jsdom-testable); 1e-2 swaps the internals to CodeMirror 6 without changing the interface. Saving sends a typed `updateAnnotation` message; the host persists via a new `GroupStore.updateAnnotation` and re-posts the group, so the view reconciles. Clipboard goes through the host (`vscode.env.clipboard`).

**Tech Stack:** TypeScript + Svelte 5 (web extension host). New runtime deps: `markdown-it@14`, `dompurify@3`. Builds on Phase 1a–1d. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-1`; Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + `timeout: 600000` (`pkill -f vscode-test-web` first).

---

## Context: what exists (Phase 1d)

- `src/shared/protocol.ts` — `HostToDetail`(setGroup), `DetailToHost`(ready|selectAnnotation), `parseDetailMessage`, `TagColor`.
- `src/core/detailState.ts` — `DetailState { group, palette, selectedAnnotationId }`, `initialDetailState`, `applyDetailMessage`, `oneLine`.
- `src/webview/detail/` — `vscodeApi.ts` (postToHost), `state.ts` (`detail` writable, `handleHostMessage`, `setSelectedAnnotation`), `DetailApp.svelte` (group view: header + `AnnotationRow` list), `AnnotationRow.svelte`, `main.ts`.
- `src/web/detailPanelProvider.ts` — `DetailPanelProvider` (`showGroup`, `onSelectAnnotation`, posts `setGroup`).
- `src/web/extension.ts` — wires `provider.onSelectGroup` → load group + `detailProvider.showGroup` + focus; `detailProvider.onSelectAnnotation` → `revealAnnotation`.
- `src/core/groupStore.ts` — `GroupStore` (`listGroups`, `getGroup`, `saveGroup`, `deleteGroup`).
- `src/core/sidebarState.ts` — `tagColor` (reused).

---

## File Structure (1e-1)

```
package.json                                  (modify) # + markdown-it, dompurify (+ @types/markdown-it? no — v14 ships types)
src/shared/protocol.ts                        (modify) # DetailToHost += updateAnnotation, copyText; parse cases
src/shared/protocol.unit.test.ts              (modify) # tests for the new cases
src/core/detailState.ts                       (modify) # + mode; openAnnotation/backToGroup; setGroup preserves annotation mode
src/core/detailState.unit.test.ts             (modify) # tests for mode transitions
src/webview/detail/MarkdownPreview.svelte     (new)    # markdown-it + DOMPurify → {@html}
src/webview/detail/MarkdownPreview.svelte.test.ts (new)
src/webview/detail/MarkdownEditor.svelte      (new)    # textarea-backed (doc/onChange); 1e-2 swaps to CodeMirror
src/webview/detail/MarkdownEditor.svelte.test.ts (new)
src/webview/detail/AnnotationView.svelte      (new)    # empty→editor / preview+Edit; Save/Copy/Back
src/webview/detail/AnnotationView.svelte.test.ts (new)
src/webview/detail/state.ts                   (modify) # + openAnnotation/backToGroup; post updateAnnotation/copyText helpers
src/webview/detail/DetailApp.svelte           (modify) # route group view vs AnnotationView; row → openAnnotation
src/webview/detail/DetailApp.svelte.test.ts   (modify) # + annotation-mode test
src/core/groupStore.ts                        (modify) # + updateAnnotation
src/core/groupStore.unit.test.ts              (modify) # + updateAnnotation tests
src/web/detailPanelProvider.ts                (modify) # handle updateAnnotation (hook) + copyText (clipboard)
src/web/extension.ts                          (modify) # wire onUpdateAnnotation → GroupStore.updateAnnotation + re-post
src/web/test/suite/navigate.integration.test.ts  (no change)
src/web/test/suite/updateAnnotation.integration.test.ts (new) # round-trip via GroupStore
src/web/test/suite/index.ts                   (modify) # import the new integration test
e2e/annotation.spec.ts                        (new)    # open annotation view, see preview
```

---

## Task 1: Add markdown-it + DOMPurify

**Files:** Modify `package.json`

- [ ] **Step 1: Add the deps.** In `package.json`, add to `dependencies` (create the block if absent — these are RUNTIME deps bundled into the webview):

```json
  "dependencies": {
    "dompurify": "^3.4.7",
    "markdown-it": "^14.2.0"
  },
```

(Place `"dependencies"` as a top-level key, e.g. right before `"devDependencies"`. `markdown-it` v14 ships its own types; `dompurify` v3 ships its own types — no `@types/*` needed.)

- [ ] **Step 2: Install**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm install`
Expected: completes; `markdown-it` + `dompurify` added. (Network — if sandboxed, retry the Bash call with `dangerouslyDisableSandbox: true`.)

- [ ] **Step 3: Verify the build + suite still green**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green (the deps aren't imported yet — this just confirms install didn't break anything).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add markdown-it + dompurify for the annotation view"
```

---

## Task 2: Protocol + detail-state mode

**Files:** Modify `src/shared/protocol.ts`, `src/shared/protocol.unit.test.ts`, `src/core/detailState.ts`, `src/core/detailState.unit.test.ts`

- [ ] **Step 1: Append protocol tests** — in `src/shared/protocol.unit.test.ts`, inside the existing `describe('parseDetailMessage', …)` block, add two tests:

```ts
  it('accepts updateAnnotation with string id + content', () => {
    expect(parseDetailMessage({ type: 'updateAnnotation', annotationId: 'a1', content: 'hi' })).toEqual({
      type: 'updateAnnotation',
      annotationId: 'a1',
      content: 'hi',
    });
  });

  it('accepts copyText with a string', () => {
    expect(parseDetailMessage({ type: 'copyText', text: 'x' })).toEqual({ type: 'copyText', text: 'x' });
  });

  it('rejects updateAnnotation with non-string fields', () => {
    expect(parseDetailMessage({ type: 'updateAnnotation', annotationId: 'a1', content: 5 })).toBeNull();
    expect(parseDetailMessage({ type: 'copyText', text: 5 })).toBeNull();
  });
```

- [ ] **Step 2: Append detail-state tests** — in `src/core/detailState.unit.test.ts`, add:

```ts
import { initialDetailState, applyDetailMessage, oneLine, openAnnotation, backToGroup } from './detailState';
// (update the existing import line to include openAnnotation, backToGroup)

describe('mode transitions', () => {
  it('initial mode is group', () => {
    expect(initialDetailState().mode).toBe('group');
  });

  it('openAnnotation switches to annotation mode and records the id', () => {
    const next = openAnnotation(initialDetailState(), 'a1');
    expect(next.mode).toBe('annotation');
    expect(next.selectedAnnotationId).toBe('a1');
  });

  it('backToGroup returns to group mode and clears the selection', () => {
    const next = backToGroup(openAnnotation(initialDetailState(), 'a1'));
    expect(next.mode).toBe('group');
    expect(next.selectedAnnotationId).toBeNull();
  });

  it('setGroup keeps annotation mode when the selected annotation still exists', () => {
    const g = {
      id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open' as const,
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'x', range: { startLine: 1, endLine: 1 }, content: 'c', contentHash: 'h' }],
    };
    const start = openAnnotation({ ...initialDetailState(), group: g }, 'a1');
    const next = applyDetailMessage(start, { type: 'setGroup', group: g, palette: [] });
    expect(next.mode).toBe('annotation');
    expect(next.selectedAnnotationId).toBe('a1');
  });

  it('setGroup falls back to group mode when the selected annotation is gone', () => {
    const start = openAnnotation(initialDetailState(), 'gone');
    const next = applyDetailMessage(start, { type: 'setGroup', group: null, palette: [] });
    expect(next.mode).toBe('group');
    expect(next.selectedAnnotationId).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts`
Expected: FAIL — `updateAnnotation`/`copyText` not handled; `openAnnotation`/`backToGroup`/`mode` not exported.

- [ ] **Step 4: Extend `src/shared/protocol.ts`.** Change the `DetailToHost` union to add two variants:

```ts
export type DetailToHost =
  | { type: 'ready' }
  | { type: 'selectAnnotation'; annotationId: string }
  | { type: 'updateAnnotation'; annotationId: string; content: string }
  | { type: 'copyText'; text: string };
```

And add these cases to the `switch` in `parseDetailMessage` (before `default`):

```ts
    case 'updateAnnotation':
      return typeof raw.annotationId === 'string' && typeof raw.content === 'string'
        ? { type: 'updateAnnotation', annotationId: raw.annotationId, content: raw.content }
        : null;
    case 'copyText':
      return typeof raw.text === 'string' ? { type: 'copyText', text: raw.text } : null;
```

- [ ] **Step 5: Extend `src/core/detailState.ts`.** Add `mode` to the interface and the helpers:

Change `DetailState`:
```ts
export interface DetailState {
  group: AnnotationGroup | null;
  palette: TagColor[];
  selectedAnnotationId: string | null;
  mode: 'group' | 'annotation';
}
```

Change `initialDetailState`:
```ts
export function initialDetailState(): DetailState {
  return { group: null, palette: [], selectedAnnotationId: null, mode: 'group' };
}
```

Change the `setGroup` branch of `applyDetailMessage` to preserve annotation mode when possible:
```ts
    case 'setGroup': {
      const keep =
        state.mode === 'annotation' &&
        state.selectedAnnotationId !== null &&
        (message.group?.annotations.some((a) => a.id === state.selectedAnnotationId) ?? false);
      return {
        group: message.group,
        palette: message.palette,
        selectedAnnotationId: keep ? state.selectedAnnotationId : null,
        mode: keep ? 'annotation' : 'group',
      };
    }
```

Add the two pure helpers at the end:
```ts
/** Open the annotation view for `id`. */
export function openAnnotation(state: DetailState, id: string): DetailState {
  return { ...state, mode: 'annotation', selectedAnnotationId: id };
}

/** Return to the group view. */
export function backToGroup(state: DetailState): DetailState {
  return { ...state, mode: 'group', selectedAnnotationId: null };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: exit 0; all green. (NOTE: `detailState.ts` now has a `mode` field — any existing `DetailState` literal in tests/components without `mode` will fail type-check. The detail `state.ts` store uses `initialDetailState()` so it's fine; the DetailApp test sets full state objects — if check-types flags a missing `mode` in a test literal, add `mode: 'group'`/`'annotation'` to it. The DetailApp.svelte test's `detail.set({...})` literals will need `mode` added; that's handled in Task 6.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts src/core/detailState.ts src/core/detailState.unit.test.ts
git commit -m "feat: detail-panel mode (group/annotation) + updateAnnotation/copyText messages"
```

> If Step 7 surfaced a missing-`mode` type error in `DetailApp.svelte.test.ts`, that file is updated in Task 6; if it blocks the commit here, add `mode: 'group'` to those literals now and note it.

---

## Task 3: MarkdownPreview component

**Files:** Create `src/webview/detail/MarkdownPreview.svelte`, `src/webview/detail/MarkdownPreview.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — `src/webview/detail/MarkdownPreview.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import MarkdownPreview from './MarkdownPreview.svelte';

describe('MarkdownPreview', () => {
  it('renders Markdown as HTML', () => {
    render(MarkdownPreview, { source: '# Title\n\nSome **bold** text.' });
    const el = screen.getByTestId('md-preview');
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
  });

  it('sanitizes dangerous HTML', () => {
    render(MarkdownPreview, { source: 'ok <img src=x onerror="alert(1)"> <script>bad()<\/script>' });
    const el = screen.getByTestId('md-preview');
    expect(el.querySelector('script')).toBeNull();
    // onerror attribute must be stripped if an img survives at all
    expect(el.innerHTML).not.toContain('onerror');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/MarkdownPreview.svelte.test.ts`
Expected: FAIL — cannot resolve `./MarkdownPreview.svelte`.

- [ ] **Step 3: Implement `src/webview/detail/MarkdownPreview.svelte`**

```svelte
<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';

  let { source }: { source: string } = $props();

  const md = new MarkdownIt({ linkify: true, typographer: true });

  const html = $derived(
    DOMPurify.sanitize(md.render(source ?? ''), {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
        'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      ],
      ALLOWED_ATTR: ['href', 'title'],
      ALLOW_DATA_ATTR: false,
    }),
  );
</script>

<div class="md-preview" data-testid="md-preview">{@html html}</div>

<style>
  .md-preview { font-size: 13px; line-height: 1.5; }
  .md-preview :global(h1) { font-size: 1.3em; }
  .md-preview :global(h2) { font-size: 1.15em; }
  .md-preview :global(code) { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 4px; border-radius: 3px; }
  .md-preview :global(pre) { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 8px; border-radius: 4px; overflow-x: auto; }
  .md-preview :global(a) { color: var(--vscode-textLink-foreground, #3794ff); }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/MarkdownPreview.svelte.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Verify type-check + build** (markdown-it/dompurify bundle into the webview)

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: exit 0; webview bundle builds with the new deps.

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/MarkdownPreview.svelte src/webview/detail/MarkdownPreview.svelte.test.ts
git commit -m "feat: MarkdownPreview component (markdown-it + DOMPurify)"
```

---

## Task 4: MarkdownEditor component (textarea-backed)

> The component interface (`doc` value + `onChange`) is what 1e-2 keeps when swapping the internals to CodeMirror 6. A plain `<textarea>` is used here so the component is jsdom-testable.

**Files:** Create `src/webview/detail/MarkdownEditor.svelte`, `src/webview/detail/MarkdownEditor.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — `src/webview/detail/MarkdownEditor.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MarkdownEditor from './MarkdownEditor.svelte';

describe('MarkdownEditor', () => {
  it('shows the initial doc value', () => {
    render(MarkdownEditor, { doc: 'hello' });
    expect((screen.getByTestId('md-editor') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(MarkdownEditor, { doc: '', onChange });
    await userEvent.type(screen.getByTestId('md-editor'), 'hi');
    expect(onChange).toHaveBeenLastCalledWith('hi');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/MarkdownEditor.svelte.test.ts`
Expected: FAIL — cannot resolve `./MarkdownEditor.svelte`.

- [ ] **Step 3: Implement `src/webview/detail/MarkdownEditor.svelte`**

```svelte
<script lang="ts">
  let {
    doc = '',
    onChange,
  }: {
    doc?: string;
    onChange?: (value: string) => void;
  } = $props();

  let value = $state(doc);

  function handleInput(event: Event): void {
    value = (event.currentTarget as HTMLTextAreaElement).value;
    onChange?.(value);
  }
</script>

<textarea
  class="md-editor"
  data-testid="md-editor"
  value={doc}
  oninput={handleInput}
  spellcheck="false"
  placeholder="Write Markdown…"
></textarea>

<style>
  .md-editor {
    width: 100%;
    box-sizing: border-box;
    min-height: 160px;
    resize: vertical;
    background: var(--vscode-input-background, #2a2a2a);
    color: var(--vscode-input-foreground, #ddd);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12.5px;
    line-height: 1.5;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/MarkdownEditor.svelte.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/MarkdownEditor.svelte src/webview/detail/MarkdownEditor.svelte.test.ts
git commit -m "feat: MarkdownEditor component (textarea-backed; CodeMirror swap in 1e-2)"
```

---

## Task 5: AnnotationView component

**Files:** Create `src/webview/detail/AnnotationView.svelte`, `src/webview/detail/AnnotationView.svelte.test.ts`; Modify `src/webview/detail/state.ts`

- [ ] **Step 1: Add store actions/senders to `src/webview/detail/state.ts`.** Add the `openAnnotation`/`backToGroup` imports and store actions, plus message senders. Append:

```ts
import { openAnnotation as openAnnotationState, backToGroup as backToGroupState } from '../../core/detailState';
import { postToHost } from './vscodeApi';

/** Switch the panel to the annotation view for `id`. */
export function openAnnotationView(id: string): void {
  detail.update((state) => openAnnotationState(state, id));
}

/** Return to the group view. */
export function showGroupView(): void {
  detail.update((state) => backToGroupState(state));
}

/** Persist an annotation's content (host saves + re-posts the group). */
export function saveAnnotationContent(annotationId: string, content: string): void {
  postToHost({ type: 'updateAnnotation', annotationId, content });
}

/** Ask the host to copy text to the clipboard. */
export function copyToClipboard(text: string): void {
  postToHost({ type: 'copyText', text });
}
```

(Keep the existing `detail`, `handleHostMessage`, `setSelectedAnnotation` exports. `setSelectedAnnotation` is now unused by the app — leave it or remove it; if you remove it, also remove it from any importer. Simplest: leave it.)

- [ ] **Step 2: Write the failing test** — `src/webview/detail/AnnotationView.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AnnotationView from './AnnotationView.svelte';
import { type Annotation } from '../../shared/model';

function annotation(content: string): Annotation {
  return { id: 'a1', file: 'src/x.ts', range: { startLine: 2, endLine: 4 }, content, contentHash: 'h' };
}

describe('AnnotationView', () => {
  it('shows a preview and the file:range for a non-empty annotation', () => {
    render(AnnotationView, { annotation: annotation('# Note') });
    expect(screen.getByTestId('md-preview')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-loc')).toHaveTextContent('src/x.ts:2–4');
    expect(screen.queryByTestId('md-editor')).toBeNull(); // preview mode, not editing
  });

  it('starts in edit mode for an empty annotation', () => {
    render(AnnotationView, { annotation: annotation('') });
    expect(screen.getByTestId('md-editor')).toBeInTheDocument();
  });

  it('calls onback when Back is clicked', async () => {
    const onback = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), onback });
    await userEvent.click(screen.getByTestId('back-btn'));
    expect(onback).toHaveBeenCalled();
  });

  it('Edit reveals the editor; Save calls onsave with the content', async () => {
    const onsave = vi.fn();
    render(AnnotationView, { annotation: annotation('original'), onsave });
    await userEvent.click(screen.getByTestId('edit-btn'));
    expect(screen.getByTestId('md-editor')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('save-btn'));
    expect(onsave).toHaveBeenCalledWith('a1', 'original');
  });

  it('Copy markdown calls oncopy with the content', async () => {
    const oncopy = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), oncopy });
    await userEvent.click(screen.getByTestId('copy-md-btn'));
    expect(oncopy).toHaveBeenCalledWith('# Note');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — cannot resolve `./AnnotationView.svelte`.

- [ ] **Step 4: Implement `src/webview/detail/AnnotationView.svelte`**

```svelte
<script lang="ts">
  import { type Annotation } from '../../shared/model';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';

  let {
    annotation,
    onback,
    onsave,
    oncopy,
    oncopyloc,
  }: {
    annotation: Annotation;
    onback?: () => void;
    onsave?: (id: string, content: string) => void;
    oncopy?: (content: string) => void;
    oncopyloc?: (loc: string) => void;
  } = $props();

  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);

  // Edit mode is on when the annotation is empty, or the user clicked Edit.
  let editing = $state(annotation.content.length === 0);
  let draft = $state(annotation.content);

  function startEdit(): void {
    draft = annotation.content;
    editing = true;
  }
  function save(): void {
    onsave?.(annotation.id, draft);
    editing = false;
  }
</script>

<section class="annotation-view" data-testid="annotation-view">
  <div class="bar">
    <button type="button" class="link" data-testid="back-btn" onclick={() => onback?.()}>‹ Back</button>
    <span class="loc" data-testid="annotation-loc">{location}</span>
    <button type="button" class="link" data-testid="copy-loc-btn" onclick={() => oncopyloc?.(location)}>⧉ path</button>
  </div>

  <div class="toolbar">
    {#if editing}
      <button type="button" class="btn" data-testid="save-btn" onclick={save}>Save</button>
    {:else}
      <button type="button" class="btn" data-testid="edit-btn" onclick={startEdit}>✎ Edit</button>
    {/if}
    <button type="button" class="btn ghost" data-testid="copy-md-btn" onclick={() => oncopy?.(annotation.content)}>⧉ Copy markdown</button>
  </div>

  {#if editing}
    <MarkdownEditor doc={draft} onChange={(v) => (draft = v)} />
  {:else}
    <MarkdownPreview source={annotation.content} />
  {/if}
</section>

<style>
  .annotation-view { padding: 4px 2px; }
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .loc { flex: 1; font-family: monospace; font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11.5px; padding: 0; }
  .toolbar { display: flex; gap: 6px; margin-bottom: 8px; }
  .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 3px; padding: 4px 10px; font-size: 11.5px; cursor: pointer; }
  .btn.ghost { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); }
</style>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 6: Verify type-check + build**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts src/webview/detail/state.ts
git commit -m "feat: AnnotationView (preview/edit/save/copy) + detail store actions"
```

---

## Task 6: DetailApp router (group view ⇄ annotation view)

**Files:** Modify `src/webview/detail/DetailApp.svelte`, `src/webview/detail/DetailApp.svelte.test.ts`

- [ ] **Step 1: Replace `src/webview/detail/DetailApp.svelte`** — route on `mode`, and make annotation-row clicks open the annotation view (and still post `selectAnnotation` for navigate-to-code):

```svelte
<script lang="ts">
  import { detail, openAnnotationView, showGroupView, saveAnnotationContent, copyToClipboard } from './state';
  import { postToHost } from './vscodeApi';
  import { tagColor } from '../../core/sidebarState';
  import AnnotationRow from './AnnotationRow.svelte';
  import AnnotationView from './AnnotationView.svelte';

  function openRow(id: string): void {
    openAnnotationView(id);
    postToHost({ type: 'selectAnnotation', annotationId: id }); // navigate-to-code
  }

  const current = $derived(
    $detail.group?.annotations.find((a) => a.id === $detail.selectedAnnotationId) ?? null,
  );
</script>

<main data-testid="detail">
  {#if !$detail.group}
    <p class="empty" data-testid="detail-empty">Select a group to see its annotations.</p>
  {:else if $detail.mode === 'annotation' && current}
    <AnnotationView
      annotation={current}
      onback={showGroupView}
      onsave={(id, content) => saveAnnotationContent(id, content)}
      oncopy={(content) => copyToClipboard(content)}
      oncopyloc={(loc) => copyToClipboard(loc)}
    />
  {:else}
    <header class="head">
      <div class="title" data-testid="detail-title">{$detail.group.title}</div>
      <div class="meta">{$detail.group.author} · {$detail.group.status}</div>
      {#if $detail.group.tags.length > 0}
        <div class="chips">
          {#each $detail.group.tags as tag (tag)}
            <span class="chip" style="background:{tagColor($detail.palette, tag)}">{tag}</span>
          {/each}
        </div>
      {/if}
      {#if $detail.group.gitRef}
        <div class="gitref">Git ref: <code>{$detail.group.gitRef}</code></div>
      {/if}
    </header>
    <div class="rows">
      {#each $detail.group.annotations as annotation (annotation.id)}
        <AnnotationRow {annotation} selected={false} onselect={openRow} />
      {/each}
    </div>
  {/if}
</main>

<style>
  main { padding: 8px; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); }
  .empty { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 12px; padding: 8px 2px; }
  .head { padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c); margin-bottom: 6px; }
  .title { font-size: 15px; font-weight: 600; color: var(--vscode-foreground, #eee); }
  .meta { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 11.5px; margin-top: 3px; }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
  .chip { font-size: 10.5px; padding: 1px 8px; border-radius: 9px; color: #fff; }
  .gitref { font-size: 11.5px; color: #bbb; margin-top: 8px; }
  .gitref code { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 6px; border-radius: 3px; }
</style>
```

- [ ] **Step 2: Update `src/webview/detail/DetailApp.svelte.test.ts`** — the two existing tests set state literals that now need `mode`, and add an annotation-mode test. Replace the file with:

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import DetailApp from './DetailApp.svelte';
import { detail } from './state';
import { initialDetailState } from '../../core/detailState';
import { type AnnotationGroup } from '../../shared/model';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'Login review', author: 'Ezequiel', tags: ['security'], gitRef: 'main', status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 2 }, content: 'First', contentHash: 'h' },
      { id: 'a2', file: 'b.ts', range: { startLine: 5, endLine: 5 }, content: 'Second', contentHash: 'h' },
    ],
  };
}

describe('DetailApp.svelte', () => {
  beforeEach(() => {
    detail.set(initialDetailState());
  });

  it('shows an empty state when no group is selected', () => {
    render(DetailApp);
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
  });

  it('renders the group header and an annotation row per annotation in group mode', () => {
    detail.set({ group: group(), palette: [{ name: 'security', color: '#c0392b' }], selectedAnnotationId: null, mode: 'group' });
    render(DetailApp);
    expect(screen.getByTestId('detail-title')).toHaveTextContent('Login review');
    expect(screen.getAllByTestId('annotation-row')).toHaveLength(2);
  });

  it('renders the annotation view in annotation mode', () => {
    detail.set({ group: group(), palette: [], selectedAnnotationId: 'a1', mode: 'annotation' });
    render(DetailApp);
    expect(screen.getByTestId('annotation-view')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-title')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/DetailApp.svelte.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 4: Verify type-check + full unit suite + build**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit && npm run compile`
Expected: exit 0; all green; webview bundle builds.

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/DetailApp.svelte src/webview/detail/DetailApp.svelte.test.ts
git commit -m "feat: detail panel routes group view vs annotation view"
```

---

## Task 7: GroupStore.updateAnnotation + host wiring

**Files:** Modify `src/core/groupStore.ts`, `src/core/groupStore.unit.test.ts`, `src/web/detailPanelProvider.ts`, `src/web/extension.ts`

- [ ] **Step 1: Add a failing test** — in `src/core/groupStore.unit.test.ts`, add:

```ts
  it('updateAnnotation replaces content, bumps updatedAt, and persists', async () => {
    const g = group('g1');
    g.annotations.push({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'old', contentHash: 'h' });
    await store.saveGroup(g);
    const ok = await store.updateAnnotation('g1', 'a1', 'new content', 999);
    expect(ok).toBe(true);
    const reloaded = await store.getGroup('g1');
    expect(reloaded?.annotations[0].content).toBe('new content');
    expect(reloaded?.updatedAt).toBe(999);
  });

  it('updateAnnotation returns false for a missing group or annotation', async () => {
    expect(await store.updateAnnotation('nope', 'a1', 'x', 1)).toBe(false);
    await store.saveGroup(group('g1'));
    expect(await store.updateAnnotation('g1', 'missing', 'x', 1)).toBe(false);
  });
```

> The existing `group(id, title?)` helper in this test file creates a group with `annotations: []`. The first new test pushes an annotation before saving — confirm the helper allows that (it returns a fresh object each call).

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts`
Expected: FAIL — `updateAnnotation` is not a method.

- [ ] **Step 3: Add `updateAnnotation` to `src/core/groupStore.ts`** (inside the `GroupStore` class, after `saveGroup`):

```ts
  /**
   * Replace one annotation's content and bump the group's updatedAt, then persist.
   * Returns false if the group or annotation does not exist.
   */
  async updateAnnotation(groupId: string, annotationId: string, content: string, now: number): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const index = group.annotations.findIndex((a) => a.id === annotationId);
    if (index < 0) {
      return false;
    }
    const annotations = group.annotations.map((a, i) => (i === index ? { ...a, content } : a));
    await this.saveGroup({ ...group, annotations, updatedAt: now });
    return true;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Add updateAnnotation + copyText handling to `src/web/detailPanelProvider.ts`.** Add a public hook and handle the two new messages in `onDidReceiveMessage`.

Add the hook field (next to `onSelectAnnotation`):
```ts
  /** Set by the extension to persist an annotation's edited content. */
  public onUpdateAnnotation?: (groupId: string, annotationId: string, content: string) => void;
```

Add to the `onDidReceiveMessage` handler (after the `selectAnnotation` branch):
```ts
      } else if (message.type === 'updateAnnotation') {
        if (this.group) {
          this.onUpdateAnnotation?.(this.group.id, message.annotationId, message.content);
        }
      } else if (message.type === 'copyText') {
        void vscode.env.clipboard.writeText(message.text);
```

(So the chain reads `if (ready) … else if (selectAnnotation) … else if (updateAnnotation) … else if (copyText) …`.)

Expose the active group id for the extension's reload (it already stores `this.group`); no extra method needed — the extension passes the `groupId` it receives.

- [ ] **Step 6: Wire `onUpdateAnnotation` in `src/web/extension.ts`.** After the existing `detailProvider.onSelectAnnotation = …` assignment, add:

```ts
  detailProvider.onUpdateAnnotation = async (groupId, annotationId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const ok = await store.updateAnnotation(groupId, annotationId, content, Math.floor(Date.now() / 1000));
    if (ok) {
      const updated = await store.getGroup(groupId);
      detailProvider.showGroup(updated, readTagPalette());
    }
  };
```

(`GroupStore`, `VscodeFileSystem`, `readTagPalette` are already imported in `extension.ts` from Phase 1d. Do not duplicate imports.)

- [ ] **Step 7: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 8: Commit**

```bash
git add src/core/groupStore.ts src/core/groupStore.unit.test.ts src/web/detailPanelProvider.ts src/web/extension.ts
git commit -m "feat: persist annotation content edits (GroupStore.updateAnnotation + wiring)"
```

---

## Task 8: Integration + e2e + full suite

**Files:** Create `src/web/test/suite/updateAnnotation.integration.test.ts`, `e2e/annotation.spec.ts`; Modify `src/web/test/suite/index.ts`

- [ ] **Step 1: Write the integration test** — `src/web/test/suite/updateAnnotation.integration.test.ts`

```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateAnnotation (vscode.workspace.fs)', () => {
  test('persists an annotation content edit', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'upd-itest', title: 'Upd', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' }],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.updateAnnotation('upd-itest', 'a1', 'edited', 1234);
      if (!ok) {
        throw new Error('updateAnnotation returned false');
      }
      const reloaded = await store.getGroup('upd-itest');
      if (reloaded?.annotations[0]?.content !== 'edited') {
        throw new Error(`content not persisted: ${reloaded?.annotations[0]?.content}`);
      }
      if (reloaded?.updatedAt !== 1234) {
        throw new Error(`updatedAt not bumped: ${reloaded?.updatedAt}`);
      }
    } finally {
      await store.deleteGroup('upd-itest');
    }
  });
});
```

- [ ] **Step 2: Import it in `src/web/test/suite/index.ts`** — add to the `Promise.all([...])`:

```ts
    Promise.all([
      import('./extension.test'),
      import('./groupStore.integration.test'),
      import('./navigate.integration.test'),
      import('./updateAnnotation.integration.test'),
    ])
```

- [ ] **Step 3: Create `e2e/annotation.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('opening an annotation shows the annotation view', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open the Annotated sidebar and click the seeded group card.
  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  // Detail panel (2nd webview) shows the group; click the annotation row.
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();
  await detail.getByTestId('annotation-row').click();

  // The annotation view should now be shown (the seed annotation has content "Seed annotation").
  await expect(detail.getByTestId('annotation-view')).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByTestId('md-preview')).toContainText('Seed annotation', { timeout: 30_000 });
});
```

> Selector note: this mirrors `e2e/detail.spec.ts` (ordinal `iframe.webview` selectors, since `@vscode/test-web` positions webview iframes as siblings). The seed group's annotation has content `"Seed annotation"`, so it renders in preview mode (non-empty).

- [ ] **Step 4: Run the e2e (verify it passes)**

Run (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:e2e`
Expected: 3 passed — `sidebar.spec`, `detail.spec`, `annotation.spec`.

> If the annotation view doesn't appear: clicking the row calls `openAnnotationView(id)` (local store → mode='annotation') and posts `selectAnnotation` (navigate). The view renders from `$detail.group.annotations.find(... selectedAnnotationId)`. Verify the row click fired and `current` resolved. Keep the assertion meaningful (don't weaken).

- [ ] **Step 5: Run the full suite (Definition of Done)**

Run (same settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**6 passing**) → `test:e2e` (**3 passed**) all green.

- [ ] **Step 6: Commit**

```bash
git add src/web/test/suite/updateAnnotation.integration.test.ts src/web/test/suite/index.ts e2e/annotation.spec.ts
git commit -m "test: updateAnnotation integration + annotation-view e2e"
```

---

## Phase 1e-1 Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (protocol, detailState mode, MarkdownPreview, MarkdownEditor, AnnotationView, DetailApp router, GroupStore.updateAnnotation + earlier suites).
- [ ] `npm run test:integration` passes — **6 passing** (incl. updateAnnotation round-trip).
- [ ] `npm run test:e2e` passes — **3 passed** (sidebar, detail, annotation view).
- [ ] All work committed on the `phase-1` branch.
- [ ] Manual sanity (optional): open a group → click an annotation → see the editor (empty) or preview (non-empty); Edit → write Markdown → Save → reopen shows the saved content; Copy markdown / Copy path work; Back returns to the group view.

Next: **1e-2** — swap `MarkdownEditor`'s internals from the textarea to **CodeMirror 6** (`@codemirror/state`/`view`/`commands`/`language`/`lang-markdown`) with Markdown highlighting + the pure selection transforms (`isUrl`/`wrapSelection`/`linkSelection` — unit-tested) wired into a paste handler (select + paste URL → link) and a bold/italic keymap. The `doc`/`onChange` interface stays identical, so `AnnotationView` and the save flow are unchanged. After 1e-2, the Phase 1 MVP is complete → merge `phase-1` → `main`.
```
