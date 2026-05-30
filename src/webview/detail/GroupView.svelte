<script lang="ts">
  import { type AnnotationGroup } from '../../shared/model';
  import { type TagColor } from '../../shared/protocol';
  import { tagColor } from '../../core/sidebarState';
  import AnnotationRow from './AnnotationRow.svelte';

  let {
    group,
    palette,
    onrename,
    onedittags,
    oneditgitref,
    onselectrow,
  }: {
    group: AnnotationGroup;
    palette: TagColor[];
    onrename?: (title: string) => void;
    onedittags?: () => void;
    oneditgitref?: () => void;
    onselectrow?: (id: string) => void;
  } = $props();

  let editingTitle = $state(false);
  let titleDraft = $state('');

  function startTitleEdit(): void {
    titleDraft = group.title;
    editingTitle = true;
  }
  function commitTitle(): void {
    const trimmed = titleDraft.trim();
    editingTitle = false;
    if (trimmed && trimmed !== group.title) {
      onrename?.(trimmed);
    }
  }
  function onTitleKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      commitTitle();
    } else if (event.key === 'Escape') {
      editingTitle = false;
    }
  }
</script>

<section class="group-view" data-testid="group-view">
  <header class="head">
    {#if editingTitle}
      <input
        class="title-input"
        data-testid="title-input"
        bind:value={titleDraft}
        onkeydown={onTitleKey}
        onblur={commitTitle}
      />
    {:else}
      <div class="title-row">
        <span class="title" data-testid="detail-title">{group.title}</span>
        <button type="button" class="icon" data-testid="title-edit-btn" title="Rename" onclick={startTitleEdit}>✎</button>
      </div>
    {/if}
    <div class="meta">{group.author} · {group.status}</div>

    <div class="tags-row">
      {#each group.tags as tag (tag)}
        <span class="chip" style="background:{tagColor(palette, tag)}">{tag}</span>
      {/each}
      <button type="button" class="link" data-testid="edit-tags-btn" onclick={() => onedittags?.()}>＋ edit tags</button>
    </div>

    <div class="gitref-row">
      Git ref: {#if group.gitRef}<code>{group.gitRef}</code>{:else}<span class="none">none</span>{/if}
      <button type="button" class="link" data-testid="edit-gitref-btn" onclick={() => oneditgitref?.()}>edit</button>
    </div>
  </header>

  <div class="rows">
    {#each group.annotations as annotation (annotation.id)}
      <AnnotationRow {annotation} selected={false} onselect={(id) => onselectrow?.(id)} />
    {/each}
  </div>
</section>

<style>
  .group-view { padding: 8px; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); }
  .head { padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c); margin-bottom: 6px; }
  .title-row { display: flex; align-items: center; gap: 6px; }
  .title { font-size: 15px; font-weight: 600; color: var(--vscode-foreground, #eee); }
  .title-input { width: 100%; box-sizing: border-box; font-size: 15px; padding: 2px 4px; background: var(--vscode-input-background, #2a2a2a); color: var(--vscode-input-foreground, #ddd); border: 1px solid var(--vscode-focusBorder, #3794ff); border-radius: 3px; }
  .icon { background: none; border: none; color: var(--vscode-descriptionForeground, #9a9a9a); cursor: pointer; font-size: 12px; padding: 0; }
  .meta { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 11.5px; margin-top: 3px; }
  .tags-row { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
  .chip { font-size: 10.5px; padding: 1px 8px; border-radius: 9px; color: #fff; }
  .gitref-row { font-size: 11.5px; color: #bbb; margin-top: 8px; }
  .gitref-row code { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 6px; border-radius: 3px; }
  .none { color: var(--vscode-descriptionForeground, #9a9a9a); }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11px; padding: 0; }
</style>
