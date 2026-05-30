# vscode-annotated — Phase 1d: Detail Panel + Navigate-to-Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a detail panel in the **Secondary Side Bar** that shows the selected group's read-only "group view" (title, author, status, tag chips, optional Git ref, and the list of annotations as one-line rows). Clicking a sidebar card opens the detail panel for that group; clicking an annotation row navigates the editor to its file + line range and highlights those lines.

**Architecture:** A second webview view (`annotated.detail`) in a `secondarySidebar` view container, with its own pure reducer (`detailState`), `svelte/store`, and message bridge — mirroring the sidebar. The host wires `sidebarProvider.onSelectGroup → detailProvider.showGroup(...) + focus`, and `detailProvider.onSelectAnnotation → navigateToCode`. Navigate-to-code reuses a single `TextEditorDecorationType` (whole-line range highlight), clearing the previous highlight on each jump.

**Tech Stack:** TypeScript + Svelte 5 (web extension host). Builds on Phase 1a–1c. **Bumps `engines.vscode` + `@types/vscode` to `^1.106.0`** (required for the `secondarySidebar` manifest location). Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions for the executor:**
> - Work on the **`phase-1`** branch (already checked out).
> - **Node:** prefix node/npm/npx commands with `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"` (verify `node -v` → v25.x).
> - Commit trailer (after a blank line):
>   ```
>   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
>   ```
> - `test:integration` / `test:e2e` download/serve a VSCode web build — run with the Bash tool's `dangerouslyDisableSandbox: true` and `timeout: 600000`; `pkill -f vscode-test-web 2>/dev/null` first if a port is held.

> **Research basis (current, verified):** `contributes.viewsContainers.secondarySidebar` is the stable manifest key for the Secondary Side Bar (VSCode ≥1.106). A contributed view's auto-generated `<viewId>.focus` command reveals it (opening the secondary side bar). VSCode `Range`/`Position` are 0-based (our model is 1-based inclusive). Reuse ONE `TextEditorDecorationType` (don't create per call — they leak). Playwright drill for a secondary-sidebar webview: `.part.auxiliarybar .webview` → `#active-frame`.

---

## Context: what exists (Phase 1c)

- `src/shared/protocol.ts` — `HostToWebview`(setState), `WebviewToHost`(ready|selectGroup), `TagColor`, `parseWebviewMessage`.
- `src/core/sidebarState.ts` — `tagColor(palette, name)` (reused here).
- `src/web/sidebarViewProvider.ts` — `SidebarViewProvider` with public `onSelectGroup?: (groupId)=>void` hook (currently unset).
- `src/web/extension.ts` — registers sidebar provider + watcher + `annotated.ping` + `annotated.createAnnotation`.
- `src/core/groupStore.ts` (`GroupStore`), `src/web/vscodeFileSystem.ts` (`VscodeFileSystem`), `src/web/tagPalette.ts` (`readTagPalette`).
- `src/webview/vscode.d.ts` — ambient `acquireVsCodeApi`.
- `esbuild.mjs` webview config: `entryPoints: { 'sidebar/main': 'src/webview/sidebar/main.ts' }`.
- `package.json` — `engines.vscode ^1.100.0`, `@types/vscode ^1.100.0`; `contributes` has the `annotated` activitybar container + `annotated.sidebar` view + commands + keybindings + configuration.
- `test-workspace/.annotations/groups/seed.json` — committed "Seed Group" (annotation references `README.md`).

---

## File Structure (created/modified in 1d)

