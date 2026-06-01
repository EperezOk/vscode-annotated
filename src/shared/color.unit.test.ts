import { describe, it, expect } from 'vitest';
import { contrastColor } from './color';

describe('contrastColor', () => {
  it('returns black on light backgrounds', () => {
    expect(contrastColor('#ffffff')).toBe('#000000');
    expect(contrastColor('#ffff00')).toBe('#000000'); // yellow
    expect(contrastColor('#fff')).toBe('#000000');     // shorthand
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
