import { describe, it, expect } from 'vitest';
import { parseTagPalette } from './tags';

describe('parseTagPalette', () => {
  it('returns [] for non-array input', () => {
    expect(parseTagPalette(undefined)).toEqual([]);
    expect(parseTagPalette('nope')).toEqual([]);
  });

  it('keeps entries with a string name and defaults a missing color', () => {
    expect(parseTagPalette([{ name: 'security', color: '#c0392b' }, { name: 'todo' }])).toEqual([
      { name: 'security', color: '#c0392b' },
      { name: 'todo', color: '#888888' },
    ]);
  });

  it('skips entries without a string name', () => {
    expect(parseTagPalette([{ color: '#fff' }, 42, null, { name: 5 }])).toEqual([]);
  });
});
