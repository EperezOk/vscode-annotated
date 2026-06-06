import { EditorView, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { isUrl, linkSelection, toggleMarker } from '../../core/markdownTransforms';

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

/** Bold (Mod-b), italic (Mod-i), inline code (Mod-e) toggle shortcuts. */
export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleCommand('**') },
  { key: 'Mod-i', run: toggleCommand('*') },
  { key: 'Mod-e', run: toggleCommand('`') },
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

/** True for the editor's formatting combos (Cmd/Ctrl + b/i/e, no shift/alt). */
export function isFormattingShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  const k = e.key.toLowerCase();
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === 'b' || k === 'i' || k === 'e');
}

/**
 * Keep the formatting combos inside the editor. VS Code webviews forward keydowns to the
 * workbench so global keybindings still fire in a webview — which is why Cmd+B also toggled
 * the sidebar. The keymap still runs the toggle + preventDefault; we add stopPropagation so
 * the event never reaches the window-level forwarder.
 */
export const stopFormattingShortcuts: Extension = EditorView.domEventHandlers({
  keydown(event) {
    if (isFormattingShortcut(event)) {
      event.stopPropagation();
    }
    return false; // let the keymap run the command
  },
});
