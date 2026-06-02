import * as vscode from 'vscode';
import { GroupStore } from '../core/groupStore';
import { VscodeFileSystem } from './vscodeFileSystem';
import { displayPalette, readTagSources, promptTagColor } from './tagPalette';
import { swatchIconSvg } from '../shared/svgIcon';
import { type AnnotationGroup } from '../shared/model';
import {
  type TagOp,
  paletteHasName,
  renameInConfig,
  recolorInConfig,
  deleteFromConfig,
  groupTagPatches,
  groupsUsingTag,
} from '../core/tagAdmin';

const RENAME = '$(edit) Rename…';
const RECOLOR = '$(paintcan) Change color…';
const DELETE = '$(trash) Delete';

/** Apply a tag op to both config (workspace/global, wherever present) and every affected group file. */
async function applyOp(store: GroupStore, groups: AnnotationGroup[], op: TagOp): Promise<void> {
  const config = vscode.workspace.getConfiguration('annotated');
  const { local, global } = readTagSources();
  const now = Math.floor(Date.now() / 1000);

  if (op.kind === 'rename') {
    if (paletteHasName(local, op.from)) {
      await config.update('tags', renameInConfig(local, op.from, op.to), vscode.ConfigurationTarget.Workspace);
    }
    if (paletteHasName(global, op.from)) {
      await config.update('tags', renameInConfig(global, op.from, op.to), vscode.ConfigurationTarget.Global);
    }
  } else if (op.kind === 'recolor') {
    const inLocal = paletteHasName(local, op.name);
    const inGlobal = paletteHasName(global, op.name);
    if (inLocal) {
      await config.update('tags', recolorInConfig(local, op.name, op.color), vscode.ConfigurationTarget.Workspace);
    }
    if (inGlobal) {
      await config.update('tags', recolorInConfig(global, op.name, op.color), vscode.ConfigurationTarget.Global);
    }
    if (!inLocal && !inGlobal) {
      // JSON-only tag → add to workspace config so the new color wins via precedence.
      await config.update('tags', [...local, { name: op.name, color: op.color }], vscode.ConfigurationTarget.Workspace);
    }
  } else {
    if (paletteHasName(local, op.name)) {
      await config.update('tags', deleteFromConfig(local, op.name), vscode.ConfigurationTarget.Workspace);
    }
    if (paletteHasName(global, op.name)) {
      await config.update('tags', deleteFromConfig(global, op.name), vscode.ConfigurationTarget.Global);
    }
  }

  for (const patch of groupTagPatches(groups, op)) {
    await store.updateGroup(patch.id, { tags: patch.tags }, now);
  }
}

/**
 * The "Annotated: Manage Tags…" flow: pick a tag, pick an action (rename / recolor / delete),
 * apply it to config + every affected group, then run `afterApply` (UI refresh).
 */
export async function manageTags(afterApply: () => Promise<void> | void): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage('Open a folder to manage annotation tags.');
    return;
  }
  const store = new GroupStore(new VscodeFileSystem(folder.uri));
  const groups = await store.listGroups();
  const palette = displayPalette(groups);
  if (palette.length === 0) {
    void vscode.window.showInformationMessage('No tags yet.');
    return;
  }

  const pickedTag = await vscode.window.showQuickPick(
    palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
    { placeHolder: 'Manage which tag?' },
  );
  if (!pickedTag) {
    return;
  }
  const name = pickedTag.label;

  const action = await vscode.window.showQuickPick(
    [{ label: RENAME }, { label: RECOLOR }, { label: DELETE }],
    { placeHolder: `Tag "${name}"` },
  );
  if (!action) {
    return;
  }

  let op: TagOp;
  if (action.label === RENAME) {
    const next = await vscode.window.showInputBox({
      prompt: 'New tag name',
      value: name,
      validateInput: (v) => {
        const t = v.trim();
        if (!t) {
          return 'Name cannot be empty.';
        }
        if (t !== name && paletteHasName(palette, t)) {
          return `A tag named "${t}" already exists.`;
        }
        return undefined;
      },
    });
    const to = next?.trim();
    if (!to || to === name) {
      return;
    }
    op = { kind: 'rename', from: name, to };
  } else if (action.label === RECOLOR) {
    const current = palette.find((t) => t.name === name)?.color;
    const color = await promptTagColor(current);
    if (color === undefined) {
      return;
    }
    op = { kind: 'recolor', name, color };
  } else {
    const count = groupsUsingTag(groups, name);
    const choice = await vscode.window.showWarningMessage(
      `Delete tag "${name}"? It will be removed from ${count} group${count === 1 ? '' : 's'}. This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') {
      return;
    }
    op = { kind: 'delete', name };
  }

  try {
    await applyOp(store, groups, op);
    await afterApply();
  } catch (err) {
    void vscode.window.showErrorMessage(`Tag operation failed: ${String(err)}`);
  }
}
