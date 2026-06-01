import { describe, it, expect } from 'vitest';
import { svgDataUri, swatchIconSvg } from './svgIcon';

const PREFIX = 'data:image/svg+xml;base64,';

describe('svgDataUri', () => {
  it('produces a base64 data URI that round-trips back to the SVG', () => {
    const uri = svgDataUri('<svg/>');
    expect(uri.startsWith(PREFIX)).toBe(true);
    expect(atob(uri.slice(PREFIX.length))).toBe('<svg/>');
  });
});

describe('swatchIconSvg', () => {
  it('embeds the given color in a square svg data URI', () => {
    const svg = atob(swatchIconSvg('#E5484D').slice(PREFIX.length));
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#E5484D"');
  });
});
