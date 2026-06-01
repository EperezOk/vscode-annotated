<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { syntaxHighlighting } from '@codemirror/language';
  import { markdown } from '@codemirror/lang-markdown';
  import { markdownKeymap, urlPasteHandler, markdownHighlightStyle, fillHeightTheme } from './editorExtensions';

  let { doc = '', onChange }: { doc?: string; onChange?: (value: string) => void } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
          markdown(),
          fillHeightTheme,
          urlPasteHandler,
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    return () => view?.destroy();
  });
</script>

<div class="md-editor" data-testid="md-editor" bind:this={host}></div>

<style>
  .md-editor {
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    background: var(--vscode-input-background, #2a2a2a);
    min-height: 160px;
    font-size: 12.5px;
  }
  .md-editor :global(.cm-editor) { min-height: 160px; }
  .md-editor :global(.cm-editor.cm-focused) { outline: none; }
  .md-editor :global(.cm-content) {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-input-foreground, #ddd);
    caret-color: var(--vscode-editorCursor-foreground, #ddd);
  }
  .md-editor :global(.cm-scroller) { overflow: auto; }
</style>
