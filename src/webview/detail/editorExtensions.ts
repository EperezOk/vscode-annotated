import { EditorView, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { linkPasteEdit, toggleMarker } from '../../core/markdownTransforms';

/** Paste an http(s) URL or a local-link location over a selection → wrap as a Markdown link. */
export const urlPasteHandler: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const { main } = view.state.selection;
    const result = linkPasteEdit(view.state.doc.toString(), main.from, main.to, text);
    if (!result) {
      return false;
    }
    event.preventDefault();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.doc },
      selection: EditorSelection.range(result.selectionFrom, result.selectionTo),
    });
    return true;
  },
});

/** Build the transaction that toggles `marker` over every selection range (pure — no view). */
export function toggleMarkerSpec(state: EditorState, marker: string): TransactionSpec {
  const doc = state.doc.toString();
  return state.changeByRange((range) => {
    const edit = toggleMarker(doc, range.from, range.to, marker);
    return {
      changes: edit.changes,
      range: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
    };
  });
}

/** A command that toggles `marker` around the current selection(s). */
function toggleCommand(marker: string) {
  return (view: EditorView): boolean => {
    view.dispatch(view.state.update(toggleMarkerSpec(view.state, marker), { scrollIntoView: true }));
    return true;
  };
}

/**
 * Bold (Mod-b), italic (Mod-i), inline code (Mod-e) toggle shortcuts.
 *
 * `stopPropagation: true` keeps the combo inside the editor: CodeMirror's keydown handler
 * calls `preventDefault` (implicit for any handled binding) and, because `stopPropagation` is
 * set, also calls `stopPropagation` — so the keydown never reaches the window-level forwarder
 * that VS Code webviews use to fire global keybindings (otherwise Cmd+B would also toggle the
 * sidebar). Both fire only when the toggle actually runs: the platform-correct Mod- key is
 * pressed (Cmd on macOS, Ctrl elsewhere) and the command returns true.
 */
export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleCommand('**'), stopPropagation: true },
  { key: 'Mod-i', run: toggleCommand('*'), stopPropagation: true },
  { key: 'Mod-e', run: toggleCommand('`'), stopPropagation: true },
];

/**
 * Markdown highlight style tuned for the VSCode webview: colors come from VSCode theme
 * CSS variables (with literal fallbacks so it stays visible if a var is undefined), plus
 * bold/italic weights. Replaces CodeMirror's defaultHighlightStyle, whose light-theme
 * colors are nearly invisible on the dark input background.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: 'bold', color: 'var(--vscode-symbolIcon-keywordForeground, #569cd6)' },
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
