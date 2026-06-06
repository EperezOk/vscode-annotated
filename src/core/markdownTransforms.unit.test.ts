import { describe, it, expect } from 'vitest';
import { isUrl, linkSelection, toggleMarker, type MarkerEdit } from './markdownTransforms';

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

/** Apply an edit's change ops to `doc` and return the new doc + the selected slice. */
function apply(doc: string, e: MarkerEdit): { doc: string; sel: string } {
  const out = [...e.changes]
    .sort((a, b) => b.from - a.from) // right-to-left keeps earlier indices valid
    .reduce((acc, c) => acc.slice(0, c.from) + c.insert + acc.slice(c.to), doc);
  return { doc: out, sel: out.slice(e.selectionFrom, e.selectionTo) };
}

describe('toggleMarker', () => {
  it('wraps a bold selection and re-selects the inner text', () => {
    const r = apply('foo bar', toggleMarker('foo bar', 0, 3, '**'));
    expect(r.doc).toBe('**foo** bar');
    expect(r.sel).toBe('foo');
  });
  it('unwraps bold when markers sit just outside the selection', () => {
    const r = apply('**foo** bar', toggleMarker('**foo** bar', 2, 5, '**'));
    expect(r.doc).toBe('foo bar');
    expect(r.sel).toBe('foo');
  });
  it('unwraps bold when the selection includes the markers', () => {
    const r = apply('**foo** bar', toggleMarker('**foo** bar', 0, 7, '**'));
    expect(r.doc).toBe('foo bar');
    expect(r.sel).toBe('foo');
  });
  it('inserts an empty bold pair at a bare cursor, caret between', () => {
    const e = toggleMarker('ab', 1, 1, '**');
    const r = apply('ab', e);
    expect(r.doc).toBe('a****b');
    expect(e.selectionFrom).toBe(3);
    expect(e.selectionTo).toBe(3);
  });
  it('removes an empty bold pair when pressed again on it', () => {
    const e = toggleMarker('a****b', 3, 3, '**');
    const r = apply('a****b', e);
    expect(r.doc).toBe('ab');
    expect(e.selectionFrom).toBe(1);
    expect(e.selectionTo).toBe(1);
  });
  it('wraps an italic selection', () => {
    const r = apply('foo', toggleMarker('foo', 0, 3, '*'));
    expect(r.doc).toBe('*foo*');
    expect(r.sel).toBe('foo');
  });
  it('italic on bold text wraps (does not mistake ** for *)', () => {
    const r = apply('**foo**', toggleMarker('**foo**', 2, 5, '*'));
    expect(r.doc).toBe('***foo***');
    expect(r.sel).toBe('foo');
  });
  it('unwraps italic', () => {
    const r = apply('*foo*', toggleMarker('*foo*', 1, 4, '*'));
    expect(r.doc).toBe('foo');
    expect(r.sel).toBe('foo');
  });
  it('unwraps italic when the selection includes the markers', () => {
    const r = apply('*foo*', toggleMarker('*foo*', 0, 5, '*'));
    expect(r.doc).toBe('foo');
    expect(r.sel).toBe('foo');
  });
  it('bold on bold+italic removes only the bold layer', () => {
    const r = apply('***foo***', toggleMarker('***foo***', 3, 6, '**'));
    expect(r.doc).toBe('*foo*');
    expect(r.sel).toBe('foo');
  });
  it('wraps inline code', () => {
    const r = apply('foo', toggleMarker('foo', 0, 3, '`'));
    expect(r.doc).toBe('`foo`');
    expect(r.sel).toBe('foo');
  });
  it('unwraps inline code', () => {
    const r = apply('`foo`', toggleMarker('`foo`', 1, 4, '`'));
    expect(r.doc).toBe('foo');
    expect(r.sel).toBe('foo');
  });
});
