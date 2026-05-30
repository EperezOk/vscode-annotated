# vscode-annotated — Phase 2d: Drag-Reorder Annotations + Prev/Next Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (a) **Drag-reorder** annotations within a group (the array order is the display order; reordering rewrites and persists it), and (b) a prominent **Prev / Next** navigation bar in the annotation view with an `n / total` position indicator, so users can step through a group's annotations.

**Architecture:** Annotation order = `group.annotations` array order (no explicit `order` field). Reordering is host-persisted: the webview computes the new id order on drop and posts a `reorderAnnotations` message; the host calls a new permutation-guarded `GroupStore.reorderAnnotations` and re-posts `setGroup`. Prev/Next is pure: `nextAnnotationId`/`prevAnnotationId`/`annotationPosition` derive neighbors from `DetailState`; `DetailApp` passes `onprev`/`onnext`/`position` into `AnnotationView`, reusing the existing navigate-to-code path. Native HTML5 drag-and-drop (no library); a pure `moveBefore` helper does the array math.

**Tech Stack:** TypeScript + Svelte 5 runes. Builds on Phase 1 + 2a + 2b + 2c. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-2` (already checked out — Phase 2 sub-plans accumulate here per CLAUDE.md); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + Bash `timeout: 600000` and `pkill -f vscode-test-web || true` first.

---

## Context (exact current shapes)

- `src/shared/model.ts` — `Annotation { id, file, range, content, contentHash }`; `AnnotationGroup { …, annotations: Annotation[] }`. **Array order is canonical**; `parseGroup` preserves it; `serializeGroup` = `JSON.stringify(group, null, 2)`.
- `src/core/groupStore.ts` — methods: `listGroups`, `getGroup`, `saveGroup` (whole-file write via `this.fs.writeFile(this.path(group.id), enc.encode(serializeGroup(group)))`), `deleteGroup`, `updateAnnotation`, `updateAnnotationRange`, `updateGroup`. Each mutator loads via `getGroup`, returns `false` if missing, `saveGroup`s with `updatedAt: now`, returns `true`.
- `src/shared/protocol.ts` — `DetailToHost` union ends with `| { type: 'updateAnnotationRange'; annotationId: string; startLine: number; endLine: number }`. `parseDetailMessage` is a `switch (raw.type)` with a `case 'updateAnnotationRange'` validating types and returning the typed object or `null`.
- `src/core/detailState.ts` — `DetailState { group, palette, selectedAnnotationId, mode, staleIds }`; helpers `isStale`, `openAnnotation`, `backToGroup`, `oneLine`. The `setGroup` branch keeps the selection if the annotation still exists.
- `src/webview/detail/DetailApp.svelte` — imports senders from `./state` (`detail, openAnnotationView, showGroupView, saveAnnotationContent, copyToClipboard, renameGroup, requestEditTags, requestEditGitRef, saveAnnotationRange`). Has `function openRow(id) { openAnnotationView(id); postToHost({ type: 'selectAnnotation', annotationId: id }); }` and `const current = $derived($detail.group?.annotations.find((a) => a.id === $detail.selectedAnnotationId) ?? null)`. Renders empty / `{#key $detail.selectedAnnotationId}<AnnotationView … />{/key}` / `<GroupView … onselectrow={openRow} />`.
- `src/webview/detail/GroupView.svelte` — props `{ group, palette, staleIds, onrename, onedittags, oneditgitref, onselectrow }`. Renders `<div class="rows">{#each group.annotations as annotation (annotation.id)}<AnnotationRow {annotation} selected={false} stale={staleIds.includes(annotation.id)} onselect={(id) => onselectrow?.(id)} />{/each}</div>`.
- `src/webview/detail/AnnotationRow.svelte` — a `<button class="row" data-testid="annotation-row" onclick={() => onselect?.(annotation.id)}>` with stale-dot + summary + loc. Props `{ annotation, selected?, stale?, onselect? }`.
- `src/webview/detail/AnnotationView.svelte` — props `{ annotation, stale?, onback?, onsave?, oncopy?, oncopyloc?, onsaverange? }`. Has a `.bar` (back-btn / loc / edit-range / copy-loc), a stale-banner, a `.toolbar` (edit/save + copy-md), then editor/preview. Already imports `untrack`.
- `src/webview/detail/state.ts` — `detail` store + `handleHostMessage`, `openAnnotationView`, `showGroupView`, `saveAnnotationContent`, `copyToClipboard`, `renameGroup`, `requestEditTags`, `requestEditGitRef`, `saveAnnotationRange`. Senders post via `postToHost`.
- `src/web/detailPanelProvider.ts` — `onDidReceiveMessage` is an `if/else if` chain over `message.type` (`ready`/`selectAnnotation`/`updateAnnotation`/`updateAnnotationRange`/`copyText`/`setGroupTitle`/`editTags`/`editGitRef`), each guarded by `if (this.group)`. Public hooks: `onSelectAnnotation`, `onUpdateAnnotation`, `onUpdateAnnotationRange`, `onSetGroupTitle`, `onEditTags`, `onEditGitRef`. `showGroup(group, palette, staleIds=[])` stores + `post()`.
- `src/web/extension.ts` — `now = () => Math.floor(Date.now() / 1000)`; `showGroupWithStale(groupId)`; hooks wired as `detailProvider.onUpdateAnnotation = async (groupId, annotationId, content) => { … store.updateAnnotation(…, now()); if (ok) await showGroupWithStale(groupId); }` etc.
- Seed: `test-workspace/.annotations/groups/seed-group.json` (open, **single annotation** — `drift.spec`/`sidebar.spec` rely on exactly one visible card with one row, do NOT change it); `test-workspace/.annotations/groups/seed-resolved.json` (resolved → hidden by default; currently one annotation `r1`).

---

## Design notes (decisions)

- **Reorder = permutation only.** `GroupStore.reorderAnnotations(groupId, orderedIds, now)` persists only when `orderedIds` is a permutation of the group's existing ids (same length, every id present) — otherwise returns `false`, guarding against loss/injection.
- **Drop-before semantics.** Dropping the dragged row onto a target inserts it immediately **before** the target. `moveBefore(ids, moved, target)` is the pure helper; if `moved === target` it's a no-op, if `target` is missing the moved id goes to the end.
- **No optimistic UI.** Like content/range edits, the webview posts and waits for the host's `setGroup` re-post to re-render — consistent and simple. (The reorder is local-FS fast.)
- **Native HTML5 DnD, no library.** `GroupView` wraps each row in a `draggable` div that tracks `draggedId` on `dragstart` and calls a `dropOn(targetId)` on `drop` (with `dragover` `preventDefault`). No `dataTransfer` dependency → testable with `fireEvent` in jsdom.
- **No reorder e2e.** Native drag-and-drop inside nested VSCode webview iframes is flaky under Playwright. Reorder is covered by **unit** (`moveBefore`, `GroupStore.reorderAnnotations`), **component** (`GroupView` fireEvent drag → `onreorder` called), and **integration** (store round-trip). This is a deliberate coverage choice, not an omission.
- **Prev/Next** reuses `DetailApp.openRow` (which both opens the annotation view and posts `selectAnnotation` for navigate-to-code). Buttons are disabled at the ends (handler is `undefined`). The position indicator shows `current / total` (1-based).
- **Deferred:** the `Annotated: Next/Previous Annotation` keyboard commands (spec §commands) are out of scope here — they need a host→webview `navigate` message. The in-panel buttons fully deliver Next/Previous navigation. Tracked in the backlog below.

---

## File Structure (2d)

```
src/shared/protocol.ts                            (modify) # DetailToHost += reorderAnnotations; parse case
src/shared/protocol.unit.test.ts                  (modify)
src/core/detailState.ts                           (modify) # + moveBefore, selectedAnnotationIndex, next/prevAnnotationId, annotationPosition
src/core/detailState.unit.test.ts                 (modify)
src/core/groupStore.ts                            (modify) # + reorderAnnotations(groupId, orderedIds, now)
src/core/groupStore.unit.test.ts                  (modify)
src/webview/detail/AnnotationView.svelte          (modify) # + Prev/Next nav bar + position
src/webview/detail/AnnotationView.svelte.test.ts  (modify)
src/webview/detail/state.ts                       (modify) # + reorderAnnotations sender
src/webview/detail/DetailApp.svelte               (modify) # wire prev/next/position + onreorder
src/webview/detail/GroupView.svelte               (modify) # drag-reorder UI + dropOn(moveBefore)
src/webview/detail/GroupView.svelte.test.ts       (modify)
src/web/detailPanelProvider.ts                    (modify) # onReorderAnnotations hook + handler branch
src/web/extension.ts                              (modify) # wire onReorderAnnotations (persist + refresh)
src/web/test/suite/reorderAnnotations.integration.test.ts (new)
src/web/test/suite/index.ts                       (modify)
test-workspace/.annotations/groups/seed-resolved.json (modify) # → 3 annotations for the nav e2e
e2e/navigate.spec.ts                              (new)    # Prev/Next via the resolved multi-annotation group
```

---

## Task 1: Protocol + pure helpers + GroupStore.reorderAnnotations

**Files:** Modify `src/shared/protocol.ts`(+test), `src/core/detailState.ts`(+test), `src/core/groupStore.ts`(+test)

- [ ] **Step 1: Append tests.**

In `src/shared/protocol.unit.test.ts` (inside the `parseDetailMessage` describe):
```ts
  it('accepts reorderAnnotations with a string[] of ids', () => {
    expect(parseDetailMessage({ type: 'reorderAnnotations', annotationIds: ['a1', 'a2'] })).toEqual({
      type: 'reorderAnnotations', annotationIds: ['a1', 'a2'],
    });
  });
  it('rejects reorderAnnotations with non-string ids or a non-array', () => {
    expect(parseDetailMessage({ type: 'reorderAnnotations', annotationIds: ['a1', 2] })).toBeNull();
    expect(parseDetailMessage({ type: 'reorderAnnotations', annotationIds: 'a1' })).toBeNull();
  });
```

In `src/core/detailState.unit.test.ts` — add `moveBefore, selectedAnnotationIndex, nextAnnotationId, prevAnnotationId, annotationPosition` to the existing import from `./detailState`, then append. The file already has a `group()` factory with one annotation `a1`; add a local helper that yields three:
```ts
function group3(): AnnotationGroup {
  return {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
    annotations: [
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
      { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
      { id: 'a3', file: 'x.ts', range: { startLine: 3, endLine: 3 }, content: '', contentHash: 'h' },
    ],
  };
}

describe('moveBefore', () => {
  it('moves an item up (before an earlier target)', () => {
    expect(moveBefore(['a1', 'a2', 'a3'], 'a3', 'a1')).toEqual(['a3', 'a1', 'a2']);
  });
  it('moves an item down (before a later target)', () => {
    expect(moveBefore(['a1', 'a2', 'a3'], 'a1', 'a3')).toEqual(['a2', 'a1', 'a3']);
  });
  it('is a no-op when moved === target', () => {
    expect(moveBefore(['a1', 'a2'], 'a1', 'a1')).toEqual(['a1', 'a2']);
  });
  it('appends the moved id when the target is missing', () => {
    expect(moveBefore(['a1', 'a2'], 'a1', 'zzz')).toEqual(['a2', 'a1']);
  });
});

describe('annotation navigation', () => {
  it('selectedAnnotationIndex finds the current annotation', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(selectedAnnotationIndex(state)).toBe(1);
  });
  it('nextAnnotationId returns the next id, null at the end', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(nextAnnotationId(state)).toBe('a3');
    expect(nextAnnotationId({ ...state, selectedAnnotationId: 'a3' })).toBeNull();
  });
  it('prevAnnotationId returns the previous id, null at the start', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(prevAnnotationId(state)).toBe('a1');
    expect(prevAnnotationId({ ...state, selectedAnnotationId: 'a1' })).toBeNull();
  });
  it('annotationPosition is 1-based with the total, or null when unselected', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(annotationPosition(state)).toEqual({ current: 2, total: 3 });
    expect(annotationPosition(initialDetailState())).toBeNull();
  });
});
```
(`AnnotationGroup` is likely already imported in this test file; if not, add `import { type AnnotationGroup } from '../shared/model';`.)

Append to `src/core/groupStore.unit.test.ts` (inside `describe('GroupStore', …)`, using its existing `group(id)` factory + `store`):
```ts
  it('reorderAnnotations rewrites the array order, bumps updatedAt, persists', async () => {
    const g = group('g1');
    g.annotations.push(
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'c1', contentHash: 'h' },
      { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: 'c2', contentHash: 'h' },
      { id: 'a3', file: 'x.ts', range: { startLine: 3, endLine: 3 }, content: 'c3', contentHash: 'h' },
    );
    await store.saveGroup(g);
    const ok = await store.reorderAnnotations('g1', ['a3', 'a1', 'a2'], 555);
    expect(ok).toBe(true);
    const r = await store.getGroup('g1');
    expect(r?.annotations.map((a) => a.id)).toEqual(['a3', 'a1', 'a2']);
    expect(r?.updatedAt).toBe(555);
  });

  it('reorderAnnotations rejects a non-permutation (missing/extra/duplicate ids)', async () => {
    const g = group('g1');
    g.annotations.push(
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
      { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
    );
    await store.saveGroup(g);
    expect(await store.reorderAnnotations('g1', ['a1'], 1)).toBe(false);          // wrong length
    expect(await store.reorderAnnotations('g1', ['a1', 'zzz'], 1)).toBe(false);   // unknown id
    expect(await store.reorderAnnotations('g1', ['a1', 'a1'], 1)).toBe(false);    // duplicate
    expect(await store.reorderAnnotations('missing', ['a1', 'a2'], 1)).toBe(false); // no group
    const r = await store.getGroup('g1');
    expect(r?.annotations.map((a) => a.id)).toEqual(['a1', 'a2']); // unchanged
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts src/core/groupStore.unit.test.ts`
Expected: FAIL — no `reorderAnnotations` parse case; helpers undefined; `store.reorderAnnotations` not a function. Report output.

- [ ] **Step 3: Extend `src/shared/protocol.ts`.** Add to the `DetailToHost` union:
```ts
  | { type: 'reorderAnnotations'; annotationIds: string[] }
```
Add to `parseDetailMessage`'s switch (before `default`):
```ts
    case 'reorderAnnotations':
      return Array.isArray(raw.annotationIds) && raw.annotationIds.every((id) => typeof id === 'string')
        ? { type: 'reorderAnnotations', annotationIds: raw.annotationIds as string[] }
        : null;
```
(Mirror how sibling cases access `raw` — if the file casts `raw` to a record type, follow that. The `as string[]` keeps the return type precise after the `every` guard.)

- [ ] **Step 4: Extend `src/core/detailState.ts`.** Append after the existing helpers:
```ts
/** Reorder ids by removing `moved` and inserting it immediately before `target`. */
export function moveBefore(ids: string[], moved: string, target: string): string[] {
  if (moved === target) {
    return [...ids];
  }
  const without = ids.filter((id) => id !== moved);
  const index = without.indexOf(target);
  if (index < 0) {
    return [...without, moved];
  }
  return [...without.slice(0, index), moved, ...without.slice(index)];
}

/** Index of the selected annotation in the group, or -1. */
export function selectedAnnotationIndex(state: DetailState): number {
  if (!state.group || state.selectedAnnotationId === null) {
    return -1;
  }
  return state.group.annotations.findIndex((a) => a.id === state.selectedAnnotationId);
}

/** Id of the annotation after the selected one, or null at the end. */
export function nextAnnotationId(state: DetailState): string | null {
  const index = selectedAnnotationIndex(state);
  if (index < 0 || !state.group) {
    return null;
  }
  const next = state.group.annotations[index + 1];
  return next ? next.id : null;
}

/** Id of the annotation before the selected one, or null at the start. */
export function prevAnnotationId(state: DetailState): string | null {
  const index = selectedAnnotationIndex(state);
  if (index <= 0 || !state.group) {
    return null;
  }
  return state.group.annotations[index - 1].id;
}

/** 1-based position of the selected annotation + the group total, or null. */
export function annotationPosition(state: DetailState): { current: number; total: number } | null {
  const index = selectedAnnotationIndex(state);
  if (index < 0 || !state.group) {
    return null;
  }
  return { current: index + 1, total: state.group.annotations.length };
}
```

- [ ] **Step 5: Add `reorderAnnotations` to `src/core/groupStore.ts`** (after `updateAnnotationRange`):
```ts
  /**
   * Rewrite the annotation order to match `orderedIds`. Persists only when
   * `orderedIds` is a permutation of the group's existing annotation ids
   * (same length, every id present exactly once). Returns false otherwise.
   */
  async reorderAnnotations(groupId: string, orderedIds: string[], now: number): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const byId = new Map(group.annotations.map((a) => [a.id, a]));
    const unique = new Set(orderedIds);
    if (orderedIds.length !== group.annotations.length || unique.size !== orderedIds.length) {
      return false;
    }
    if (!orderedIds.every((id) => byId.has(id))) {
      return false;
    }
    const annotations = orderedIds.map((id) => byId.get(id)!);
    await this.saveGroup({ ...group, annotations, updatedAt: now });
    return true;
  }
```

- [ ] **Step 6: Run pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts src/core/groupStore.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types exit 0; all unit green.

- [ ] **Step 7: Commit**
```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts src/core/detailState.ts src/core/detailState.unit.test.ts src/core/groupStore.ts src/core/groupStore.unit.test.ts
git commit -m "feat: reorder protocol/helpers + GroupStore.reorderAnnotations + annotation nav helpers"
```

---

## Task 2: AnnotationView Prev/Next bar + DetailApp nav wiring

**Files:** Modify `src/webview/detail/AnnotationView.svelte`(+test), `src/webview/detail/DetailApp.svelte`

- [ ] **Step 1: Append AnnotationView tests.** In `src/webview/detail/AnnotationView.svelte.test.ts` (keep the existing `vi.mock('./MarkdownEditor.svelte', …)` and `annotation(content)` factory):
```ts
  it('shows the position indicator and fires onprev/onnext', async () => {
    const onprev = vi.fn();
    const onnext = vi.fn();
    render(AnnotationView, { annotation: annotation('# N'), position: { current: 2, total: 3 }, onprev, onnext });
    expect(screen.getByTestId('position-info')).toHaveTextContent('2 / 3');
    await userEvent.click(screen.getByTestId('next-btn'));
    expect(onnext).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('prev-btn'));
    expect(onprev).toHaveBeenCalled();
  });
  it('disables prev/next when no handler is given (ends of the list)', () => {
    render(AnnotationView, { annotation: annotation('# N'), position: { current: 1, total: 1 } });
    expect(screen.getByTestId('prev-btn')).toBeDisabled();
    expect(screen.getByTestId('next-btn')).toBeDisabled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — no `position-info`/`prev-btn`/`next-btn`.

- [ ] **Step 3: Update `AnnotationView.svelte`.** Add to the `$props()` destructure + its type:
```ts
    onprev,
    onnext,
    position,
```
```ts
    onprev?: () => void;
    onnext?: () => void;
    position?: { current: number; total: number };
```
Insert the nav bar immediately after the closing `</div>` of `<div class="bar">` (before the stale banner):
```svelte
  <div class="nav" data-testid="nav-bar">
    <button type="button" class="nav-btn" data-testid="prev-btn" disabled={!onprev} onclick={() => onprev?.()}>‹ Prev</button>
    <span class="position" data-testid="position-info">{position?.current ?? 0} / {position?.total ?? 0}</span>
    <button type="button" class="nav-btn" data-testid="next-btn" disabled={!onnext} onclick={() => onnext?.()}>Next ›</button>
  </div>
```
Add styles (large, comfortable buttons):
```css
  .nav { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .nav-btn { flex: 1; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); border: none; border-radius: 4px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
  .nav-btn:disabled { opacity: 0.4; cursor: default; }
  .position { font-size: 12px; color: var(--vscode-descriptionForeground, #9a9a9a); min-width: 48px; text-align: center; }
```

- [ ] **Step 4: Run to verify the AnnotationView tests pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `DetailApp.svelte`.** Add a new import line: `import { prevAnnotationId, nextAnnotationId, annotationPosition } from '../../core/detailState';` (DetailApp doesn't import from core yet). Add derived values in `<script>` (after `current`):
```ts
  const prevId = $derived(prevAnnotationId($detail));
  const nextId = $derived(nextAnnotationId($detail));
  const position = $derived(annotationPosition($detail));
```
Then pass to `<AnnotationView>` inside the `{#key}` block:
```svelte
        position={position}
        onprev={prevId ? () => openRow(prevId) : undefined}
        onnext={nextId ? () => openRow(nextId) : undefined}
```
(`openRow` already exists and both navigates the view and posts `selectAnnotation` for navigate-to-code. Keep all existing AnnotationView props.)

- [ ] **Step 6: Run component + unit + check-types + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 7: Commit**
```bash
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts src/webview/detail/DetailApp.svelte
git commit -m "feat: Prev/Next navigation bar in the annotation view"
```

---

## Task 3: GroupView drag-reorder + reorder sender

**Files:** Modify `src/webview/detail/GroupView.svelte`(+test), `src/webview/detail/state.ts`, `src/webview/detail/DetailApp.svelte`

- [ ] **Step 1: Append a GroupView drag test.** In `src/webview/detail/GroupView.svelte.test.ts`, add `fireEvent` to the `@testing-library/svelte` import (it currently imports `render, screen`). Add a local 3-annotation factory and tests:
```ts
  function group3(): AnnotationGroup {
    return {
      id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
      annotations: [
        { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'one', contentHash: 'h' },
        { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: 'two', contentHash: 'h' },
        { id: 'a3', file: 'x.ts', range: { startLine: 3, endLine: 3 }, content: 'three', contentHash: 'h' },
      ],
    };
  }

  it('reorders via drag-and-drop and calls onreorder with the new id order', async () => {
    const onreorder = vi.fn();
    render(GroupView, { group: group3(), palette, onreorder });
    const handles = screen.getAllByTestId('annotation-drag');
    await fireEvent.dragStart(handles[2]); // drag a3
    await fireEvent.drop(handles[0]);      // drop before a1
    expect(onreorder).toHaveBeenCalledWith(['a3', 'a1', 'a2']);
  });
  it('does not call onreorder when dropped on itself', async () => {
    const onreorder = vi.fn();
    render(GroupView, { group: group3(), palette, onreorder });
    const handles = screen.getAllByTestId('annotation-drag');
    await fireEvent.dragStart(handles[1]);
    await fireEvent.drop(handles[1]);
    expect(onreorder).not.toHaveBeenCalled();
  });
```
(`AnnotationGroup` is likely already imported in this test file; if not, add the import. `palette` and the existing `group()` factory remain in use by the existing tests.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/GroupView.svelte.test.ts`
Expected: FAIL — no `annotation-drag` handle; `onreorder` never called.

- [ ] **Step 3: Update `GroupView.svelte`.** Add to `<script>`:
```ts
  import { moveBefore } from '../../core/detailState';
```
Add `onreorder` to the `$props()` destructure + its type: `onreorder?: (annotationIds: string[]) => void;`. Add drag state + handler:
```ts
  let draggedId = $state<string | null>(null);
  function dropOn(targetId: string): void {
    if (draggedId === null || draggedId === targetId) {
      draggedId = null;
      return;
    }
    const next = moveBefore(group.annotations.map((a) => a.id), draggedId, targetId);
    draggedId = null;
    onreorder?.(next);
  }
```
Replace the `<div class="rows">…{#each}…</div>` block with draggable wrappers:
```svelte
<div class="rows">
  {#each group.annotations as annotation (annotation.id)}
    <div
      class="row-wrap"
      class:dragging={draggedId === annotation.id}
      data-testid="annotation-drag"
      draggable="true"
      role="listitem"
      ondragstart={() => (draggedId = annotation.id)}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => { e.preventDefault(); dropOn(annotation.id); }}
      ondragend={() => (draggedId = null)}
    >
      <span class="grip" aria-hidden="true">⠿</span>
      <AnnotationRow
        {annotation}
        selected={false}
        stale={staleIds.includes(annotation.id)}
        onselect={(id) => onselectrow?.(id)}
      />
    </div>
  {/each}
</div>
```
Add styles:
```css
  .row-wrap { display: flex; align-items: center; gap: 4px; cursor: grab; }
  .row-wrap.dragging { opacity: 0.5; }
  .row-wrap > :global(button) { flex: 1; }
  .grip { color: var(--vscode-descriptionForeground, #888); font-size: 12px; user-select: none; }
```
(Keep the existing `.rows` style if present.)

- [ ] **Step 4: Add the reorder sender to `src/webview/detail/state.ts`:**
```ts
/** Persist a new annotation order (host validates it is a permutation). */
export function reorderAnnotations(annotationIds: string[]): void {
  postToHost({ type: 'reorderAnnotations', annotationIds });
}
```

- [ ] **Step 5: Wire `DetailApp.svelte`.** Add `reorderAnnotations` to the `./state` import. Pass it to `<GroupView>`: `onreorder={(ids) => reorderAnnotations(ids)}` (keep all existing GroupView props).

- [ ] **Step 6: Run component + unit + check-types + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 7: Commit**
```bash
git add src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts src/webview/detail/state.ts src/webview/detail/DetailApp.svelte
git commit -m "feat: drag-reorder annotations in the group view (native DnD + moveBefore)"
```

---

## Task 4: Host wiring + integration + nav e2e + full suite

**Files:** Modify `src/web/detailPanelProvider.ts`, `src/web/extension.ts`, `src/web/test/suite/index.ts`, `test-workspace/.annotations/groups/seed-resolved.json`; Create `src/web/test/suite/reorderAnnotations.integration.test.ts`, `e2e/navigate.spec.ts`

- [ ] **Step 1: `detailPanelProvider.ts` — add hook + handler branch.** Add a public hook near the others:
```ts
  /** Set by the extension: persist a reordered annotation list. */
  public onReorderAnnotations?: (groupId: string, annotationIds: string[]) => void;
```
In `onDidReceiveMessage`, after the `editGitRef` branch, add:
```ts
      } else if (message.type === 'reorderAnnotations') {
        if (this.group) {
          this.onReorderAnnotations?.(this.group.id, message.annotationIds);
        }
```
(Mirror the existing `if (this.group) { … }` branches.)

- [ ] **Step 2: `extension.ts` — wire the hook.** Near the other `detailProvider.on…` assignments add:
```ts
  detailProvider.onReorderAnnotations = async (groupId, annotationIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const ok = await store.reorderAnnotations(groupId, annotationIds, now());
    if (ok) {
      await showGroupWithStale(groupId);
    }
  };
```
(`GroupStore`, `VscodeFileSystem`, `now`, `showGroupWithStale` are already in scope — mirror the `onUpdateAnnotation` wiring.)

- [ ] **Step 3: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 4: Integration test** — create `src/web/test/suite/reorderAnnotations.integration.test.ts` (mirror `updateAnnotationRange.integration.test.ts`'s structure — read it first for the exact imports + workspace-folder guard + try/finally cleanup):
```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.reorderAnnotations (vscode.workspace.fs)', () => {
  test('persists a permuted annotation order', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'reorder-itest', title: 'R', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [
        { id: 'a1', file: 'README.md', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
        { id: 'a2', file: 'README.md', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
        { id: 'a3', file: 'README.md', range: { startLine: 3, endLine: 3 }, content: '', contentHash: 'h' },
      ],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.reorderAnnotations('reorder-itest', ['a3', 'a1', 'a2'], 9);
      if (!ok) {
        throw new Error('reorderAnnotations returned false');
      }
      const r = await store.getGroup('reorder-itest');
      const order = r?.annotations.map((a) => a.id).join(',');
      if (order !== 'a3,a1,a2') {
        throw new Error(`order not persisted: ${order}`);
      }
    } finally {
      await store.deleteGroup('reorder-itest');
    }
  });
});
```

- [ ] **Step 5: Register it in `src/web/test/suite/index.ts`** — add `import('./reorderAnnotations.integration.test')` to the existing `Promise.all([...])`, matching the existing style.

- [ ] **Step 6: Give the resolved seed group 3 annotations** so the nav e2e has something to step through. Read `test-workspace/.annotations/groups/seed-resolved.json`, then replace its `annotations` array with three distinct entries (keep `id: "seed-resolved"`, `status: "resolved"`, the title/author/tags). Each annotation needs a distinct `id` (`r1`/`r2`/`r3`), a real `file` (e.g. `README.md`), a `range`, non-empty `content` (so the row summary renders), and a `contentHash`. Match the JSON indentation of the file. Example annotations array:
```json
  "annotations": [
    { "id": "r1", "file": "README.md", "range": { "startLine": 1, "endLine": 1 }, "content": "First resolved note.", "contentHash": "seed" },
    { "id": "r2", "file": "README.md", "range": { "startLine": 2, "endLine": 2 }, "content": "Second resolved note.", "contentHash": "seed" },
    { "id": "r3", "file": "README.md", "range": { "startLine": 3, "endLine": 3 }, "content": "Third resolved note.", "contentHash": "seed" }
  ]
```
(The 2c `filters.spec` only checks the card + badge appear — it doesn't open the group or count annotations — so this change is safe for it.)

- [ ] **Step 7: Create `e2e/navigate.spec.ts`.** Read an existing detail e2e (`e2e/drift.spec.ts` or `e2e/detail.spec.ts`) FIRST to copy the exact sidebar (`.first()`/`.nth(0)`) and detail (`.nth(1)`) iframe-drill + the activity-bar tab regex. Then:
```ts
import { test, expect } from '@playwright/test';

test('prev/next steps through a group\'s annotations', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame();
  await expect(sidebar.getByTestId('filter-bar')).toBeVisible({ timeout: 30_000 });

  // Reveal the resolved seed group (3 annotations) and open it.
  await sidebar.getByTestId('show-resolved').click();
  await sidebar.getByTestId('group-card').filter({ hasText: 'Resolved Group' }).click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  // The group view lists 3 annotation rows; open the first.
  await expect(detail.getByTestId('annotation-row')).toHaveCount(3, { timeout: 30_000 });
  await detail.getByTestId('annotation-row').first().click();

  // Annotation view: position 1/3, Prev disabled, Next enabled.
  await expect(detail.getByTestId('position-info')).toHaveText('1 / 3', { timeout: 30_000 });
  await expect(detail.getByTestId('prev-btn')).toBeDisabled();
  await expect(detail.getByTestId('next-btn')).toBeEnabled();

  // Step forward → 2/3.
  await detail.getByTestId('next-btn').click();
  await expect(detail.getByTestId('position-info')).toHaveText('2 / 3');
  await expect(detail.getByTestId('prev-btn')).toBeEnabled();
});
```
> If the title text differs in your seed, match it. If `drift.spec`/`detail.spec` use `page.locator('iframe.webview').contentFrame()` (no `.first()`) for the sidebar, match that exact form. The detail panel needs the group selected first — that's why we click the card before drilling into `.nth(1)`.

- [ ] **Step 8: Run the e2e** (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm run test:e2e`
Expected: 8 passed (the 7 from 2c + `navigate.spec`). If `navigate.spec` fails: verify the resolved seed has 3 annotations and the card title matches the filter text; verify `next-btn`/`position-info` testids; re-check the iframe drill. Do NOT weaken assertions.

- [ ] **Step 9: Full suite (Definition of Done)** (`dangerouslyDisableSandbox: true`, `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**9 passing** — the 8 prior + reorder) → `test:e2e` (**8 passed**). All green. Report ACTUAL counts.

- [ ] **Step 10: Commit**
```bash
git add src/web/detailPanelProvider.ts src/web/extension.ts src/web/test/suite/reorderAnnotations.integration.test.ts src/web/test/suite/index.ts test-workspace/.annotations/groups/seed-resolved.json e2e/navigate.spec.ts
git commit -m "feat: host persists annotation reorder; reorder integration + prev/next nav e2e"
```

---

## Phase 2d Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (moveBefore, nav helpers, reorderAnnotations, Prev/Next UI, GroupView drag + earlier suites).
- [ ] `npm run test:integration` passes — **9 passing**.
- [ ] `npm run test:e2e` passes — **8 passed** (incl. prev/next navigation).
- [ ] All work committed on the `phase-2` branch.
- [ ] Manual sanity (optional): dragging a row reorders the list and the order survives reload; Prev/Next steps through annotations with the right `n / total` and disabled ends; navigating also moves the editor to the annotation's code.

## Phase 2 complete after 2d
Run **finishing-a-development-branch** to merge `phase-2` → `main` (after a final whole-phase code review).

## Backlog (deferred from 2d, not in scope)
- `Annotated: Next/Previous Annotation` **keyboard commands** (`ctrl/cmd+alt+]` / `[`) — needs a host→detail `navigate` message + keybindings. The in-panel Prev/Next buttons already cover navigation; add the commands as a small follow-up if desired.
- A drag-handle-only drag target (currently the whole row is draggable; the `⠿` grip is affordance only).
