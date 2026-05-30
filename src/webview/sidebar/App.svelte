<script lang="ts">
  import { sidebar, setSelected } from './state';
  import { postToHost } from './vscodeApi';
  import GroupCard from './GroupCard.svelte';

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
    {#each $sidebar.groups as group (group.id)}
      <GroupCard
        {group}
        palette={$sidebar.palette}
        selected={$sidebar.selectedId === group.id}
        {onselect}
      />
    {/each}
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
