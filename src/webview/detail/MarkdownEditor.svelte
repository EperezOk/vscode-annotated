<script lang="ts">
  let {
    doc = '',
    onChange,
  }: {
    doc?: string;
    onChange?: (value: string) => void;
  } = $props();

  let value = $state(doc);

  function handleInput(event: Event): void {
    value = (event.currentTarget as HTMLTextAreaElement).value;
    onChange?.(value);
  }
</script>

<textarea
  class="md-editor"
  data-testid="md-editor"
  value={doc}
  oninput={handleInput}
  spellcheck="false"
  placeholder="Write Markdown…"
></textarea>

<style>
  .md-editor {
    width: 100%;
    box-sizing: border-box;
    min-height: 160px;
    resize: vertical;
    background: var(--vscode-input-background, #2a2a2a);
    color: var(--vscode-input-foreground, #ddd);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12.5px;
    line-height: 1.5;
  }
</style>
