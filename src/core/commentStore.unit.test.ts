import { describe, it, expect, beforeEach } from 'vitest';
import { CommentStore } from './commentStore';
import { MemoryFileSystem } from './memoryFileSystem';
import { type Comment } from '../shared/model';

function comment(id: string, annotationId: string, ts: number): Comment {
  return { id, annotationId, content: `c-${id}`, timestamp: ts };
}

describe('CommentStore', () => {
  let store: CommentStore;
  beforeEach(() => {
    store = new CommentStore(new MemoryFileSystem());
  });

  it('listCommentFiles returns [] when the dir does not exist', async () => {
    expect(await store.listCommentFiles()).toEqual([]);
  });

  it('addComment creates the author file then appends', async () => {
    await store.addComment('ana', 'Ana', 'a@x', comment('c1', 'a1', 100));
    await store.addComment('ana', 'Ana', 'a@x', comment('c2', 'a1', 200));
    const files = await store.listCommentFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ author: 'Ana', email: 'a@x' });
    expect(files[0].comments.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('updateComment edits only within the given file and returns false when missing', async () => {
    await store.addComment('ana', 'Ana', 'a@x', comment('c1', 'a1', 100));
    expect(await store.updateComment('ana', 'c1', 'edited')).toBe(true);
    expect(await store.updateComment('ana', 'nope', 'x')).toBe(false);
    expect(await store.updateComment('bob', 'c1', 'x')).toBe(false);
    const file = await store.getCommentFile('ana');
    expect(file?.comments[0].content).toBe('edited');
    expect(file?.comments[0].timestamp).toBe(100);
  });

  it('deleteComment removes only within the given file and returns false when missing', async () => {
    await store.addComment('ana', 'Ana', 'a@x', comment('c1', 'a1', 100));
    await store.addComment('ana', 'Ana', 'a@x', comment('c2', 'a1', 200));
    expect(await store.deleteComment('ana', 'c1')).toBe(true);
    expect(await store.deleteComment('ana', 'c1')).toBe(false);
    const file = await store.getCommentFile('ana');
    expect(file?.comments.map((c) => c.id)).toEqual(['c2']);
  });
});
