<script lang="ts">
  import { detail, openAnnotationView, showGroupView, saveAnnotationContent, copyToClipboard } from './state';
  import { postToHost } from './vscodeApi';
  import { tagColor } from '../../core/sidebarState';
  import AnnotationRow from './AnnotationRow.svelte';
  import AnnotationView from './AnnotationView.svelte';

  function openRow(id: string): void {
    openAnnotationView(id);
    postToHost({ type: 'selectAnnotation', annotationId: id }); // navigate-to-code
  }

  const current = $derived(
    $detail.group?.annotations.find((a) => a.id === $detail.selectedAnnotationId) ?? null,
  );
</script>

<main data-testid="detail">
  {#if !$detail.group}
    <p class="empty" data-testid="detail-empty">Select a group to see its annotations.</p>
  {:else if $detail.mode === 'annotation' && current}
    {#key $detail.selectedAnnotationId}
      <AnnotationView
        annotation={current}
        onback={showGroupView}
        onsave={(id, content) => saveAnnotationContent(id, content)}
        oncopy={(content) => copyToClipboard(content)}
        oncopyloc={(loc) => copyToClipboard(loc)}
      />
    {/key}
  {:else}
    <header class="head">
      <div class="title" data-testid="detail-title">{$detail.group.title}</div>
      <div class="meta">{$detail.group.author} · {$detail.group.status}</div>
      {#if $detail.group.tags.length > 0}
        <div class="chips">
          {#each $detail.group.tags as tag (tag)}
            <span class="chip" style="background:{tagColor($detail.palette, tag)}">{tag}</span>
          {/each}
        </div>
      {/if}
      {#if $detail.group.gitRef}
        <div class="gitref">Git ref: <code>{$detail.group.gitRef}</code></div>
      {/if}
    </header>
    <div class="rows">
      {#each $detail.group.annotations as annotation (annotation.id)}
        <AnnotationRow {annotation} selected={false} onselect={openRow} />
      {/each}
    </div>
  {/if}
</main>

<style>
  main { padding: 8px; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); }
  .empty { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 12px; padding: 8px 2px; }
  .head { padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c); margin-bottom: 6px; }
  .title { font-size: 15px; font-weight: 600; color: var(--vscode-foreground, #eee); }
  .meta { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 11.5px; margin-top: 3px; }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
  .chip { font-size: 10.5px; padding: 1px 8px; border-radius: 9px; color: #fff; }
  .gitref { font-size: 11.5px; color: #bbb; margin-top: 8px; }
  .gitref code { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 6px; border-radius: 3px; }
</style>
