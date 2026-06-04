import { describe, it, expect } from 'vitest';
import { contrastColor, authorHue } from './color';

describe('contrastColor', () => {
  it('returns black on light backgrounds', () => {
    expect(contrastColor('#ffffff')).toBe('#000000');
    expect(contrastColor('#ffff00')).toBe('#000000'); // yellow
    expect(contrastColor('#fff')).toBe('#000000');     // shorthand
    expect(contrastColor('#808080')).toBe('#000000'); // boundary: BT.601 brightness exactly 128 → black
  });

  it('returns white on dark backgrounds', () => {
    expect(contrastColor('#000000')).toBe('#ffffff');
    expect(contrastColor('#0000ff')).toBe('#ffffff'); // blue
    expect(contrastColor('#5B5BD6')).toBe('#ffffff'); // indigo swatch
  });

  it('defaults to white for malformed input', () => {
    expect(contrastColor('not-a-color')).toBe('#ffffff');
    expect(contrastColor('')).toBe('#ffffff');
    expect(contrastColor('#12')).toBe('#ffffff');
  });
});

describe('authorHue', () => {
  const ORANGE = (h: number) => h >= 15 && h <= 50;

  it('reserves an orange hue for "Claude"', () => {
    expect(ORANGE(authorHue('Claude'))).toBe(true);
  });

  it('matches the reserved hue case-insensitively / trimmed', () => {
    expect(authorHue('claude')).toBe(authorHue('Claude'));
    expect(authorHue('  Claude  ')).toBe(authorHue('Claude'));
  });

  it('never gives a non-Claude author the reserved orange band', () => {
    for (const name of ['Ana', 'Bob', 'Carol', 'Dee', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy', 'Mallory', 'Niaj']) {
      expect(ORANGE(authorHue(name))).toBe(false);
    }
  });

  it('is deterministic for the same author', () => {
    expect(authorHue('Ana')).toBe(authorHue('Ana'));
  });

  it('produces a valid hue (0–359) for any input, including empty', () => {
    for (const name of ['Ana', 'Claude', '', '   ', '🦊', 'a-very-long-author-name']) {
      const h = authorHue(name);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('spreads several distinct authors across multiple hues', () => {
    const hues = new Set(['Ana', 'Bob', 'Carol', 'Dee', 'Eve'].map(authorHue));
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });
});
