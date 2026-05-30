import { describe, it, expect, beforeEach } from 'vitest';
import { GroupStore } from './groupStore';
import { MemoryFileSystem } from './memoryFileSystem';
import { serializeGroup, type AnnotationGroup } from '../shared/model';

function group(id: string, title = 'T'): AnnotationGroup {
  return {
    id,
    title,
    author: 'A',
    tags: [],
    gitRef: null,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    annotations: [],
  };
}

describe('GroupStore', () => {
  let fs: MemoryFileSystem;
  let store: GroupStore;
  beforeEach(() => {
    fs = new MemoryFileSystem();
    store = new GroupStore(fs);
  });

  it('saveGroup then getGroup round-trips', async () => {
    await store.saveGroup(group('g1', 'Hello'));
    const got = await store.getGroup('g1');
    expect(got?.title).toBe('Hello');
  });

  it('writes to .annotations/groups/<id>.json', async () => {
    await store.saveGroup(group('g1'));
    expect(await fs.exists('.annotations/groups/g1.json')).toBe(true);
  });

  it('getGroup returns null for a missing id', async () => {
    expect(await store.getGroup('missing')).toBeNull();
  });

  it('listGroups returns all saved groups', async () => {
    await store.saveGroup(group('g1'));
    await store.saveGroup(group('g2'));
    expect((await store.listGroups()).map((g) => g.id).sort()).toEqual(['g1', 'g2']);
  });

  it('listGroups returns [] when the directory does not exist', async () => {
    expect(await store.listGroups()).toEqual([]);
  });

  it('listGroups skips invalid JSON / invalid group files', async () => {
    await store.saveGroup(group('g1'));
    await fs.writeFile('.annotations/groups/broken.json', new TextEncoder().encode('{ not json'));
    await fs.writeFile(
      '.annotations/groups/wrong.json',
      new TextEncoder().encode(JSON.stringify({ id: 'x' })),
    );
    expect((await store.listGroups()).map((g) => g.id)).toEqual(['g1']);
  });

  it('ignores non-.json files in the directory', async () => {
    await store.saveGroup(group('g1'));
    await fs.writeFile('.annotations/groups/README.md', new TextEncoder().encode('# hi'));
    expect((await store.listGroups()).map((g) => g.id)).toEqual(['g1']);
  });

  it('deleteGroup removes the file', async () => {
    await store.saveGroup(group('g1'));
    await store.deleteGroup('g1');
    expect(await store.getGroup('g1')).toBeNull();
  });

  it('persists exactly the serialized form', async () => {
    const g = group('g1', 'Exact');
    await store.saveGroup(g);
    const bytes = await fs.readFile('.annotations/groups/g1.json');
    expect(new TextDecoder().decode(bytes)).toBe(serializeGroup(g));
  });

  it('updateAnnotation replaces content, bumps updatedAt, and persists', async () => {
    const g = group('g1');
    g.annotations.push({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'old', contentHash: 'h' });
    await store.saveGroup(g);
    const ok = await store.updateAnnotation('g1', 'a1', 'new content', 999);
    expect(ok).toBe(true);
    const reloaded = await store.getGroup('g1');
    expect(reloaded?.annotations[0].content).toBe('new content');
    expect(reloaded?.updatedAt).toBe(999);
  });

  it('updateAnnotation returns false for a missing group or annotation', async () => {
    expect(await store.updateAnnotation('nope', 'a1', 'x', 1)).toBe(false);
    await store.saveGroup(group('g1'));
    expect(await store.updateAnnotation('g1', 'missing', 'x', 1)).toBe(false);
  });
});
