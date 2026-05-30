# vscode-annotated — Phase 2b: Drift Detection + Editable Line Range — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Flag **stale** annotations (the code under their line range changed since the annotation was created) — an amber dot in the group view's annotation list and a banner in the annotation view — and let users **edit an annotation's line range** (file stays fixed), which re-anchors the content hash.

**Architecture:** Drift is computed **host-side** (webviews can't read files): a pure `isAnnotationStale(fileText, range, contentHash)` reused by the host, which reads each annotation's current file and sends a `staleIds: string[]` alongside `setGroup`. The detail panel renders stale state from `staleIds`. Editing a range posts `updateAnnotationRange`; the host recomputes the content hash from the new range's current file lines and persists via a new `GroupStore.updateAnnotationRange`. New state fields default defensively so existing tests are unaffected.

**Tech Stack:** TypeScript + Svelte 5. Builds on Phase 1 + 2a. Reuses `anchorText`/`sha256Hex`. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-2` (already checked out — Phase 2 sub-plans accumulate here per CLAUDE.md); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + `timeout: 600000` (`pkill -f vscode-test-web` first).

---

## Context (Phase 1 + 2a)

- `src/shared/hash.ts` — `sha256Hex(text)`, `anchorText(fileText, range)`.
- `src/shared/model.ts` — `Annotation { id, file, range, content, contentHash }`, `AnnotationGroup`.
- `src/core/groupStore.ts` — `GroupStore` (`updateAnnotation`, `updateGroup`, …).
- `src/shared/protocol.ts` — `HostToDetail = { type:'setGroup'; group; palette }`; `DetailToHost = … | setGroupTitle | editTags | editGitRef`; `parseDetailMessage`.
- `src/core/detailState.ts` — `DetailState { group; palette; selectedAnnotationId; mode }`; `initialDetailState`; `applyDetailMessage`; `oneLine`; `openAnnotation`/`backToGroup`.
- `src/webview/detail/` — `DetailApp.svelte` (router: empty / annotation `{#key}` / group→`<GroupView>`), `GroupView.svelte` (header + `<AnnotationRow>` list), `AnnotationRow.svelte` (`{annotation, selected?, onselect?}`), `AnnotationView.svelte` (`{annotation, onback?, onsave?, oncopy?, oncopyloc?}`), `state.ts` (`detail`, `handleHostMessage`, senders), `vscodeApi.ts`.
- `src/web/detailPanelProvider.ts` — `showGroup(group, palette)`; `post()` sends `{type:'setGroup', group, palette}`; hooks `onSelectAnnotation`/`onUpdateAnnotation`/`onSetGroupTitle`/`onEditTags`/`onEditGitRef`.
- `src/web/extension.ts` — wires the hooks; `showGroup`/`reloadDetail`/`patchGroup`; `VscodeFileSystem` available.
- `src/web/vscodeFileSystem.ts` — `VscodeFileSystem` (`readFile(path): Promise<Uint8Array>`).

---

## File Structure (2b)

```
src/core/drift.ts                             (new)    # pure isAnnotationStale(fileText, range, contentHash)
src/core/drift.unit.test.ts                   (new)
src/core/groupStore.ts                        (modify) # + updateAnnotationRange(groupId, annotationId, range, contentHash, now)
src/core/groupStore.unit.test.ts              (modify)
src/shared/protocol.ts                        (modify) # setGroup += staleIds; DetailToHost += updateAnnotationRange
src/shared/protocol.unit.test.ts              (modify)
src/core/detailState.ts                       (modify) # DetailState += staleIds; setGroup stores it; isStale(state,id) helper
src/core/detailState.unit.test.ts             (modify)
src/webview/detail/AnnotationRow.svelte       (modify) # + stale? prop → amber dot
src/webview/detail/AnnotationRow.svelte.test.ts (modify)
src/webview/detail/AnnotationView.svelte      (modify) # + stale? banner + editable range (onsaverange)
src/webview/detail/AnnotationView.svelte.test.ts (modify)
src/webview/detail/GroupView.svelte           (modify) # + staleIds prop → per-row stale
src/webview/detail/GroupView.svelte.test.ts   (modify)
src/webview/detail/DetailApp.svelte           (modify) # pass staleIds; wire range save + stale to AnnotationView
src/webview/detail/state.ts                   (modify) # + saveAnnotationRange sender
src/web/staleness.ts                          (new)    # host: computeStaleIds(fs, group) using isAnnotationStale
src/web/detailPanelProvider.ts                (modify) # showGroup(group, palette, staleIds); onUpdateAnnotationRange hook
src/web/extension.ts                          (modify) # compute staleIds on showGroup; wire updateAnnotationRange
src/web/test/suite/updateAnnotationRange.integration.test.ts (new)
src/web/test/suite/index.ts                   (modify)
e2e/drift.spec.ts                             (new)    # seed a stale annotation → stale banner shows
```

---

## Task 1: Pure drift helper + GroupStore.updateAnnotationRange

**Files:** Create `src/core/drift.ts`, `src/core/drift.unit.test.ts`; Modify `src/core/groupStore.ts`, `src/core/groupStore.unit.test.ts`

- [ ] **Step 1: Write the failing tests.**

`src/core/drift.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAnnotationStale } from './drift';
import { sha256Hex, anchorText } from '../shared/hash';

const file = 'l1\nl2\nl3\nl4\nl5';

describe('isAnnotationStale', () => {
  it('is false when the anchored lines still match the stored hash', async () => {
    const hash = await sha256Hex(anchorText(file, { startLine: 2, endLine: 3 }));
    expect(await isAnnotationStale(file, { startLine: 2, endLine: 3 }, hash)).toBe(false);
  });

  it('is true when the anchored lines changed', async () => {
    const hash = await sha256Hex(anchorText(file, { startLine: 2, endLine: 3 }));
    const edited = 'l1\nCHANGED\nl3\nl4\nl5';
    expect(await isAnnotationStale(edited, { startLine: 2, endLine: 3 }, hash)).toBe(true);
  });
});
```

Append to `src/core/groupStore.unit.test.ts` (inside `describe('GroupStore', …)`):

```ts
  it('updateAnnotationRange replaces range + contentHash, bumps updatedAt, persists', async () => {
    const g = group('g1');
    g.annotations.push({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'c', contentHash: 'old' });
    await store.saveGroup(g);
    const ok = await store.updateAnnotationRange('g1', 'a1', { startLine: 3, endLine: 5 }, 'newhash', 777);
    expect(ok).toBe(true);
    const r = await store.getGroup('g1');
    expect(r?.annotations[0].range).toEqual({ startLine: 3, endLine: 5 });
    expect(r?.annotations[0].contentHash).toBe('newhash');
    expect(r?.annotations[0].content).toBe('c'); // content unchanged
    expect(r?.updatedAt).toBe(777);
  });

  it('updateAnnotationRange returns false for a missing group/annotation', async () => {
    expect(await store.updateAnnotationRange('nope', 'a1', { startLine: 1, endLine: 1 }, 'h', 1)).toBe(false);
    await store.saveGroup(group('g1'));
    expect(await store.updateAnnotationRange('g1', 'missing', { startLine: 1, endLine: 1 }, 'h', 1)).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/drift.unit.test.ts src/core/groupStore.unit.test.ts`
Expected: FAIL — `./drift` unresolved; `updateAnnotationRange` not a method.

- [ ] **Step 3: Implement `src/core/drift.ts`**

```ts
import { type LineRange } from '../shared/model';
import { anchorText, sha256Hex } from '../shared/hash';

/** True if the current file's anchored lines no longer match the stored content hash. */
export async function isAnnotationStale(fileText: string, range: LineRange, contentHash: string): Promise<boolean> {
  const current = await sha256Hex(anchorText(fileText, range));
  return current !== contentHash;
}
```

- [ ] **Step 4: Add `updateAnnotationRange` to `src/core/groupStore.ts`** (after `updateAnnotation`)

```ts
  /**
   * Replace one annotation's line range + content hash (file is fixed), bump
   * updatedAt, persist. Returns false if the group/annotation does not exist.
   */
  async updateAnnotationRange(
    groupId: string,
    annotationId: string,
    range: LineRange,
    contentHash: string,
    now: number,
  ): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const index = group.annotations.findIndex((a) => a.id === annotationId);
    if (index < 0) {
      return false;
    }
    const annotations = group.annotations.map((a, i) => (i === index ? { ...a, range, contentHash } : a));
    await this.saveGroup({ ...group, annotations, updatedAt: now });
    return true;
  }
```

(Add `LineRange` to the existing import from `../shared/model`: `import { type AnnotationGroup, type LineRange, parseGroup, serializeGroup } from '../shared/model';`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/drift.unit.test.ts src/core/groupStore.unit.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 7: Commit**

```bash
git add src/core/drift.ts src/core/drift.unit.test.ts src/core/groupStore.ts src/core/groupStore.unit.test.ts
git commit -m "feat: pure drift detection + GroupStore.updateAnnotationRange"
```

---

## Task 2: Protocol + detail-state (staleIds, updateAnnotationRange)

**Files:** Modify `src/shared/protocol.ts`, `src/shared/protocol.unit.test.ts`, `src/core/detailState.ts`, `src/core/detailState.unit.test.ts`

- [ ] **Step 1: Append tests.**

In `src/shared/protocol.unit.test.ts` (inside `describe('parseDetailMessage', …)`):

```ts
  it('accepts updateAnnotationRange with id + integer lines', () => {
    expect(parseDetailMessage({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: 2, endLine: 4 })).toEqual({
      type: 'updateAnnotationRange', annotationId: 'a1', startLine: 2, endLine: 4,
    });
  });
  it('rejects updateAnnotationRange with non-number lines', () => {
    expect(parseDetailMessage({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: '2', endLine: 4 })).toBeNull();
  });
```

In `src/core/detailState.unit.test.ts`:

```ts
import { isStale } from './detailState';
// (add isStale to the existing import from './detailState')

describe('staleIds', () => {
  it('initial staleIds is empty', () => {
    expect(initialDetailState().staleIds).toEqual([]);
  });
  it('setGroup stores staleIds (defaulting to [])', () => {
    const next = applyDetailMessage(initialDetailState(), { type: 'setGroup', group: null, palette: [], staleIds: ['a1'] });
    expect(next.staleIds).toEqual(['a1']);
  });
  it('isStale checks membership', () => {
    const s = { ...initialDetailState(), staleIds: ['a1'] };
    expect(isStale(s, 'a1')).toBe(true);
    expect(isStale(s, 'a2')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `src/shared/protocol.ts`.** Add an **optional** `staleIds` to `HostToDetail` (optional so existing `setGroup` literals in tests don't break type-check; the provider always supplies it):

```ts
export type HostToDetail = {
  type: 'setGroup';
  group: AnnotationGroup | null;
  palette: TagColor[];
  staleIds?: string[];
};
```

Add to `DetailToHost`:
```ts
  | { type: 'updateAnnotationRange'; annotationId: string; startLine: number; endLine: number }
```

Add to `parseDetailMessage` (before `default`):
```ts
    case 'updateAnnotationRange':
      return typeof raw.annotationId === 'string' &&
        typeof raw.startLine === 'number' &&
        typeof raw.endLine === 'number'
        ? { type: 'updateAnnotationRange', annotationId: raw.annotationId, startLine: raw.startLine, endLine: raw.endLine }
        : null;
```

- [ ] **Step 4: Extend `src/core/detailState.ts`.** Add `staleIds` to `DetailState`:

```ts
export interface DetailState {
  group: AnnotationGroup | null;
  palette: TagColor[];
  selectedAnnotationId: string | null;
  mode: 'group' | 'annotation';
  staleIds: string[];
}
```

`initialDetailState` adds `staleIds: []`. In `applyDetailMessage`'s `setGroup` branch, add `staleIds: message.staleIds ?? []` to BOTH returned objects (the `keep` and reset branches). Add a helper:

```ts
/** Whether the annotation `id` is flagged stale in this state. */
export function isStale(state: DetailState, id: string): boolean {
  return state.staleIds.includes(id);
}
```

- [ ] **Step 5: Run to verify pass + full suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types 0; all green. (Existing `detail.set({...})` literals that omit `staleIds` still work: `applyDetailMessage` isn't called on them, and the components read `$detail.staleIds ?? []` — added in Task 4 — but `initialDetailState()` now provides `[]`. If any non-`.svelte.test.ts` literal of `DetailState` lacks `staleIds` and breaks check-types, add `staleIds: []` to it.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts src/core/detailState.ts src/core/detailState.unit.test.ts
git commit -m "feat: staleIds in setGroup + updateAnnotationRange message + isStale helper"
```

---

## Task 3: Webview — stale dot, stale banner, editable range

**Files:** Modify `src/webview/detail/AnnotationRow.svelte`(+test), `AnnotationView.svelte`(+test), `GroupView.svelte`(+test), `DetailApp.svelte`, `state.ts`

- [ ] **Step 1: AnnotationRow — add `stale?` prop + amber dot.** Add to its `$props()`: `stale?: boolean` (default false). In the markup, before `.summary`, add a dot shown when stale:

```svelte
  {#if stale}<span class="stale-dot" data-testid="stale-dot" title="Lines changed since this was written">●</span>{/if}
```
and a style: `.stale-dot { color: var(--vscode-editorWarning-foreground, #f39c12); font-size: 9px; }`. Update its props type to include `stale?: boolean`.

Append to `AnnotationRow.svelte.test.ts`:
```ts
  it('shows a stale dot when stale', () => {
    render(AnnotationRow, { annotation: annotation('hi'), stale: true });
    expect(screen.getByTestId('stale-dot')).toBeInTheDocument();
  });
  it('has no stale dot by default', () => {
    render(AnnotationRow, { annotation: annotation('hi') });
    expect(screen.queryByTestId('stale-dot')).toBeNull();
  });
```

- [ ] **Step 2: AnnotationView — stale banner + editable range.** Add props `stale?: boolean` (default false) and `onsaverange?: (id: string, startLine: number, endLine: number) => void`. Add local edit state for the range. In the markup:
  - A banner when `stale`:
    ```svelte
    {#if stale}<div class="stale-banner" data-testid="stale-banner">⚠ Lines changed since this was written — content may no longer match.</div>{/if}
    ```
  - Make the range (currently part of `annotation-loc`) editable: keep `annotation-loc` showing `{annotation.file}:` then two number inputs + a save button, OR a compact "edit range" toggle. Implement a simple inline editor: show the location text with an `edit-range-btn`; when editing, show `start`/`end` number inputs (`data-testid="range-start"`/`range-end`) + `save-range-btn` that calls `onsaverange(annotation.id, start, end)` and exits edit mode.

  Replace the `<div class="bar">` location area with:
  ```svelte
  <div class="bar">
    <button type="button" class="link" data-testid="back-btn" onclick={() => onback?.()}>‹ Back</button>
    {#if editingRange}
      <span class="loc">{annotation.file}:
        <input class="num" data-testid="range-start" type="number" min="1" bind:value={rangeStart} />–<input class="num" data-testid="range-end" type="number" min="1" bind:value={rangeEnd} />
      </span>
      <button type="button" class="link" data-testid="save-range-btn" onclick={saveRange}>save</button>
    {:else}
      <span class="loc" data-testid="annotation-loc">{location}</span>
      <button type="button" class="link" data-testid="edit-range-btn" onclick={startRangeEdit}>edit range</button>
    {/if}
    <button type="button" class="link" data-testid="copy-loc-btn" onclick={() => oncopyloc?.(location)}>⧉ path</button>
  </div>
  ```
  Script additions (use `untrack` for seed-once like the existing editing/draft):
  ```ts
  import { untrack } from 'svelte';
  let editingRange = $state(false);
  let rangeStart = $state(untrack(() => annotation.range.startLine));
  let rangeEnd = $state(untrack(() => annotation.range.endLine));
  function startRangeEdit(): void { rangeStart = annotation.range.startLine; rangeEnd = annotation.range.endLine; editingRange = true; }
  function saveRange(): void {
    const s = Math.max(1, Math.floor(Number(rangeStart) || 1));
    const e = Math.max(s, Math.floor(Number(rangeEnd) || s));
    editingRange = false;
    onsaverange?.(annotation.id, s, e);
  }
  ```
  (If `untrack` is already imported in AnnotationView from the earlier fix, don't re-import.) Add styles for `.num { width: 42px; }` and `.stale-banner { background: #3a2f12; color: #f0c674; font-size: 11px; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; }`.

  Append to `AnnotationView.svelte.test.ts`:
  ```ts
  it('shows the stale banner when stale', () => {
    render(AnnotationView, { annotation: annotation('# Note'), stale: true });
    expect(screen.getByTestId('stale-banner')).toBeInTheDocument();
  });
  it('edits the range and calls onsaverange', async () => {
    const onsaverange = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), onsaverange });
    await userEvent.click(screen.getByTestId('edit-range-btn'));
    const start = screen.getByTestId('range-start') as HTMLInputElement;
    await userEvent.clear(start); await userEvent.type(start, '5');
    const end = screen.getByTestId('range-end') as HTMLInputElement;
    await userEvent.clear(end); await userEvent.type(end, '9');
    await userEvent.click(screen.getByTestId('save-range-btn'));
    expect(onsaverange).toHaveBeenCalledWith('a1', 5, 9);
  });
  ```

- [ ] **Step 3: GroupView — pass per-row stale.** Add prop `staleIds?: string[]` (default `[]`). On each `<AnnotationRow>`, add `stale={staleIds.includes(annotation.id)}`. Append a test asserting a row shows the dot when its id is in `staleIds`:
  ```ts
  it('marks a row stale when its id is in staleIds', () => {
    render(GroupView, { group: group(), palette, staleIds: ['a1'] });
    expect(screen.getByTestId('stale-dot')).toBeInTheDocument();
  });
  ```

- [ ] **Step 4: state.ts — add the range sender:**
```ts
/** Persist an annotation's edited line range (host recomputes the hash). */
export function saveAnnotationRange(annotationId: string, startLine: number, endLine: number): void {
  postToHost({ type: 'updateAnnotationRange', annotationId, startLine, endLine });
}
```

- [ ] **Step 5: DetailApp — wire staleIds + range save + banner.** In `<script>`, add `saveAnnotationRange` to the `./state` import. Pass `staleIds={$detail.staleIds ?? []}` to `<GroupView>`. In the annotation-mode branch, pass to `<AnnotationView>`: `stale={($detail.staleIds ?? []).includes(current.id)}` and `onsaverange={(id, s, e) => saveAnnotationRange(id, s, e)}`.

- [ ] **Step 6: Run component + unit + build**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 7: Commit**

```bash
git add src/webview/detail/AnnotationRow.svelte src/webview/detail/AnnotationRow.svelte.test.ts src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts src/webview/detail/DetailApp.svelte src/webview/detail/state.ts
git commit -m "feat: stale dot/banner + editable line range in the detail webview"
```

---

## Task 4: Host wiring (compute staleIds + range update)

**Files:** Create `src/web/staleness.ts`; Modify `src/web/detailPanelProvider.ts`, `src/web/extension.ts`

- [ ] **Step 1: Create `src/web/staleness.ts`**

```ts
import { type AnnotationGroup } from '../shared/model';
import { type FileSystem } from '../core/fileSystem';
import { isAnnotationStale } from '../core/drift';

const dec = new TextDecoder();

/** Ids of annotations whose anchored lines no longer match their stored hash (or whose file is gone). */
export async function computeStaleIds(fs: FileSystem, group: AnnotationGroup): Promise<string[]> {
  const stale: string[] = [];
  for (const annotation of group.annotations) {
    try {
      const fileText = dec.decode(await fs.readFile(annotation.file));
      if (await isAnnotationStale(fileText, annotation.range, annotation.contentHash)) {
        stale.push(annotation.id);
      }
    } catch {
      stale.push(annotation.id); // file missing/unreadable → treat as stale
    }
  }
  return stale;
}
```

- [ ] **Step 2: `detailPanelProvider.ts` — `showGroup` takes staleIds; add range hook.** Change `showGroup` to `showGroup(group, palette, staleIds: string[] = [])`, store `this.staleIds = staleIds` (add a private field, default `[]`), and include it in `post()`'s message (`{ type:'setGroup', group: this.group, palette: this.palette, staleIds: this.staleIds }`). Add a public hook + message branch:

```ts
  /** Set by the extension: persist an annotation's edited line range. */
  public onUpdateAnnotationRange?: (groupId: string, annotationId: string, startLine: number, endLine: number) => void;
```
In `onDidReceiveMessage`, after `updateAnnotation`:
```ts
      } else if (message.type === 'updateAnnotationRange') {
        if (this.group) {
          this.onUpdateAnnotationRange?.(this.group.id, message.annotationId, message.startLine, message.endLine);
        }
```

- [ ] **Step 3: `extension.ts` — compute staleIds on every detail post; wire range update.** Add imports: `import { computeStaleIds } from './staleness';`, `import { sha256Hex, anchorText } from '../shared/hash';`. Change the `showGroup`/`reloadDetail` helper so it computes staleIds:

```ts
  const showGroupWithStale = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const group = await new GroupStore(fs).getGroup(groupId);
    const staleIds = group ? await computeStaleIds(fs, group) : [];
    detailProvider.showGroup(group, readTagPalette(), staleIds);
  };
```
Replace `reloadDetail(groupId)` calls (and the `provider.onSelectGroup` body's `showGroup` call) to use `showGroupWithStale(groupId)`. (In `onSelectGroup`, after computing nothing else, call `await showGroupWithStale(groupId)` then `executeCommand('annotated.detail.focus')`. In `patchGroup`/`onUpdateAnnotation`, replace the reload with `await showGroupWithStale(groupId)`.)

Wire the range update hook:
```ts
  detailProvider.onUpdateAnnotationRange = async (groupId, annotationId, startLine, endLine): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const group = await store.getGroup(groupId);
    const annotation = group?.annotations.find((a) => a.id === annotationId);
    if (!annotation) {
      return;
    }
    const range = { startLine, endLine };
    let contentHash = annotation.contentHash;
    try {
      const fileText = new TextDecoder().decode(await fs.readFile(annotation.file));
      contentHash = await sha256Hex(anchorText(fileText, range));
    } catch {
      // file unreadable — keep the old hash (the row will show stale)
    }
    const ok = await store.updateAnnotationRange(groupId, annotationId, range, contentHash, Math.floor(Date.now() / 1000));
    if (ok) {
      await showGroupWithStale(groupId);
    }
  };
```

(Keep all existing wiring; just route detail re-posts through `showGroupWithStale`. `VscodeFileSystem`/`GroupStore`/`readTagPalette` already imported.)

- [ ] **Step 4: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 5: Commit**

```bash
git add src/web/staleness.ts src/web/detailPanelProvider.ts src/web/extension.ts
git commit -m "feat: host computes staleIds + persists annotation range edits (re-anchoring the hash)"
```

---

## Task 5: Integration + e2e + full suite

**Files:** Create `src/web/test/suite/updateAnnotationRange.integration.test.ts`, `e2e/drift.spec.ts`; Modify `src/web/test/suite/index.ts`, `test-workspace/.annotations/groups/seed-group.json`

- [ ] **Step 1: Integration test** — `src/web/test/suite/updateAnnotationRange.integration.test.ts`

```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateAnnotationRange (vscode.workspace.fs)', () => {
  test('persists a new range + content hash', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'rng-itest', title: 'R', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'README.md', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'old' }],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.updateAnnotationRange('rng-itest', 'a1', { startLine: 2, endLine: 3 }, 'newhash', 9);
      if (!ok) {
        throw new Error('updateAnnotationRange returned false');
      }
      const r = await store.getGroup('rng-itest');
      if (r?.annotations[0]?.range.endLine !== 3 || r?.annotations[0]?.contentHash !== 'newhash') {
        throw new Error(`range/hash not persisted: ${JSON.stringify(r?.annotations[0])}`);
      }
    } finally {
      await store.deleteGroup('rng-itest');
    }
  });
});
```

- [ ] **Step 2: Import it in `index.ts`** — add `import('./updateAnnotationRange.integration.test')` to the `Promise.all([...])`.

- [ ] **Step 3: Make the seed annotation stale.** The seed annotation (`seed-group.json`) points at `README.md` line 1 with `contentHash: "seed"` (a placeholder that will NOT match the real SHA of README.md line 1) — so it is **already stale**, which is what the drift e2e needs. Confirm `test-workspace/.annotations/groups/seed-group.json`'s annotation has `contentHash: "seed"` (it does). No change needed — just rely on it.

- [ ] **Step 4: Create `e2e/drift.spec.ts`** — open the seeded annotation and assert the stale banner:

```ts
import { test, expect } from '@playwright/test';

test('a stale annotation shows the stale banner', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  // The seed annotation's stored contentHash ("seed") doesn't match README.md → stale dot in the list.
  await expect(detail.getByTestId('stale-dot')).toBeVisible({ timeout: 30_000 });
  // Open it → stale banner in the annotation view.
  await detail.getByTestId('annotation-row').click();
  await expect(detail.getByTestId('stale-banner')).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 5: Run the e2e**

Run (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:e2e`
Expected: 6 passed — the 5 existing + `drift.spec`.

> If the stale dot/banner doesn't show: the host computes staleIds in `showGroupWithStale` by reading each annotation's file. The seed annotation's file `README.md` exists with content not matching hash `"seed"` → stale. Verify `computeStaleIds` runs on `onSelectGroup`. If `README.md` can't be read in the mount, the catch also marks it stale → banner still shows. Keep the assertion meaningful.

- [ ] **Step 6: Full suite (Definition of Done)**

Run (same settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**8 passing**) → `test:e2e` (**6 passed**) all green.

- [ ] **Step 7: Commit**

```bash
git add src/web/test/suite/updateAnnotationRange.integration.test.ts src/web/test/suite/index.ts e2e/drift.spec.ts
git commit -m "test: updateAnnotationRange integration + drift (stale banner) e2e"
```

---

## Phase 2b Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (drift, updateAnnotationRange, staleIds, stale UI + earlier suites).
- [ ] `npm run test:integration` passes — **8 passing**.
- [ ] `npm run test:e2e` passes — **6 passed** (incl. drift/stale banner).
- [ ] All work committed on the `phase-2` branch.
- [ ] Manual sanity (optional): an annotation whose code changed shows the amber dot + banner; editing its range re-anchors (the banner clears if the new range matches; edit content/range round-trips).

Next in Phase 2: **2c** — sidebar filters (tag/author) + show-resolved checkbox. Then **2d** — drag-reorder annotations + Next/Previous navigation. After 2d, Phase 2 is complete → merge `phase-2` → `main`.
```
