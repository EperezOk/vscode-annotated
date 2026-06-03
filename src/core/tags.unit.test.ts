import { describe, it, expect } from 'vitest';
import { parseTagPalette, NEW_TAG_LABEL, splitPickedTags, TAG_SWATCHES, resolveTagPickAccept } from './tags';

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

describe('splitPickedTags', () => {
  it('separates real tag names from the new-tag sentinel', () => {
    expect(splitPickedTags(['security', 'todo'])).toEqual({ names: ['security', 'todo'], addNew: false });
    expect(splitPickedTags(['security', NEW_TAG_LABEL])).toEqual({ names: ['security'], addNew: true });
    expect(splitPickedTags([NEW_TAG_LABEL])).toEqual({ names: [], addNew: true });
    expect(splitPickedTags([])).toEqual({ names: [], addNew: false });
  });
});

describe('TAG_SWATCHES', () => {
  it('lists the eight named swatches in order with valid 6-digit hex colors', () => {
    expect(TAG_SWATCHES.map((s) => s.name)).toEqual([
      'Red', 'Amber', 'Yellow', 'Green', 'Teal', 'Blue', 'Indigo', 'Gray',
    ]);
    for (const s of TAG_SWATCHES) {
      expect(s.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('resolveTagPickAccept', () => {
  it('returns checked tag names with addNew=false', () => {
    expect(resolveTagPickAccept(['security', 'perf'], 'security')).toEqual({
      names: ['security', 'perf'],
      addNew: false,
    });
  });

  it('detects a checked "New tag…" item alongside other tags', () => {
    expect(resolveTagPickAccept(['security', NEW_TAG_LABEL], undefined)).toEqual({
      names: ['security'],
      addNew: true,
    });
  });

  it('treats Enter on the highlighted "New tag…" with nothing checked as add-new', () => {
    expect(resolveTagPickAccept([], NEW_TAG_LABEL)).toEqual({ names: [], addNew: true });
  });

  it('keeps the no-tags path: nothing checked + a regular tag highlighted', () => {
    expect(resolveTagPickAccept([], 'security')).toEqual({ names: [], addNew: false });
  });

  it('keeps the no-tags path: nothing checked + no active item', () => {
    expect(resolveTagPickAccept([], undefined)).toEqual({ names: [], addNew: false });
  });
});
