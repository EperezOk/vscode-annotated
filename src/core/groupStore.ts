import { type FileSystem } from './fileSystem';
import { type AnnotationGroup, parseGroup, serializeGroup } from '../shared/model';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** Persistence CRUD for annotation groups, one JSON file per group. */
export class GroupStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly dir = '.annotations/groups',
  ) {}

  private path(id: string): string {
    return `${this.dir}/${id}.json`;
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
    try {
      const bytes = await this.fs.readFile(this.path(id));
      return parseGroup(JSON.parse(dec.decode(bytes)));
    } catch {
      return null;
    }
  }

  /** Write a group (whole-file). Caller is responsible for timestamps. */
  async saveGroup(group: AnnotationGroup): Promise<void> {
    await this.fs.createDirectory(this.dir);
    await this.fs.writeFile(this.path(group.id), enc.encode(serializeGroup(group)));
  }

  /** Delete a group's file. No-op if absent. */
  async deleteGroup(id: string): Promise<void> {
    await this.fs.delete(this.path(id));
  }
}
