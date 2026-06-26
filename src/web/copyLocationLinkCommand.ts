import * as vscode from 'vscode';
import { formatLocationLink } from '../shared/locationLink';

/**
 * Register `annotated.copyLocationLink`: copy the active editor's selection (or cursor line) as a
 * `path#L10-L20` location string, ready to paste over a selection in an annotation (paste-to-link).
 */
export function registerCopyLocationLinkCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.copyLocationLink', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('Annotated: open a file and select lines to copy a location link.');
      return;
    }
    const file = vscode.workspace.asRelativePath(editor.document.uri, false);
    const sel = editor.selection;
    // VS Code lines are 0-based; the model is 1-based inclusive. A selection ending at column 0 of
    // a later line does not really include that line (mirrors createAnnotationCommand.getSelection).
    const startLine = sel.start.line + 1;
    const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
    const location = formatLocationLink(file, { startLine, endLine });
    await vscode.env.clipboard.writeText(location);
    void vscode.window.showInformationMessage(`Annotated: copied ${location}`);
  });
}
