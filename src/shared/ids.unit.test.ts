import { describe, it, expect } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('returns a v4-style UUID string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns a different value each call', () => {
    expect(newId()).not.toBe(newId());
  });
});
