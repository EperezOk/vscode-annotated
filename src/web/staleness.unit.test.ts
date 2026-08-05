import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../core/memoryFileSystem';
import { computeStaleIds } from './staleness';
import { sha256Hex, anchorText } from '../shared/hash';
import { type AnnotationGroup } from '../shared/model';

const enc = new TextEncoder();

async function group(annotations: AnnotationGroup['annotations']): Promise<AnnotationGroup> {
  return {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open',
    createdAt: 1, updatedAt: 1, annotations,
  };
}

describe('computeStaleIds with whole-file annotations', () => {
  it('never marks a readable whole-file annotation stale, even after edits', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('src/foo.ts', enc.encode('totally different content\n'));
    const g = await group([{ id: 'a1', file: 'src/foo.ts', range: null, content: '', contentHash: '' }]);
    expect(await computeStaleIds(fs, g)).toEqual([]);
  });

  it('marks a whole-file annotation stale when its file is gone', async () => {
    const fs = new MemoryFileSystem();
    const g = await group([{ id: 'a1', file: 'src/gone.ts', range: null, content: '', contentHash: '' }]);
    expect(await computeStaleIds(fs, g)).toEqual(['a1']);
  });

  it('still hash-checks line annotations', async () => {
    const fs = new MemoryFileSystem();
    const text = 'one\ntwo\nthree\n';
    await fs.writeFile('src/foo.ts', enc.encode(text));
    const fresh = await sha256Hex(anchorText(text, { startLine: 2, endLine: 2 }));
    const g = await group([
      { id: 'ok', file: 'src/foo.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: fresh },
      { id: 'drifted', file: 'src/foo.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'stale' },
    ]);
    expect(await computeStaleIds(fs, g)).toEqual(['drifted']);
  });
});
