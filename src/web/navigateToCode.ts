import * as vscode from 'vscode';
import { type Annotation } from '../shared/model';

let highlightType: vscode.TextEditorDecorationType | undefined;
let lastEditor: vscode.TextEditor | undefined;

function decorationType(): vscode.TextEditorDecorationType {
  if (!highlightType) {
    highlightType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      isWholeLine: true,
    });
  }
  return highlightType;
}

/** Clear the highlight applied by the previous navigation, if any. */
export function clearHighlight(): void {
  if (lastEditor && highlightType) {
    lastEditor.setDecorations(highlightType, []);
  }
  lastEditor = undefined;
}

/**
 * Open the annotation's file, reveal + select its line range, and highlight those
 * full lines (clearing the previous highlight). `folderUri` is the workspace folder.
 * Model line numbers are 1-based inclusive; VSCode ranges are 0-based.
 */
export async function revealAnnotation(folderUri: vscode.Uri, annotation: Annotation): Promise<void> {
  const uri = vscode.Uri.joinPath(folderUri, ...annotation.file.split('/').filter(Boolean));
  const range = new vscode.Range(
    annotation.range.startLine - 1,
    0,
    annotation.range.endLine - 1,
    Number.MAX_SAFE_INTEGER,
  );

  clearHighlight();

  const editor = await vscode.window.showTextDocument(uri, { selection: range, preserveFocus: true });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(decorationType(), [range]);
  lastEditor = editor;
}
