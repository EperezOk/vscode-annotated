<script lang="ts">
  import { type AnnotationGroup, type GroupStatus } from '../../shared/model';
  import { type TagColor } from '../../shared/protocol';
  import { tagColor } from '../../core/sidebarState';
  import { moveBefore } from '../../core/detailState';
  import AnnotationRow from './AnnotationRow.svelte';

  let {
    group,
    palette,
    staleIds = [],
    onrename,
    onedittags,
    oneditgitref,
    onselectrow,
    onreorder,
    onsetstatus,
  }: {
    group: AnnotationGroup;
    palette: TagColor[];
    staleIds?: string[];
    onrename?: (title: string) => void;
    onedittags?: () => void;
    oneditgitref?: () => void;
    onselectrow?: (id: string) => void;
    onreorder?: (annotationIds: string[]) => void;
    onsetstatus?: (status: GroupStatus) => void;
  } = $props();

  let editingTitle = $state(false);
  let titleDraft = $state('');
  let draggedId = $state<string | null>(null);

  function dropOn(targetId: string): void {
    if (draggedId === null || draggedId === targetId) {
      draggedId = null;
      return;
    }
    const next = moveBefore(group.annotations.map((a) => a.id), draggedId, targetId);
    draggedId = null;
    onreorder?.(next);
  }

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
  const resolveLabel = $derived(group.status === 'resolved' ? 'Restore' : 'Resolve');
  function toggleStatus(): void {
    onsetstatus?.(group.status === 'resolved' ? 'open' : 'resolved');
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
      <button type="button" class="link" data-testid="resolve-btn" onclick={toggleStatus}>{resolveLabel}</button>
    </div>
  </header>

  <div class="rows">
    {#each group.annotations as annotation (annotation.id)}
      <div
        class="row-wrap"
        class:dragging={draggedId === annotation.id}
        data-testid="annotation-drag"
        draggable="true"
        role="listitem"
        ondragstart={() => (draggedId = annotation.id)}
        ondragover={(e: DragEvent) => e.preventDefault()}
        ondrop={(e: DragEvent) => { e.preventDefault(); dropOn(annotation.id); }}
        ondragend={() => (draggedId = null)}
      >
        <span class="grip" aria-hidden="true">⠿</span>
        <AnnotationRow
          {annotation}
          selected={false}
          stale={staleIds.includes(annotation.id)}
          onselect={(id) => onselectrow?.(id)}
        />
      </div>
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
  .row-wrap { display: flex; align-items: center; gap: 4px; cursor: grab; }
  .row-wrap.dragging { opacity: 0.5; }
  .row-wrap > :global(button) { flex: 1; }
  .grip { color: var(--vscode-descriptionForeground, #888); font-size: 12px; user-select: none; }
</style>
