import * as vscode from 'vscode';
import { type Tag, parseTagPalette, TAG_SWATCHES, NEW_TAG_LABEL, resolveTagPickAccept } from '../core/tags';
import { swatchIconSvg } from '../shared/svgIcon';
import { type AnnotationGroup, DEFAULT_TAG_COLOR } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import { resolveDisplayPalette, missingWorkspaceTags } from '../core/tagResolve';
import { tagColor } from '../core/sidebarState';

/** Add a tag to the palette if its name isn't already present. */
export async function addTagToPalette(name: string, color = DEFAULT_TAG_COLOR): Promise<void> {
  const config = vscode.workspace.getConfiguration('annotated');
  const current = parseTagPalette(config.get('tags'));
  if (current.some((t) => t.name === name)) {
    return;
  }
  await config.update('tags', [...current, { name, color }], vscode.ConfigurationTarget.Global);
}

const CUSTOM_HEX_LABEL = '$(paintcan) Custom hex…';

/**
 * Prompt for a tag color via the visual swatch QuickPick (with a custom-hex fallback).
 * `initial` pre-fills the custom-hex input box. Returns undefined if the user cancels.
 */
export async function promptTagColor(initial: string = DEFAULT_TAG_COLOR): Promise<string | undefined> {
  const items: vscode.QuickPickItem[] = [
    ...TAG_SWATCHES.map((s) => ({
      label: s.name,
      description: s.hex,
      iconPath: vscode.Uri.parse(swatchIconSvg(s.hex)),
    })),
    { label: CUSTOM_HEX_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Tag color' });
  if (!picked) {
    return undefined;
  }
  if (picked.label === CUSTOM_HEX_LABEL) {
    const hex = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: initial });
    if (hex === undefined) {
      return undefined;
    }
    return hex.trim() || DEFAULT_TAG_COLOR;
  }
  return picked.description ?? DEFAULT_TAG_COLOR;
}

/**
 * Prompt for a new tag's name + color, persist it to the palette, and return it.
 * Returns undefined if the user cancels at any step or leaves the name blank.
 */
export async function promptNewTag(): Promise<Tag | undefined> {
  const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
  if (!name || !name.trim()) {
    return undefined;
  }
  const color = await promptTagColor();
  if (color === undefined) {
    return undefined;
  }
  const tag: Tag = { name: name.trim(), color };
  await addTagToPalette(tag.name, tag.color);
  return tag;
}

/** Local (workspace) and global (user) tag palettes, read separately for precedence. */
export function readTagSources(): { local: Tag[]; global: Tag[] } {
  const inspected = vscode.workspace.getConfiguration('annotated').inspect('tags');
  return {
    local: parseTagPalette(inspected?.workspaceValue),
    global: parseTagPalette(inspected?.globalValue),
  };
}

/** The precedence-resolved display palette (local > global > JSON) for the given groups. */
export function displayPalette(groups: AnnotationGroup[]): TagColor[] {
  const { local, global } = readTagSources();
  return resolveDisplayPalette(local, global, groups);
}

/** Add group tags missing from both configs to the workspace config (idempotent — no-op if none). */
export async function reconcileWorkspaceTags(groups: AnnotationGroup[]): Promise<void> {
  const { local, global } = readTagSources();
  const missing = missingWorkspaceTags(local, global, groups);
  if (missing.length === 0) {
    return;
  }
  await vscode.workspace
    .getConfiguration('annotated')
    .update('tags', [...local, ...missing], vscode.ConfigurationTarget.Workspace);
}

/** Options for `pickTagsWithNewOption`. */
export interface PickTagsOptions {
  placeHolder: string;
  /** Tag names to show pre-checked (e.g. the group's current tags). */
  preselectedNames?: string[];
  /**
   * Tag names that are on SOME but not all of the targets (bulk edit). Shown with a "mixed…"
   * hint and left unchecked: checking one adds it to all; leaving it is a no-op (it stays on
   * whichever groups already have it — you can't remove a non-common tag from here).
   */
  partialNames?: string[];
}

/**
 * Multi-select tag QuickPick with a pinned "＋New tag…" action item, shared by the
 * create flow and the tag-edit handlers. Built on `createQuickPick` (not
 * `showQuickPick`) so that:
 * - checking "New tag…" accepts immediately (it is an action, not a tag), and
 * - Enter on the highlighted-but-unchecked "New tag…" still counts as add-new
 *   (a plain multi-select accept would return [] and silently skip the prompts).
 * Returns the picked tags (with any newly created tag appended), [] for "no tags",
 * or undefined if the user cancelled.
 */
export async function pickTagsWithNewOption(
  palette: TagColor[],
  options: PickTagsOptions,
): Promise<Tag[] | undefined> {
  // Guard: the action item must never be pre-checked (it would auto-accept on open).
  const preselected = new Set(options.preselectedNames ?? []);
  preselected.delete(NEW_TAG_LABEL);
  const partial = new Set(options.partialNames ?? []);
  const quickPick = vscode.window.createQuickPick();
  quickPick.canSelectMany = true;
  quickPick.placeholder = options.placeHolder;
  quickPick.items = [
    ...palette.map((t) => ({
      label: t.name,
      iconPath: vscode.Uri.parse(swatchIconSvg(t.color)),
      ...(partial.has(t.name) ? { description: 'on some — check to add to all' } : {}),
    })),
    { label: NEW_TAG_LABEL, alwaysShow: true },
  ];
  quickPick.selectedItems = quickPick.items.filter((item) => preselected.has(item.label));

  const accepted = await new Promise<{ names: string[]; addNew: boolean } | undefined>((resolve) => {
    // Checking "New tag…" is an action: accept right away (later resolves are no-ops).
    quickPick.onDidChangeSelection((selection) => {
      if (selection.some((item) => item.label === NEW_TAG_LABEL)) {
        resolve(resolveTagPickAccept(selection.map((item) => item.label), undefined));
        quickPick.hide();
      }
    });
    quickPick.onDidAccept(() => {
      resolve(
        resolveTagPickAccept(
          quickPick.selectedItems.map((item) => item.label),
          quickPick.activeItems[0]?.label,
        ),
      );
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      resolve(undefined); // cancel; no-op when accept already resolved
      quickPick.dispose();
    });
    quickPick.show();
  });

  if (!accepted) {
    return undefined;
  }
  const tags: Tag[] = accepted.names.map((name) => ({ name, color: tagColor(palette, name) }));
  if (accepted.addNew) {
    const created = await promptNewTag();
    if (created) {
      tags.push(created);
    }
  }
  return tags;
}
