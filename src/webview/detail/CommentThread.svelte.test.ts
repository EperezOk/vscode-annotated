import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CommentThread from './CommentThread.svelte';
import { type ThreadComment } from '../../shared/model';

vi.mock('./MarkdownEditor.svelte', async () => ({
  default: (await import('./__mocks__/MarkdownEditorStub.svelte')).default,
}));

const thread: ThreadComment[] = [
  { id: 'c1', annotationId: 'a1', author: 'Ana', content: 'first note', timestamp: 100 },
  { id: 'c2', annotationId: 'a1', author: 'Me', content: 'my note', timestamp: 200 },
];

describe('CommentThread', () => {
  it('renders each comment with author + body', () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    const rows = screen.getAllByTestId('comment');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ana');
  });
  it('shows edit/delete only on the current user\'s own comments', () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    expect(screen.getAllByTestId('comment-delete-btn')).toHaveLength(1);
  });
  it('expands the reply editor and adds a comment', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    expect(screen.queryByTestId('md-editor')).toBeNull();
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    await userEvent.type(screen.getByTestId('md-editor'), 'Hello');
    await userEvent.click(screen.getByTestId('comment-add-btn'));
    expect(onadd).toHaveBeenCalledWith('Hello');
  });
  it('deletes an own comment', async () => {
    const ondelete = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, ondelete });
    await userEvent.click(screen.getByTestId('comment-delete-btn'));
    expect(ondelete).toHaveBeenCalledWith('c2');
  });
  it('edits an own comment', async () => {
    const onedit = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, onedit });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'edited');
    await userEvent.click(screen.getByTestId('comment-save-btn'));
    expect(onedit).toHaveBeenCalledWith('c2', 'edited');
  });
});
