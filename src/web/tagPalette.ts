import * as vscode from 'vscode';
import { type Tag, parseTagPalette } from '../core/tags';

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
