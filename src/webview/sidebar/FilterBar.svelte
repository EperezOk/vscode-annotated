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
