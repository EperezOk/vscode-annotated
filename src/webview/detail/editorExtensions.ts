import { EditorView, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
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
