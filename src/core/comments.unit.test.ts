import { describe, it, expect } from 'vitest';
import { slugifyAuthor, flattenComments, relativeTime } from './comments';
import { type CommentFile } from '../shared/model';

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
