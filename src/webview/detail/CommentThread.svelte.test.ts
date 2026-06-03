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

  it('marks other authors\' names with the "other" class; own name unmarked', () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    const rows = screen.getAllByTestId('comment');
    expect(rows[0].querySelector('.cauthor')).toHaveClass('other'); // Ana
    expect(rows[1].querySelector('.cauthor')).not.toHaveClass('other'); // Me
  });

  it('autofocuses the reply composer when opened', async () => {
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200 });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('autofocuses the editor when editing an own comment', async () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('adds a comment via Cmd/Ctrl+Enter', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.type(editor, 'Quick');
    await userEvent.type(editor, '{Meta>}{Enter}{/Meta}');
    expect(onadd).toHaveBeenCalledWith('Quick');
  });

  it('does not add an empty comment via Cmd/Ctrl+Enter', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    await userEvent.type(screen.getByTestId('md-editor'), '{Meta>}{Enter}{/Meta}');
    expect(onadd).not.toHaveBeenCalled();
  });

  it('saves a comment edit via Cmd/Ctrl+Enter', async () => {
    const onedit = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, onedit });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.type(editor, '!');
    await userEvent.type(editor, '{Meta>}{Enter}{/Meta}');
    expect(onedit).toHaveBeenCalledWith('c2', 'my note!');
  });
});
