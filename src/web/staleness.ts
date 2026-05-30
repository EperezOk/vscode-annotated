import { type AnnotationGroup } from '../shared/model';
import { type FileSystem } from '../core/fileSystem';
import { isAnnotationStale } from '../core/drift';

const dec = new TextDecoder();

/** Ids of annotations whose anchored lines no longer match their stored hash (or whose file is gone). */
export async function computeStaleIds(fs: FileSystem, group: AnnotationGroup): Promise<string[]> {
  const stale: string[] = [];
  for (const annotation of group.annotations) {
    try {
      const fileText = dec.decode(await fs.readFile(annotation.file));
      if (await isAnnotationStale(fileText, annotation.range, annotation.contentHash)) {
        stale.push(annotation.id);
      }
    } catch {
      stale.push(annotation.id); // file missing/unreadable → treat as stale
    }
  }
  return stale;
}
