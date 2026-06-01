# Phase 4f — Sidebar Filter Dropdown + Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible tag/author filter chips with a **searchable dropdown** (full list shown on focus, typing filters, selected values become removable pills) (TODO #9), and add a **manual refresh button** to the sidebar header that reloads from disk (TODO #10).

**Architecture:** A pure `filterOptions(all, selected, query, cap)` helper in `core/sidebarState.ts`; a reusable `FilterPicker.svelte` combobox; `FilterBar.svelte` uses two pickers (tags — colored pills via the palette + `contrastColor` from 4a — and authors), keeping the existing "Show resolved" checkbox. `App.svelte` gains a header refresh button posting a new `refresh` message that `sidebarViewProvider` handles by calling its existing `refresh()`. Filter *selection state* and `filterGroups` are unchanged — only presentation.

**Tech Stack:** Svelte 5 (runes), Vitest (unit + jsdom component), VSCode webview messaging.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality

`filterOptions` and the `refresh` protocol arm are unit-tested. `FilterPicker` and the rewritten `FilterBar` are component-tested in jsdom. `App.svelte`'s tag-filter test is rewritten to drive the dropdown. The `sidebarViewProvider` handler is `vscode`-glue (type-check only). **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/core/sidebarState.ts` (+ `.unit.test.ts`) — add `filterOptions`.
- **Create** `src/webview/sidebar/FilterPicker.svelte` (+ `.svelte.test.ts`) — reusable searchable dropdown.
- **Modify** `src/webview/sidebar/FilterBar.svelte` (+ rewrite `.svelte.test.ts`) — use two `FilterPicker`s + palette.
- **Modify** `src/webview/sidebar/App.svelte` (+ `.svelte.test.ts`) — pass palette; add refresh button.
- **Modify** `src/shared/protocol.ts` (+ `.unit.test.ts`) — add `refresh` webview→host message.
- **Modify** `src/web/sidebarViewProvider.ts` — handle `refresh`.

---

### Task 1: `filterOptions` pure helper

**Files:**
- Modify: `src/core/sidebarState.ts`
- Test: `src/core/sidebarState.unit.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/core/sidebarState.unit.test.ts` (it already imports from `./sidebarState`; add `filterOptions` to that import):

```ts
describe('filterOptions', () => {
  const all = ['security', 'todo', 'perf', 'bug'];

  it('returns all unselected options for an empty query', () => {
    expect(filterOptions(all, ['todo'], '')).toEqual({ visible: ['security', 'perf', 'bug'], more: 0 });
  });

  it('filters by case-insensitive substring', () => {
    expect(filterOptions(all, [], 'E')).toEqual({ visible: ['security', 'perf'], more: 0 });
  });

  it('excludes already-selected options', () => {
    expect(filterOptions(all, ['security'], 'se')).toEqual({ visible: [], more: 0 });
  });

  it('caps the list and reports how many more matched', () => {
    const many = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const result = filterOptions(many, [], '', 50);
    expect(result.visible).toHaveLength(50);
    expect(result.more).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/sidebarState.unit.test.ts`
Expected: FAIL — `filterOptions` is not exported.

- [ ] **Step 3: Implement.** Append to `src/core/sidebarState.ts`:

```ts
/**
 * Visible options for a filter dropdown: options not already selected that match the
 * (case-insensitive, trimmed) query, capped to `cap`. An empty query returns all
 * unselected options. `more` is how many matches were dropped past the cap.
 */
export function filterOptions(
  all: string[],
  selected: string[],
  query: string,
  cap = 50,
): { visible: string[]; more: number } {
  const q = query.trim().toLowerCase();
  const matches = all.filter(
    (o) => !selected.includes(o) && (q === '' || o.toLowerCase().includes(q)),
  );
  return { visible: matches.slice(0, cap), more: Math.max(0, matches.length - cap) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/sidebarState.unit.test.ts`
