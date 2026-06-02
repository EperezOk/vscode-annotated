import { describe, it, expect } from 'vitest';
import { paletteHasName, renameInConfig, recolorInConfig, deleteFromConfig } from './tagAdmin';
import { groupTagPatches, groupsUsingTag } from './tagAdmin';
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
