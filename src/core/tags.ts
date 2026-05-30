/** A user-configured tag: a name and a display color. */
export interface Tag {
  name: string;
  color: string;
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
