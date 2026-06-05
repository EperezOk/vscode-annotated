import { type Tag, type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';

export type { Tag };

/** A palette-level tag operation. */
export type TagOp =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'recolor'; name: string; color: string }
  | { kind: 'delete'; name: string };

/** True if a tag with this exact name exists in the array. */
export function paletteHasName(arr: TagColor[], name: string): boolean {
  return arr.some((t) => t.name === name);
}

/** Rename a config entry old→new, preserving its color. No-op if `oldName` is absent. */
export function renameInConfig(arr: TagColor[], oldName: string, newName: string): TagColor[] {
  return arr.map((t) => (t.name === oldName ? { name: newName, color: t.color } : t));
}

/** Set a config entry's color. No-op if `name` is absent (does NOT add). */
export function recolorInConfig(arr: TagColor[], name: string, color: string): TagColor[] {
  return arr.map((t) => (t.name === name ? { name: t.name, color } : t));
}

/** Remove a config entry by name. No-op if absent. */
export function deleteFromConfig(arr: TagColor[], name: string): TagColor[] {
  return arr.filter((t) => t.name !== name);
}

/** Per-group new `tags[]` for an op — returns ONLY groups that actually change. */
export function groupTagPatches(groups: AnnotationGroup[], op: TagOp): { id: string; tags: Tag[] }[] {
  const out: { id: string; tags: Tag[] }[] = [];
  for (const g of groups) {
    if (op.kind === 'rename') {
      if (!g.tags.some((t) => t.name === op.from)) continue;
      out.push({ id: g.id, tags: g.tags.map((t) => (t.name === op.from ? { name: op.to, color: t.color } : t)) });
    } else if (op.kind === 'recolor') {
      if (!g.tags.some((t) => t.name === op.name && t.color !== op.color)) continue;
      out.push({ id: g.id, tags: g.tags.map((t) => (t.name === op.name ? { name: t.name, color: op.color } : t)) });
    } else {
      if (!g.tags.some((t) => t.name === op.name)) continue;
      out.push({ id: g.id, tags: g.tags.filter((t) => t.name !== op.name) });
    }
  }
  return out;
}

/** How many groups currently use the tag. */
export function groupsUsingTag(groups: AnnotationGroup[], name: string): number {
  return groups.filter((g) => g.tags.some((t) => t.name === name)).length;
}

function sameTags(a: Tag[], b: Tag[]): boolean {
  return a.length === b.length && a.every((t, i) => t.name === b[i].name && t.color === b[i].color);
}

/** Tag names present on EVERY group (intersection by name). [] for no groups. */
export function commonTagNames(groups: AnnotationGroup[]): string[] {
  if (groups.length === 0) {
    return [];
  }
  const [first, ...rest] = groups;
  return first.tags
    .map((t) => t.name)
    .filter((name) => rest.every((g) => g.tags.some((t) => t.name === name)));
}

/** Tag names on SOME but not all groups (union minus intersection) — "mixed" across the set. */
export function partialTagNames(groups: AnnotationGroup[]): string[] {
  const common = new Set(commonTagNames(groups));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const t of g.tags) {
      if (!common.has(t.name) && !seen.has(t.name)) {
        seen.add(t.name);
        out.push(t.name);
      }
    }
  }
  return out;
}

/**
 * Differential bulk tag edit. `picked` is the final selection from a multi-select picker that was
 * pre-checked with the groups' COMMON tags (see `commonTagNames`). The only meaningful moves are:
 *  - a previously-common tag left UNchecked  → removed from every group,
 *  - a newly-checked tag (not previously common) → added to every group (that lacks it),
 *  - every other (non-common) tag a group has  → left untouched.
 * This never clobbers a group's distinct tags. Returns ONLY the groups whose tags actually change.
 */
export function bulkTagPatches(groups: AnnotationGroup[], picked: Tag[]): { id: string; tags: Tag[] }[] {
  const common = new Set(commonTagNames(groups));
  const pickedNames = new Set(picked.map((t) => t.name));
  const removeNames = new Set([...common].filter((name) => !pickedNames.has(name)));
  const addTags = picked.filter((t) => !common.has(t.name)); // ensure these on every group

  const out: { id: string; tags: Tag[] }[] = [];
  for (const g of groups) {
    const existing = new Set(g.tags.map((t) => t.name));
    const kept = g.tags.filter((t) => !removeNames.has(t.name)); // preserve order + existing colors
    const next = [...kept, ...addTags.filter((t) => !existing.has(t.name))];
    if (!sameTags(g.tags, next)) {
      out.push({ id: g.id, tags: next });
    }
  }
  return out;
}
