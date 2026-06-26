import * as vscode from 'vscode';
import { revealAnnotation, revealLocation } from '../../navigateToCode';
import { type Annotation } from '../../../shared/model';

suite('navigate-to-code', () => {
  test('opens the annotation file and selects its 1-based line range', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder — @vscode/test-web must be passed the test-workspace folder');
    }
    const annotation: Annotation = {
      id: 'nav-a',
      file: 'README.md',
      range: { startLine: 2, endLine: 3 },
      content: '',
      contentHash: 'h',
    };

    await revealAnnotation(folder.uri, annotation);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error('no active editor after revealAnnotation');
    }
    if (!editor.document.uri.path.endsWith('/README.md')) {
      throw new Error(`expected README.md, got ${editor.document.uri.path}`);
    }
    if (editor.selection.start.line !== 1) {
      throw new Error(`expected selection to start at 0-based line 1, got ${editor.selection.start.line}`);
    }
    if (editor.selection.end.line !== 2) {
      throw new Error(`expected selection to end at 0-based line 2, got ${editor.selection.end.line}`);
    }
  });

  test('revealLocation opens a workspace-relative target and selects its range', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    await revealLocation(folder.uri, 'README.md', { startLine: 1, endLine: 2 });
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.uri.path.endsWith('/README.md')) {
      throw new Error('expected README.md to be the active editor');
    }
    if (editor.selection.start.line !== 0 || editor.selection.end.line !== 1) {
      throw new Error(`unexpected selection ${editor.selection.start.line}-${editor.selection.end.line}`);
    }
  });
});
