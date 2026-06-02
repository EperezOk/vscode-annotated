import * as vscode from 'vscode';
import { type AnnotationGroup, type Tag } from '../shared/model';
import { newId } from '../shared/ids';
import { sha256Hex } from '../shared/hash';
import { GroupStore } from '../core/groupStore';
import { resolveAuthor } from '../core/authorIdentity';
import {
  runCreateAnnotation,
  type CreateAnnotationDeps,
  type GroupChoice,
  type SelectionInfo,
} from '../core/createAnnotationFlow';
import { VscodeFileSystem } from './vscodeFileSystem';
import { VscodeAuthorNameSources } from './authorSources';
import { displayPalette, promptNewTag } from './tagPalette';
import { type TagColor } from '../shared/protocol';
import { swatchIconSvg } from '../shared/svgIcon';
import { NEW_TAG_LABEL, splitPickedTags } from '../core/tags';
import { tagColor } from '../core/sidebarState';

const CREATE_NEW_LABEL = '$(add) Create new group…';

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
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const editor = vscode.window.activeTextEditor;

    const deps: CreateAnnotationDeps = {
      getSelection: () => getSelection(editor),
      resolveAuthor: () => resolveAuthor(new VscodeAuthorNameSources()),
      listGroups: () => store.listGroups(),
      pickGroup: (groups) => pickGroup(groups),
      promptGroupTitle: () => promptGroupTitle(),
      pickTags: async () => pickTags(displayPalette(await store.listGroups())),
      saveGroup: (group) => store.saveGroup(group),
      newId,
      now: () => Math.floor(Date.now() / 1000),
      hashContent: (text) => sha256Hex(text),
      showInfo: (message) => void vscode.window.showInformationMessage(message),
      showWarning: (message) => void vscode.window.showWarningMessage(message),
    };

    const result = await runCreateAnnotation(deps);
    if (result && onCreated) {
      await onCreated(result.group.id, result.annotationId);
    }
  });
}

function getSelection(editor: vscode.TextEditor | undefined): SelectionInfo | undefined {
  if (!editor) {
    return undefined;
  }
  const sel = editor.selection;
  // VSCode lines are 0-based; the model uses 1-based inclusive lines.
  const startLine = sel.start.line + 1;
  // If the selection ends at column 0 of a later line, that line is not really included.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  return {
    file: vscode.workspace.asRelativePath(editor.document.uri, false),
    range: { startLine, endLine },
    fileText: editor.document.getText(),
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

async function pickTags(palette: TagColor[]): Promise<Tag[] | undefined> {
  const items: vscode.QuickPickItem[] = [
    ...palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
    { label: NEW_TAG_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select tags (optional)',
  });
  if (picked === undefined) {
    return undefined;
  }
  const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
  const tags: Tag[] = names.map((name) => ({ name, color: tagColor(palette, name) }));
  if (addNew) {
    const created = await promptNewTag();
    if (created) {
      tags.push(created);
    }
  }
  return tags;
}
