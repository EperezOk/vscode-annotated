import { describe, it, expect } from 'vitest';
import { initialDetailState, applyDetailMessage, oneLine, openAnnotation, backToGroup, isStale, moveBefore, selectedAnnotationIndex, nextAnnotationId, prevAnnotationId, annotationPosition, commentsFor } from './detailState';
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
    expect(initialDetailState()).toEqual({ group: null, palette: [], selectedAnnotationId: null, mode: 'group', staleIds: [], comments: [], currentAuthor: '' });
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

function group3(): AnnotationGroup {
  return {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
    annotations: [
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
      { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
      { id: 'a3', file: 'x.ts', range: { startLine: 3, endLine: 3 }, content: '', contentHash: 'h' },
    ],
  };
}

describe('moveBefore', () => {
  it('moves an item up (before an earlier target)', () => {
    expect(moveBefore(['a1', 'a2', 'a3'], 'a3', 'a1')).toEqual(['a3', 'a1', 'a2']);
  });
  it('moves an item down (before a later target)', () => {
    expect(moveBefore(['a1', 'a2', 'a3'], 'a1', 'a3')).toEqual(['a2', 'a1', 'a3']);
  });
  it('is a no-op when moved === target', () => {
    expect(moveBefore(['a1', 'a2'], 'a1', 'a1')).toEqual(['a1', 'a2']);
  });
  it('appends the moved id when the target is missing', () => {
    expect(moveBefore(['a1', 'a2'], 'a1', 'zzz')).toEqual(['a2', 'a1']);
  });
});

describe('annotation navigation', () => {
  it('selectedAnnotationIndex finds the current annotation', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(selectedAnnotationIndex(state)).toBe(1);
  });
  it('nextAnnotationId returns the next id, null at the end', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(nextAnnotationId(state)).toBe('a3');
    expect(nextAnnotationId({ ...state, selectedAnnotationId: 'a3' })).toBeNull();
  });
  it('prevAnnotationId returns the previous id, null at the start', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(prevAnnotationId(state)).toBe('a1');
    expect(prevAnnotationId({ ...state, selectedAnnotationId: 'a1' })).toBeNull();
  });
  it('annotationPosition is 1-based with the total, or null when unselected', () => {
    const state = { ...initialDetailState(), group: group3(), selectedAnnotationId: 'a2' };
    expect(annotationPosition(state)).toEqual({ current: 2, total: 3 });
    expect(annotationPosition(initialDetailState())).toBeNull();
  });
});

describe('comments in detail state', () => {
  const thread = [
    { id: 'c1', annotationId: 'a1', author: 'Ana', content: 'one', timestamp: 100 },
    { id: 'c2', annotationId: 'a2', author: 'Bob', content: 'two', timestamp: 200 },
  ];
  it('initial state has empty comments + currentAuthor', () => {
    const s = initialDetailState();
    expect(s.comments).toEqual([]);
    expect(s.currentAuthor).toBe('');
  });
  it('setGroup stores comments + currentAuthor (defaulting)', () => {
    const next = applyDetailMessage(initialDetailState(), {
      type: 'setGroup', group: null, palette: [], comments: thread, currentAuthor: 'Ana',
    });
    expect(next.comments).toEqual(thread);
    expect(next.currentAuthor).toBe('Ana');
  });
  it('commentsFor filters by annotation id', () => {
    const s = { ...initialDetailState(), comments: thread };
    expect(commentsFor(s, 'a1').map((c) => c.id)).toEqual(['c1']);
    expect(commentsFor(s, 'zzz')).toEqual([]);
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
