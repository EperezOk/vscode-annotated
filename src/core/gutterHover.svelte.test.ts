import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { hoverMarkdown } from './gutterIndicators';

describe('hoverMarkdown label escaping', () => {
  const md = new MarkdownIt();
  const item = (label: string) => ({ label, groupId: 'g1', annotationId: 'a1' });

  function anchors(markdown: string): { href: string | null; text: string }[] {
    const html = md.render(markdown);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), text: a.textContent ?? '' }));
  }

  it('renders a plain label as one command link', () => {
    const [a, ...rest] = anchors(hoverMarkdown([item('Group · a note')]));
    expect(rest).toEqual([]);
    expect(a.href).toContain('command:annotated.openAnnotation?');
    expect(a.text).toBe('📝 Group · a note');
  });

  it('survives a stray closing bracket', () => {
    const [a] = anchors(hoverMarkdown([item('Group · items[0] and x]')]));
    expect(a.href).toContain('command:annotated.openAnnotation?');
    expect(a.text).toBe('📝 Group · items[0] and x]');
  });

  it('survives a label ending in a backslash', () => {
    const [a] = anchors(hoverMarkdown([item('Group · path C:\\\\tmp\\\\')]));
    expect(a.href).toContain('command:annotated.openAnnotation?');
  });

  it('survives a code span containing a link-ish sequence', () => {
    const [a] = anchors(hoverMarkdown([item('Group · see `x](y)` here')]));
    expect(a.href).toContain('command:annotated.openAnnotation?');
    expect(a.text).toBe('📝 Group · see `x](y)` here');
  });

  it('keeps each item a separate link', () => {
    const links = anchors(hoverMarkdown([item('One · a]'), item('Two · `b')]));
    expect(links.length).toBe(2);
  });
});
