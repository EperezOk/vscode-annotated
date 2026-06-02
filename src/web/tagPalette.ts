import * as vscode from 'vscode';
import { type Tag, parseTagPalette, TAG_SWATCHES } from '../core/tags';
import { swatchIconSvg } from '../shared/svgIcon';
import { type AnnotationGroup, DEFAULT_TAG_COLOR } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import { resolveDisplayPalette, missingWorkspaceTags } from '../core/tagResolve';

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
