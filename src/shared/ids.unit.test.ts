import { describe, it, expect } from 'vitest';
import { newId, idSegment } from './ids';

describe('newId', () => {
  it('returns a v4-style UUID string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns a different value each call', () => {
    expect(newId()).not.toBe(newId());
  });
});

describe('idSegment', () => {
  it('returns the first 8 hex chars of a de-hyphenated UUID by default', () => {
    expect(idSegment('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400');
  });
  it('honors a custom length', () => {
    expect(idSegment('550e8400-e29b-41d4-a716-446655440000', 9)).toBe('550e8400e');
  });
  it('returns the whole de-hyphenated id when shorter than len', () => {
    expect(idSegment('g1')).toBe('g1');
  });
});
