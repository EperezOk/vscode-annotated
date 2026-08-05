import * as vscode from 'vscode';
import { type Annotation, type LineRange } from '../shared/model';
import { toWorkspaceRelativeSegments } from '../shared/path';

let highlightType: vscode.TextEditorDecorationType | undefined;
let lastEditor: vscode.TextEditor | undefined;

function decorationType(): vscode.TextEditorDecorationType {
  if (!highlightType) {
    highlightType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('focusBorder'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
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

let linkHighlightType: vscode.TextEditorDecorationType | undefined;
let lastLinkEditor: vscode.TextEditor | undefined;

function linkDecorationType(): vscode.TextEditorDecorationType {
  if (!linkHighlightType) {
    linkHighlightType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('textLink.foreground'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
  }
  return linkHighlightType;
}

/** Clear the link-target highlight applied by the previous local-link navigation, if any. */
export function clearLinkHighlight(): void {
  if (lastLinkEditor && linkHighlightType) {
    lastLinkEditor.setDecorations(linkHighlightType, []);
  }
  lastLinkEditor = undefined;
}

/** Clear both the annotation highlight and the link-target highlight. */
export function clearAllHighlights(): void {
  clearHighlight();
  clearLinkHighlight();
}

/**
 * Open a local-link target (workspace-relative `file` + 1-based `range`), reveal + select the
 * lines, and apply the link-target highlight (distinct from the annotation highlight). Keeps
 * focus in the panel (preserveFocus) so the annotation view is untouched. Out-of-workspace or
 * unopenable targets warn and no-op rather than throw.
 */
export async function revealLocation(folderUri: vscode.Uri, file: string, range: LineRange | null): Promise<void> {
  const segments = toWorkspaceRelativeSegments(file, folderUri.path);
  if (!segments) {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}" (outside the workspace).`);
    return;
  }
  const uri = vscode.Uri.joinPath(folderUri, ...segments);
  clearLinkHighlight();
  // A file-only link has no lines to select or highlight — just open it.
  if (range === null) {
    try {
      await vscode.window.showTextDocument(uri, { preserveFocus: true });
    } catch {
      void vscode.window.showWarningMessage(`Annotated: cannot open "${file}".`);
    }
    return;
  }
  const vsRange = new vscode.Range(range.startLine - 1, 0, range.endLine - 1, Number.MAX_SAFE_INTEGER);
  let editor: vscode.TextEditor;
  try {
    editor = await vscode.window.showTextDocument(uri, { selection: vsRange, preserveFocus: true });
  } catch {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}".`);
    return;
  }
  editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(linkDecorationType(), [vsRange]);
  lastLinkEditor = editor;
}

/**
 * Open the annotation's file, reveal + select its line range, and highlight those
 * full lines (clearing the previous highlight). `folderUri` is the workspace folder.
 * Model line numbers are 1-based inclusive; VSCode ranges are 0-based.
 */
export async function revealAnnotation(folderUri: vscode.Uri, annotation: Annotation): Promise<void> {
  const segments = toWorkspaceRelativeSegments(annotation.file, folderUri.path);
  if (!segments) {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${annotation.file}" (outside the workspace).`);
    return;
  }
  const uri = vscode.Uri.joinPath(folderUri, ...segments);

  clearHighlight();
  clearLinkHighlight(); // re-anchoring on the annotation drops any stale link-target highlight

  // A whole-file annotation has no lines to reveal: just open the file (no selection, no highlight).
  if (annotation.range === null) {
    try {
      await vscode.window.showTextDocument(uri, { preserveFocus: true });
    } catch {
      void vscode.window.showWarningMessage(`Annotated: cannot open "${annotation.file}".`);
    }
    return;
  }

  const range = new vscode.Range(
    annotation.range.startLine - 1,
    0,
    annotation.range.endLine - 1,
    Number.MAX_SAFE_INTEGER,
  );

  let editor: vscode.TextEditor;
  try {
    editor = await vscode.window.showTextDocument(uri, { selection: range, preserveFocus: true });
  } catch {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${annotation.file}".`);
    return;
  }
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(decorationType(), [range]);
  lastEditor = editor;
}
