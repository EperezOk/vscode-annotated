# vscode-annotated — Phase 2c: Sidebar Filters (tag / author / show-resolved) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a **filter bar** to the sidebar — multi-select **tag** filter, multi-select **author** filter, and a **Show resolved** checkbox. Resolved groups are hidden by default; when shown they render dimmed with a `resolved` badge. Filtering OR-matches tags (a group is kept if it has *any* selected tag) and OR-matches authors.

**Architecture:** Filtering is **webview-local**. The host already posts the full, unfiltered group list (`setState`); no protocol change is needed. Filter state lives in the pure `src/core/sidebarState.ts` module (`selectedTags`, `selectedAuthors`, `showResolved`) with a pure `filterGroups(state)` selector and `availableTags`/`availableAuthors` option derivers — all unit-tested. The Svelte sidebar renders a new `FilterBar.svelte`, drives it through thin store senders in `state.ts`, and `GroupCard.svelte` gains the `resolved` badge + dimming.

**Tech Stack:** TypeScript + Svelte 5 runes. Builds on Phase 1 + 2a + 2b. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-2` (already checked out — Phase 2 sub-plans accumulate here per CLAUDE.md); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + Bash `timeout: 600000` and `pkill -f vscode-test-web || true` first.

---

## Context (current sidebar — exact shapes)

- `src/shared/model.ts` — `AnnotationGroup { id, title, author: string, tags: string[], gitRef, status: GroupStatus, createdAt, updatedAt, annotations }`; `GroupStatus = 'open' | 'resolved'`.
- `src/shared/protocol.ts` — `HostToWebview = { type:'setState'; groups: AnnotationGroup[]; palette: TagColor[] }`; `WebviewToHost = { type:'ready' } | { type:'selectGroup'; groupId }`. **No change in 2c.**
- `src/core/sidebarState.ts` — pure:
  ```ts
  export interface SidebarState { groups: AnnotationGroup[]; palette: TagColor[]; selectedId: string | null; }
  export function initialSidebarState(): SidebarState { return { groups: [], palette: [], selectedId: null }; }
  export function applyHostMessage(state, message) { /* setState → replace groups/palette, keep selectedId if still present */ }
  export function tagColor(palette, name): string { /* palette lookup, default '#888888' */ }
  ```
- `src/webview/sidebar/state.ts` — `export const sidebar = writable<SidebarState>(initialSidebarState())`; `handleHostMessage`; `setSelected(id)`.
- `src/webview/sidebar/App.svelte` — renders `{#if $sidebar.groups.length === 0}<p data-testid="empty">…</p>{:else}{#each $sidebar.groups as group}<GroupCard … />{/each}{/if}`. Empty text: `No annotations yet. Select code and run "Annotated: Create Annotation".`
- `src/webview/sidebar/GroupCard.svelte` — `{ group, palette, selected?, onselect? }`; renders `.title`, `.meta` (`author · N annotation(s)`), `.chips`; `data-testid="group-card"`. Imports `tagColor` from `../../core/sidebarState`.
- `src/web/sidebarViewProvider.ts` — `refresh()` posts `{ type:'setState', groups: await listGroups(), palette: readTagPalette() }` (ALL groups). FileSystemWatcher on `**/.annotations/**/*.json` re-`refresh()`es. **No change in 2c.**
- Tests: `src/core/sidebarState.unit.test.ts` (factory `group(id)`), `src/webview/sidebar/App.svelte.test.ts` (factory `group(id, title)`, imports `initialSidebarState`), `src/webview/sidebar/GroupCard.svelte.test.ts` (factory `group()`).
- e2e: `e2e/sidebar.spec.ts` asserts the single seeded `group-card` contains `Seed Group`; `e2e/drift.spec.ts` clicks the single `group-card`. **Both rely on exactly one VISIBLE card** — preserved because resolved groups are hidden by default.
- Seed: `test-workspace/.annotations/groups/seed-group.json` (id `seed-group`, `status: "open"`).

---

## Design notes (decisions baked into this plan)

- **OR within a facet, AND across facets.** A group passes the tag facet if it has *any* selected tag (or no tags are selected). Same for authors. Both facets must pass, plus the resolved rule.
- **Resolved rule:** if `status === 'resolved'` and `!showResolved`, the group is hidden — regardless of tag/author selection.
- **Filter options are derived from the full group list** (`availableTags`/`availableAuthors`), sorted, de-duplicated. On live reload (`setState`), selected tags/authors that no longer exist are pruned so the UI stays coherent; `showResolved` is preserved.
- **Filter UI = toggle chips** (not dropdowns): one `<button>` per tag and per author, `active` when selected; a checkbox for show-resolved. Chips match the card-chip aesthetic and are trivial to test by accessible name.
- **No protocol/host change.** Everything is webview-local; the host keeps sending all groups.

---

## File Structure (2c)

```
src/core/sidebarState.ts                          (modify) # +filter fields, filterGroups, availableTags/Authors, toggleInList
src/core/sidebarState.unit.test.ts                (modify) # +filter logic tests; fix initial toEqual literal
src/webview/sidebar/state.ts                      (modify) # +toggleTagFilter/toggleAuthorFilter/setShowResolved senders
src/webview/sidebar/GroupCard.svelte              (modify) # +resolved badge + dimming
src/webview/sidebar/GroupCard.svelte.test.ts      (modify) # +resolved badge test
src/webview/sidebar/FilterBar.svelte              (new)    # tag/author toggle chips + show-resolved checkbox
src/webview/sidebar/FilterBar.svelte.test.ts      (new)
src/webview/sidebar/App.svelte                    (modify) # render FilterBar; render filterGroups(...); no-matches state
src/webview/sidebar/App.svelte.test.ts            (modify) # fix SidebarState literals; +filter interaction tests
test-workspace/.annotations/groups/seed-resolved.json (new) # a resolved group so the filter e2e is meaningful (hidden by default)
e2e/filters.spec.ts                               (new)    # show-resolved reveals the resolved group + badge
```

---

## Task 1: Pure filter logic in `sidebarState.ts`

**Files:** Modify `src/core/sidebarState.ts`, `src/core/sidebarState.unit.test.ts`

- [ ] **Step 1: Append/adjust tests.** In `src/core/sidebarState.unit.test.ts`:

First, the existing `initialSidebarState` assertion gains three fields. Find:
```ts
  it('is empty with no selection', () => {
    expect(initialSidebarState()).toEqual({ groups: [], palette: [], selectedId: null });
  });
```
and replace its expected literal with:
```ts
  it('is empty with no selection and no filters', () => {
    expect(initialSidebarState()).toEqual({
      groups: [], palette: [], selectedId: null,
      selectedTags: [], selectedAuthors: [], showResolved: false,
    });
  });
```

Replace the existing local `group` factory (currently `function group(id: string)`) with a richer one (keeps the single-arg call sites working via defaults):
```ts
function group(
  id: string,
  opts: { author?: string; tags?: string[]; status?: 'open' | 'resolved' } = {},
): AnnotationGroup {
  return {
    id, title: id, author: opts.author ?? 'A', tags: opts.tags ?? [],
    gitRef: null, status: opts.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: [],
  };
}
```

Add `filterGroups`, `availableTags`, `availableAuthors`, `toggleInList` to the existing import from `./sidebarState`, then append:
```ts
describe('availableTags / availableAuthors', () => {
  it('returns sorted, de-duplicated tags across all groups', () => {
    const groups = [group('g1', { tags: ['security', 'todo'] }), group('g2', { tags: ['todo', 'arch'] })];
    expect(availableTags(groups)).toEqual(['arch', 'security', 'todo']);
  });
  it('returns sorted, de-duplicated authors', () => {
    const groups = [group('g1', { author: 'Zoe' }), group('g2', { author: 'Ana' }), group('g3', { author: 'Zoe' })];
    expect(availableAuthors(groups)).toEqual(['Ana', 'Zoe']);
  });
});

describe('toggleInList', () => {
  it('adds a value that is absent', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b']);
  });
  it('removes a value that is present', () => {
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('filterGroups', () => {
  const base = initialSidebarState();
  const groups = [
    group('open-sec', { author: 'Ana', tags: ['security'], status: 'open' }),
    group('open-todo', { author: 'Zoe', tags: ['todo'], status: 'open' }),
    group('res-sec', { author: 'Ana', tags: ['security'], status: 'resolved' }),
  ];

  it('hides resolved groups by default', () => {
    expect(filterGroups({ ...base, groups }).map((g) => g.id)).toEqual(['open-sec', 'open-todo']);
  });
  it('includes resolved groups when showResolved is true', () => {
    expect(filterGroups({ ...base, groups, showResolved: true }).map((g) => g.id)).toEqual(
      ['open-sec', 'open-todo', 'res-sec'],
    );
  });
  it('OR-matches selected tags (and still hides resolved by default)', () => {
    expect(filterGroups({ ...base, groups, selectedTags: ['security'] }).map((g) => g.id)).toEqual(['open-sec']);
  });
  it('OR-matches selected authors', () => {
    expect(filterGroups({ ...base, groups, selectedAuthors: ['Zoe'] }).map((g) => g.id)).toEqual(['open-todo']);
  });
  it('ANDs the tag and author facets together', () => {
    expect(
      filterGroups({ ...base, groups, selectedTags: ['security'], selectedAuthors: ['Zoe'] }).map((g) => g.id),
    ).toEqual([]); // no open group is both security AND by Zoe
  });
  it('combines showResolved with a tag filter', () => {
    expect(
      filterGroups({ ...base, groups, selectedTags: ['security'], showResolved: true }).map((g) => g.id),
    ).toEqual(['open-sec', 'res-sec']);
  });
});

describe('applyHostMessage preserves + prunes filters', () => {
  it('keeps showResolved and prunes selected tags/authors no longer present', () => {
    const state = {
      ...initialSidebarState(),
      selectedTags: ['security', 'gone'],
      selectedAuthors: ['Ana', 'ghost'],
      showResolved: true,
    };
    const next = applyHostMessage(state, {
      type: 'setState',
      groups: [group('g1', { author: 'Ana', tags: ['security'] })],
      palette: [],
    });
    expect(next.selectedTags).toEqual(['security']);
    expect(next.selectedAuthors).toEqual(['Ana']);
    expect(next.showResolved).toBe(true);
  });
});
```
(`applyHostMessage`, `initialSidebarState` are already imported in this file — only add the four new names.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/sidebarState.unit.test.ts`
Expected: FAIL — `filterGroups`/`availableTags`/`availableAuthors`/`toggleInList` undefined; `initialSidebarState` toEqual mismatch (missing filter fields); `applyHostMessage` doesn't prune.

- [ ] **Step 3: Extend `src/core/sidebarState.ts`.** Add the three fields to the interface:
```ts
export interface SidebarState {
  groups: AnnotationGroup[];
  palette: TagColor[];
  selectedId: string | null;
  selectedTags: string[];
  selectedAuthors: string[];
  showResolved: boolean;
}
```
Update `initialSidebarState`:
```ts
export function initialSidebarState(): SidebarState {
  return { groups: [], palette: [], selectedId: null, selectedTags: [], selectedAuthors: [], showResolved: false };
}
```
Rewrite the `setState` branch of `applyHostMessage` to preserve `showResolved` and prune dangling tag/author selections:
```ts
    case 'setState': {
      const stillExists = state.selectedId !== null && message.groups.some((g) => g.id === state.selectedId);
      const tags = new Set(message.groups.flatMap((g) => g.tags));
      const authors = new Set(message.groups.map((g) => g.author));
      return {
        groups: message.groups,
        palette: message.palette,
        selectedId: stillExists ? state.selectedId : null,
        selectedTags: state.selectedTags.filter((t) => tags.has(t)),
        selectedAuthors: state.selectedAuthors.filter((a) => authors.has(a)),
        showResolved: state.showResolved,
      };
    }
```
Append the new pure helpers (after `tagColor`):
```ts
/** Sorted, de-duplicated tag names across all groups (filter options). */
export function availableTags(groups: AnnotationGroup[]): string[] {
  return [...new Set(groups.flatMap((g) => g.tags))].sort();
}

/** Sorted, de-duplicated author names across all groups (filter options). */
export function availableAuthors(groups: AnnotationGroup[]): string[] {
  return [...new Set(groups.map((g) => g.author))].sort();
}

/** Toggle a value's membership in a list (immutable). */
export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * The groups to display given the current filters:
 * - resolved groups are hidden unless `showResolved`;
 * - if any tags are selected, keep groups with ANY of them;
 * - if any authors are selected, keep groups whose author is selected.
 */
export function filterGroups(state: SidebarState): AnnotationGroup[] {
  return state.groups.filter((g) => {
    if (g.status === 'resolved' && !state.showResolved) {
      return false;
    }
    if (state.selectedTags.length > 0 && !g.tags.some((t) => state.selectedTags.includes(t))) {
      return false;
    }
    if (state.selectedAuthors.length > 0 && !state.selectedAuthors.includes(g.author)) {
      return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Run to verify pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/sidebarState.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types exit 0; all unit green.

IMPORTANT — `check-types` will now FAIL in `src/webview/sidebar/App.svelte.test.ts` because its `sidebar.set({ groups: …, palette: [], selectedId: null })` literals no longer satisfy `SidebarState` (missing the three new required fields). Task 3 rewrites that test file fully — but to keep Task 1's check-types green, do the **minimal** fix now: in `App.svelte.test.ts`, change each `sidebar.set({ … })` literal that constructs a `SidebarState` to spread `initialSidebarState()` first, e.g. `sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'First'), group('g2', 'Second')], palette: [] })`. (`initialSidebarState` is already imported there.) Do NOT add new tests in Task 1 — just make existing literals compile. If any other file constructs a `SidebarState` literal and breaks check-types, spread `initialSidebarState()` into it too; report each.

- [ ] **Step 5: Commit**
```bash
git add src/core/sidebarState.ts src/core/sidebarState.unit.test.ts src/webview/sidebar/App.svelte.test.ts
git commit -m "feat: pure sidebar filter logic (filterGroups, availableTags/Authors, toggleInList)"
```

---

## Task 2: GroupCard resolved badge/dimming + filter senders

**Files:** Modify `src/webview/sidebar/GroupCard.svelte`, `src/webview/sidebar/GroupCard.svelte.test.ts`, `src/webview/sidebar/state.ts`

- [ ] **Step 1: Append a GroupCard test.** In `src/webview/sidebar/GroupCard.svelte.test.ts`, the existing `group()` factory returns `status: 'open'`. Append:
```ts
  it('shows a resolved badge and dims when the group is resolved', () => {
    render(GroupCard, { group: { ...group(), status: 'resolved' }, palette: [] });
    expect(screen.getByTestId('resolved-badge')).toBeInTheDocument();
    expect(screen.getByTestId('group-card')).toHaveClass('resolved');
  });
  it('has no resolved badge for an open group', () => {
    render(GroupCard, { group: group(), palette: [] });
    expect(screen.queryByTestId('resolved-badge')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/GroupCard.svelte.test.ts`
Expected: FAIL — no `resolved-badge`, no `resolved` class.

- [ ] **Step 3: Update `GroupCard.svelte`.** Add `class:resolved={group.status === 'resolved'}` to the card `<button>` (alongside `class:selected`). Inside the card, render the badge in the `.title` row when resolved. Change the title block to:
```svelte
  <div class="title">
    {group.title}
    {#if group.status === 'resolved'}<span class="badge" data-testid="resolved-badge">resolved</span>{/if}
  </div>
```
Add styles:
```css
  .card.resolved { opacity: 0.6; }
  .badge { margin-left: 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 8px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); vertical-align: middle; }
```
(Keep the rest of the component unchanged.)

- [ ] **Step 4: Add filter senders to `src/webview/sidebar/state.ts`.** Add `toggleInList` to the import from `../../core/sidebarState` (it currently imports `initialSidebarState, applyHostMessage, type SidebarState`). Append:
```ts
/** Toggle a tag in the active tag filter. */
export function toggleTagFilter(tag: string): void {
  sidebar.update((state) => ({ ...state, selectedTags: toggleInList(state.selectedTags, tag) }));
}

/** Toggle an author in the active author filter. */
export function toggleAuthorFilter(author: string): void {
  sidebar.update((state) => ({ ...state, selectedAuthors: toggleInList(state.selectedAuthors, author) }));
}

/** Show or hide resolved groups. */
export function setShowResolved(value: boolean): void {
  sidebar.update((state) => ({ ...state, showResolved: value }));
}
```

- [ ] **Step 5: Run component + unit + check-types**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types`
Expected: all green; check-types exit 0.

- [ ] **Step 6: Commit**
```bash
git add src/webview/sidebar/GroupCard.svelte src/webview/sidebar/GroupCard.svelte.test.ts src/webview/sidebar/state.ts
git commit -m "feat: resolved badge/dimming on group cards + sidebar filter store senders"
```

---

## Task 3: FilterBar component + App wiring

**Files:** Create `src/webview/sidebar/FilterBar.svelte`, `src/webview/sidebar/FilterBar.svelte.test.ts`; Modify `src/webview/sidebar/App.svelte`, `src/webview/sidebar/App.svelte.test.ts`

- [ ] **Step 1: Write the FilterBar test.** Create `src/webview/sidebar/FilterBar.svelte.test.ts`:
```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterBar from './FilterBar.svelte';

const base = { tags: [] as string[], authors: [] as string[], selectedTags: [] as string[], selectedAuthors: [] as string[], showResolved: false };

describe('FilterBar', () => {
  it('renders a chip per tag and author and a show-resolved checkbox', () => {
    render(FilterBar, { ...base, tags: ['security'], authors: ['Ana'] });
    expect(screen.getByRole('button', { name: 'security' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByTestId('show-resolved')).toBeInTheDocument();
  });
  it('marks a selected tag chip active', () => {
    render(FilterBar, { ...base, tags: ['security'], selectedTags: ['security'] });
    expect(screen.getByRole('button', { name: 'security' })).toHaveClass('active');
  });
  it('calls ontoggletag when a tag chip is clicked', async () => {
    const ontoggletag = vi.fn();
    render(FilterBar, { ...base, tags: ['security'], ontoggletag });
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    expect(ontoggletag).toHaveBeenCalledWith('security');
  });
  it('calls ontoggleauthor when an author chip is clicked', async () => {
    const ontoggleauthor = vi.fn();
    render(FilterBar, { ...base, authors: ['Ana'], ontoggleauthor });
    await userEvent.click(screen.getByRole('button', { name: 'Ana' }));
    expect(ontoggleauthor).toHaveBeenCalledWith('Ana');
  });
  it('calls onshowresolved with the new checkbox state', async () => {
    const onshowresolved = vi.fn();
    render(FilterBar, { ...base, onshowresolved });
    await userEvent.click(screen.getByTestId('show-resolved'));
    expect(onshowresolved).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/FilterBar.svelte.test.ts`
Expected: FAIL — `./FilterBar.svelte` does not exist.

- [ ] **Step 3: Create `src/webview/sidebar/FilterBar.svelte`:**
```svelte
<script lang="ts">
  let {
    tags,
    authors,
    selectedTags,
    selectedAuthors,
    showResolved,
    ontoggletag,
    ontoggleauthor,
    onshowresolved,
  }: {
    tags: string[];
    authors: string[];
    selectedTags: string[];
    selectedAuthors: string[];
    showResolved: boolean;
    ontoggletag?: (tag: string) => void;
    ontoggleauthor?: (author: string) => void;
    onshowresolved?: (value: boolean) => void;
  } = $props();
</script>

<div class="filter-bar" data-testid="filter-bar">
  {#if tags.length > 0}
    <div class="row" data-testid="tag-filters">
      <span class="label">Tags</span>
      {#each tags as tag (tag)}
        <button
          type="button"
          class="chip"
          class:active={selectedTags.includes(tag)}
          onclick={() => ontoggletag?.(tag)}
        >{tag}</button>
      {/each}
    </div>
  {/if}
  {#if authors.length > 0}
    <div class="row" data-testid="author-filters">
      <span class="label">Authors</span>
      {#each authors as author (author)}
        <button
          type="button"
          class="chip"
          class:active={selectedAuthors.includes(author)}
          onclick={() => ontoggleauthor?.(author)}
        >{author}</button>
      {/each}
    </div>
  {/if}
  <label class="resolved-toggle">
    <input
      type="checkbox"
      data-testid="show-resolved"
      checked={showResolved}
      onchange={(e) => onshowresolved?.(e.currentTarget.checked)}
    />
    Show resolved
  </label>
</div>

<style>
  .filter-bar { display: flex; flex-direction: column; gap: 6px; padding: 6px 4px 8px; border-bottom: 1px solid var(--vscode-sideBar-border, #333); margin-bottom: 8px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #9a9a9a); margin-right: 2px; }
  .chip { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); border: 1px solid transparent; border-radius: 10px; padding: 1px 8px; font-size: 11px; cursor: pointer; }
  .chip.active { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border-color: var(--vscode-focusBorder, #007fd4); }
  .resolved-toggle { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--vscode-foreground, #ccc); cursor: pointer; }
</style>
```

- [ ] **Step 4: Run to verify the FilterBar test passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/FilterBar.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `src/webview/sidebar/App.svelte`** to render the FilterBar and the filtered list:
```svelte
<script lang="ts">
  import { sidebar, setSelected, toggleTagFilter, toggleAuthorFilter, setShowResolved } from './state';
  import { postToHost } from './vscodeApi';
  import { filterGroups, availableTags, availableAuthors } from '../../core/sidebarState';
  import GroupCard from './GroupCard.svelte';
  import FilterBar from './FilterBar.svelte';

  const visible = $derived(filterGroups($sidebar));
  const tags = $derived(availableTags($sidebar.groups));
  const authors = $derived(availableAuthors($sidebar.groups));

  function onselect(id: string): void {
    setSelected(id);
    postToHost({ type: 'selectGroup', groupId: id });
  }
</script>

<main data-testid="sidebar">
  {#if $sidebar.groups.length === 0}
    <p class="empty" data-testid="empty">
      No annotations yet. Select code and run "Annotated: Create Annotation".
    </p>
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
    {#if visible.length === 0}
      <p class="empty" data-testid="no-matches">No groups match the current filters.</p>
    {:else}
      {#each visible as group (group.id)}
        <GroupCard
          {group}
          palette={$sidebar.palette}
          selected={$sidebar.selectedId === group.id}
          {onselect}
        />
      {/each}
    {/if}
  {/if}
</main>

<style>
  .empty { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 12px; padding: 8px; }
</style>
```
(If the existing App.svelte has a `<style>` block with `.empty` already, keep its rules — just ensure `.empty` exists. Preserve any other existing styles.)

- [ ] **Step 6: Rewrite `src/webview/sidebar/App.svelte.test.ts`** with the richer factory + filter interaction tests:
```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import App from './App.svelte';
import { sidebar } from './state';
import { initialSidebarState } from '../../core/sidebarState';
import { type AnnotationGroup } from '../../shared/model';

function group(
  id: string,
  title: string,
  opts: { author?: string; tags?: string[]; status?: 'open' | 'resolved' } = {},
): AnnotationGroup {
  return {
    id, title, author: opts.author ?? 'A', tags: opts.tags ?? [],
    gitRef: null, status: opts.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: [],
  };
}

describe('App.svelte', () => {
  beforeEach(() => {
    sidebar.set(initialSidebarState());
  });

  it('shows an empty-state message when there are no groups', () => {
    render(App);
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });

  it('renders a card per group from the store', () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'First'), group('g2', 'Second')], palette: [] });
    render(App);
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('First');
    expect(cards[1]).toHaveTextContent('Second');
  });

  it('hides resolved groups until show-resolved is checked', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Open one'), group('g2', 'Resolved one', { status: 'resolved' })],
      palette: [],
    });
    render(App);
    expect(screen.getAllByTestId('group-card')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('show-resolved'));
    expect(screen.getAllByTestId('group-card')).toHaveLength(2);
  });

  it('filters by tag when a tag chip is selected', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Sec', { tags: ['security'] }), group('g2', 'Todo', { tags: ['todo'] })],
      palette: [],
    });
    render(App);
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Sec');
  });

  it('renders the no-matches message when the only group is resolved and hidden', () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Resolved only', { status: 'resolved' })],
      palette: [],
    });
    render(App);
    expect(screen.getByTestId('no-matches')).toBeInTheDocument();
    expect(screen.queryByTestId('group-card')).toBeNull();
  });
});
```

- [ ] **Step 7: Run component + unit + check-types + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 8: Commit**
```bash
git add src/webview/sidebar/FilterBar.svelte src/webview/sidebar/FilterBar.svelte.test.ts src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts
git commit -m "feat: sidebar FilterBar (tag/author chips + show-resolved) wired into App"
```

---

## Task 4: Resolved seed group + filter e2e + full suite

**Files:** Create `test-workspace/.annotations/groups/seed-resolved.json`, `e2e/filters.spec.ts`; verify existing seed/specs

- [ ] **Step 1: Confirm no test asserts an exact seed group count.** Before adding a second seed group, grep so nothing breaks:
```bash
grep -rn "listGroups\|group-card\|seed-group\|Seed Group" src/web/test e2e
```
Read `e2e/sidebar.spec.ts` and `e2e/drift.spec.ts` and any sidebar integration test. CONFIRM they each rely on a single *visible* `group-card` (they will stay green because the new group is `resolved` → hidden by default). If any test asserts a literal group COUNT from `listGroups()` over the seed workspace (not the filtered webview), update that expected count by +1 and report it. (`updateAnnotationRange`/`createAnnotation` integration tests create+delete their own groups and are unaffected.)

- [ ] **Step 2: Read the existing seed to mirror its exact shape.** Read `test-workspace/.annotations/groups/seed-group.json`. Create `test-workspace/.annotations/groups/seed-resolved.json` with the SAME field shape, `id` matching the filename stem (`seed-resolved`), `status: "resolved"`, a distinct title, a distinct author, and at least one tag so the filter chips have content. Example (adjust field names to match the real seed exactly — especially `gitRef`, timestamps, and the annotation shape `{ id, file, range:{startLine,endLine}, content, contentHash }`):
```json
{
  "id": "seed-resolved",
  "title": "Resolved Group",
  "author": "Reviewer",
  "tags": ["archived"],
  "gitRef": null,
  "status": "resolved",
  "createdAt": 1,
  "updatedAt": 1,
  "annotations": [
    {
      "id": "r1",
      "file": "README.md",
      "range": { "startLine": 1, "endLine": 1 },
      "content": "Resolved note.",
      "contentHash": "seed"
    }
  ]
}
```

- [ ] **Step 3: Create `e2e/filters.spec.ts`.** Mirror the sidebar-only iframe drill used by `e2e/sidebar.spec.ts` exactly (read it first — copy its `.locator('iframe.webview')…contentFrame().locator('iframe#active-frame').contentFrame()` pattern and the activity-bar tab name regex `/Annotated/i`). Then:
```ts
import { test, expect } from '@playwright/test';

test('show-resolved reveals the resolved group with a badge', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  // Sidebar-only drill — copy the exact pattern from sidebar.spec.ts:
  const sidebar = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame();

  // The filter bar is present and resolved groups are hidden by default → exactly one card.
  await expect(sidebar.getByTestId('filter-bar')).toBeVisible({ timeout: 30_000 });
  await expect(sidebar.getByTestId('group-card')).toHaveCount(1);

  // Reveal resolved groups → the resolved seed card appears with a badge.
  await sidebar.getByTestId('show-resolved').click();
  await expect(sidebar.getByTestId('group-card')).toHaveCount(2);
  await expect(sidebar.getByTestId('resolved-badge')).toBeVisible();
});
```
> If `sidebar.spec.ts` uses `page.locator('iframe.webview').contentFrame()` WITHOUT `.first()`, use that exact form instead — match the existing spec so there's no strict-mode surprise when only the sidebar webview is mounted.

- [ ] **Step 4: Run the e2e** (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm run test:e2e`
Expected: 7 passed — the 6 from Phase 2b + `filters.spec`. The existing `sidebar.spec`/`drift.spec` still see a single visible card (resolved hidden by default). Do NOT weaken assertions; if the resolved card doesn't appear on toggle, debug the filter wiring rather than relaxing the test.

- [ ] **Step 5: Full suite (Definition of Done)** (`dangerouslyDisableSandbox: true`, `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**8 passing**, unchanged) → `test:e2e` (**7 passed**). All green. (If the integration count changed because you had to bump a seed-count assertion in Step 1, report the actual numbers.)

- [ ] **Step 6: Commit**
```bash
git add test-workspace/.annotations/groups/seed-resolved.json e2e/filters.spec.ts
git commit -m "test: resolved seed group + show-resolved filter e2e"
```
(Add any integration test file you had to adjust in Step 1 to this commit.)

---

## Phase 2c Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (filter logic, FilterBar, GroupCard badge, App filtering + earlier suites).
- [ ] `npm run test:integration` passes — **8 passing** (unchanged unless a seed-count assertion was bumped).
- [ ] `npm run test:e2e` passes — **7 passed** (incl. show-resolved filter).
- [ ] All work committed on the `phase-2` branch.
- [ ] Manual sanity (optional): tag/author chips filter the list (OR within a facet, AND across facets); resolved groups hidden by default, shown dimmed with a badge when the checkbox is on; selecting a tag that no longer exists after a live reload is pruned.

Next in Phase 2: **2d** — drag-reorder annotations within a group + Next/Previous navigation in the annotation view. After 2d, Phase 2 is complete → final review → merge `phase-2` → `main`.
