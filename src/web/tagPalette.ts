import * as vscode from 'vscode';
import { type Tag, parseTagPalette, TAG_SWATCHES } from '../core/tags';
import { swatchIconSvg } from '../shared/svgIcon';

const DEFAULT_COLOR = '#888888';

/** Read the configured tag palette (`annotated.tags`). */
export function readTagPalette(): Tag[] {
  return parseTagPalette(vscode.workspace.getConfiguration('annotated').get('tags'));
}

/** Add a tag to the palette if its name isn't already present. */
export async function addTagToPalette(name: string, color = DEFAULT_COLOR): Promise<void> {
  const config = vscode.workspace.getConfiguration('annotated');
  const current = parseTagPalette(config.get('tags'));
  if (current.some((t) => t.name === name)) {
    return;
  }
  await config.update('tags', [...current, { name, color }], vscode.ConfigurationTarget.Global);
}

const CUSTOM_HEX_LABEL = '$(paintcan) Custom hex…';

/**
 * Prompt for a new tag's name + color (visual swatch QuickPick, with a custom-hex
 * fallback), persist it to the palette, and return it. Returns undefined if the user
 * cancels at any step or leaves the name blank.
 */
export async function promptNewTag(): Promise<Tag | undefined> {
  const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
  if (!name || !name.trim()) {
    return undefined;
  }
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
  let color: string;
  if (picked.label === CUSTOM_HEX_LABEL) {
    const hex = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: DEFAULT_COLOR });
    color = hex?.trim() || DEFAULT_COLOR;
  } else {
    color = picked.description ?? DEFAULT_COLOR;
  }
  const tag: Tag = { name: name.trim(), color };
  await addTagToPalette(tag.name, tag.color);
  return tag;
}
