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

  it('writes to .annotations/groups/<title-slug>-<idseg>.json', async () => {
    await store.saveGroup(group('g1'));
    expect(await fs.exists('.annotations/groups/t-g1.json')).toBe(true);
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
    const bytes = await fs.readFile('.annotations/groups/exact-g1.json');
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

  it('updateGroup applies a partial patch, bumps updatedAt, and persists', async () => {
    await store.saveGroup(group('g1', 'Old'));
    const ok = await store.updateGroup('g1', { title: 'New', tags: [{ name: 'security', color: '#888888' }], gitRef: 'main' }, 555);
    expect(ok).toBe(true);
    const g = await store.getGroup('g1');
    expect(g?.title).toBe('New');
    expect(g?.tags).toEqual([{ name: 'security', color: '#888888' }]);
    expect(g?.gitRef).toBe('main');
    expect(g?.updatedAt).toBe(555);
  });

  it('updateGroup leaves unspecified fields unchanged', async () => {
    await store.saveGroup({ ...group('g1', 'Keep'), tags: [{ name: 'a', color: '#888888' }], gitRef: 'dev' });
    await store.updateGroup('g1', { title: 'Renamed' }, 1);
    const g = await store.getGroup('g1');
    expect(g?.title).toBe('Renamed');
    expect(g?.tags).toEqual([{ name: 'a', color: '#888888' }]);
    expect(g?.gitRef).toBe('dev');
  });

  it('updateGroup can set gitRef to null', async () => {
    await store.saveGroup({ ...group('g1'), gitRef: 'x' });
    await store.updateGroup('g1', { gitRef: null }, 1);
    expect((await store.getGroup('g1'))?.gitRef).toBeNull();
  });

  it('updateGroup returns false for a missing group', async () => {
    expect(await store.updateGroup('nope', { title: 'x' }, 1)).toBe(false);
  });

  it('updateAnnotationRange replaces range + contentHash, bumps updatedAt, persists', async () => {
    const g = group('g1');
    g.annotations.push({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'c', contentHash: 'old' });
    await store.saveGroup(g);
    const ok = await store.updateAnnotationRange('g1', 'a1', { startLine: 3, endLine: 5 }, 'newhash', 777);
    expect(ok).toBe(true);
    const r = await store.getGroup('g1');
    expect(r?.annotations[0].range).toEqual({ startLine: 3, endLine: 5 });
    expect(r?.annotations[0].contentHash).toBe('newhash');
    expect(r?.annotations[0].content).toBe('c');
    expect(r?.updatedAt).toBe(777);
  });

  it('updateAnnotationRange returns false for a missing group/annotation', async () => {
    expect(await store.updateAnnotationRange('nope', 'a1', { startLine: 1, endLine: 1 }, 'h', 1)).toBe(false);
    await store.saveGroup(group('g1'));
    expect(await store.updateAnnotationRange('g1', 'missing', { startLine: 1, endLine: 1 }, 'h', 1)).toBe(false);
  });

  it('reorderAnnotations rewrites the array order, bumps updatedAt, persists', async () => {
    const g = group('g1');
    g.annotations.push(
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'c1', contentHash: 'h' },
      { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: 'c2', contentHash: 'h' },
      { id: 'a3', file: 'x.ts', range: { startLine: 3, endLine: 3 }, content: 'c3', contentHash: 'h' },
    );
    await store.saveGroup(g);
    const ok = await store.reorderAnnotations('g1', ['a3', 'a1', 'a2'], 555);
    expect(ok).toBe(true);
    const r = await store.getGroup('g1');
    expect(r?.annotations.map((a) => a.id)).toEqual(['a3', 'a1', 'a2']);
    expect(r?.updatedAt).toBe(555);
  });

  it('reorderAnnotations rejects a non-permutation (missing/extra/duplicate ids)', async () => {
    const g = group('g1');
    g.annotations.push(
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
      { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
    );
    await store.saveGroup(g);
    expect(await store.reorderAnnotations('g1', ['a1'], 1)).toBe(false);
    expect(await store.reorderAnnotations('g1', ['a1', 'zzz'], 1)).toBe(false);
    expect(await store.reorderAnnotations('g1', ['a1', 'a1'], 1)).toBe(false);
    expect(await store.reorderAnnotations('missing', ['a1', 'a2'], 1)).toBe(false);
    const r = await store.getGroup('g1');
    expect(r?.annotations.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('updateGroup can patch status and bumps updatedAt', async () => {
    await store.saveGroup(group('g1'));
    const ok = await store.updateGroup('g1', { status: 'resolved' }, 909);
    expect(ok).toBe(true);
    const r = await store.getGroup('g1');
    expect(r?.status).toBe('resolved');
    expect(r?.updatedAt).toBe(909);
  });

  describe('filename resolution (read-side)', () => {
    const enc = (g: AnnotationGroup) => new TextEncoder().encode(serializeGroup(g));

    it('reads and deletes a legacy <uuid>.json file by id', async () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      await fs.writeFile(`.annotations/groups/${id}.json`, enc(group(id, 'Legacy')));
      expect((await store.getGroup(id))?.title).toBe('Legacy');
      await store.deleteGroup(id);
      expect(await store.getGroup(id)).toBeNull();
      expect(await fs.exists(`.annotations/groups/${id}.json`)).toBe(false);
    });

    it('reads a new-format <slug>-<idseg>.json file by full id', async () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      await fs.writeFile('.annotations/groups/misleading-docs-550e8400.json', enc(group(id, 'Misleading docs')));
      expect((await store.getGroup(id))?.title).toBe('Misleading docs');
    });

    it('resolves prefix-colliding slugged files by internal id', async () => {
      const a = '550e8400-aaaa-41d4-a716-446655440000';
      const b = '550e8400-bbbb-41d4-a716-446655440000';
      await fs.writeFile('.annotations/groups/x-550e8400.json', enc(group(a, 'A')));
      await fs.writeFile('.annotations/groups/y-550e8400b.json', enc(group(b, 'B')));
      expect((await store.getGroup(a))?.title).toBe('A');
      expect((await store.getGroup(b))?.title).toBe('B');
    });

    it('getGroup returns null when no file matches the id', async () => {
      await fs.writeFile('.annotations/groups/other-deadbeef.json', enc(group('deadbeef-0000-0000-0000-000000000000', 'Other')));
      expect(await store.getGroup('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    });
  });

  describe('deleteAnnotation', () => {
    function withAnnotations(id: string): AnnotationGroup {
      return {
        ...group(id),
        annotations: [
          { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
          { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
        ],
      };
    }

    it('removes the annotation, bumps updatedAt, and persists', async () => {
      await store.saveGroup(withAnnotations('g1'));
      expect(await store.deleteAnnotation('g1', 'a1', 99)).toBe(true);
      const got = await store.getGroup('g1');
      expect(got?.annotations.map((a) => a.id)).toEqual(['a2']);
      expect(got?.updatedAt).toBe(99);
    });

    it('keeps the (now empty) group file when the last annotation is deleted', async () => {
      const base = withAnnotations('g1');
      await store.saveGroup({ ...base, annotations: [base.annotations[0]] });
      expect(await store.deleteAnnotation('g1', 'a1', 99)).toBe(true);
      expect((await store.getGroup('g1'))?.annotations).toEqual([]);
      expect(await fs.exists('.annotations/groups/t-g1.json')).toBe(true);
    });

    it('returns false for a missing group or annotation', async () => {
      expect(await store.deleteAnnotation('nope', 'a1', 1)).toBe(false);
      await store.saveGroup(withAnnotations('g1'));
      expect(await store.deleteAnnotation('g1', 'missing', 1)).toBe(false);
    });
  });

  describe('filename scheme (write-side)', () => {
    const UID = '550e8400-e29b-41d4-a716-446655440000';

    it('names a new group <title-slug>-<idseg>.json', async () => {
      await store.saveGroup(group(UID, 'Misleading docs'));
      expect(await fs.exists('.annotations/groups/misleading-docs-550e8400.json')).toBe(true);
    });

    it('renames the file when the title changes and removes the old one', async () => {
      await store.saveGroup(group(UID, 'Old title'));
      expect(await fs.exists('.annotations/groups/old-title-550e8400.json')).toBe(true);
      await store.updateGroup(UID, { title: 'New title' }, 2);
      expect(await fs.exists('.annotations/groups/old-title-550e8400.json')).toBe(false);
      expect(await fs.exists('.annotations/groups/new-title-550e8400.json')).toBe(true);
      expect((await store.getGroup(UID))?.title).toBe('New title');
      expect((await fs.readDirectory('.annotations/groups')).length).toBe(1);
    });

    it('migrates a legacy <uuid>.json file to the slugged name on first write', async () => {
      await fs.writeFile(`.annotations/groups/${UID}.json`, new TextEncoder().encode(serializeGroup(group(UID, 'Legacy'))));
      await store.updateGroup(UID, { status: 'resolved' }, 2);
      expect(await fs.exists(`.annotations/groups/${UID}.json`)).toBe(false);
      expect(await fs.exists('.annotations/groups/legacy-550e8400.json')).toBe(true);
      expect((await store.getGroup(UID))?.status).toBe('resolved');
    });

    it('does not overwrite a different group that wants the same filename', async () => {
      const a = '550e8400-aaaa-41d4-a716-446655440000';
      const b = '550e8400-bbbb-41d4-a716-446655440000';
      await store.saveGroup(group(a, 'Same'));
      await store.saveGroup(group(b, 'Same')); // same slug + same first-8 hex → guard lengthens idseg
      const names = await fs.readDirectory('.annotations/groups');
      expect(names.length).toBe(2);
      expect((await store.getGroup(a))?.title).toBe('Same');
      expect((await store.getGroup(b))?.title).toBe('Same');
    });

    it('falls back to untitled for an empty title', async () => {
      await store.saveGroup(group(UID, ''));
      expect(await fs.exists('.annotations/groups/untitled-550e8400.json')).toBe(true);
    });
  });
});
