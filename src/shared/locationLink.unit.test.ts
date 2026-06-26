import { describe, it, expect } from 'vitest';
import { formatLocationLink, parseLocationLink, isLocationLink } from './locationLink';

describe('formatLocationLink', () => {
  it('formats a multi-line range as path#Lstart-Lend', () => {
    expect(formatLocationLink('src/foo.ts', { startLine: 10, endLine: 20 })).toBe('src/foo.ts#L10-L20');
  });
  it('collapses a single-line range to path#Lstart', () => {
    expect(formatLocationLink('src/foo.ts', { startLine: 42, endLine: 42 })).toBe('src/foo.ts#L42');
  });
});

describe('parseLocationLink', () => {
  it('parses a range', () => {
    expect(parseLocationLink('src/foo.ts#L10-L20')).toEqual({ file: 'src/foo.ts', range: { startLine: 10, endLine: 20 } });
  });
  it('parses a single line as start===end', () => {
    expect(parseLocationLink('src/foo.ts#L42')).toEqual({ file: 'src/foo.ts', range: { startLine: 42, endLine: 42 } });
  });
  it('normalizes backslashes to forward slashes', () => {
    expect(parseLocationLink('src\\foo.ts#L1')).toEqual({ file: 'src/foo.ts', range: { startLine: 1, endLine: 1 } });
  });
  it('round-trips with formatLocationLink', () => {
    const href = formatLocationLink('a/b/c.ts', { startLine: 3, endLine: 9 });
    expect(parseLocationLink(href)).toEqual({ file: 'a/b/c.ts', range: { startLine: 3, endLine: 9 } });
  });
  it('returns null for http(s) URLs even with a line fragment', () => {
    expect(parseLocationLink('https://example.com/x#L1')).toBeNull();
    expect(parseLocationLink('http://x.co#L1-L2')).toBeNull();
  });
  it('returns null when there is no #L fragment', () => {
    expect(parseLocationLink('src/foo.ts')).toBeNull();
    expect(parseLocationLink('src/foo.ts#section')).toBeNull();
  });
  it('returns null for an empty file part', () => {
    expect(parseLocationLink('#L1')).toBeNull();
  });
  it('returns null for a reversed or zero range', () => {
    expect(parseLocationLink('src/foo.ts#L9-L3')).toBeNull();
    expect(parseLocationLink('src/foo.ts#L0')).toBeNull();
  });
  it('returns null for a scheme/absolute/Windows-drive path', () => {
    expect(parseLocationLink('mailto:x#L1')).toBeNull();
    expect(parseLocationLink('C:/foo.ts#L1')).toBeNull();
  });
  it('returns null for an unsafely-large line number', () => {
    expect(parseLocationLink('src/foo.ts#L99999999999999999999')).toBeNull();
  });
});

describe('isLocationLink', () => {
  it('is true for a local link (trims surrounding whitespace)', () => {
    expect(isLocationLink('  src/foo.ts#L1-L2  ')).toBe(true);
  });
  it('is false for a URL or plain text', () => {
    expect(isLocationLink('https://example.com')).toBe(false);
    expect(isLocationLink('hello world')).toBe(false);
  });
});
