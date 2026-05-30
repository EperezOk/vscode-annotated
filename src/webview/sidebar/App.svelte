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
</style>
