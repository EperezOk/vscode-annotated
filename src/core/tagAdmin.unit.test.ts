import { describe, it, expect } from 'vitest';
import { paletteHasName, renameInConfig, recolorInConfig, deleteFromConfig } from './tagAdmin';
import { groupTagPatches, groupsUsingTag, commonTagNames, partialTagNames, bulkTagPatches } from './tagAdmin';
import { type AnnotationGroup } from '../shared/model';

function grp(id: string, tags: { name: string; color: string }[]): AnnotationGroup {
  return { id, title: id, author: 'A', tags, gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('paletteHasName', () => {
  it('matches by exact name', () => {
    const arr = [{ name: 'bug', color: '#111' }];
    expect(paletteHasName(arr, 'bug')).toBe(true);
    expect(paletteHasName(arr, 'Bug')).toBe(false);
    expect(paletteHasName(arr, 'perf')).toBe(false);
  });
});

describe('renameInConfig', () => {
  it('renames a matching entry, preserving its color; no-op if absent', () => {
    const arr = [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }];
    expect(renameInConfig(arr, 'bug', 'defect')).toEqual([
      { name: 'defect', color: '#111' },
      { name: 'perf', color: '#222' },
    ]);
    expect(renameInConfig(arr, 'absent', 'x')).toEqual(arr);
  });
});

describe('recolorInConfig', () => {
  it('updates a matching entry color; no-op if absent (does not add)', () => {
    const arr = [{ name: 'bug', color: '#111' }];
    expect(recolorInConfig(arr, 'bug', '#999')).toEqual([{ name: 'bug', color: '#999' }]);
    expect(recolorInConfig(arr, 'perf', '#999')).toEqual(arr);
  });
});

describe('deleteFromConfig', () => {
  it('removes a matching entry; no-op if absent', () => {
    const arr = [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }];
    expect(deleteFromConfig(arr, 'bug')).toEqual([{ name: 'perf', color: '#222' }]);
    expect(deleteFromConfig(arr, 'absent')).toEqual(arr);
  });
});

describe('groupTagPatches', () => {
  const groups = [
    grp('g1', [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }]),
    grp('g2', [{ name: 'perf', color: '#222' }]),
  ];

  it('rename: patches only groups that use the old name, preserving color', () => {
    expect(groupTagPatches(groups, { kind: 'rename', from: 'bug', to: 'defect' })).toEqual([
      { id: 'g1', tags: [{ name: 'defect', color: '#111' }, { name: 'perf', color: '#222' }] },
    ]);
  });

  it('recolor: patches only groups whose stored color differs', () => {
    const mixed = [
      grp('g1', [{ name: 'bug', color: '#111' }]),
      grp('g2', [{ name: 'bug', color: '#999' }]),
    ];
    expect(groupTagPatches(mixed, { kind: 'recolor', name: 'bug', color: '#999' })).toEqual([
      { id: 'g1', tags: [{ name: 'bug', color: '#999' }] },
    ]);
  });

  it('delete: strips the tag from each group that has it', () => {
    expect(groupTagPatches(groups, { kind: 'delete', name: 'perf' })).toEqual([
      { id: 'g1', tags: [{ name: 'bug', color: '#111' }] },
      { id: 'g2', tags: [] },
    ]);
  });

  it('returns nothing when no group is affected', () => {
    expect(groupTagPatches(groups, { kind: 'delete', name: 'absent' })).toEqual([]);
  });
});

describe('groupsUsingTag', () => {
  it('counts groups whose tags include the name', () => {
    const groups = [
      grp('g1', [{ name: 'bug', color: '#111' }]),
      grp('g2', [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }]),
      grp('g3', [{ name: 'perf', color: '#222' }]),
    ];
    expect(groupsUsingTag(groups, 'bug')).toBe(2);
    expect(groupsUsingTag(groups, 'absent')).toBe(0);
  });
});

const bug = { name: 'bug', color: '#111' };
const perf = { name: 'perf', color: '#222' };
const low = { name: 'low', color: '#333' };