```
src/shared/protocol.ts                       (modify) # + HostToDetail, DetailToHost, parseDetailMessage
src/shared/protocol.unit.test.ts             (modify) # + parseDetailMessage tests
src/core/detailState.ts                      (new)    # DetailState, initialDetailState, applyDetailMessage, oneLine
src/core/detailState.unit.test.ts            (new)
src/webview/detail/AnnotationRow.svelte      (new)    # one annotation row (prop-driven)
src/webview/detail/AnnotationRow.svelte.test.ts (new)
src/webview/detail/vscodeApi.ts              (new)    # lazy acquireVsCodeApi + postToHost(DetailToHost)
src/webview/detail/state.ts                  (new)    # writable store + handleHostMessage/setSelectedAnnotation
src/webview/detail/DetailApp.svelte          (new)    # store-driven group view
src/webview/detail/DetailApp.svelte.test.ts  (new)
src/webview/detail/main.ts                   (new)    # message bridge, mount, post ready
esbuild.mjs                                  (modify) # add detail/main webview entry
src/web/navigateToCode.ts                    (new)    # revealAnnotation + clearHighlight (reused decoration)
src/web/detailPanelProvider.ts               (new)    # DetailPanelProvider (annotated.detail)
src/web/extension.ts                         (modify) # register detail provider; wire onSelectGroup/onSelectAnnotation
package.json                                 (modify) # engines+@types ^1.106.0; secondarySidebar container + detail view
src/web/test/suite/navigate.integration.test.ts (new) # navigate-to-code opens seeded file at range
src/web/test/suite/index.ts                  (modify) # import the new integration test
test-workspace/README.md                     (new)    # committed file the seed annotation points at
e2e/detail.spec.ts                           (new)    # click card → detail panel shows the group
```

---

## Task 1: Detail messages in the protocol

**Files:** Modify `src/shared/protocol.ts`, `src/shared/protocol.unit.test.ts`

- [ ] **Step 1: Append tests to `src/shared/protocol.unit.test.ts`** — add this second `describe` block (keep the existing `parseWebviewMessage` describe and the existing import line; add `parseDetailMessage` to the import):

Change the import line from:
```ts
import { parseWebviewMessage } from './protocol';
```
to:
```ts
import { parseWebviewMessage, parseDetailMessage } from './protocol';
```

Then append, after the existing `describe('parseWebviewMessage', ...)` block:

```ts
describe('parseDetailMessage', () => {
  it('accepts a ready message', () => {
    expect(parseDetailMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts a selectAnnotation message with a string annotationId', () => {
    expect(parseDetailMessage({ type: 'selectAnnotation', annotationId: 'a1' })).toEqual({
      type: 'selectAnnotation',
      annotationId: 'a1',
    });
  });

  it('rejects selectAnnotation without a string annotationId', () => {
    expect(parseDetailMessage({ type: 'selectAnnotation' })).toBeNull();
    expect(parseDetailMessage({ type: 'selectAnnotation', annotationId: 7 })).toBeNull();
  });

  it('rejects unknown types and non-objects', () => {
    expect(parseDetailMessage({ type: 'nope' })).toBeNull();
    expect(parseDetailMessage(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts`
Expected: FAIL — `parseDetailMessage` is not exported.

- [ ] **Step 3: Append to `src/shared/protocol.ts`** — add the detail message types + validator (keep everything already there). Add after the existing `WebviewToHost` type:

```ts
/** Host → detail-panel messages. */
export type HostToDetail = {
  type: 'setGroup';
  group: AnnotationGroup | null;
  palette: TagColor[];
};

/** Detail-panel → host messages. */
export type DetailToHost =
  | { type: 'ready' }
  | { type: 'selectAnnotation'; annotationId: string };
```

And add after `parseWebviewMessage`:

```ts
/** Validate an untrusted detail→host message; returns it narrowed, or null. */
export function parseDetailMessage(raw: unknown): DetailToHost | null {
  if (!isObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'selectAnnotation':
      return typeof raw.annotationId === 'string' ? { type: 'selectAnnotation', annotationId: raw.annotationId } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts`
Expected: PASS — 8 tests pass (4 webview + 4 detail).

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat: detail-panel protocol messages (setGroup, selectAnnotation)"
```

---

## Task 2: Pure detail state reducer

**Files:** Create `src/core/detailState.ts`, `src/core/detailState.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/detailState.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { initialDetailState, applyDetailMessage, oneLine } from './detailState';
import { type AnnotationGroup } from '../shared/model';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [{ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' }],
  };
}

describe('initialDetailState', () => {
  it('has no group and no selection', () => {
    expect(initialDetailState()).toEqual({ group: null, palette: [], selectedAnnotationId: null });
  });
});

