import { describe, it, expect } from 'vitest';
import { initialSidebarState, applyHostMessage, tagColor } from './sidebarState';
import { type AnnotationGroup } from '../shared/model';

function group(id: string): AnnotationGroup {
  return { id, title: id, author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('initialSidebarState', () => {
  it('is empty with no selection', () => {
    expect(initialSidebarState()).toEqual({ groups: [], palette: [], selectedId: null });
  });
});

describe('applyHostMessage', () => {
  it('setState replaces groups and palette', () => {
    const next = applyHostMessage(initialSidebarState(), {
      type: 'setState',
      groups: [group('g1')],
      palette: [{ name: 'security', color: '#c0392b' }],
    });
    expect(next.groups.map((g) => g.id)).toEqual(['g1']);
    expect(next.palette).toEqual([{ name: 'security', color: '#c0392b' }]);
  });

  it('preserves the selection when the selected group still exists', () => {
    const state = { ...initialSidebarState(), selectedId: 'g1' };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g1'), group('g2')], palette: [] });
    expect(next.selectedId).toBe('g1');
  });

  it('clears the selection when the selected group is gone', () => {
    const state = { ...initialSidebarState(), selectedId: 'g1' };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g2')], palette: [] });
    expect(next.selectedId).toBeNull();
  });
});

describe('tagColor', () => {
  it('resolves a known tag color', () => {
    expect(tagColor([{ name: 'todo', color: '#f39c12' }], 'todo')).toBe('#f39c12');
  });

  it('falls back to a neutral default for unknown tags', () => {
    expect(tagColor([], 'unknown')).toBe('#888888');
  });
});
