import * as vscode from 'vscode';
import { type AnnotationGroup } from '../shared/model';
import { newId } from '../shared/ids';
import { sha256Hex } from '../shared/hash';
import { toWorkspaceRelativeSegments } from '../shared/path';
import { GroupStore } from '../core/groupStore';
import { resolveAuthor } from '../core/authorIdentity';
import {
  runCreateAnnotation,
  type CreateAnnotationDeps,
  type GroupChoice,
  type SelectionInfo,
} from '../core/createAnnotationFlow';
import { currentRef } from '../core/gitRefs';
import { readGitRefInfo } from './gitRefsSource';
import { VscodeFileSystem } from './vscodeFileSystem';
import { VscodeAuthorNameSources } from './authorSources';
import { displayPalette, pickTagsWithNewOption } from './tagPalette';

const CREATE_NEW_LABEL = '$(add) Create new group…';

/** Build the flow deps for one invocation. `getSelection` decides selection- vs file-scope. */
function buildDeps(
  fs: VscodeFileSystem,
  store: GroupStore,
  getSelection: () => SelectionInfo | undefined,
): CreateAnnotationDeps {
  const dec = new TextDecoder();
  return {
    getSelection,
    readWorkingText: async (file) => {
      try {
        return dec.decode(await fs.readFile(file));
      } catch {
        return null;
      }
    },
    resolveAuthor: () => resolveAuthor(new VscodeAuthorNameSources()),
    listGroups: () => store.listGroups(),
    pickGroup: (groups) => pickGroup(groups),
    promptGroupTitle: () => promptGroupTitle(),
    pickTags: async () =>
      pickTagsWithNewOption(displayPalette(await store.listGroups()), {
        placeHolder: 'Select tags (optional)',
      }),
    saveGroup: (group) => store.saveGroup(group),
    newId,
    now: () => Math.floor(Date.now() / 1000),
    hashContent: (text) => sha256Hex(text),
    getGitRef: async () => currentRef(await readGitRefInfo()),
    showInfo: (message) => void vscode.window.showInformationMessage(message),
    showWarning: (message) => void vscode.window.showWarningMessage(message),
  };
}

/** Register the `annotated.createAnnotation` command. */
export function registerCreateAnnotationCommand(
  onCreated?: (groupId: string, annotationId: string) => void | Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.createAnnotation', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage('Annotated: open a folder to create annotations.');
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const editor = vscode.window.activeTextEditor;
    const deps = buildDeps(fs, store, () => getSelection(editor, folder.uri.path));
    const result = await runCreateAnnotation(deps);
    if (result && onCreated) {
      await onCreated(result.group.id, result.annotationId);
    }
  });
}

/**
 * Register `annotated.createFileAnnotation`: annotate a whole file (no line range). The target is
 * the Explorer-provided `Uri` when invoked from the context menu, else the active editor's file.
 */
export function registerCreateFileAnnotationCommand(
  onCreated?: (groupId: string, annotationId: string) => void | Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.createFileAnnotation', async (resource?: vscode.Uri) => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage('Annotated: open a folder to create annotations.');
      return;
    }
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showWarningMessage('Annotated: open a file (or pick one in the Explorer) to annotate it.');
      return;
    }
    // Folders (and anything unreadable) are not annotatable targets.
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        void vscode.window.showWarningMessage('Annotated: pick a file, not a folder.');
        return;
      }
    } catch {
      void vscode.window.showWarningMessage(`Annotated: cannot read "${uri.path}".`);
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const raw = vscode.workspace.asRelativePath(uri, false);
    const segments = toWorkspaceRelativeSegments(raw, folder.uri.path);
    const deps = buildDeps(fs, store, () => ({
      file: segments ? segments.join('/') : raw,
      range: null,
    }));
    const result = await runCreateAnnotation(deps);
    if (result && onCreated) {
      await onCreated(result.group.id, result.annotationId);
    }
  });
}

function getSelection(editor: vscode.TextEditor | undefined, workspaceRootPath?: string): SelectionInfo | undefined {
  if (!editor) {
    return undefined;
  }
  const sel = editor.selection;
  // VSCode lines are 0-based; the model uses 1-based inclusive lines.
  const startLine = sel.start.line + 1;
  // If the selection ends at column 0 of a later line, that line is not really included.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  const raw = vscode.workspace.asRelativePath(editor.document.uri, false);
  const segments = toWorkspaceRelativeSegments(raw, workspaceRootPath);
  return {
    file: segments ? segments.join('/') : raw,
    range: { startLine, endLine },
  };
}

interface GroupQuickPickItem extends vscode.QuickPickItem {
  groupId?: string;
}

async function pickGroup(groups: AnnotationGroup[]): Promise<GroupChoice | undefined> {
  const items: GroupQuickPickItem[] = [
    { label: CREATE_NEW_LABEL, alwaysShow: true },
    ...groups.map((g) => ({
      label: g.title,
      description: `${g.annotations.length} annotation(s)${g.tags.length ? ` · ${g.tags.map((t) => t.name).join(', ')}` : ''}`,
      groupId: g.id,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Add annotation to group…' });
  if (!picked) {
    return undefined;
  }
  return picked.groupId ? { kind: 'existing', id: picked.groupId } : { kind: 'new' };
}

async function promptGroupTitle(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Name for the new annotation group',
    validateInput: (value) => (value.trim().length === 0 ? 'Please enter a name' : undefined),
  });
}

