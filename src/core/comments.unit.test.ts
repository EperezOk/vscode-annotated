import { describe, it, expect } from 'vitest';
import { slugifyAuthor, flattenComments, relativeTime, groupCommentsOf, commentCountsByGroup } from './comments';
import { type CommentFile, type AnnotationGroup, type ThreadComment } from '../shared/model';

describe('slugifyAuthor', () => {
  it('lowercases and dash-joins non-alphanumerics', () => {
    expect(slugifyAuthor('Alice Doe')).toBe('alice-doe');
    expect(slugifyAuthor('  J@ne  Q. Public ')).toBe('j-ne-q-public');
  });
  it('falls back to "anon" for empty/symbol-only names', () => {
    expect(slugifyAuthor('')).toBe('anon');
    expect(slugifyAuthor('@@@')).toBe('anon');
  });
});

describe('flattenComments', () => {
  const files: CommentFile[] = [
    { author: 'Bob', email: 'b@x', comments: [
      { id: 'c2', annotationId: 'a1', content: 'second', timestamp: 200 },
    ] },
    { author: 'Ana', email: 'a@x', comments: [
      { id: 'c1', annotationId: 'a1', content: 'first', timestamp: 100 },
      { id: 'c3', annotationId: 'a2', content: 'other', timestamp: 300 },
    ] },
  ];
  it('merges across files, attaches author, sorts by timestamp', () => {
    expect(flattenComments(files).map((c) => [c.id, c.author])).toEqual([
      ['c1', 'Ana'], ['c2', 'Bob'], ['c3', 'Ana'],
    ]);
  });
});

describe('relativeTime', () => {
  it('formats common buckets', () => {
    expect(relativeTime(1000, 1000)).toBe('just now');
    expect(relativeTime(1000, 1000 + 5 * 60)).toBe('5m ago');
    expect(relativeTime(1000, 1000 + 3 * 3600)).toBe('3h ago');
    expect(relativeTime(1000, 1000 + 2 * 86400)).toBe('2d ago');
  });
  it('clamps future timestamps to "just now"', () => {
    expect(relativeTime(2000, 1000)).toBe('just now');
  });
});

describe('groupCommentsOf', () => {
  const comments: ThreadComment[] = [
    { id: 'c1', groupId: 'g1', author: 'A', content: 'x', timestamp: 1 },
    { id: 'c2', annotationId: 'a1', author: 'A', content: 'y', timestamp: 2 },
    { id: 'c3', groupId: 'g2', author: 'B', content: 'z', timestamp: 3 },
  ];
  it('keeps only comments targeting the group itself, in order', () => {
    expect(groupCommentsOf(comments, 'g1').map((c) => c.id)).toEqual(['c1']);
  });
});

describe('commentCountsByGroup', () => {
  const groups: AnnotationGroup[] = [
    {
      id: 'g1', title: 'T', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' }],
    },
    { id: 'g2', title: 'U', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] },
  ];
  it('sums annotation comments + group comments per group; orphans ignored', () => {
    const comments: ThreadComment[] = [
      { id: 'c1', annotationId: 'a1', author: 'A', content: 'x', timestamp: 1 },
      { id: 'c2', annotationId: 'a1', author: 'B', content: 'y', timestamp: 2 },
      { id: 'c3', groupId: 'g1', author: 'A', content: 'z', timestamp: 3 },
      { id: 'c4', groupId: 'g2', author: 'A', content: 'w', timestamp: 4 },
      { id: 'c5', annotationId: 'orphan', author: 'A', content: 'v', timestamp: 5 },
    ];
    expect(commentCountsByGroup(groups, comments)).toEqual({ g1: 3, g2: 1 });
  });
  it('returns zero entries for comment-less groups', () => {
    expect(commentCountsByGroup(groups, [])).toEqual({ g1: 0, g2: 0 });
  });
  it('ignores comments whose target id collides with inherited object keys', () => {
    const comments: ThreadComment[] = [
      { id: 'c1', groupId: 'constructor', author: 'A', content: 'x', timestamp: 1 },
    ];
    expect(commentCountsByGroup(groups, comments)).toEqual({ g1: 0, g2: 0 });
  });
});
