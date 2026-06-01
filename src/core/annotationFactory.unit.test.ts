import { describe, it, expect } from 'vitest';
import { createGroup, makeAnnotation, addAnnotation } from './annotationFactory';

describe('createGroup', () => {
  it('builds an open group with timestamps and copied tags', () => {
    const tags = [{ name: 'security', color: '#888888' }];
    const g = createGroup({ id: 'g1', title: 'T', author: 'A', tags, now: 100 });
    expect(g).toEqual({
      id: 'g1',
      title: 'T',
      author: 'A',
      tags: [{ name: 'security', color: '#888888' }],
      gitRef: null,
      status: 'open',
      createdAt: 100,
      updatedAt: 100,
      annotations: [],
    });
    tags.push({ name: 'mutated', color: '#888888' });
    expect(g.tags).toEqual([{ name: 'security', color: '#888888' }]); // input array not aliased
  });

  it('accepts an explicit gitRef', () => {
    expect(createGroup({ id: 'g1', title: 'T', author: 'A', tags: [], gitRef: 'main', now: 1 }).gitRef).toBe('main');
  });
});

describe('makeAnnotation', () => {
  it('builds an annotation with empty content by default', () => {
    const a = makeAnnotation({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 2 }, contentHash: 'h' });
    expect(a).toEqual({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' });
  });
});

describe('addAnnotation', () => {
  it('appends an annotation and bumps updatedAt without mutating the input', () => {
    const g = createGroup({ id: 'g1', title: 'T', author: 'A', tags: [], now: 1 });
    const a = makeAnnotation({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, contentHash: 'h' });
    const next = addAnnotation(g, a, 200);
    expect(next.annotations).toEqual([a]);
    expect(next.updatedAt).toBe(200);
    expect(g.annotations).toEqual([]); // original unchanged
  });
});
