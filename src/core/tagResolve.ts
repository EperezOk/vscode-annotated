import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';

const DEFAULT_COLOR = '#888888';

/** First-seen JSON color per tag name across the given groups. */
export function jsonTagColors(groups: AnnotationGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const tag of group.tags) {
      if (!map.has(tag.name)) {
        map.set(tag.name, tag.color);
      }
    }
  }
  return map;
}

/** Resolve a tag's display color: local config → global config → JSON → default. */
export function resolveTagColor(
  name: string,
  sources: { local: TagColor[]; global: TagColor[]; json: Map<string, string> },
): string {
  const find = (arr: TagColor[]): string | undefined => arr.find((t) => t.name === name)?.color;
  return find(sources.local) ?? find(sources.global) ?? sources.json.get(name) ?? DEFAULT_COLOR;
}

/** The full display palette: every tag name (config ∪ groups), each color precedence-resolved. */
export function resolveDisplayPalette(
  local: TagColor[],
  global: TagColor[],
  groups: AnnotationGroup[],
): TagColor[] {
  const json = jsonTagColors(groups);
  const names = new Set<string>([
    ...local.map((t) => t.name),
    ...global.map((t) => t.name),
    ...groups.flatMap((g) => g.tags.map((t) => t.name)),
  ]);
  return [...names].sort().map((name) => ({ name, color: resolveTagColor(name, { local, global, json }) }));
}

/** Tags used by groups but absent from BOTH config sources, deduped, with their JSON color. */
export function missingWorkspaceTags(
  local: TagColor[],
  global: TagColor[],
  groups: AnnotationGroup[],
): TagColor[] {
  const json = jsonTagColors(groups);
  const have = new Set<string>([...local.map((t) => t.name), ...global.map((t) => t.name)]);
  const out: TagColor[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const tag of group.tags) {
      if (!have.has(tag.name) && !seen.has(tag.name)) {
        seen.add(tag.name);
        out.push({ name: tag.name, color: json.get(tag.name) ?? DEFAULT_COLOR });
      }
    }
  }
  return out;
}
