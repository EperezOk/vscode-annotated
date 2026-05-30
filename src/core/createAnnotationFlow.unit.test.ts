import { describe, it, expect, vi } from 'vitest';
import { runCreateAnnotation, type CreateAnnotationDeps } from './createAnnotationFlow';
import { createGroup } from './annotationFactory';
import { type AnnotationGroup } from '../shared/model';

function deps(overrides: Partial<CreateAnnotationDeps>): CreateAnnotationDeps {
  return {
    getSelection: () => ({ file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, fileText: 'a\nb\nc' }),
    resolveAuthor: async () => 'Author',
    listGroups: async () => [],
    pickGroup: async () => ({ kind: 'new' }),
    promptGroupTitle: async () => 'New Group',
    pickTags: async () => [],
    saveGroup: vi.fn(async () => {}),
    newId: () => 'id-1',
    now: () => 1000,
    hashContent: async () => 'HASH',
    showInfo: vi.fn(),
    showWarning: vi.fn(),
    ...overrides,
  };
}

describe('runCreateAnnotation', () => {
  it('warns and aborts when there is no selection', async () => {
    const showWarning = vi.fn();
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ getSelection: () => undefined, showWarning, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalled();
  });

  it('creates a new group with the annotation and saves it', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    let nextId = 0;
    const result = await runCreateAnnotation(
      deps({ saveGroup, newId: () => `id-${++nextId}`, pickTags: async () => ['security'] }),
    );
    expect(saveGroup).toHaveBeenCalledTimes(1);
    const saved = saveGroup.mock.calls[0][0] as AnnotationGroup;
    expect(saved.title).toBe('New Group');
    expect(saved.author).toBe('Author');
    expect(saved.tags).toEqual(['security']);
    expect(saved.annotations).toHaveLength(1);
    expect(saved.annotations[0]).toMatchObject({ file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'HASH' });
    expect(result?.id).toBe(saved.id);
  });

  it('hashes the anchored code lines (not the whole file)', async () => {
    const hashContent = vi.fn(async () => 'HASH');
    await runCreateAnnotation(deps({ hashContent, getSelection: () => ({ file: 'f', range: { startLine: 2, endLine: 3 }, fileText: 'l1\nl2\nl3\nl4' }) }));
    expect(hashContent).toHaveBeenCalledWith('l2\nl3');
  });

  it('appends to an existing group when one is picked', async () => {
    const existing = createGroup({ id: 'g1', title: 'Existing', author: 'A', tags: [], now: 1 });
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    await runCreateAnnotation(
      deps({ listGroups: async () => [existing], pickGroup: async () => ({ kind: 'existing', id: 'g1' }), saveGroup }),
    );
    const saved = saveGroup.mock.calls[0][0] as AnnotationGroup;
    expect(saved.id).toBe('g1');
    expect(saved.annotations).toHaveLength(1);
    expect(saved.updatedAt).toBe(1000);
  });

  it('aborts without saving when the group pick is cancelled', async () => {
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ pickGroup: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('aborts without saving when the new-group title is cancelled', async () => {
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ promptGroupTitle: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('aborts without saving when tag selection is cancelled', async () => {
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ pickTags: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });
});
