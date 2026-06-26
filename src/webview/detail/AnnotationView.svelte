<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { formatLineRange, type Annotation, type LineRange, type ThreadComment } from '../../shared/model';
  import { fileName } from '../../shared/path';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import CommentThread from './CommentThread.svelte';

  let {
    annotation,
    stale = false,
    onback,
    onsave,
    oncopy,
    oncopyloc,
    onsaverange,
    onprev,
    onnext,
    position,
    comments,
    currentAuthor,
    onaddcomment,
    oneditcomment,
    ondeletecomment,
    onlocallink,
    onrevealcode,
  }: {
    annotation: Annotation;
    stale?: boolean;
    onback?: () => void;
    onsave?: (id: string, content: string) => void;
    oncopy?: (content: string) => void;
    oncopyloc?: (loc: string) => void;
    onsaverange?: (id: string, startLine: number, endLine: number) => void;
    onprev?: () => void;
    onnext?: () => void;
    position?: { current: number; total: number };
    comments?: ThreadComment[];
    currentAuthor?: string;
    onaddcomment?: (annotationId: string, content: string) => void;
    oneditcomment?: (commentId: string, content: string) => void;
    ondeletecomment?: (commentId: string) => void;
    onlocallink?: (file: string, range: LineRange) => void;
    onrevealcode?: (id: string) => void;
  } = $props();

  // Full path:range — stays the "copy path" payload and the hover tooltip.
  const location = $derived(`${annotation.file}:${formatLineRange(annotation.range)}`);
  const shortLocation = $derived(`${fileName(annotation.file)}:${formatLineRange(annotation.range)}`);

  // Seed once from the prop (intentional — DetailApp keys this component by
  // annotation id, so it remounts on switch). untrack() avoids the spurious
  // `state_referenced_locally` warning while preserving that semantics.
  let editing = $state(untrack(() => annotation.content.length === 0));
  let draft = $state(untrack(() => annotation.content));

  let editingRange = $state(false);
  let rangeStart = $state(untrack(() => annotation.range.startLine));
  let rangeEnd = $state(untrack(() => annotation.range.endLine));
  function startRangeEdit(): void { rangeStart = annotation.range.startLine; rangeEnd = annotation.range.endLine; editingRange = true; }
  function saveRange(): void {
    const s = Math.max(1, Math.floor(Number(rangeStart) || 1));
    const e = Math.max(s, Math.floor(Number(rangeEnd) || s));
    editingRange = false;
    onsaverange?.(annotation.id, s, e);
  }

  function startEdit(): void {
    draft = annotation.content;
    editing = true;
  }
  function save(): void {
    onsave?.(annotation.id, draft);
    editing = false;
  }
  function cancelEdit(): void {
    draft = annotation.content;
    editing = false;
  }

  let copiedPath = $state(false);
  let copiedMd = $state(false);
  let pathTimer: ReturnType<typeof setTimeout> | undefined;
  let mdTimer: ReturnType<typeof setTimeout> | undefined;

  function copyPath(): void {
    oncopyloc?.(location);
    copiedPath = true;
    clearTimeout(pathTimer);
    pathTimer = setTimeout(() => (copiedPath = false), 1500);
  }
  function copyMd(): void {
    oncopy?.(annotation.content);
    copiedMd = true;
    clearTimeout(mdTimer);
    mdTimer = setTimeout(() => (copiedMd = false), 1500);
  }

  onDestroy(() => {
    clearTimeout(pathTimer);
    clearTimeout(mdTimer);
  });
</script>

<section class="annotation-view" data-testid="annotation-view">
  <div class="bar">
    <button type="button" class="link" data-testid="back-btn" onclick={() => onback?.()}>‹ Back</button>
    {#if editingRange}
      <span class="loc">{fileName(annotation.file)}:
        <input class="num" data-testid="range-start" type="number" min="1" bind:value={rangeStart} />–<input class="num" data-testid="range-end" type="number" min="1" bind:value={rangeEnd} />
      </span>
      <button type="button" class="link" data-testid="save-range-btn" onclick={saveRange}>save</button>
    {:else}
      <span class="loc" data-testid="annotation-loc" title={location}>{shortLocation}</span>
      <button type="button" class="link" data-testid="edit-range-btn" onclick={startRangeEdit}>edit range</button>
    {/if}
    <button type="button" class="link" data-testid="refocus-btn" onclick={() => onrevealcode?.(annotation.id)}>↩ Refocus code</button>
    <button type="button" class="link" data-testid="copy-loc-btn" onclick={copyPath}>{copiedPath ? '✓ Copied' : '⧉ path'}</button>
  </div>

  <div class="nav" data-testid="nav-bar">
    <button type="button" class="nav-btn" data-testid="prev-btn" disabled={!onprev} onclick={() => onprev?.()}>‹ Prev</button>
    <span class="position" data-testid="position-info">{position?.current ?? 0} / {position?.total ?? 0}</span>
    <button type="button" class="nav-btn" data-testid="next-btn" disabled={!onnext} onclick={() => onnext?.()}>Next ›</button>
  </div>

  {#if stale}<div class="stale-banner" data-testid="stale-banner">⚠ Lines changed since this was written — content may no longer match.</div>{/if}

  <div class="toolbar">
    {#if editing}
      <button type="button" class="btn" data-testid="save-btn" onclick={save}>Save</button>
      <button type="button" class="btn ghost" data-testid="cancel-btn" onclick={cancelEdit}>Cancel</button>
    {:else}
      <button type="button" class="btn" data-testid="edit-btn" onclick={startEdit}>✎ Edit</button>
    {/if}
    <button type="button" class="btn ghost" data-testid="copy-md-btn" onclick={copyMd}>{copiedMd ? '✓ Copied' : '⧉ Copy markdown'}</button>
  </div>

  {#if editing}
    <MarkdownEditor doc={draft} autofocus onChange={(v) => (draft = v)} onSubmit={save} />
  {:else}
    <MarkdownPreview source={annotation.content} {onlocallink} />
  {/if}

  <CommentThread
    comments={comments ?? []}
    currentAuthor={currentAuthor ?? ''}
    {onlocallink}
    onadd={(content) => onaddcomment?.(annotation.id, content)}
    onedit={(id, content) => oneditcomment?.(id, content)}
    ondelete={(id) => ondeletecomment?.(id)}
  />
</section>

<style>
  .annotation-view { padding: 4px 2px; }
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .loc { flex: 1; font-family: monospace; font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11.5px; padding: 0; }
  .toolbar { display: flex; gap: 6px; margin-bottom: 8px; }
  .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 3px; padding: 4px 10px; font-size: 11.5px; cursor: pointer; }
  .btn.ghost { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); }
  .num { width: 42px; }
  .stale-banner { background: #3a2f12; color: #f0c674; font-size: 11px; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; }
  .nav { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .nav-btn { flex: 1; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); border: none; border-radius: 4px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
  .nav-btn:disabled { opacity: 0.4; cursor: default; }
  .position { font-size: 12px; color: var(--vscode-descriptionForeground, #9a9a9a); min-width: 48px; text-align: center; }
</style>