describe('commonTagNames', () => {
  it('returns tag names present on every group (intersection)', () => {
    const groups = [grp('g1', [bug, perf]), grp('g2', [perf, low])];
    expect(commonTagNames(groups)).toEqual(['perf']);
  });
  it('is empty when groups share nothing', () => {
    expect(commonTagNames([grp('g1', [bug]), grp('g2', [perf])])).toEqual([]);
  });
  it('returns a single group\'s own tags', () => {
    expect(commonTagNames([grp('g1', [bug, perf])])).toEqual(['bug', 'perf']);
  });
  it('returns [] for no groups', () => {
    expect(commonTagNames([])).toEqual([]);
  });
});

describe('partialTagNames', () => {
  it('returns names on some-but-not-all groups (union minus intersection)', () => {
    const groups = [grp('g1', [bug, perf]), grp('g2', [perf, low])];
    expect(partialTagNames(groups).sort()).toEqual(['bug', 'low']);
  });
  it('is empty when all groups share the same tags', () => {
    expect(partialTagNames([grp('g1', [perf]), grp('g2', [perf])])).toEqual([]);
  });
});

describe('bulkTagPatches', () => {
  it('removes a common tag (unchecked) from every group, preserving the rest', () => {
    const groups = [grp('g1', [bug, perf]), grp('g2', [perf, low])];
    // common = [perf]; picked = [] → perf removed from both, bug/low preserved.
    expect(bulkTagPatches(groups, [])).toEqual([
      { id: 'g1', tags: [bug] },
      { id: 'g2', tags: [low] },
    ]);
  });

  it('adds a newly-checked tag to every group, keeping their distinct tags', () => {
    const groups = [grp('g1', [bug]), grp('g2', [perf])];
    // common = []; picked = [low] → low added to both.
    expect(bulkTagPatches(groups, [low])).toEqual([
      { id: 'g1', tags: [bug, low] },
      { id: 'g2', tags: [perf, low] },
    ]);
  });

  it('makes no change when the picked set equals the common set', () => {
    const groups = [grp('g1', [bug, perf]), grp('g2', [perf, low])];
    expect(bulkTagPatches(groups, [perf])).toEqual([]);
  });

  it('adds a partial tag only to groups missing it (no duplicates, no reorder churn)', () => {
    const groups = [grp('g1', [perf, low]), grp('g2', [perf])];
    // common = [perf]; low is partial. picked = [perf, low] → low added to g2 only; g1 unchanged.
    expect(bulkTagPatches(groups, [perf, low])).toEqual([{ id: 'g2', tags: [perf, low] }]);
  });

  it('removes a common tag and adds a new one in one edit', () => {
    const done = { name: 'done', color: '#444' };
    const groups = [grp('g1', [bug, perf]), grp('g2', [perf, low])];
    // common = [perf]; picked = [bug? no] → picked = [done]: perf unchecked (remove), done new (add).
    expect(bulkTagPatches(groups, [done])).toEqual([
      { id: 'g1', tags: [bug, done] },
      { id: 'g2', tags: [low, done] },
    ]);
  });

  it('behaves like a plain set-edit for a single group', () => {
    const groups = [grp('g1', [bug, perf])];
    // common = [bug, perf]; picked = [bug] → perf removed.
    expect(bulkTagPatches(groups, [bug])).toEqual([{ id: 'g1', tags: [bug] }]);
  });

  it('added tags carry the picked color; preserved (still-common) tags keep their own', () => {
    const groups = [grp('g1', [bug]), grp('g2', [bug])];
    const lowRecolored = { name: 'low', color: '#abcdef' };
    // common = [bug] stays checked; low is newly added with the picked color.
    expect(bulkTagPatches(groups, [bug, lowRecolored])).toEqual([
      { id: 'g1', tags: [bug, lowRecolored] },
      { id: 'g2', tags: [bug, lowRecolored] },
    ]);
  });
});
