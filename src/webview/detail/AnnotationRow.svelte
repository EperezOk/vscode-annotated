<script lang="ts">
  import { formatLineRange, type Annotation } from '../../shared/model';
  import { oneLine } from '../../core/detailState';
  import { fileName } from '../../shared/path';
  import CommentBadge from '../shared/CommentBadge.svelte';

  let {
    annotation,
    selected = false,
    stale = false,
    commentCount = 0,
    onselect,
  }: {
    annotation: Annotation;
    selected?: boolean;
    stale?: boolean;
    commentCount?: number;
    onselect?: (id: string) => void;
  } = $props();

  const summary = $derived(oneLine(annotation.content) || '(empty)');
  const range = $derived(formatLineRange(annotation.range));
  const shortLoc = $derived(`${fileName(annotation.file)}:${range}`);
  const fullLoc = $derived(`${annotation.file}:${range}`);
</script>

<button
  type="button"
  class="row"
  class:selected
  data-testid="annotation-row"
  onclick={() => onselect?.(annotation.id)}
>
  {#if stale}<span class="stale-dot" data-testid="stale-dot" title="Lines changed since this was written">●</span>{/if}
  <span class="summary">{summary}</span>
  <CommentBadge count={commentCount} />
  <span class="loc" data-testid="annotation-loc" title={fullLoc}>{shortLoc}</span>
</button>

<style>
  .row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 8px;
    text-align: left;
    background: transparent;
    color: var(--vscode-foreground, #ccc);
    border: none;
    border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a);
    padding: 6px 4px;
    cursor: pointer;
    font-family: var(--vscode-font-family, sans-serif);
  }
  .row:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  .row.selected { background: var(--vscode-list-activeSelectionBackground, #04395e); }
  .summary { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
  .loc { color: var(--vscode-descriptionForeground, #8a8a8a); font-size: 10.5px; font-family: monospace; white-space: nowrap; }
  .stale-dot { color: var(--vscode-editorWarning-foreground, #f39c12); font-size: 9px; }
</style>
