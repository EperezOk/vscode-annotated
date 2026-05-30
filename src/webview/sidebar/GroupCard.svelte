<script lang="ts">
  import { type AnnotationGroup } from '../../shared/model';
  import { type TagColor } from '../../shared/protocol';
  import { tagColor } from '../../core/sidebarState';

  let {
    group,
    palette,
    selected = false,
    onselect,
  }: {
    group: AnnotationGroup;
    palette: TagColor[];
    selected?: boolean;
    onselect?: (id: string) => void;
  } = $props();
</script>

<button
  type="button"
  class="card"
  class:selected
  data-testid="group-card"
  onclick={() => onselect?.(group.id)}
>
  <div class="title">{group.title}</div>
  <div class="meta">{group.author} · {group.annotations.length} annotation{group.annotations.length === 1 ? '' : 's'}</div>
  {#if group.tags.length > 0}
    <div class="chips">
      {#each group.tags as tag (tag)}
        <span class="chip" style="background:{tagColor(palette, tag)}">{tag}</span>
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
    color: #fff;
  }
</style>