Expected: PASS (all sidebarState tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/sidebarState.ts src/core/sidebarState.unit.test.ts
git commit -m "feat(sidebar): filterOptions helper for the filter dropdown (TODO #9)"
```

---

### Task 2: `FilterPicker.svelte` reusable searchable dropdown

**Files:**
- Create: `src/webview/sidebar/FilterPicker.svelte`
- Test: `src/webview/sidebar/FilterPicker.svelte.test.ts`

- [ ] **Step 1: Write the failing component test** — create `src/webview/sidebar/FilterPicker.svelte.test.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterPicker from './FilterPicker.svelte';

const base = { label: 'Tags', options: ['security', 'todo', 'perf'], selected: [] as string[] };

describe('FilterPicker', () => {
  it('shows no option menu until the input is focused', () => {
    render(FilterPicker, { ...base });
    expect(screen.queryByTestId('picker-menu-Tags')).toBeNull();
  });

  it('reveals the full option list on focus', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    expect(screen.getByRole('button', { name: 'security' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'perf' })).toBeInTheDocument();
  });

  it('filters the list as you type', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.type(screen.getByTestId('picker-input-Tags'), 'se');
    expect(screen.getByRole('button', { name: 'security' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'todo' })).toBeNull();
  });

  it('calls onToggle when an option is chosen', async () => {
    const onToggle = vi.fn();
    render(FilterPicker, { ...base, onToggle });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    expect(onToggle).toHaveBeenCalledWith('security');
  });

  it('renders selected values as removable pills and removes on ✕', async () => {
    const onToggle = vi.fn();
    render(FilterPicker, { ...base, selected: ['security'], onToggle });
    expect(screen.getByTestId('pill-Tags')).toHaveTextContent('security');
    await userEvent.click(screen.getByTestId('pill-remove-Tags'));
    expect(onToggle).toHaveBeenCalledWith('security');
  });

  it('closes the menu on Escape', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    expect(screen.getByTestId('picker-menu-Tags')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('picker-menu-Tags')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/FilterPicker.svelte.test.ts`
Expected: FAIL — cannot resolve `./FilterPicker.svelte`.

- [ ] **Step 3: Implement `src/webview/sidebar/FilterPicker.svelte`:**

```svelte
<script lang="ts">
  import { filterOptions } from '../../core/sidebarState';
  import { contrastColor } from '../../shared/color';

  let {
    label,
    options,
    selected,
    onToggle,
    colorFor,
    placeholder = 'Filter…',
  }: {
    label: string;
    options: string[];
    selected: string[];
    onToggle?: (value: string) => void;
    colorFor?: (value: string) => string;
    placeholder?: string;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let highlighted = $state(0);

  const result = $derived(filterOptions(options, selected, query));

  function choose(value: string): void {
    onToggle?.(value);
    query = '';
    highlighted = 0;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      query = '';
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(highlighted + 1, result.visible.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const value = result.visible[highlighted];
      if (value) {
        choose(value);
      }
    }
  }
</script>

<div class="picker" data-testid="filter-picker-{label}">
  <span class="label">{label}</span>
  <div class="field">
    {#each selected as value (value)}
      {@const bg = colorFor ? colorFor(value) : undefined}
      <span class="pill" data-testid="pill-{label}" style={bg ? `background:${bg}; color:${contrastColor(bg)}` : ''}>
        {value}
        <button type="button" class="pill-x" data-testid="pill-remove-{label}" aria-label="Remove {value}" onclick={() => onToggle?.(value)}>✕</button>
      </span>
    {/each}
    <input
      type="text"
      class="picker-input"
      data-testid="picker-input-{label}"
      placeholder={placeholder}
      bind:value={query}
      onfocus={() => (open = true)}
      onblur={() => (open = false)}
      onkeydown={onkeydown}
    />
  </div>
  {#if open}
    <ul class="menu" data-testid="picker-menu-{label}">
      {#each result.visible as option, i (option)}
        {@const obg = colorFor ? colorFor(option) : undefined}
        <li>
          <button
            type="button"
            class="option"
            class:highlighted={i === highlighted}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => choose(option)}
          >
            {#if obg}<span class="swatch" style="background:{obg}"></span>{/if}
            {option}
          </button>
        </li>
      {/each}
      {#if result.visible.length === 0}
        <li class="hint" data-testid="picker-empty-{label}">No matches</li>
      {/if}
      {#if result.more > 0}
        <li class="hint" data-testid="picker-more-{label}">+{result.more} more — type to filter…</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .field { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; flex: 1; min-width: 80px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
  .pill-x { background: none; border: none; color: inherit; cursor: pointer; font-size: 10px; padding: 0; line-height: 1; }
  .picker-input { flex: 1; min-width: 60px; background: var(--vscode-input-background, #2a2a2a); color: var(--vscode-input-foreground, #ddd); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; padding: 1px 5px; font-size: 11px; }
  .menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; margin: 2px 0 0; padding: 2px; list-style: none; max-height: 180px; overflow: auto; background: var(--vscode-dropdown-background, #252526); border: 1px solid var(--vscode-dropdown-border, #454545); border-radius: 4px; }
  .menu .option { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground, #ccc); cursor: pointer; padding: 3px 6px; font-size: 11.5px; border-radius: 3px; }
  .menu .option.highlighted, .menu .option:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  .swatch { width: 9px; height: 9px; border-radius: 2px; flex: none; }
  .hint { padding: 3px 6px; font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); }
</style>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/FilterPicker.svelte.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar/FilterPicker.svelte src/webview/sidebar/FilterPicker.svelte.test.ts
git commit -m "feat(sidebar): FilterPicker searchable dropdown component (TODO #9)"
```

---

### Task 3: `FilterBar.svelte` uses two `FilterPicker`s

**Files:**
- Modify: `src/webview/sidebar/FilterBar.svelte`
- Test: `src/webview/sidebar/FilterBar.svelte.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the test** — replace the entire contents of `src/webview/sidebar/FilterBar.svelte.test.ts` with:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterBar from './FilterBar.svelte';

const base = {
  tags: [] as string[], authors: [] as string[],
  selectedTags: [] as string[], selectedAuthors: [] as string[],
  showResolved: false, palette: [] as { name: string; color: string }[],
};

describe('FilterBar', () => {
  it('shows the show-resolved checkbox and no options until a picker is focused', () => {
    render(FilterBar, { ...base, tags: ['security'], authors: ['Ana'] });
    expect(screen.getByTestId('show-resolved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'security' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ana' })).toBeNull();
  });

  it('toggles a tag when chosen from the tag picker', async () => {
    const ontoggletag = vi.fn();
    render(FilterBar, { ...base, tags: ['security'], ontoggletag });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    expect(ontoggletag).toHaveBeenCalledWith('security');
  });

  it('toggles an author when chosen from the author picker', async () => {
    const ontoggleauthor = vi.fn();
    render(FilterBar, { ...base, authors: ['Ana'], ontoggleauthor });
    await userEvent.click(screen.getByTestId('picker-input-Authors'));
    await userEvent.click(screen.getByRole('button', { name: 'Ana' }));
    expect(ontoggleauthor).toHaveBeenCalledWith('Ana');
  });

  it('shows a selected tag as a pill', () => {
    render(FilterBar, { ...base, tags: ['security'], selectedTags: ['security'] });
    expect(screen.getByTestId('pill-Tags')).toHaveTextContent('security');
  });

  it('calls onshowresolved with the new checkbox state', async () => {
    const onshowresolved = vi.fn();
    render(FilterBar, { ...base, onshowresolved });
    await userEvent.click(screen.getByTestId('show-resolved'));
    expect(onshowresolved).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/FilterBar.svelte.test.ts`
Expected: FAIL — no `picker-input-Tags` (FilterBar still renders the old chips).

- [ ] **Step 3: Rewrite `src/webview/sidebar/FilterBar.svelte`:**

```svelte
<script lang="ts">
  import FilterPicker from './FilterPicker.svelte';
  import { tagColor } from '../../core/sidebarState';
  import { type TagColor } from '../../shared/protocol';

  let {
    tags,
    authors,
    selectedTags,
    selectedAuthors,
    showResolved,
    palette = [],
    ontoggletag,
    ontoggleauthor,
    onshowresolved,
  }: {
    tags: string[];
    authors: string[];
    selectedTags: string[];
    selectedAuthors: string[];
    showResolved: boolean;
    palette?: TagColor[];
    ontoggletag?: (tag: string) => void;
    ontoggleauthor?: (author: string) => void;
    onshowresolved?: (value: boolean) => void;
  } = $props();
</script>

<div class="filter-bar" data-testid="filter-bar">
  {#if tags.length > 0}
    <FilterPicker
      label="Tags"
      options={tags}
      selected={selectedTags}
      onToggle={ontoggletag}
      colorFor={(t) => tagColor(palette, t)}
      placeholder="Filter by tag…"
    />
  {/if}
  {#if authors.length > 0}
    <FilterPicker
      label="Authors"
      options={authors}
      selected={selectedAuthors}
      onToggle={ontoggleauthor}
      placeholder="Filter by author…"
    />
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
  .filter-bar { display: flex; flex-direction: column; gap: 8px; padding: 6px 4px 8px; border-bottom: 1px solid var(--vscode-sideBar-border, #333); margin-bottom: 8px; }
  .resolved-toggle { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--vscode-foreground, #ccc); cursor: pointer; }
</style>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/FilterBar.svelte.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar/FilterBar.svelte src/webview/sidebar/FilterBar.svelte.test.ts
git commit -m "feat(sidebar): FilterBar uses searchable tag/author pickers (TODO #9)"
```

---

### Task 4: `App.svelte` — pass palette + add the refresh button

**Files:**
- Modify: `src/webview/sidebar/App.svelte`
- Test: `src/webview/sidebar/App.svelte.test.ts`

- [ ] **Step 1: Update/add tests.** In `src/webview/sidebar/App.svelte.test.ts`:

(a) Replace the existing `it('filters by tag when a tag chip is selected', ...)` test with the dropdown-driven version:

```ts
  it('filters by tag selected from the dropdown', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Sec', { tags: ['security'] }), group('g2', 'Todo', { tags: ['todo'] })],
      palette: [],
    });
    render(App);
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Sec');
  });
```

(b) Add a refresh test (the `postToHost` mock is already set up at the top of the file):

```ts
  it('posts a refresh message when the refresh button is clicked', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One')], palette: [] });
    render(App);
    await userEvent.click(screen.getByTestId('refresh-btn'));
    expect(postToHost).toHaveBeenCalledWith({ type: 'refresh' });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL — no `picker-input-Tags` and no `refresh-btn` yet.

- [ ] **Step 3: Implement in `src/webview/sidebar/App.svelte`.**

(a) Add a refresh handler to the `<script>` (near the existing `onselect` function):

```ts
  function refreshFiles(): void {
    postToHost({ type: 'refresh' });
  }
```

(b) Restructure the top of `<main>` so a header with the refresh button is **always** present (today the header only renders when there are groups). Replace:

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
```

with:

```svelte
<main data-testid="sidebar">
  <header class="bar">
    <button type="button" class="link" data-testid="refresh-btn" title="Reload annotations from disk" onclick={refreshFiles}>↻ Refresh</button>
    {#if $sidebar.groups.length > 0}
      <button type="button" class="link" data-testid="bulk-toggle" onclick={toggleBulkMode}>
        {$sidebar.bulkMode ? 'Done' : 'Select'}
      </button>
    {/if}
  </header>
  {#if $sidebar.groups.length === 0}
    <p class="empty" data-testid="empty">
      No annotations yet. Select code and run "Annotated: Create Annotation".
    </p>
  {:else}
```

(Delete the old `<header class="bar">…</header>` block that was inside the `{:else}` — it is now hoisted above. The rest of the `{:else}` branch — the `{#if $sidebar.bulkMode}` bulk-bar / FilterBar block and the cards — stays unchanged except for step (c).)

(c) Pass the palette to `FilterBar`. Change the `<FilterBar ... />` usage to add the `palette` prop:

```svelte
      <FilterBar
        {tags}
        {authors}
        selectedTags={$sidebar.selectedTags}
        selectedAuthors={$sidebar.selectedAuthors}
        showResolved={$sidebar.showResolved}
        palette={$sidebar.palette}
        ontoggletag={toggleTagFilter}
        ontoggleauthor={toggleAuthorFilter}
        onshowresolved={setShowResolved}
      />
```

(d) Update the `.bar` style rule so the header lays out the refresh button on the left and bulk-toggle on the right. Change:

```css
  .bar { display: flex; justify-content: flex-end; padding: 2px 2px 6px; }
```

to:

```css
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 2px 6px; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/App.svelte.test.ts`
Expected: PASS (all App tests, including the rewritten tag-filter test and the new refresh test).

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts
git commit -m "feat(sidebar): always-on header with refresh button; pass palette to FilterBar (TODO #9, #10)"
```

---

### Task 5: `refresh` webview→host protocol message

**Files:**
- Modify: `src/shared/protocol.ts`
- Test: `src/shared/protocol.unit.test.ts`

- [ ] **Step 1: Write the failing test** — add inside `describe('parseWebviewMessage', ...)` in `src/shared/protocol.unit.test.ts`:

```ts
  it('accepts a refresh message', () => {
    expect(parseWebviewMessage({ type: 'refresh' })).toEqual({ type: 'refresh' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: FAIL — returns `null` (unknown type).

- [ ] **Step 3: Implement.** In `src/shared/protocol.ts`:

(a) Add a member to the `WebviewToHost` union (after the `ready` member):

```ts
  | { type: 'ready' }
  | { type: 'refresh' }
```

(b) Add a parse arm in `parseWebviewMessage`'s `switch`, alongside the `ready` case:

```ts
    case 'refresh':
      return { type: 'refresh' };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat(protocol): add refresh webview→host message (TODO #10)"
```

---

### Task 6: Handle `refresh` in `SidebarViewProvider`

**Files:**
- Modify: `src/web/sidebarViewProvider.ts`

- [ ] **Step 1: Handle the message.** In `src/web/sidebarViewProvider.ts`'s `onDidReceiveMessage` handler, add a branch (e.g. right after the `ready` branch that already calls `this.refresh()`):

```ts
      } else if (message.type === 'refresh') {
        await this.refresh();
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/web/sidebarViewProvider.ts
git commit -m "feat(sidebar): reload from disk on refresh message (TODO #10)"
```

---

### Task 7: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest unit + component tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** TODO #9 (searchable dropdown, full list on focus, typing filters, removable pills, colored tag pills) → `filterOptions` (Task 1) + `FilterPicker` (Task 2) + `FilterBar` integration (Task 3). TODO #10 (refresh) → header button (Task 4) + `refresh` message (Task 5) + handler (Task 6). ✓
- **Type consistency:** `filterOptions(all, selected, query, cap?) → { visible: string[]; more: number }`. `FilterPicker` props (`label/options/selected/onToggle/colorFor/placeholder`) match `FilterBar`'s usage; tag pills colored via `tagColor(palette, t)` + `contrastColor` (from 4a). `WebviewToHost` gains `{ type: 'refresh' }`, posted by `App` and handled in `SidebarViewProvider`. Filter selection state + `filterGroups` untouched. ✓
- **Existing tests updated, not deleted:** `FilterBar.svelte.test.ts` rewritten to the dropdown UX; `App.svelte.test.ts` tag-filter test rewritten to drive the dropdown; the bulk-mode/empty/no-matches tests still pass (header hoist preserves `empty` + `bulk-toggle`). ✓
- **Combobox blur/click:** options use `onmousedown|preventDefault` so the input doesn't blur-close before the option's `onclick` fires; a genuine outside click blurs the input and closes the menu. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** `type TagColor` imported as type; `filterOptions`/`tagColor`/`contrastColor`/`FilterPicker` are value imports. ✓
- **Out of scope:** wiring the manual refresh to also recompute editor gutter indicators is deferred to 4g (which adds the gutter manager); 4f's refresh reloads the sidebar only.
