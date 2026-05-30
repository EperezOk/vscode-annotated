import { describe, it, expect } from 'vitest';
import { initialDetailState, applyDetailMessage, oneLine, openAnnotation, backToGroup, isStale } from './detailState';
import { type AnnotationGroup } from '../shared/model';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [{ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' }],
  };
}

describe('initialDetailState', () => {
  it('has no group and no selection', () => {
    expect(initialDetailState()).toEqual({ group: null, palette: [], selectedAnnotationId: null, mode: 'group', staleIds: [] });
  });
});

describe('applyDetailMessage', () => {
  it('setGroup replaces the group + palette and resets the selection', () => {
    const start = { ...initialDetailState(), selectedAnnotationId: 'old' };
    const next = applyDetailMessage(start, { type: 'setGroup', group: group(), palette: [{ name: 'x', color: '#111' }] });
    expect(next.group?.id).toBe('g1');
    expect(next.palette).toEqual([{ name: 'x', color: '#111' }]);
    expect(next.selectedAnnotationId).toBeNull();
  });

  it('setGroup with null clears the group', () => {
    const next = applyDetailMessage(initialDetailState(), { type: 'setGroup', group: null, palette: [] });
    expect(next.group).toBeNull();
  });
});

describe('mode transitions', () => {
  it('initial mode is group', () => {
    expect(initialDetailState().mode).toBe('group');
  });

  it('openAnnotation switches to annotation mode and records the id', () => {
    const next = openAnnotation(initialDetailState(), 'a1');
    expect(next.mode).toBe('annotation');
    expect(next.selectedAnnotationId).toBe('a1');
  });

  it('backToGroup returns to group mode and clears the selection', () => {
    const next = backToGroup(openAnnotation(initialDetailState(), 'a1'));
    expect(next.mode).toBe('group');
    expect(next.selectedAnnotationId).toBeNull();
  });

  it('setGroup keeps annotation mode when the selected annotation still exists', () => {
    const g = {
      id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open' as const,
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'x', range: { startLine: 1, endLine: 1 }, content: 'c', contentHash: 'h' }],
    };
    const start = openAnnotation({ ...initialDetailState(), group: g }, 'a1');
    const next = applyDetailMessage(start, { type: 'setGroup', group: g, palette: [] });
    expect(next.mode).toBe('annotation');
    expect(next.selectedAnnotationId).toBe('a1');
  });

  it('setGroup falls back to group mode when the selected annotation is gone', () => {
    const start = openAnnotation(initialDetailState(), 'gone');
    const next = applyDetailMessage(start, { type: 'setGroup', group: null, palette: [] });
    expect(next.mode).toBe('group');
    expect(next.selectedAnnotationId).toBeNull();
  });
});

describe('staleIds', () => {
  it('initial staleIds is empty', () => {
    expect(initialDetailState().staleIds).toEqual([]);
  });
  it('setGroup stores staleIds (defaulting to [])', () => {
    const next = applyDetailMessage(initialDetailState(), { type: 'setGroup', group: null, palette: [], staleIds: ['a1'] });
    expect(next.staleIds).toEqual(['a1']);
  });
  it('isStale checks membership', () => {
    const s = { ...initialDetailState(), staleIds: ['a1'] };
    expect(isStale(s, 'a1')).toBe(true);
    expect(isStale(s, 'a2')).toBe(false);
  });
});

describe('oneLine', () => {
  it('returns the first non-empty line, trimmed', () => {
    expect(oneLine('\n  hello world  \nsecond')).toBe('hello world');
  });

  it('truncates long content with an ellipsis', () => {
    expect(oneLine('x'.repeat(80), 10)).toBe('xxxxxxxxx…');
  });

  it('returns empty string for blank content', () => {
    expect(oneLine('   \n  ')).toBe('');
  });
});