describe('applyDetailMessage', () => {
  it('setGroup replaces the group + palette and resets the selection', () => {
    const start = { ...initialDetailState(), selectedAnnotationId: 'old' };
    const next = applyDetailMessage(start, { type: 'setGroup', group: group(), palette: [{ name: 'x', color: '#111' }] });
    expect(next.group?.id).toBe('g1');
    expect(next.palette).toEqual([{ name: 'x', color: '#111' }]);
    expect(next.selectedAnnotationId).toBeNull();
  });

  it('setGroup with null clears the group', () => {
    const next = applyDetailMessage(initialDetailState(), { type: 'setGroup', group: null, palette: [] });
    expect(next.group).toBeNull();
  });
});

describe('oneLine', () => {
  it('returns the first non-empty line, trimmed', () => {
    expect(oneLine('\n  hello world  \nsecond')).toBe('hello world');
  });

  it('truncates long content with an ellipsis', () => {
    expect(oneLine('x'.repeat(80), 10)).toBe('xxxxxxxxx…');
  });

  it('returns empty string for blank content', () => {
    expect(oneLine('   \n  ')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/detailState.unit.test.ts`
Expected: FAIL — cannot resolve `./detailState`.

- [ ] **Step 3: Implement `src/core/detailState.ts`**

```ts
import { type AnnotationGroup } from '../shared/model';
import { type HostToDetail, type TagColor } from '../shared/protocol';

export interface DetailState {
  group: AnnotationGroup | null;
  palette: TagColor[];
  selectedAnnotationId: string | null;
}

export function initialDetailState(): DetailState {
  return { group: null, palette: [], selectedAnnotationId: null };
}

/** Apply a host→detail message, returning a new state. */
export function applyDetailMessage(state: DetailState, message: HostToDetail): DetailState {
  switch (message.type) {
    case 'setGroup':
      return { group: message.group, palette: message.palette, selectedAnnotationId: null };
    default:
      return state;
  }
}

/** First non-empty line of `content`, trimmed, truncated to `max` chars with an ellipsis. */
export function oneLine(content: string, max = 60): string {
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/detailState.unit.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/detailState.ts src/core/detailState.unit.test.ts
git commit -m "feat: pure detail-panel state reducer + one-line content helper"
```

---

## Task 3: AnnotationRow component

**Files:** Create `src/webview/detail/AnnotationRow.svelte`, `src/webview/detail/AnnotationRow.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — `src/webview/detail/AnnotationRow.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AnnotationRow from './AnnotationRow.svelte';
import { type Annotation } from '../../shared/model';

function annotation(content: string): Annotation {
  return { id: 'a1', file: 'src/auth/login.ts', range: { startLine: 42, endLine: 47 }, content, contentHash: 'h' };
}

describe('AnnotationRow', () => {
  it('renders the one-line content and file:range', () => {
    render(AnnotationRow, { annotation: annotation('## First line\nsecond') });
    const row = screen.getByTestId('annotation-row');
    expect(row).toHaveTextContent('## First line');
    expect(row).toHaveTextContent('src/auth/login.ts:42–47');
  });

  it('shows "(empty)" for an annotation with no content', () => {
    render(AnnotationRow, { annotation: annotation('') });
    expect(screen.getByTestId('annotation-row')).toHaveTextContent('(empty)');
  });

  it('calls onselect with the annotation id when clicked', async () => {
    const onselect = vi.fn();
    render(AnnotationRow, { annotation: annotation('hi'), onselect });
    await userEvent.click(screen.getByTestId('annotation-row'));
    expect(onselect).toHaveBeenCalledWith('a1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationRow.svelte.test.ts`
Expected: FAIL — cannot resolve `./AnnotationRow.svelte`.

- [ ] **Step 3: Implement `src/webview/detail/AnnotationRow.svelte`**

```svelte
<script lang="ts">
  import { type Annotation } from '../../shared/model';
  import { oneLine } from '../../core/detailState';

  let {
    annotation,
    selected = false,
    onselect,
  }: {
    annotation: Annotation;
    selected?: boolean;
    onselect?: (id: string) => void;
  } = $props();

  const summary = $derived(oneLine(annotation.content) || '(empty)');
  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);
</script>

<button
  type="button"
  class="row"
  class:selected
  data-testid="annotation-row"
  onclick={() => onselect?.(annotation.id)}
>
  <span class="summary">{summary}</span>
  <span class="loc">{location}</span>
</button>

<style>
  .row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 8px;
    text-align: left;
    background: transparent;
    color: var(--vscode-foreground, #ccc);
    border: none;
    border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a);
    padding: 6px 4px;
    cursor: pointer;
    font-family: var(--vscode-font-family, sans-serif);
  }
  .row:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  .row.selected { background: var(--vscode-list-activeSelectionBackground, #04395e); }
  .summary { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
  .loc { color: var(--vscode-descriptionForeground, #8a8a8a); font-size: 10.5px; font-family: monospace; white-space: nowrap; }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationRow.svelte.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/AnnotationRow.svelte src/webview/detail/AnnotationRow.svelte.test.ts
git commit -m "feat: AnnotationRow detail component"
```

---

## Task 4: Detail webview wiring (store, app, bridge) + esbuild entry

**Files:** Create `src/webview/detail/vscodeApi.ts`, `src/webview/detail/state.ts`, `src/webview/detail/DetailApp.svelte`, `src/webview/detail/DetailApp.svelte.test.ts`, `src/webview/detail/main.ts`; Modify `esbuild.mjs`

- [ ] **Step 1: Create `src/webview/detail/vscodeApi.ts`**

```ts
import { type DetailToHost } from '../../shared/protocol';

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

/** Post a typed message to the extension host. */
export function postToHost(message: DetailToHost): void {
  getApi().postMessage(message);
}
```

- [ ] **Step 2: Create `src/webview/detail/state.ts`**

```ts
import { writable } from 'svelte/store';
import { initialDetailState, applyDetailMessage, type DetailState } from '../../core/detailState';
import { type HostToDetail } from '../../shared/protocol';

export const detail = writable<DetailState>(initialDetailState());

/** Apply a host message to the store. */
export function handleHostMessage(message: HostToDetail): void {
  detail.update((state) => applyDetailMessage(state, message));
}

/** Record the locally-selected annotation. */
export function setSelectedAnnotation(id: string): void {
  detail.update((state) => ({ ...state, selectedAnnotationId: id }));
}
```

- [ ] **Step 3: Write the failing test** — `src/webview/detail/DetailApp.svelte.test.ts`

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

  it('renders the group header and an annotation row per annotation', () => {
    detail.set({ group: group(), palette: [{ name: 'security', color: '#c0392b' }], selectedAnnotationId: null });
    render(DetailApp);
    expect(screen.getByTestId('detail-title')).toHaveTextContent('Login review');
    expect(screen.getByTestId('detail')).toHaveTextContent('Ezequiel');
    expect(screen.getByTestId('detail')).toHaveTextContent('security');
    expect(screen.getAllByTestId('annotation-row')).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/DetailApp.svelte.test.ts`
Expected: FAIL — cannot resolve `./DetailApp.svelte`.

- [ ] **Step 5: Implement `src/webview/detail/DetailApp.svelte`**

```svelte
<script lang="ts">
  import { detail, setSelectedAnnotation } from './state';
  import { postToHost } from './vscodeApi';
  import { tagColor } from '../../core/sidebarState';
  import AnnotationRow from './AnnotationRow.svelte';

  function onselect(id: string): void {
    setSelectedAnnotation(id);
    postToHost({ type: 'selectAnnotation', annotationId: id });
  }
</script>

<main data-testid="detail">
  {#if !$detail.group}
    <p class="empty" data-testid="detail-empty">Select a group to see its annotations.</p>
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
        <AnnotationRow
          {annotation}
          selected={$detail.selectedAnnotationId === annotation.id}
          {onselect}
        />
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

- [ ] **Step 6: Run the component test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/DetailApp.svelte.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 7: Create `src/webview/detail/main.ts`**

```ts
import { mount } from 'svelte';
import DetailApp from './DetailApp.svelte';
import { handleHostMessage } from './state';
import { postToHost } from './vscodeApi';

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message && typeof message === 'object' && message.type === 'setGroup') {
    handleHostMessage(message);
  }
});

const app = mount(DetailApp, { target: document.body });

// Ask the host for the current group.
postToHost({ type: 'ready' });

export default app;
```

- [ ] **Step 8: Add the detail webview entry to `esbuild.mjs`** — change the webview config's `entryPoints` from:

```js
  entryPoints: { 'sidebar/main': 'src/webview/sidebar/main.ts' },
```

to:

```js
  entryPoints: {
    'sidebar/main': 'src/webview/sidebar/main.ts',
    'detail/main': 'src/webview/detail/main.ts',
  },
```

- [ ] **Step 9: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit && test -f dist/webview/detail/main.js && test -f dist/webview/detail/main.css && echo OK`
Expected: exit 0; `OK` — the detail bundle (`dist/webview/detail/main.js` + `main.css`) is emitted; all unit/component tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/webview/detail/vscodeApi.ts src/webview/detail/state.ts src/webview/detail/DetailApp.svelte src/webview/detail/DetailApp.svelte.test.ts src/webview/detail/main.ts esbuild.mjs
git commit -m "feat: detail webview app (group view) + bundle entry"
```

---

## Task 5: Navigate-to-code, DetailPanelProvider, wiring, manifest, engines bump

**Files:** Create `src/web/navigateToCode.ts`, `src/web/detailPanelProvider.ts`; Modify `src/web/extension.ts`, `package.json`

- [ ] **Step 1: Bump `engines.vscode` + `@types/vscode` in `package.json`** to `^1.106.0`:

Change `"engines": { "vscode": "^1.100.0", "node": ">=20.19" }` to:
```json
  "engines": { "vscode": "^1.106.0", "node": ">=20.19" },
```
And in `devDependencies` change `"@types/vscode": "^1.100.0"` to `"@types/vscode": "^1.106.0"`.

Then install:

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm install`
Expected: completes; `@types/vscode` updated. (Needs network — if sandboxed, use the Bash tool's `dangerouslyDisableSandbox: true`.)

- [ ] **Step 2: Add the secondary side bar container + detail view to `package.json` `contributes`.** Add a `secondarySidebar` array to `viewsContainers` (sibling of `activitybar`) and an `annotated-detail` entry to `views`:

```json
    "viewsContainers": {
      "activitybar": [
        { "id": "annotated", "title": "Annotated", "icon": "media/icon.svg" }
      ],
      "secondarySidebar": [
        { "id": "annotated-detail", "title": "Annotated Detail", "icon": "media/icon.svg" }
      ]
    },
    "views": {
      "annotated": [
        { "type": "webview", "id": "annotated.sidebar", "name": "Annotations" }
      ],
      "annotated-detail": [
        { "type": "webview", "id": "annotated.detail", "name": "Detail" }
      ]
    },
```

(Keep `commands`, `keybindings`, `configuration` unchanged.)

- [ ] **Step 3: Create `src/web/navigateToCode.ts`**

```ts
import * as vscode from 'vscode';
import { type Annotation } from '../shared/model';

let highlightType: vscode.TextEditorDecorationType | undefined;
let lastEditor: vscode.TextEditor | undefined;

function decorationType(): vscode.TextEditorDecorationType {
  if (!highlightType) {
    highlightType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      isWholeLine: true,
    });
  }
  return highlightType;
}

/** Clear the highlight applied by the previous navigation, if any. */
export function clearHighlight(): void {
  if (lastEditor && highlightType) {
    lastEditor.setDecorations(highlightType, []);
  }
  lastEditor = undefined;
}

/**
 * Open the annotation's file, reveal + select its line range, and highlight those
 * full lines (clearing the previous highlight). `folderUri` is the workspace folder.
 * Model line numbers are 1-based inclusive; VSCode ranges are 0-based.
 */
export async function revealAnnotation(folderUri: vscode.Uri, annotation: Annotation): Promise<void> {
  const uri = vscode.Uri.joinPath(folderUri, ...annotation.file.split('/').filter(Boolean));
  const range = new vscode.Range(
    annotation.range.startLine - 1,
    0,
    annotation.range.endLine - 1,
    Number.MAX_SAFE_INTEGER,
  );

  clearHighlight();

  const editor = await vscode.window.showTextDocument(uri, { selection: range, preserveFocus: true });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(decorationType(), [range]);
  lastEditor = editor;
}
```

- [ ] **Step 4: Create `src/web/detailPanelProvider.ts`**

```ts
import * as vscode from 'vscode';
import { type Annotation, type AnnotationGroup } from '../shared/model';
import { parseDetailMessage, type HostToDetail, type TagColor } from '../shared/protocol';

export class DetailPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'annotated.detail';
  private view?: vscode.WebviewView;
  private group: AnnotationGroup | null = null;
  private palette: TagColor[] = [];

  /** Set by the extension to navigate to a selected annotation. */
  public onSelectAnnotation?: (annotation: Annotation) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((raw) => {
      const message = parseDetailMessage(raw);
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        this.post();
      } else if (message.type === 'selectAnnotation') {
        const annotation = this.group?.annotations.find((a) => a.id === message.annotationId);
        if (annotation) {
          this.onSelectAnnotation?.(annotation);
        }
      }
    });
  }

  /** Set the group shown by the panel and push it to the webview (if resolved). */
  showGroup(group: AnnotationGroup | null, palette: TagColor[]): void {
    this.group = group;
    this.palette = palette;
    this.post();
  }

  private post(): void {
    if (!this.view) {
      return;
    }
    const message: HostToDetail = { type: 'setGroup', group: this.group, palette: this.palette };
    void this.view.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'detail');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
    const nonce = getNonce();
    const csp =
      `default-src 'none'; ` +
      `style-src ${webview.cspSource}; ` +
      `script-src 'nonce-${nonce}'; ` +
      `font-src ${webview.cspSource}; ` +
      `img-src ${webview.cspSource} https: data:;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Detail</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 5: Wire it all in `src/web/extension.ts`.** Add imports near the others:

```ts
import { DetailPanelProvider } from './detailPanelProvider';
import { GroupStore } from '../core/groupStore';
import { VscodeFileSystem } from './vscodeFileSystem';
import { readTagPalette } from './tagPalette';
import { revealAnnotation } from './navigateToCode';
```

Then, after the existing sidebar `provider` registration + watcher block, add the detail provider and wire the hooks:

```ts
  const detailProvider = new DetailPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DetailPanelProvider.viewType, detailProvider),
  );

  provider.onSelectGroup = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const group = folder
      ? await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId)
      : null;
    detailProvider.showGroup(group, readTagPalette());
    await vscode.commands.executeCommand('annotated.detail.focus');
  };

  detailProvider.onSelectAnnotation = (annotation): void => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      void revealAnnotation(folder.uri, annotation);
    }
  };
