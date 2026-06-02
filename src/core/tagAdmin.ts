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
