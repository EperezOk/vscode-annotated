<script lang="ts">
  import { type AnnotationGroup } from '../../shared/model';
  import { type TagColor } from '../../shared/protocol';
  import { tagColor } from '../../core/sidebarState';
  import { contrastColor } from '../../shared/color';
  import CommentBadge from '../shared/CommentBadge.svelte';

  let {
    group,
    palette,
    commentCount = 0,
    selected = false,
    bulkMode = false,
    checked = false,
    onselect,
    oncheck,
  }: {
    group: AnnotationGroup;
    palette: TagColor[];
    commentCount?: number;
    selected?: boolean;
    bulkMode?: boolean;
    checked?: boolean;
    onselect?: (id: string) => void;
    oncheck?: (id: string) => void;
  } = $props();
</script>

<button
  type="button"
  class="card"
  class:selected
  class:resolved={group.status === 'resolved'}
  data-testid="group-card"
  data-vscode-context={JSON.stringify({ webviewSection: 'group', groupId: group.id, preventDefaultContextMenuItems: true })}
  onclick={() => (bulkMode ? oncheck?.(group.id) : onselect?.(group.id))}
>
  {#if bulkMode}
    <input type="checkbox" class="bulk-cb" data-testid="bulk-checkbox" checked={checked} tabindex="-1" aria-label="Select group" />
  {/if}
  <div class="title">
    {group.title}
    {#if group.status === 'resolved'}<span class="badge" data-testid="resolved-badge">resolved</span>{/if}
  </div>
  <div class="meta">{group.author} · {group.annotations.length} annotation{group.annotations.length === 1 ? '' : 's'} <CommentBadge count={commentCount} /></div>
  {#if group.tags.length > 0}
    <div class="chips">
      {#each group.tags as tag (tag.name)}
        {@const bg = tagColor(palette, tag.name)}
        <span class="chip" data-testid="tag-chip" style="background:{bg}; color:{contrastColor(bg)}">{tag.name}</span>
      {/each}
    </div>
  {/if}
</button>

<style>
  .card {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-foreground, #ccc);
    border: 1px solid var(--vscode-widget-border, #3c3c3c);
    border-left: 3px solid var(--vscode-focusBorder, #3794ff);
    border-radius: 4px;
    padding: 8px 10px;
    margin-bottom: 8px;
    cursor: pointer;
    font-family: var(--vscode-font-family, sans-serif);
  }
  .card.selected {
    outline: 1px solid var(--vscode-focusBorder, #3794ff);
  }
  .card.resolved { opacity: 0.6; }
  .badge { margin-left: 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 8px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); vertical-align: middle; }
  .title {
    font-weight: 600;
    font-size: 12.5px;
  }
  .meta {
    color: var(--vscode-descriptionForeground, #9a9a9a);
    font-size: 11px;
    margin-top: 2px;
  }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 9px;
  }
  .bulk-cb { margin-right: 6px; pointer-events: none; vertical-align: middle; }
</style>
