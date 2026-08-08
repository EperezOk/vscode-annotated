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
  it('returns a whole-file target when there is no #L fragment, but null for a non-#L fragment', () => {
    expect(parseLocationLink('src/foo.ts')).toEqual({ file: 'src/foo.ts', range: null });
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
  it('accepts a leading-slash POSIX absolute path (normalized later at navigation)', () => {
    expect(parseLocationLink('/Users/me/repo/src/foo.ts#L5')).toEqual({
      file: '/Users/me/repo/src/foo.ts',
      range: { startLine: 5, endLine: 5 },
    });
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

describe('file-only local links', () => {
  it('parses a path with no fragment as a whole-file target', () => {
    expect(parseLocationLink('src/core/foo.ts')).toEqual({ file: 'src/core/foo.ts', range: null });
  });

  it('parses a bare filename with an extension', () => {
    expect(parseLocationLink('README.md')).toEqual({ file: 'README.md', range: null });
  });

  it('normalizes backslashes', () => {
    expect(parseLocationLink('src\\core\\foo.ts')).toEqual({ file: 'src/core/foo.ts', range: null });
  });

  it('ignores prose targets that do not look like paths', () => {
    expect(parseLocationLink('whatever')).toBeNull();
    expect(parseLocationLink('')).toBeNull();
  });

  it('still ignores URLs and non-line fragments', () => {
    expect(parseLocationLink('https://example.com/a/b.ts')).toBeNull();
    expect(parseLocationLink('docs/adr.md#heading')).toBeNull();
  });

  it('still parses line fragments', () => {
    expect(parseLocationLink('src/foo.ts#L4-L9')).toEqual({ file: 'src/foo.ts', range: { startLine: 4, endLine: 9 } });
  });

  it('formats a null range as the bare path', () => {
    expect(formatLocationLink('src/foo.ts', null)).toBe('src/foo.ts');
  });

  it('treats a bare path as a location link for the paste guard', () => {
    expect(isLocationLink(' src/foo.ts ')).toBe(true);
    expect(isLocationLink('just words')).toBe(false);
  });
});

describe('paste-guard precision (no whitespace, no bare-slash abbreviations)', () => {
  it('rejects a short slash abbreviation that is not a real path', () => {
    expect(parseLocationLink('N/A')).toBeNull();
  });

  it('rejects prose that happens to end in what looks like an extension', () => {
    expect(parseLocationLink('see section 3.2')).toBeNull();
  });

  it('rejects a multi-line clipboard payload that contains a slash', () => {
    const snippet = 'function foo() {\n  return a/b;\n}';
    expect(parseLocationLink(snippet)).toBeNull();
  });

  it('rejects targets with tabs or carriage returns', () => {
    expect(parseLocationLink('src/foo.ts\tbar')).toBeNull();
    expect(parseLocationLink('src/foo.ts\rbar')).toBeNull();
  });

  it('still accepts real paths with no fragment', () => {
    expect(parseLocationLink('src/core/foo.ts')).toEqual({ file: 'src/core/foo.ts', range: null });
    expect(parseLocationLink('README.md')).toEqual({ file: 'README.md', range: null });
  });

  it('still accepts a line-fragment link', () => {
    expect(parseLocationLink('src/foo.ts#L4-L9')).toEqual({ file: 'src/foo.ts', range: { startLine: 4, endLine: 9 } });
  });

  it('accepts an extensionless path with a short segment as long as one segment is a real name', () => {
    expect(parseLocationLink('bin/x')).toEqual({ file: 'bin/x', range: null });
    expect(parseLocationLink('src/d/utils')).toEqual({ file: 'src/d/utils', range: null });
    expect(parseLocationLink('a/deeply/nested/path')).toEqual({ file: 'a/deeply/nested/path', range: null });
  });

  it('still rejects an extensionless path where every segment is single-character', () => {
    expect(parseLocationLink('N/A')).toBeNull();
    expect(parseLocationLink('x/y/z')).toBeNull();
  });
});
