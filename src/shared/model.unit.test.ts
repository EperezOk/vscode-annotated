import { describe, it, expect } from 'vitest';
import { parseGroup, serializeGroup, parseCommentFile, serializeCommentFile, formatLineRange, type AnnotationGroup } from './model';

const validGroup: AnnotationGroup = {
  id: 'g1',
  title: 'Login review',
  author: 'Ezequiel',
  tags: [
    { name: 'security', color: '#E5484D' },
    { name: 'question', color: '#3794FF' },
  ],
  gitRef: 'feature/login',
  status: 'open',
  createdAt: 1730000000,
  updatedAt: 1730000001,
  annotations: [
    {
      id: 'a1',
      file: 'src/auth/login.ts',
      range: { startLine: 42, endLine: 47 },
      content: '## note',
      contentHash: 'abc123',
    },
  ],
};

describe('serializeGroup/parseGroup', () => {
  it('round-trips a valid group', () => {
    const text = serializeGroup(validGroup);
    expect(parseGroup(JSON.parse(text))).toEqual(validGroup);
  });

  it('serializes as pretty JSON (2-space indent)', () => {
    expect(serializeGroup(validGroup)).toContain('\n  "id": "g1"');
  });

  it('accepts gitRef: null', () => {
    const g = { ...validGroup, gitRef: null };
    expect(parseGroup(JSON.parse(serializeGroup(g))).gitRef).toBeNull();
  });

  it('throws on a non-object', () => {
    expect(() => parseGroup(null)).toThrow();
    expect(() => parseGroup('nope')).toThrow();
  });

  it('throws when a required field is missing', () => {
    const { title, ...noTitle } = validGroup;
    expect(() => parseGroup(noTitle)).toThrow(/title/);
  });

  it('throws when status is invalid', () => {
    expect(() => parseGroup({ ...validGroup, status: 'archived' })).toThrow(/status/);
  });

  it('throws when an annotation range is malformed', () => {
    const bad = { ...validGroup, annotations: [{ ...validGroup.annotations[0], range: { startLine: 5, endLine: 2 } }] };
    expect(() => parseGroup(bad)).toThrow(/range/);
  });

  it('migrates legacy string[] tags to {name, color} with the default color', () => {
    const legacy = { ...validGroup, tags: ['security', 'todo'] };
    expect(parseGroup(legacy).tags).toEqual([
      { name: 'security', color: '#888888' },
      { name: 'todo', color: '#888888' },
    ]);
  });

  it('throws when a tag is neither a string nor a {name} object', () => {
    expect(() => parseGroup({ ...validGroup, tags: [42] })).toThrow(/tags/);
  });
});

describe('parseCommentFile', () => {
  it('parses a valid comment file', () => {
    const raw = { author: 'Ana', email: 'a@x', comments: [
      { id: 'c1', annotationId: 'a1', content: 'hi', timestamp: 100 },
    ] };
    expect(parseCommentFile(raw)).toEqual(raw);
  });
  it('throws on a malformed comment', () => {
    expect(() => parseCommentFile({ author: 'Ana', email: 'a@x', comments: [{ id: 1 }] })).toThrow();
  });
  it('round-trips through serializeCommentFile', () => {
    const file = { author: 'Ana', email: 'a@x', comments: [{ id: 'c1', annotationId: 'a1', content: 'hi', timestamp: 100 }] };
    expect(parseCommentFile(JSON.parse(serializeCommentFile(file)))).toEqual(file);
  });
});

describe('formatLineRange', () => {
  it('collapses a single-line range to one number', () => {
    expect(formatLineRange({ startLine: 12, endLine: 12 })).toBe('12');
  });
  it('formats a multi-line range with an en dash', () => {
    expect(formatLineRange({ startLine: 12, endLine: 18 })).toBe('12–18');
  });
});

describe('parseCommentFile comment targets', () => {
  const base = { author: 'A', email: 'a@x' };
  it('parses an annotation comment (existing shape)', () => {
    const file = parseCommentFile({ ...base, comments: [{ id: 'c1', annotationId: 'a1', content: 'x', timestamp: 1 }] });
    expect(file.comments[0]).toEqual({ id: 'c1', annotationId: 'a1', content: 'x', timestamp: 1 });
  });
  it('parses a group comment', () => {
    const file = parseCommentFile({ ...base, comments: [{ id: 'c1', groupId: 'g1', content: 'x', timestamp: 1 }] });
    expect(file.comments[0]).toEqual({ id: 'c1', groupId: 'g1', content: 'x', timestamp: 1 });
  });
  it('rejects a comment with both targets', () => {
    expect(() =>
      parseCommentFile({ ...base, comments: [{ id: 'c1', annotationId: 'a1', groupId: 'g1', content: 'x', timestamp: 1 }] }),
    ).toThrow(/exactly one/);
  });
  it('rejects a comment with neither target', () => {
    expect(() => parseCommentFile({ ...base, comments: [{ id: 'c1', content: 'x', timestamp: 1 }] })).toThrow(/exactly one/);
  });
});
