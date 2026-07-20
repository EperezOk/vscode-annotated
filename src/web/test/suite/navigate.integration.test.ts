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

  test('revealAnnotation resolves an absolute in-workspace file to the same document as its relative form', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    // Build a canonical in-workspace ABSOLUTE path. Uri.joinPath is host-robust: naive
    // `${folder.uri.path}/README.md` doubles the slash when the workspace root path is "/"
    // (as it is under @vscode/test-web's vscode-test-web://mount/).
    const absoluteFile = vscode.Uri.joinPath(folder.uri, 'README.md').path;
    const annotation: Annotation = {
      id: 'nav-abs-inside',
      file: absoluteFile,
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

  test('revealAnnotation warns and no-ops for an out-of-workspace absolute file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }

    // Establish a known "before" state so we can confirm no navigation happened.
    await revealAnnotation(folder.uri, {
      id: 'nav-baseline',
      file: 'README.md',
      range: { startLine: 1, endLine: 1 },
      content: '',
      contentHash: 'h',
    });
    const before = vscode.window.activeTextEditor?.document.uri.toString();

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warning: string | undefined;
    (vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
      ((message: string) => {
        warning = message;
        return Promise.resolve(undefined);
      }) as typeof vscode.window.showWarningMessage;

    try {
      const annotation: Annotation = {
        id: 'nav-abs-outside',
        // A workspace-escaping absolute path. A ".." escape (rather than a sibling dir like
        // "/tmp/…") is rejected on ANY host — including @vscode/test-web, whose workspace-root
        // path is "/", under which every non-escaping absolute path is technically "inside".
        file: '/../../etc/passwd',
        range: { startLine: 1, endLine: 1 },
        content: '',
        contentHash: 'h',
      };
      await revealAnnotation(folder.uri, annotation);
    } finally {
      (vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
        originalShowWarningMessage;
    }

    if (!warning || !warning.includes('outside the workspace')) {
      throw new Error(`expected an "outside the workspace" warning, got ${warning}`);
    }
    const after = vscode.window.activeTextEditor?.document.uri.toString();
    if (after !== before) {
      throw new Error(`expected active editor to be unchanged; was ${before}, now ${after}`);
    }
  });
});