```

(Leave the `annotated.ping` / `annotated.createAnnotation` registrations and the sidebar watcher unchanged.)

- [ ] **Step 6: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; bundles emitted; all unit/component tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json src/web/navigateToCode.ts src/web/detailPanelProvider.ts src/web/extension.ts
git commit -m "feat: detail panel in secondary side bar + navigate-to-code wiring"
```

---

## Task 6: Integration (navigate) + e2e (detail panel) + full suite

**Files:** Create `test-workspace/README.md`, `src/web/test/suite/navigate.integration.test.ts`, `e2e/detail.spec.ts`; Modify `src/web/test/suite/index.ts`

- [ ] **Step 1: Create `test-workspace/README.md`** (the file the seed annotation points at; needs ≥1 line):

```md
# Test Workspace

Line two.
Line three.
```

- [ ] **Step 2: Write the navigate integration test** — `src/web/test/suite/navigate.integration.test.ts`

```ts
import * as vscode from 'vscode';
import { revealAnnotation } from '../../navigateToCode';
import { type Annotation } from '../../../shared/model';

suite('navigate-to-code', () => {
  test('opens the annotation file and selects its 1-based line range', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder — @vscode/test-web must be passed the test-workspace folder');
    }
    const annotation: Annotation = {
      id: 'nav-a',
      file: 'README.md',
      range: { startLine: 2, endLine: 3 },
      content: '',
      contentHash: 'h',
    };

    await revealAnnotation(folder.uri, annotation);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error('no active editor after revealAnnotation');
    }
    if (!editor.document.uri.path.endsWith('/README.md')) {
      throw new Error(`expected README.md, got ${editor.document.uri.path}`);
    }
    // 1-based [2,3] → 0-based selection start line 1.
    if (editor.selection.start.line !== 1) {
      throw new Error(`expected selection to start at 0-based line 1, got ${editor.selection.start.line}`);
    }
    if (editor.selection.end.line !== 2) {
      throw new Error(`expected selection to end at 0-based line 2, got ${editor.selection.end.line}`);
    }
  });
});
```

