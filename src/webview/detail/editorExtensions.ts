import { EditorView, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { isUrl, linkSelection } from '../../core/markdownTransforms';

/** Select text + paste an http(s) URL → wrap the selection as a Markdown link. */
export const urlPasteHandler: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (!text || !isUrl(text)) {
      return false;
    }
    const { main } = view.state.selection;
    if (main.empty) {
      return false;
    }
    event.preventDefault();
    const result = linkSelection(view.state.doc.toString(), main.from, main.to, text);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.doc },
      selection: EditorSelection.range(result.selectionFrom, result.selectionTo),
    });
    return true;
  },
});

/** A command that wraps each selection range with `before`/`after`. */
function wrapCommand(before: string, after: string) {
  return (view: EditorView): boolean => {
    const tr = view.state.changeByRange((range) => ({
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    }));
    view.dispatch(view.state.update(tr, { scrollIntoView: true }));
    return true;
  };
}

/** Bold (Mod-b) and italic (Mod-i) shortcuts. */
export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: wrapCommand('**', '**') },
  { key: 'Mod-i', run: wrapCommand('*', '*') },
];

/**
 * Markdown highlight style tuned for the VSCode webview: colors come from VSCode theme
 * CSS variables (with literal fallbacks so it stays visible if a var is undefined), plus
 * bold/italic weights. Replaces CodeMirror's defaultHighlightStyle, whose light-theme
 * colors are nearly invisible on the dark input background.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: 'bold', color: 'var(--vscode-textPreformat-foreground, #4ec9b0)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--vscode-textLink-foreground, #3794ff)' },
  { tag: t.monospace, color: 'var(--vscode-textPreformat-foreground, #ce9178)' },
  { tag: t.quote, fontStyle: 'italic', color: 'var(--vscode-descriptionForeground, #9a9a9a)' },
  { tag: t.list, color: 'var(--vscode-textLink-foreground, #3794ff)' },
  { tag: t.processingInstruction, color: 'var(--vscode-descriptionForeground, #9a9a9a)' },
]);

/**
 * Make the editable content fill the editor's min-height so a click in the blank area
 * below short content lands on `.cm-content` (CodeMirror then places the cursor at the
 * nearest position — the end of the document) instead of doing nothing.
 */
export const fillHeightTheme: Extension = EditorView.theme({
  '.cm-content': { minHeight: '160px' },
  '.cm-scroller': { minHeight: '160px' },
});
