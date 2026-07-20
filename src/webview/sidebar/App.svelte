<script lang="ts">
  import { onDestroy } from 'svelte';
  import { sidebar, setSelected, toggleTagFilter, toggleAuthorFilter, toggleGitRefFilter, setShowResolved, toggleBulkMode, toggleGroupSelection, bulkEditTags, bulkEditGitRef, bulkResolveRestore, bulkDelete } from './state';
  import { postToHost } from './vscodeApi';
  import { filterGroups, availableTags, availableAuthors, availableGitRefs } from '../../core/sidebarState';
  import GroupCard from './GroupCard.svelte';
  import FilterBar from './FilterBar.svelte';

  const visible = $derived(filterGroups($sidebar));
  const tags = $derived(availableTags($sidebar.groups));
  const authors = $derived(availableAuthors($sidebar.groups));
  const gitRefs = $derived(availableGitRefs($sidebar.groups));

  function onselect(id: string): void {
    setSelected(id);
    postToHost({ type: 'selectGroup', groupId: id });
  }

  let refreshed = $state(false);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  function refreshFiles(): void {
    postToHost({ type: 'refresh' });
    refreshed = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => (refreshed = false), 1500);
  }
  onDestroy(() => clearTimeout(refreshTimer));
</script>

<main data-testid="sidebar">
  <header class="bar">
    <button type="button" class="link" data-testid="refresh-btn" title="Reload annotations from disk" onclick={refreshFiles}>{refreshed ? '✓ Refreshed' : '↻ Refresh'}</button>
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
        {gitRefs}
        selectedTags={$sidebar.selectedTags}
        selectedAuthors={$sidebar.selectedAuthors}
        selectedGitRefs={$sidebar.selectedGitRefs}
        showResolved={$sidebar.showResolved}
        palette={$sidebar.palette}
        ontoggletag={toggleTagFilter}
        ontoggleauthor={toggleAuthorFilter}
        ontogglegitref={toggleGitRefFilter}
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
          commentCount={$sidebar.commentCounts[group.id] ?? 0}
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

<style>
  main {
    padding: 8px;
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground, #ccc);
  }
  .empty {
    color: var(--vscode-descriptionForeground, #9a9a9a);
    font-size: 12px;
    padding: 8px 2px;
  }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 2px 6px; }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11.5px; padding: 0; }
  .bulk-bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 4px 8px; border-bottom: 1px solid var(--vscode-sideBar-border, #333); margin-bottom: 8px; background: var(--vscode-sideBar-background, #1e1e1e); }
  .count { font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); margin-right: auto; }
  .bbtn { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); border: none; border-radius: 3px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
  .bbtn:disabled { opacity: 0.4; cursor: default; }
  .bbtn.danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-foreground, #fff); }
</style>
