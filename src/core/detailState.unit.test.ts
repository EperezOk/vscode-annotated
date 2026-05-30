import { describe, it, expect } from 'vitest';
import { initialDetailState, applyDetailMessage, oneLine } from './detailState';
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
    expect(initialDetailState()).toEqual({ group: null, palette: [], selectedAnnotationId: null });
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
