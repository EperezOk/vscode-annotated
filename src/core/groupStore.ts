import { type FileSystem } from './fileSystem';
import { type AnnotationGroup, type LineRange, parseGroup, serializeGroup } from '../shared/model';
import { removeAnnotation } from './annotationFactory';
import { slugifyTitle } from '../shared/slug';
import { idSegment } from '../shared/ids';

const dec = new TextDecoder();
const enc = new TextEncoder();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Persistence CRUD for annotation groups, one JSON file per group. */
export class GroupStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly dir = '.annotations/groups',
  ) {}

  /**
   * The real on-disk path for a group `id`, or null. The filename is cosmetic; the
   * canonical id lives inside the JSON. A file belongs to `id` when its stem equals
   * `id` (legacy `<id>.json`, e.g. a `<uuid>.json`) or its trailing `-` token is a prefix of the
   * de-hyphenated id (`<title-slug>-<idseg>.json`). Exact matches are unambiguous;
   * shorter-prefix matches are confirmed by reading each candidate's internal id.
   */
  private async resolvePath(id: string): Promise<string | null> {
    const names = await this.fs.readDirectory(this.dir);
    const deId = id.replace(/-/g, '');
    const exact: string[] = [];
    const prefix: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const stem = name.slice(0, -'.json'.length);
      if (stem === id) {
        exact.push(name); // legacy `<id>.json` — the stem is the canonical id verbatim
        continue;
      }
      if (UUID_RE.test(stem)) {
        continue; // a uuid stem that isn't this id — a different group's legacy file
      }
      const seg = stem.slice(stem.lastIndexOf('-') + 1); // whole stem when there is no '-'
      if (seg.length === 0 || !deId.startsWith(seg)) {
        continue;
      }
      (seg === deId ? exact : prefix).push(name);
    }
    if (exact.length > 0) {
      return `${this.dir}/${exact[0]}`;
    }
    for (const name of prefix) {
      try {
        const parsed = JSON.parse(dec.decode(await this.fs.readFile(`${this.dir}/${name}`)));
        if (parsed?.id === id) {
          return `${this.dir}/${name}`;
        }
      } catch {
        // unparseable candidate — skip
      }
    }
    return null;
  }

  /** Load all valid groups. Invalid/unparseable files are skipped (with a warning). */
  async listGroups(): Promise<AnnotationGroup[]> {
    const names = await this.fs.readDirectory(this.dir);
    const groups: AnnotationGroup[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      try {
        const bytes = await this.fs.readFile(`${this.dir}/${name}`);
        groups.push(parseGroup(JSON.parse(dec.decode(bytes))));
      } catch (e) {
        console.warn(`[annotated] skipping invalid group file ${name}: ${String(e)}`);
      }
    }
    return groups;
  }

  /** Load one group by id, or null if missing/invalid. */
  async getGroup(id: string): Promise<AnnotationGroup | null> {
    const path = await this.resolvePath(id);
    if (!path) {
      return null;
    }
    try {
      return parseGroup(JSON.parse(dec.decode(await this.fs.readFile(path))));
    } catch {
      return null;
    }
  }

  /** Write a group (whole-file) under `<title-slug>-<idseg>.json`. Renames on
   *  title change, migrates a legacy `<id>.json` file, and never clobbers a
   *  different group. Caller is responsible for timestamps. */
  async saveGroup(group: AnnotationGroup): Promise<void> {
    await this.fs.createDirectory(this.dir);
    const existing = await this.resolvePath(group.id);
    let len = 8;
    let target = this.nameFor(group, len);
    while (await this.takenByOther(target, group.id)) {
      const next = this.nameFor(group, ++len);
      if (next === target) {
        break; // id segment can't grow any further
      }
      target = next;
    }
    const targetPath = `${this.dir}/${target}`;
    await this.fs.writeFile(targetPath, enc.encode(serializeGroup(group)));
    if (existing && existing !== targetPath) {
      await this.fs.delete(existing);
    }
  }

  /** The canonical filename for `group`, using the first `len` chars of its id segment. */
  private nameFor(group: AnnotationGroup, len: number): string {
    return `${slugifyTitle(group.title)}-${idSegment(group.id, len)}.json`;
  }

  /** True when `name` exists and holds a group whose id differs from `id` (or is unreadable). */
  private async takenByOther(name: string, id: string): Promise<boolean> {
    const path = `${this.dir}/${name}`;
    if (!(await this.fs.exists(path))) {
      return false;
    }
    try {
      const parsed = JSON.parse(dec.decode(await this.fs.readFile(path)));
      return parsed?.id !== id;
    } catch {
      return true; // present but unreadable — don't clobber
    }
  }

  /** Delete a group's file (found by id). No-op if absent. */
  async deleteGroup(id: string): Promise<void> {
    const path = await this.resolvePath(id);
    if (path) {
      await this.fs.delete(path);
    }
  }

  /**
   * Replace one annotation's content and bump the group's updatedAt, then persist.
   * Returns false if the group or annotation does not exist.
   */
  async updateAnnotation(groupId: string, annotationId: string, content: string, now: number): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const index = group.annotations.findIndex((a) => a.id === annotationId);
    if (index < 0) {
      return false;
    }
    const annotations = group.annotations.map((a, i) => (i === index ? { ...a, content } : a));
    await this.saveGroup({ ...group, annotations, updatedAt: now });
    return true;
  }

  /**
   * Replace one annotation's line range + content hash (file is fixed), bump
   * updatedAt, persist. Returns false if the group/annotation does not exist.
   */
  async updateAnnotationRange(
    groupId: string,
    annotationId: string,
    range: LineRange,
    contentHash: string,
    now: number,
  ): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const index = group.annotations.findIndex((a) => a.id === annotationId);
    if (index < 0) {
      return false;
    }
    const annotations = group.annotations.map((a, i) => (i === index ? { ...a, range, contentHash } : a));
    await this.saveGroup({ ...group, annotations, updatedAt: now });
    return true;
  }

  /**
   * Rewrite the annotation order to match `orderedIds`. Persists only when
   * `orderedIds` is a permutation of the group's existing annotation ids
   * (same length, every id present exactly once). Returns false otherwise.
   */
  async reorderAnnotations(groupId: string, orderedIds: string[], now: number): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const byId = new Map(group.annotations.map((a) => [a.id, a]));
    const unique = new Set(orderedIds);
    if (orderedIds.length !== group.annotations.length || unique.size !== orderedIds.length) {
      return false;
    }
    if (!orderedIds.every((id) => byId.has(id))) {
      return false;
    }
    const annotations = orderedIds.map((id) => byId.get(id)!);
    await this.saveGroup({ ...group, annotations, updatedAt: now });
    return true;
  }

  /**
   * Delete one annotation from a group; the group itself is kept, even when
   * emptied. Returns false when the group or annotation does not exist.
   */
  async deleteAnnotation(groupId: string, annotationId: string, now: number): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const updated = removeAnnotation(group, annotationId, now);
    if (!updated) {
      return false;
    }
    await this.saveGroup(updated);
    return true;
  }

  /**
   * Apply a partial patch to a group's metadata (title/tags/gitRef), bump
   * updatedAt, and persist. Returns false if the group does not exist.
   */
  async updateGroup(
    groupId: string,
    patch: Partial<Pick<AnnotationGroup, 'title' | 'tags' | 'gitRef' | 'status'>>,
    now: number,
  ): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const next: AnnotationGroup = {
      ...group,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      ...(patch.gitRef !== undefined ? { gitRef: patch.gitRef } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: now,
    };
    await this.saveGroup(next);
    return true;
  }
}
