<script lang="ts">
  import GroupView from './GroupView.svelte';
  import {
    detail, openAnnotationView, showGroupView, saveAnnotationContent, copyToClipboard,
    renameGroup, requestEditTags, requestEditGitRef, saveAnnotationRange, reorderAnnotations, setGroupStatus,
    addComment, editComment, deleteComment, addGroupComment, openLocalLink, refocusCode,
  } from './state';
  import { postToHost } from './vscodeApi';
  import AnnotationView from './AnnotationView.svelte';
  import { prevAnnotationId, nextAnnotationId, annotationPosition, commentsFor } from '../../core/detailState';

  function openRow(id: string): void {
    openAnnotationView(id);
    postToHost({ type: 'selectAnnotation', annotationId: id }); // navigate-to-code
  }

  const current = $derived(
    $detail.group?.annotations.find((a) => a.id === $detail.selectedAnnotationId) ?? null,
  );
  const prevId = $derived(prevAnnotationId($detail));
  const nextId = $derived(nextAnnotationId($detail));
  const position = $derived(annotationPosition($detail));
</script>

<main data-testid="detail">
  {#if !$detail.group}
    <p class="empty" data-testid="detail-empty">Select a group to see its annotations.</p>
  {:else if $detail.mode === 'annotation' && current}
    {#key $detail.selectedAnnotationId}
      <AnnotationView
        annotation={current}
        stale={($detail.staleIds ?? []).includes(current.id)}
        onback={showGroupView}
        onsave={(id, content) => saveAnnotationContent(id, content)}
        oncopy={(content) => copyToClipboard(content)}
        oncopyloc={(loc) => copyToClipboard(loc)}
        onsaverange={(id, s, e) => saveAnnotationRange(id, s, e)}
        position={position}
        onprev={prevId ? () => openRow(prevId) : undefined}
        onnext={nextId ? () => openRow(nextId) : undefined}
        comments={commentsFor($detail, current.id)}
        currentAuthor={$detail.currentAuthor}
        onaddcomment={(id, content) => addComment(id, content)}
        oneditcomment={(id, content) => editComment(id, content)}
        ondeletecomment={(id) => deleteComment(id)}
        onlocallink={(file, range) => openLocalLink(file, range)}
        onrevealcode={(id) => refocusCode(id)}
      />
    {/key}
  {:else}
    <GroupView
      group={$detail.group}
      palette={$detail.palette}
      staleIds={$detail.staleIds ?? []}
      comments={$detail.comments}
      currentAuthor={$detail.currentAuthor}
      onrename={(title) => renameGroup(title)}
      onedittags={requestEditTags}
      oneditgitref={requestEditGitRef}
      onselectrow={openRow}
      onreorder={(ids) => reorderAnnotations(ids)}
      onsetstatus={(s) => setGroupStatus(s)}
      onaddgroupcomment={(content) => addGroupComment(content)}
      oneditcomment={(id, content) => editComment(id, content)}
      ondeletecomment={(id) => deleteComment(id)}
      onlocallink={(file, range) => openLocalLink(file, range)}
    />
  {/if}
</main>

<style>
  main { padding: 8px; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); }
  .empty { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 12px; padding: 8px 2px; }
</style>
