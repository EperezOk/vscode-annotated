<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, EditorSelection } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { defaultKeymap, history } from '@codemirror/commands';
  import { syntaxHighlighting } from '@codemirror/language';
  import { markdown } from '@codemirror/lang-markdown';
  import { markdownKeymap, containedHistoryKeymap, urlPasteHandler, markdownHighlightStyle, fillHeightTheme } from './editorExtensions';

  let { doc = '', autofocus = false, onChange, onSubmit }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void; onSubmit?: () => void } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  /**
   * Focus + cursor-at-end, retried briefly: when the webview iframe itself isn't
   * focused yet (the host focuses the view asynchronously after this mounts),
   * the initial .focus() doesn't take. Retry on short timers and once when the
   * window gains focus, then give up quietly (round-3 #10).
   */
  function focusWithRetry(target: EditorView): () => void {
    const place = (): void => {
      target.focus();
      target.dispatch({ selection: EditorSelection.cursor(target.state.doc.length) });
    };
    const onWindowFocus = (): void => {
      if (!target.hasFocus) {
        place();
      }
    };
    place();
    const timers = [50, 150, 400].map((ms) =>
      setTimeout(() => {
        if (!target.hasFocus) {
          place();
        }
      }, ms),
    );
    window.addEventListener('focus', onWindowFocus);
    const deadline = setTimeout(() => window.removeEventListener('focus', onWindowFocus), 1500);
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      clearTimeout(deadline);
      window.removeEventListener('focus', onWindowFocus);
    };
  }

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
          keymap.of([
            // Submit shortcut — ahead of defaultKeymap, which binds Mod-Enter to insertBlankLine.
            { key: 'Mod-Enter', run: () => (onSubmit ? (onSubmit(), true) : false) },
            ...markdownKeymap,
            ...defaultKeymap,
            ...containedHistoryKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    const cleanupFocus = autofocus ? focusWithRetry(view) : undefined;
    return () => {
      cleanupFocus?.();
      view?.destroy();
    };
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