- [ ] **Step 3: Import the new integration test in `src/web/test/suite/index.ts`** — add `import('./navigate.integration.test')` to the `Promise.all([...])` list:

```ts
    Promise.all([
      import('./extension.test'),
      import('./groupStore.integration.test'),
      import('./navigate.integration.test'),
    ])
      .then(() => {
```

- [ ] **Step 4: Create `e2e/detail.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('clicking a sidebar card shows the group in the detail panel', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open the Annotated sidebar and click the seeded group card.
  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  const sidebar = page
    .locator('.part.sidebar iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();
  await sidebar.getByTestId('group-card').click();

  // The detail panel (secondary side bar) should now show the group view.
  const detail = page
    .locator('.part.auxiliarybar iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();
  await expect(detail.getByTestId('detail-title')).toHaveText(/Seed Group/, { timeout: 30_000 });
  await expect(detail.getByTestId('annotation-row')).toHaveCount(1);
});
```

- [ ] **Step 5: Run the e2e (verify it passes)**

Run (with `dangerouslyDisableSandbox: true` and Bash `timeout: 600000`; `pkill -f vscode-test-web 2>/dev/null` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:e2e`
Expected: 2 passed — `e2e/sidebar.spec.ts` (still green) + `e2e/detail.spec.ts` (detail panel shows "Seed Group").

> If the detail panel doesn't appear: clicking a card posts `selectGroup` → host `onSelectGroup` loads the group, calls `detailProvider.showGroup`, then `executeCommand('annotated.detail.focus')` (which opens the secondary side bar + resolves the detail webview, which posts `ready` → host re-posts `setGroup`). If the `.part.auxiliarybar` selector doesn't match, inspect the served VSCode build's DOM in headed mode and adjust; keep the `detail-title` assertion meaningful.

- [ ] **Step 6: Run the full suite (Definition of Done)**

Run (same sandbox/timeout settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**5 passing**: extension ×3, groupStore round-trip, navigate-to-code) → `test:e2e` (**2 passed**) all green.

- [ ] **Step 7: Commit**

```bash
git add test-workspace/README.md src/web/test/suite/navigate.integration.test.ts src/web/test/suite/index.ts e2e/detail.spec.ts
git commit -m "test: navigate-to-code integration + detail-panel e2e"
```

---

## Phase 1d Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (protocol ×8, detailState, AnnotationRow, DetailApp + earlier suites).
- [ ] `npm run test:integration` passes — **5 passing** (incl. navigate-to-code).
- [ ] `npm run test:e2e` passes — **2 passed** (sidebar card + detail-panel group view).
- [ ] All work committed on the `phase-1` branch.
- [ ] Manual sanity (optional): `npm start`, open the Annotated view, click a group card → the detail panel opens in the secondary side bar showing the group; click an annotation row → the editor jumps to the file and highlights the lines.

Next: **1e** — annotation view (replaces the group view when an annotation is opened) with the CodeMirror Markdown editor (write/preview, copy controls, Prev/Next is Phase 2). This adds a `viewMode` to the detail panel and a second detail message (`setAnnotation`).
```
