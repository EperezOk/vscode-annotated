import { describe, it, expect } from 'vitest';
import { isUrl, linkSelection } from './markdownTransforms';

describe('isUrl', () => {
  it('accepts http/https URLs', () => {
    expect(isUrl('https://example.com')).toBe(true);
    expect(isUrl('http://x.co/a?b=1')).toBe(true);
  });
  it('rejects non-URLs', () => {
    expect(isUrl('hello world')).toBe(false);
    expect(isUrl('example.com')).toBe(false);
    expect(isUrl('ftp://x')).toBe(false);
    expect(isUrl('')).toBe(false);
  });
});

describe('linkSelection', () => {
  it('wraps the selected text as a Markdown link', () => {
    const r = linkSelection('click here now', 6, 10, 'https://x.com');
    expect(r.doc).toBe('click [here](https://x.com) now');
    expect(r.doc.slice(r.selectionFrom, r.selectionTo)).toBe('[here](https://x.com)');
  });
  it('handles a selection at the start', () => {
    const r = linkSelection('here', 0, 4, 'http://a.b');
    expect(r.doc).toBe('[here](http://a.b)');
    expect(r.selectionFrom).toBe(0);
    expect(r.selectionTo).toBe('[here](http://a.b)'.length);
  });
});
