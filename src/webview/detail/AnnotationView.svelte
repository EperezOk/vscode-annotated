<script lang="ts">
  import { untrack } from 'svelte';
  import { type Annotation } from '../../shared/model';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';

  let {
    annotation,
    onback,
    onsave,
    oncopy,
    oncopyloc,
  }: {
    annotation: Annotation;
    onback?: () => void;
    onsave?: (id: string, content: string) => void;
    oncopy?: (content: string) => void;
    oncopyloc?: (loc: string) => void;
  } = $props();

  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);

  // Seed once from the prop (intentional — DetailApp keys this component by
  // annotation id, so it remounts on switch). untrack() avoids the spurious
  // `state_referenced_locally` warning while preserving that semantics.
  let editing = $state(untrack(() => annotation.content.length === 0));
  let draft = $state(untrack(() => annotation.content));

  function startEdit(): void {
    draft = annotation.content;
    editing = true;
  }
  function save(): void {
    onsave?.(annotation.id, draft);
    editing = false;
  }
</script>

<section class="annotation-view" data-testid="annotation-view">
  <div class="bar">
    <button type="button" class="link" data-testid="back-btn" onclick={() => onback?.()}>‹ Back</button>
    <span class="loc" data-testid="annotation-loc">{location}</span>
    <button type="button" class="link" data-testid="copy-loc-btn" onclick={() => oncopyloc?.(location)}>⧉ path</button>
  </div>

  <div class="toolbar">
    {#if editing}
      <button type="button" class="btn" data-testid="save-btn" onclick={save}>Save</button>
    {:else}
      <button type="button" class="btn" data-testid="edit-btn" onclick={startEdit}>✎ Edit</button>
    {/if}
    <button type="button" class="btn ghost" data-testid="copy-md-btn" onclick={() => oncopy?.(annotation.content)}>⧉ Copy markdown</button>
  </div>

  {#if editing}
    <MarkdownEditor doc={draft} onChange={(v) => (draft = v)} />
  {:else}
    <MarkdownPreview source={annotation.content} />
  {/if}
</section>

<style>
  .annotation-view { padding: 4px 2px; }
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .loc { flex: 1; font-family: monospace; font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11.5px; padding: 0; }
  .toolbar { display: flex; gap: 6px; margin-bottom: 8px; }
  .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 3px; padding: 4px 10px; font-size: 11.5px; cursor: pointer; }
  .btn.ghost { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); }
</style>
