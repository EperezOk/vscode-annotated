# vscode-annotated — Phase 3d: Bulk-Select Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A sidebar **Select** header toggle (→ **Done** to exit) that enters **bulk-select mode**: a checkbox per group card and a sticky action bar with **Tags**, **Git ref**, **Resolve/Restore**, **Delete**, plus a live **selected-count**. This is the final feature of IDEA.md.

**Architecture:** Bulk-selection state is webview-local pure state (`bulkMode`, `selectedGroupIds`) in `src/core/sidebarState.ts`, preserved + pruned across `setState` refreshes. Bulk actions post intent (with the selected group ids) to the host; the host runs any native UI (tag/git-ref QuickPick, delete confirm) once and loops the already-tested `GroupStore.updateGroup`/`deleteGroup`, then `provider.refresh()`. Resolve/Restore needs no native UI — the host computes the toggle target via a pure `bulkStatusToggle` helper and flips status on all selected. Native QuickPick/confirm are not Playwright-reachable, so the e2e is a **non-mutating UI smoke**; bulk logic is covered by unit tests + the existing per-group store tests.

**Tech Stack:** TypeScript + Svelte 5. Builds on Phase 1 + 2 + 3a-3c. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-3` (already checked out); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + Bash `timeout: 600000` and `pkill -f vscode-test-web || true` first.

---

## Context (exact current shapes)

- `src/core/sidebarState.ts` — `SidebarState { groups, palette, selectedId, selectedTags, selectedAuthors, showResolved }`; `initialSidebarState()`; `applyHostMessage` `setState` branch rebuilds state preserving `showResolved` + pruning `selectedTags`/`selectedAuthors` to present values; `filterGroups`, `availableTags`/`availableAuthors`, `tagColor`, `toggleInList`. Imports `AnnotationGroup` from `../shared/model`, `HostToWebview`/`TagColor` from `../shared/protocol`.
- `src/shared/model.ts` — `GroupStatus = 'open' | 'resolved'`.
- `src/shared/protocol.ts` — `HostToWebview = { type:'setState'; groups; palette }`; `WebviewToHost = { type:'ready' } | { type:'selectGroup'; groupId }`; `parseWebviewMessage(raw)` is `if (!isObject(raw) || typeof raw.type !== 'string') return null;` then `switch (raw.type)`.
- `src/webview/sidebar/App.svelte` — no header today; renders `{#if groups.length===0}empty{:else}<FilterBar …/>{#if visible.length===0}no-matches{:else}{#each visible}<GroupCard …/>{/each}{/if}{/if}`. `visible = $derived(filterGroups($sidebar))`. `onselect(id)` does `setSelected(id)` + `postToHost({type:'selectGroup', groupId:id})`.
- `src/webview/sidebar/GroupCard.svelte` — `<button class="card" class:selected class:resolved data-testid="group-card" onclick={() => onselect?.(group.id)}>` with title (+ resolved badge), meta, chips. Props `{ group, palette, selected?, onselect? }`.
- `src/webview/sidebar/state.ts` — `sidebar` store + `handleHostMessage`, `setSelected`, `toggleTagFilter`, `toggleAuthorFilter`, `setShowResolved` (imports `toggleInList` from core). `postToHost` from `./vscodeApi`.
- `src/web/sidebarViewProvider.ts` — `onSelectGroup?` hook; `onDidReceiveMessage` → `parseWebviewMessage` → `ready`→`refresh()`, `selectGroup`→`onSelectGroup`. `refresh()` lists groups + posts `{type:'setState', groups, palette: readTagPalette()}`.
- `src/web/extension.ts` — sidebar `provider` constructed + `provider.onSelectGroup` wired; `now()`; `patchGroup(groupId, patch)` (calls `updateGroup` + `showGroupWithStale`); `onEditTags` (with ＋New tag: builds items + `NEW_TAG_LABEL` + `splitPickedTags` + `addTagToPalette`); `onEditGitRef` (uses `readGitRefInfo()` + `gitRefSuggestions(info)` + a CLEAR/CUSTOM QuickPick); `readTagPalette`, `GroupStore`, `VscodeFileSystem`. `GroupStore` has `updateGroup(groupId, {title?,tags?,gitRef?,status?}, now)`, `deleteGroup(id)`, `getGroup`, `listGroups`.
- e2e sidebar drill (`filters.spec.ts`): open Annotated tab → `sidebar = page.locator('iframe.webview').contentFrame().locator('iframe#active-frame').contentFrame()`; testids `filter-bar`, `group-card`, `show-resolved`, `resolved-badge`. Seeds: `seed-group.json` (open — 1 default-visible card), `seed-resolved.json` (resolved — hidden until show-resolved). After 3c: full suite = check-types + unit + **10 integration** + **10 e2e**.

---

## Design notes
- **Bulk state preserved across refreshes:** `applyHostMessage` `setState` keeps `bulkMode` and prunes `selectedGroupIds` to ids still present (so a file-watcher refresh doesn't drop the user mid-selection, and bulk-deleted ids fall out automatically).
- **Resolve/Restore target via pure `bulkStatusToggle(groups)`:** all-open → `'resolved'`; all-resolved → `'open'`; mixed (or empty) → `'resolved'`. Host computes it; the webview button is a static "Resolve / Restore".
- **Card click in bulk mode toggles selection** (not open). The checkbox is a visual indicator (`pointer-events: none`) driven by the card click — so the e2e clicks the **card**, not the checkbox.
- **Native UI host-side, looped store ops:** tags/git-ref reuse the existing single-group QuickPick logic (one prompt, applied to all); delete shows one `showWarningMessage` modal confirm; each loops `updateGroup`/`deleteGroup` then `provider.refresh()`.
- **e2e = non-mutating UI smoke** (Select → checkboxes + action bar + count; select/deselect; Done → exit). The mutating actions need native QuickPick/confirm (not Playwright-reachable) and would pollute fixtures — covered by unit + per-group store tests instead. Documented, not silent.

---

## File Structure (3d)

```
src/core/sidebarState.ts                      (modify) # +bulkMode/selectedGroupIds, preserve/prune in setState, bulkStatusToggle
src/core/sidebarState.unit.test.ts            (modify)
src/shared/protocol.ts                        (modify) # WebviewToHost += 4 bulk messages; parse cases
src/shared/protocol.unit.test.ts              (modify)
src/webview/sidebar/state.ts                  (modify) # toggleBulkMode/toggleGroupSelection + bulk-action senders
src/webview/sidebar/GroupCard.svelte          (modify) # bulkMode/checked/oncheck + checkbox
src/webview/sidebar/GroupCard.svelte.test.ts  (modify)
src/webview/sidebar/App.svelte                (modify) # Select/Done header + sticky action bar + count
src/webview/sidebar/App.svelte.test.ts        (modify)
src/web/sidebarViewProvider.ts                (modify) # 4 bulk hooks + handler branches
src/web/extension.ts                          (modify) # 4 bulk handlers (loop store ops; native UI for tags/gitref/delete)
e2e/bulk.spec.ts                              (new)    # non-mutating bulk-mode UI smoke
```

---

## Task 1: Pure bulk state + protocol messages

**Files:** Modify `src/core/sidebarState.ts`(+test), `src/shared/protocol.ts`(+test)

- [ ] **Step 1: Append tests.**

In `src/core/sidebarState.unit.test.ts` (add `bulkStatusToggle` to the `./sidebarState` import; the file has a `group(id, opts)` factory):
```ts
describe('bulk-select state', () => {
  it('initial state is not in bulk mode with no selection', () => {
    expect(initialSidebarState().bulkMode).toBe(false);
    expect(initialSidebarState().selectedGroupIds).toEqual([]);
  });
  it('setState preserves bulkMode and prunes selectedGroupIds to present groups', () => {
    const state = { ...initialSidebarState(), bulkMode: true, selectedGroupIds: ['g1', 'gone'] };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g1')], palette: [] });
    expect(next.bulkMode).toBe(true);
    expect(next.selectedGroupIds).toEqual(['g1']);
  });
});

describe('bulkStatusToggle', () => {
  it('all open → resolved', () => {
    expect(bulkStatusToggle([group('a'), group('b')])).toBe('resolved');
  });
  it('all resolved → open', () => {
    expect(bulkStatusToggle([group('a', { status: 'resolved' }), group('b', { status: 'resolved' })])).toBe('open');
  });
  it('mixed → resolved', () => {
    expect(bulkStatusToggle([group('a'), group('b', { status: 'resolved' })])).toBe('resolved');
  });
  it('empty → resolved', () => {
    expect(bulkStatusToggle([])).toBe('resolved');
  });
});
```
Also update the existing `initialSidebarState` `toEqual(...)` assertion (the test titled like "is empty with no selection and no filters") to include `bulkMode: false, selectedGroupIds: []`.

In `src/shared/protocol.unit.test.ts` (inside the `parseWebviewMessage` describe — create it if there's a separate describe for webview msgs; otherwise add alongside):
```ts
  it('accepts bulk messages with a string[] groupIds', () => {
    for (const type of ['bulkEditTags', 'bulkEditGitRef', 'bulkResolveRestore', 'bulkDelete'] as const) {
      expect(parseWebviewMessage({ type, groupIds: ['g1', 'g2'] })).toEqual({ type, groupIds: ['g1', 'g2'] });
    }
  });
  it('rejects bulk messages with a non-array or non-string ids', () => {
    expect(parseWebviewMessage({ type: 'bulkDelete', groupIds: 'g1' })).toBeNull();
    expect(parseWebviewMessage({ type: 'bulkEditTags', groupIds: ['g1', 2] })).toBeNull();
  });
```
(`parseWebviewMessage` is imported in this test file — confirm; add it if the webview-message tests live elsewhere.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/sidebarState.unit.test.ts src/shared/protocol.unit.test.ts`
Expected: FAIL. Report output.

- [ ] **Step 3: Extend `src/core/sidebarState.ts`.** Add `GroupStatus` to the `../shared/model` import. Extend `SidebarState`:
```ts
  bulkMode: boolean;
  selectedGroupIds: string[];
```
`initialSidebarState` adds `bulkMode: false, selectedGroupIds: []`. In the `setState` branch of `applyHostMessage`, add to the returned object:
```ts
        bulkMode: state.bulkMode,
        selectedGroupIds: state.selectedGroupIds.filter((id) => message.groups.some((g) => g.id === id)),
```
Add the pure helper (after `filterGroups`):
```ts
/** The status to apply when bulk-toggling: all-open → resolved, all-resolved → open, mixed/empty → resolved. */
export function bulkStatusToggle(groups: AnnotationGroup[]): GroupStatus {
  return groups.length > 0 && groups.every((g) => g.status === 'resolved') ? 'open' : 'resolved';
}
```

- [ ] **Step 4: Extend `src/shared/protocol.ts`.** Add to `WebviewToHost`:
```ts
  | { type: 'bulkEditTags'; groupIds: string[] }
  | { type: 'bulkEditGitRef'; groupIds: string[] }
  | { type: 'bulkResolveRestore'; groupIds: string[] }
  | { type: 'bulkDelete'; groupIds: string[] }
```
Add to `parseWebviewMessage`'s switch (before `default`). To avoid four near-identical blocks, a small local guard is fine:
```ts
    case 'bulkEditTags':
    case 'bulkEditGitRef':
    case 'bulkResolveRestore':
    case 'bulkDelete':
      return Array.isArray(raw.groupIds) && (raw.groupIds as unknown[]).every((id) => typeof id === 'string')
        ? { type: raw.type, groupIds: raw.groupIds as string[] }
        : null;
```
(If TS complains that `raw.type` isn't narrowed to the union literal across the fall-through, cast: `{ type: raw.type as 'bulkEditTags' | 'bulkEditGitRef' | 'bulkResolveRestore' | 'bulkDelete', groupIds: raw.groupIds as string[] }`. Mirror how `parseDetailMessage` handles its array case for the `every` + cast idiom.)

- [ ] **Step 5: Run pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/sidebarState.unit.test.ts src/shared/protocol.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types 0; all green.

IMPORTANT — `check-types` will fail in `App.svelte.test.ts` (and possibly elsewhere) where `sidebar.set({ ...initialSidebarState(), ... })` is used — those spread `initialSidebarState()` so they're FINE. But any RAW `SidebarState` literal (not spread) breaks. The 2c work made App tests spread `initialSidebarState()`, so they should compile. If any literal breaks, spread `initialSidebarState()` into it. Report any you touched.

- [ ] **Step 6: Commit**
```bash
git add src/core/sidebarState.ts src/core/sidebarState.unit.test.ts src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat: bulk-select state (bulkMode/selectedGroupIds + bulkStatusToggle) + bulk protocol messages"
```

---

## Task 2: Bulk webview UI (checkbox, header, action bar)

**Files:** Modify `src/webview/sidebar/state.ts`, `GroupCard.svelte`(+test), `App.svelte`(+test)

- [ ] **Step 1: Add senders to `src/webview/sidebar/state.ts`** (uses the already-imported `toggleInList`):
```ts
/** Enter/exit bulk-select mode (clears the selection on toggle). */
export function toggleBulkMode(): void {
  sidebar.update((state) => ({ ...state, bulkMode: !state.bulkMode, selectedGroupIds: [] }));
}

/** Toggle a group in the bulk selection. */
export function toggleGroupSelection(groupId: string): void {
  sidebar.update((state) => ({ ...state, selectedGroupIds: toggleInList(state.selectedGroupIds, groupId) }));
}

/** Bulk-action intents (host runs any native UI + applies to all selected). */
export function bulkEditTags(groupIds: string[]): void {
  postToHost({ type: 'bulkEditTags', groupIds });
}
export function bulkEditGitRef(groupIds: string[]): void {
  postToHost({ type: 'bulkEditGitRef', groupIds });
}
export function bulkResolveRestore(groupIds: string[]): void {
  postToHost({ type: 'bulkResolveRestore', groupIds });
}
export function bulkDelete(groupIds: string[]): void {
  postToHost({ type: 'bulkDelete', groupIds });
}
```

- [ ] **Step 2: Append GroupCard tests.** In `src/webview/sidebar/GroupCard.svelte.test.ts`:
```ts
  it('shows a checkbox in bulk mode and toggles selection on card click', async () => {
    const oncheck = vi.fn();
    render(GroupCard, { group: group(), palette: [], bulkMode: true, checked: false, oncheck });
    expect(screen.getByTestId('bulk-checkbox')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('group-card'));
    expect(oncheck).toHaveBeenCalledWith('g1');
  });
  it('reflects the checked state and has no checkbox outside bulk mode', () => {
    const { unmount } = render(GroupCard, { group: group(), palette: [], bulkMode: true, checked: true });
    expect(screen.getByTestId('bulk-checkbox')).toBeChecked();
    unmount();
    render(GroupCard, { group: group(), palette: [] });
    expect(screen.queryByTestId('bulk-checkbox')).toBeNull();
  });
```
(Use the file's existing `group()` factory — it yields id `'g1'`. Match the render-prop style.)

- [ ] **Step 3: Update `GroupCard.svelte`.** Add to `$props()` (destructure + type): `bulkMode?: boolean` (default false), `checked?: boolean` (default false), `oncheck?: (id: string) => void`. Change the card's `onclick` to branch on bulk mode, and add a checkbox indicator:
```svelte
<button
  type="button"
  class="card"
  class:selected
  class:resolved={group.status === 'resolved'}
  data-testid="group-card"
  onclick={() => (bulkMode ? oncheck?.(group.id) : onselect?.(group.id))}
>
  {#if bulkMode}
    <input type="checkbox" class="bulk-cb" data-testid="bulk-checkbox" checked={checked} tabindex="-1" aria-label="Select group" />
  {/if}
  <div class="title">
    {group.title}
    {#if group.status === 'resolved'}<span class="badge" data-testid="resolved-badge">resolved</span>{/if}
  </div>
  <div class="meta">{group.author} · {group.annotations.length} annotation{group.annotations.length === 1 ? '' : 's'}</div>
  {#if group.tags.length > 0}
    <div class="chips">
      {#each group.tags as tag (tag)}
        <span class="chip" style="background:{tagColor(palette, tag)}">{tag}</span>
      {/each}
    </div>
  {/if}
</button>
```
Add a style so the checkbox is an indicator (the card click drives it):
```css
  .bulk-cb { margin-right: 6px; pointer-events: none; vertical-align: middle; }
```
(Keep all existing GroupCard styles.)

- [ ] **Step 4: Append App tests.** In `src/webview/sidebar/App.svelte.test.ts`, mock `postToHost` so bulk-action buttons can be asserted without the real VSCode API. Add at the top (after imports):
```ts
import { postToHost } from './vscodeApi';
vi.mock('./vscodeApi', () => ({ postToHost: vi.fn() }));
```
Then append:
```ts
  it('enters bulk mode: shows the action bar, checkboxes, and a live count', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One'), group('g2', 'Two')], palette: [] });
    render(App);
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();
    await userEvent.click(screen.getByTestId('bulk-toggle'));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getAllByTestId('bulk-checkbox')).toHaveLength(2);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 selected');
    await userEvent.click(screen.getAllByTestId('group-card')[0]);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');
  });
  it('dispatches a bulk resolve/restore for the selected ids', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One'), group('g2', 'Two')], palette: [], bulkMode: true, selectedGroupIds: ['g1'] });
    render(App);
    await userEvent.click(screen.getByTestId('bulk-resolve-btn'));
    expect(postToHost).toHaveBeenCalledWith({ type: 'bulkResolveRestore', groupIds: ['g1'] });
  });
```
(If the existing tests trigger `postToHost` paths — e.g. a card-open test — the mock makes `postToHost` a `vi.fn()`, which is harmless. Reset with `vi.clearAllMocks()` in `beforeEach` if the file doesn't already, to keep the dispatch assertion clean. If the existing `beforeEach` only does `sidebar.set(initialSidebarState())`, add `vi.clearAllMocks()` to it.)

- [ ] **Step 5: Update `App.svelte`.** Import the new senders (`toggleBulkMode, toggleGroupSelection, bulkEditTags, bulkEditGitRef, bulkResolveRestore, bulkDelete`) from `./state`. Add a header (Select/Done) when there are groups, the bulk checkbox wiring on cards, and a sticky action bar when `bulkMode`:
```svelte
<main data-testid="sidebar">
  {#if $sidebar.groups.length === 0}
    <p class="empty" data-testid="empty">
      No annotations yet. Select code and run "Annotated: Create Annotation".
    </p>
  {:else}
    <header class="bar">
      <button type="button" class="link" data-testid="bulk-toggle" onclick={toggleBulkMode}>
        {$sidebar.bulkMode ? 'Done' : 'Select'}
      </button>
    </header>
    {#if $sidebar.bulkMode}
      <div class="bulk-bar" data-testid="bulk-action-bar">
        <span class="count" data-testid="bulk-count">{$sidebar.selectedGroupIds.length} selected</span>
        <button type="button" class="bbtn" data-testid="bulk-tags-btn" disabled={$sidebar.selectedGroupIds.length === 0} onclick={() => bulkEditTags($sidebar.selectedGroupIds)}>Tags</button>
        <button type="button" class="bbtn" data-testid="bulk-gitref-btn" disabled={$sidebar.selectedGroupIds.length === 0} onclick={() => bulkEditGitRef($sidebar.selectedGroupIds)}>Git ref</button>
        <button type="button" class="bbtn" data-testid="bulk-resolve-btn" disabled={$sidebar.selectedGroupIds.length === 0} onclick={() => bulkResolveRestore($sidebar.selectedGroupIds)}>Resolve / Restore</button>
        <button type="button" class="bbtn danger" data-testid="bulk-delete-btn" disabled={$sidebar.selectedGroupIds.length === 0} onclick={() => bulkDelete($sidebar.selectedGroupIds)}>Delete</button>
      </div>
    {:else}
      <FilterBar
        {tags}
        {authors}
        selectedTags={$sidebar.selectedTags}
        selectedAuthors={$sidebar.selectedAuthors}
        showResolved={$sidebar.showResolved}
        ontoggletag={toggleTagFilter}
        ontoggleauthor={toggleAuthorFilter}
        onshowresolved={setShowResolved}
      />
    {/if}
    {#if visible.length === 0}
      <p class="empty" data-testid="no-matches">No groups match the current filters.</p>
    {:else}
      {#each visible as group (group.id)}
        <GroupCard
          {group}
          palette={$sidebar.palette}
          selected={$sidebar.selectedId === group.id}
          bulkMode={$sidebar.bulkMode}
          checked={$sidebar.selectedGroupIds.includes(group.id)}
          oncheck={toggleGroupSelection}
          {onselect}
        />
      {/each}
    {/if}
  {/if}
</main>
```
(Keep the existing `<script>` block's derived values + `onselect`. Add the new imports. Note: in bulk mode the FilterBar is hidden and the action bar is shown — `visible` still uses the active filters, which is fine.) Add styles:
```css
  .bar { display: flex; justify-content: flex-end; padding: 2px 2px 6px; }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11.5px; padding: 0; }
  .bulk-bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 4px 8px; border-bottom: 1px solid var(--vscode-sideBar-border, #333); margin-bottom: 8px; background: var(--vscode-sideBar-background, #1e1e1e); }
  .count { font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); margin-right: auto; }
  .bbtn { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); border: none; border-radius: 3px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
  .bbtn:disabled { opacity: 0.4; cursor: default; }
  .bbtn.danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-foreground, #fff); }
```

- [ ] **Step 6: Run component + unit + check-types + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 7: Commit**
```bash
git add src/webview/sidebar/state.ts src/webview/sidebar/GroupCard.svelte src/webview/sidebar/GroupCard.svelte.test.ts src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts
git commit -m "feat: bulk-select UI (Select/Done header, per-card checkbox, sticky action bar)"
```

---

## Task 3: Host bulk handlers + e2e + full suite

**Files:** Modify `src/web/sidebarViewProvider.ts`, `src/web/extension.ts`; Create `e2e/bulk.spec.ts`

- [ ] **Step 1: `sidebarViewProvider.ts` — add hooks + handler branches.** Add public hooks near `onSelectGroup`:
```ts
  public onBulkEditTags?: (groupIds: string[]) => Promise<void>;
  public onBulkEditGitRef?: (groupIds: string[]) => Promise<void>;
  public onBulkResolveRestore?: (groupIds: string[]) => Promise<void>;
  public onBulkDelete?: (groupIds: string[]) => Promise<void>;
```
In `onDidReceiveMessage`, after the `selectGroup` branch:
```ts
      } else if (message.type === 'bulkEditTags') {
        await this.onBulkEditTags?.(message.groupIds);
      } else if (message.type === 'bulkEditGitRef') {
        await this.onBulkEditGitRef?.(message.groupIds);
      } else if (message.type === 'bulkResolveRestore') {
        await this.onBulkResolveRestore?.(message.groupIds);
      } else if (message.type === 'bulkDelete') {
        await this.onBulkDelete?.(message.groupIds);
```
(The handler is already `async`.)

- [ ] **Step 2: `extension.ts` — wire the 4 bulk handlers.** Add `bulkStatusToggle` to the `../core/sidebarState` import (if it imports from there; else add the import). Near the existing `provider.onSelectGroup` assignment add:
```ts
  provider.onBulkResolveRestore = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const groups = (await Promise.all(groupIds.map((id) => store.getGroup(id)))).filter((g): g is AnnotationGroup => g !== null);
    const status = bulkStatusToggle(groups);
    for (const id of groupIds) {
      await store.updateGroup(id, { status }, now());
    }
    await provider.refresh();
  };

  provider.onBulkDelete = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete ${groupIds.length} group${groupIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.deleteGroup(id);
    }
    await provider.refresh();
  };

  provider.onBulkEditTags = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const palette = readTagPalette();
    const items: vscode.QuickPickItem[] = [
      ...palette.map((t) => ({ label: t.name })),
      { label: NEW_TAG_LABEL, alwaysShow: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Set tags on ${groupIds.length} group(s)`,
    });
    if (picked === undefined) {
      return;
    }
    const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
    if (addNew) {
      const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
      if (name && name.trim()) {
        const color = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: '#888888' });
        await addTagToPalette(name.trim(), color?.trim() || '#888888');
        names.push(name.trim());
      }
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.updateGroup(id, { tags: names }, now());
    }
    await provider.refresh();
  };

  provider.onBulkEditGitRef = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const info = await readGitRefInfo();
    const suggestions = gitRefSuggestions(info);
    const CLEAR = '$(close) Clear';
    const CUSTOM = '$(edit) Custom…';
    const picked = await vscode.window.showQuickPick(
      [{ label: CLEAR }, { label: CUSTOM }, ...suggestions.map((s) => ({ label: s.label, description: s.description }))],
      { placeHolder: `Set the Git ref on ${groupIds.length} group(s)` },
    );
    if (!picked) {
      return;
    }
    let gitRef: string | null;
    if (picked.label === CLEAR) {
      gitRef = null;
    } else if (picked.label === CUSTOM) {
      const custom = await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA)' });
      if (custom === undefined) {
        return;
      }
      gitRef = custom.trim() === '' ? null : custom.trim();
    } else {
      gitRef = picked.label;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.updateGroup(id, { gitRef }, now());
    }
    await provider.refresh();
  };
```
ADAPT to the file's real idioms: `AnnotationGroup` must be imported (it likely already is for other handlers — check); `NEW_TAG_LABEL`/`splitPickedTags` (`../core/tags`), `addTagToPalette` (`./tagPalette`), `readGitRefInfo`/`gitRefSuggestions` are already imported (used by `onEditTags`/`onEditGitRef`). Match the existing brace/guard style. Use `provider.refresh()` (the SIDEBAR provider), not the detail's `showGroupWithStale`.

- [ ] **Step 3: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 4: Create `e2e/bulk.spec.ts`** — a NON-MUTATING UI smoke. Copy the exact sidebar drill + tab regex from `e2e/filters.spec.ts`. Then:
```ts
import { test, expect } from '@playwright/test';

test('bulk-select mode: checkboxes, action bar, and a live count', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page.locator('iframe.webview').contentFrame().locator('iframe#active-frame').contentFrame();
  await expect(sidebar.getByTestId('filter-bar')).toBeVisible({ timeout: 30_000 });

  // Reveal both seed groups so there are 2 cards to bulk-select.
  await sidebar.getByTestId('show-resolved').click();
  await expect(sidebar.getByTestId('group-card')).toHaveCount(2);

  // Enter bulk mode → action bar + a checkbox per card; FilterBar hides.
  await sidebar.getByTestId('bulk-toggle').click();
  await expect(sidebar.getByTestId('bulk-action-bar')).toBeVisible();
  await expect(sidebar.getByTestId('bulk-checkbox')).toHaveCount(2);
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('0 selected');

  // Select two cards (clicking the card toggles selection in bulk mode).
  await sidebar.getByTestId('group-card').nth(0).click();
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('1 selected');
  await sidebar.getByTestId('group-card').nth(1).click();
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('2 selected');

  // Deselect one, then exit bulk mode (no mutation performed).
  await sidebar.getByTestId('group-card').nth(0).click();
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('1 selected');
  await sidebar.getByTestId('bulk-toggle').click();
  await expect(sidebar.getByTestId('bulk-action-bar')).toHaveCount(0);
});
```
> Do NOT click any bulk-action button (Tags/Git ref/Resolve/Delete) — those open native QuickPick/confirm dialogs Playwright can't drive and would mutate/pollute the seed fixtures. This smoke verifies the bulk UI + selection/count only. Match `filters.spec.ts`'s exact sidebar drill (it uses `.contentFrame()` without `.nth`/`.first` — mirror it).

- [ ] **Step 5: Run the e2e** (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm run test:e2e`
Expected: 11 passed (10 prior + `bulk.spec`). The bulk smoke performs no mutation, so seed fixtures stay clean. Do NOT weaken assertions.

- [ ] **Step 6: Full suite (Definition of Done)** (`dangerouslyDisableSandbox: true`, `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**10 passing**, unchanged) → `test:e2e` (**11 passed**). Report ACTUAL counts. Then `git status --short test-workspace/` — seed fixtures unchanged (bulk e2e mutates nothing).

- [ ] **Step 7: Commit**
```bash
git add src/web/sidebarViewProvider.ts src/web/extension.ts e2e/bulk.spec.ts
git commit -m "feat: host bulk handlers (resolve/restore, delete, tags, git-ref) + bulk UI e2e"
```

---

## Phase 3d Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (bulk state, bulkStatusToggle, protocol, GroupCard checkbox, App bulk UI + earlier suites).
- [ ] `npm run test:integration` passes — **10 passing** (unchanged).
- [ ] `npm run test:e2e` passes — **11 passed** (incl. bulk UI smoke).
- [ ] Seed fixtures unchanged on disk after the run.
- [ ] All work committed on the `phase-3` branch.
- [ ] Manual sanity (optional): Select → checkboxes + sticky action bar with count; Resolve/Restore flips all selected; Delete confirms then removes; Tags/Git ref apply the picked value to all selected; Done exits and clears.

## Phase 3 complete after 3d → IDEA.md fully implemented
Run **finishing-a-development-branch**: final whole-Phase-3 review, then merge `phase-3` → `main`.
