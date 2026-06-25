import { describe, it, expect } from 'vitest';
import { gutterBarsByLine, buildGutterSvg, MAX_BARS, annotationsAtLine, hoverMarkdown, decorationGroups, hoverItems, highlightableLines } from './gutterIndicators';
import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';

const palette: TagColor[] = [{ name: 'security', color: '#aa0000' }, { name: 'perf', color: '#00aa00' }];

function group(over: Partial<AnnotationGroup> & { id: string }): AnnotationGroup {
  return {
    id: over.id, title: over.title ?? 'G', author: 'A', tags: over.tags ?? [], gitRef: null,
    status: over.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: over.annotations ?? [],
  };
}

describe('gutterBarsByLine', () => {
  it('marks every line in an annotation range with the group first-tag color', () => {
    const g = group({ id: 'g1', tags: [{ name: 'security', color: '#888888' }], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 2, endLine: 4 }, content: '', contentHash: 'h' },
    ] });
    const map = gutterBarsByLine([g], 'a.ts', palette);
    expect(map.get(2)).toEqual(['#aa0000']);
    expect(map.get(3)).toEqual(['#aa0000']);
    expect(map.get(4)).toEqual(['#aa0000']);
    expect(map.has(1)).toBe(false);
    expect(map.has(5)).toBe(false);
  });

  it('ignores annotations in other files', () => {
    const g = group({ id: 'g1', tags: [{ name: 'security', color: '#888888' }], annotations: [
      { id: 'a1', file: 'other.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g], 'a.ts', palette).size).toBe(0);
  });

  it('excludes resolved groups', () => {
    const g = group({ id: 'g1', tags: [{ name: 'security', color: '#888888' }], status: 'resolved', annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g], 'a.ts', palette).size).toBe(0);
  });

  it('stacks one color per annotation covering the same line, in group then annotation order', () => {
    const g1 = group({ id: 'g1', tags: [{ name: 'security', color: '#888888' }], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 5, endLine: 5 }, content: '', contentHash: 'h' },
    ] });
    const g2 = group({ id: 'g2', tags: [{ name: 'perf', color: '#888888' }], annotations: [
      { id: 'a2', file: 'a.ts', range: { startLine: 5, endLine: 5 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g1, g2], 'a.ts', palette).get(5)).toEqual(['#aa0000', '#00aa00']);
  });

  it('uses a neutral default color for a group with no tags', () => {
    const g = group({ id: 'g1', tags: [], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g], 'a.ts', palette).get(1)).toEqual(['#888888']);
  });
});

describe('buildGutterSvg', () => {
  const PREFIX = 'data:image/svg+xml;base64,';
  const decode = (uri: string) => atob(uri.slice(PREFIX.length));

  it('draws one rect per color with the given fill', () => {
    const svg = decode(buildGutterSvg(['#aa0000', '#00aa00']));
    expect(svg).toContain('<svg');
    expect((svg.match(/<rect /g) ?? [])).toHaveLength(2);
    expect(svg).toContain('fill="#aa0000"');
    expect(svg).toContain('fill="#00aa00"');
  });

  it('caps the number of bars at MAX_BARS', () => {
    const many = Array.from({ length: MAX_BARS + 3 }, (_, i) => `#0000${i}0`);
    const svg = decode(buildGutterSvg(many));
    expect((svg.match(/<rect /g) ?? [])).toHaveLength(MAX_BARS);
  });

  it('produces a valid svg with no rects for an empty color list', () => {
    const svg = decode(buildGutterSvg([]));
    expect(svg).toContain('<svg');
    expect(svg.match(/<rect /g)).toBeNull();
  });
});

describe('annotationsAtLine', () => {
  it('returns non-resolved annotations whose range covers the line', () => {
    const g1 = group({ id: 'g1', tags: [{ name: 'security', color: '#888888' }], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 2, endLine: 4 }, content: '', contentHash: 'h' },
    ] });
    const g2 = group({ id: 'g2', status: 'resolved', annotations: [
      { id: 'a2', file: 'a.ts', range: { startLine: 3, endLine: 3 }, content: '', contentHash: 'h' },
    ] });
    const at3 = annotationsAtLine([g1, g2], 'a.ts', 3);
    expect(at3).toHaveLength(1);
    expect(at3[0].group.id).toBe('g1');
    expect(at3[0].annotation.id).toBe('a1');
    expect(annotationsAtLine([g1, g2], 'a.ts', 1)).toHaveLength(0);
    expect(annotationsAtLine([g1, g2], 'other.ts', 3)).toHaveLength(0);
  });
});

describe('hoverMarkdown', () => {
  it('builds one openAnnotation command link per item with encoded args', () => {
    const md = hoverMarkdown([
      { label: 'Login · a.ts:2–4', groupId: 'g1', annotationId: 'a1' },
      { label: 'Perf · a.ts:2', groupId: 'g2', annotationId: 'a2' },
    ]);
    const lines = md.split('\n\n');
    expect(lines).toHaveLength(2);
    expect(md).toContain('command:annotated.openAnnotation?');
    expect(md).toContain(encodeURIComponent(JSON.stringify({ groupId: 'g1', annotationId: 'a1' })));
    expect(md).toContain('📝 Login · a.ts:2–4');
  });

  it('returns an empty string for no items', () => {
    expect(hoverMarkdown([])).toBe('');
  });
});

describe('decorationGroups', () => {
  it('groups lines by color signature, with sorted lines', () => {
    const byLine = new Map<number, string[]>([
      [3, ['#aa0000']],
      [1, ['#aa0000']],
      [2, ['#aa0000', '#00aa00']],
      [5, ['#aa0000', '#00aa00']],
    ]);
    const groups = decorationGroups(byLine);
    const single = groups.find((g) => g.signature === '#aa0000');
    const stacked = groups.find((g) => g.signature === '#aa0000|#00aa00');
    expect(single?.colors).toEqual(['#aa0000']);
    expect(single?.lines).toEqual([1, 3]);
    expect(stacked?.colors).toEqual(['#aa0000', '#00aa00']);
    expect(stacked?.lines).toEqual([2, 5]);
  });

  it('returns an empty array for an empty map', () => {
    expect(decorationGroups(new Map())).toEqual([]);
  });
});

describe('highlightableLines', () => {
  it('returns the lines that have bars, sorted ascending', () => {
    const byLine = new Map<number, string[]>([
      [5, ['#aa0000']],
      [2, ['#aa0000', '#00aa00']],
      [3, ['#00aa00']],
    ]);
    expect(highlightableLines(byLine)).toEqual([2, 3, 5]);
  });

  it('returns an empty array for an empty map', () => {
    expect(highlightableLines(new Map())).toEqual([]);
  });
});

describe('hoverItems', () => {
  it('labels each item with group title + a one-line content snippet', () => {
    const g = group({ id: 'g1', title: 'Login', annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '# Heading\nmore', contentHash: 'h' },
    ] });
    expect(hoverItems([{ group: g, annotation: g.annotations[0] }])).toEqual([
      { label: 'Login · # Heading', groupId: 'g1', annotationId: 'a1' },
    ]);
  });

  it('uses (empty) for blank content', () => {
    const g = group({ id: 'g1', title: 'T', annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(hoverItems([{ group: g, annotation: g.annotations[0] }])[0].label).toBe('T · (empty)');
  });
});
