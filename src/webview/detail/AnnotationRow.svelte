<script lang="ts">
  import { type Annotation } from '../../shared/model';
  import { oneLine } from '../../core/detailState';

  let {
    annotation,
    selected = false,
    onselect,
  }: {
    annotation: Annotation;
    selected?: boolean;
    onselect?: (id: string) => void;
  } = $props();

  const summary = $derived(oneLine(annotation.content) || '(empty)');
  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);
</script>

<button
  type="button"
  class="row"
  class:selected
  data-testid="annotation-row"
  onclick={() => onselect?.(annotation.id)}
>
  <span class="summary">{summary}</span>
  <span class="loc">{location}</span>
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
</style>
