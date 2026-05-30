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
