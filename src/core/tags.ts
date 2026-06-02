import { type Tag, DEFAULT_TAG_COLOR } from '../shared/model';
export type { Tag };

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

/** The fixed set of named color swatches offered when creating a new tag. */
export const TAG_SWATCHES: readonly { name: string; hex: string }[] = [
  { name: 'Red', hex: '#E5484D' },
  { name: 'Amber', hex: '#F5A623' },
  { name: 'Yellow', hex: '#E5C100' },
  { name: 'Green', hex: '#3FB950' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Blue', hex: '#3794FF' },
  { name: 'Indigo', hex: '#5B5BD6' },
  { name: 'Gray', hex: '#8B949E' },
];

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
      tags.push({ name, color: typeof colorValue === 'string' ? colorValue : DEFAULT_TAG_COLOR });
    }
  }
  return tags;
}
