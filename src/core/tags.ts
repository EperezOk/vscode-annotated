/** A user-configured tag: a name and a display color. */
export interface Tag {
  name: string;
  color: string;
}

/** The pinned QuickPick item label that triggers inline tag creation. */
export const NEW_TAG_LABEL = '$(add) New tag…';

/** Split picked QuickPick labels into real tag names + whether ＋New tag was chosen. */
export function splitPickedTags(labels: string[]): { names: string[]; addNew: boolean } {
  const names: string[] = [];
  let addNew = false;
  for (const label of labels) {
    if (label === NEW_TAG_LABEL) {
      addNew = true;
    } else {
      names.push(label);
    }
  }
  return { names, addNew };
}

const DEFAULT_COLOR = '#888888';

/** Validate/normalize the raw `annotated.tags` config value into a Tag[]. */
export function parseTagPalette(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const tags: Tag[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
      const name = (item as { name: string }).name;
      const colorValue = (item as { color?: unknown }).color;
      tags.push({ name, color: typeof colorValue === 'string' ? colorValue : DEFAULT_COLOR });
    }
  }
  return tags;
}
