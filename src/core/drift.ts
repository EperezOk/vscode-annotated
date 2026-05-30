import { type LineRange } from '../shared/model';
import { anchorText, sha256Hex } from '../shared/hash';

/** True if the current file's anchored lines no longer match the stored content hash. */
export async function isAnnotationStale(fileText: string, range: LineRange, contentHash: string): Promise<boolean> {
  const current = await sha256Hex(anchorText(fileText, range));
  return current !== contentHash;
}
