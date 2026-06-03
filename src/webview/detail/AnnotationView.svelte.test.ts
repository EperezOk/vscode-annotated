import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AnnotationView from './AnnotationView.svelte';
import { type Annotation } from '../../shared/model';

vi.mock('./MarkdownEditor.svelte', async () => ({
  default: (await import('./__mocks__/MarkdownEditorStub.svelte')).default,
}));

function annotation(content: string): Annotation {
  return { id: 'a1', file: 'src/x.ts', range: { startLine: 2, endLine: 4 }, content, contentHash: 'h' };
}

describe('AnnotationView', () => {
  it('shows a preview and basename:range (full path on hover) for a non-empty annotation', () => {
    render(AnnotationView, { annotation: annotation('# Note') });
    expect(screen.getByTestId('md-preview')).toBeInTheDocument();
    const loc = screen.getByTestId('annotation-loc');
    expect(loc.textContent).toBe('x.ts:2–4');
    expect(loc).toHaveAttribute('title', 'src/x.ts:2–4');
    expect(screen.queryByTestId('md-editor')).toBeNull();
  });

  it('collapses a single-line range to one number', () => {
    render(AnnotationView, {
      annotation: { id: 'a1', file: 'src/x.ts', range: { startLine: 7, endLine: 7 }, content: '# N', contentHash: 'h' },
    });
    expect(screen.getByTestId('annotation-loc').textContent).toBe('x.ts:7');
  });

  it('starts in edit mode for an empty annotation', () => {
    render(AnnotationView, { annotation: annotation('') });
    expect(screen.getByTestId('md-editor')).toBeInTheDocument();
  });

  it('calls onback when Back is clicked', async () => {
    const onback = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), onback });
    await userEvent.click(screen.getByTestId('back-btn'));
    expect(onback).toHaveBeenCalled();
  });

  it('Edit reveals the editor; Save calls onsave with the content', async () => {
    const onsave = vi.fn();
    render(AnnotationView, { annotation: annotation('original'), onsave });
    await userEvent.click(screen.getByTestId('edit-btn'));
    expect(screen.getByTestId('md-editor')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('save-btn'));
    expect(onsave).toHaveBeenCalledWith('a1', 'original');
  });

  it('Copy markdown calls oncopy with the content', async () => {
    const oncopy = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), oncopy });
    await userEvent.click(screen.getByTestId('copy-md-btn'));
    expect(oncopy).toHaveBeenCalledWith('# Note');
  });

  it('shows the stale banner when stale', () => {
    render(AnnotationView, { annotation: annotation('# Note'), stale: true });
    expect(screen.getByTestId('stale-banner')).toBeInTheDocument();
  });
  it('edits the range and calls onsaverange', async () => {
    const onsaverange = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), onsaverange });
    await userEvent.click(screen.getByTestId('edit-range-btn'));
    const start = screen.getByTestId('range-start') as HTMLInputElement;
    await userEvent.clear(start); await userEvent.type(start, '5');
    const end = screen.getByTestId('range-end') as HTMLInputElement;
    await userEvent.clear(end); await userEvent.type(end, '9');
    await userEvent.click(screen.getByTestId('save-range-btn'));
    expect(onsaverange).toHaveBeenCalledWith('a1', 5, 9);
  });
  it('shows the position indicator and fires onprev/onnext', async () => {
    const onprev = vi.fn();
    const onnext = vi.fn();
    render(AnnotationView, { annotation: annotation('# N'), position: { current: 2, total: 3 }, onprev, onnext });
    expect(screen.getByTestId('position-info')).toHaveTextContent('2 / 3');
    await userEvent.click(screen.getByTestId('next-btn'));
    expect(onnext).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('prev-btn'));
    expect(onprev).toHaveBeenCalled();
  });
  it('disables prev/next when no handler is given (ends of the list)', () => {
    render(AnnotationView, { annotation: annotation('# N'), position: { current: 1, total: 1 } });
    expect(screen.getByTestId('prev-btn')).toBeDisabled();
    expect(screen.getByTestId('next-btn')).toBeDisabled();
  });

  it('autofocuses the editor when auto-opening an empty (new) annotation', () => {
    render(AnnotationView, { annotation: annotation('') });
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'true');
  });

  it('does not autofocus when manually editing an existing annotation', async () => {
    render(AnnotationView, { annotation: annotation('original') });
    await userEvent.click(screen.getByTestId('edit-btn'));
    expect(screen.getByTestId('md-editor')).toHaveAttribute('data-autofocus', 'false');
  });

  it('renders the comment thread', () => {
    render(AnnotationView, { annotation: annotation('# Note'), comments: [], currentAuthor: 'Me' });
    expect(screen.getByTestId('comment-thread')).toBeInTheDocument();
    expect(screen.getByTestId('comment-reply-trigger')).toBeInTheDocument();
  });

  it('shows transient "Copied" feedback after Copy markdown (and still calls oncopy)', async () => {
    const oncopy = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), oncopy });
    const btn = screen.getByTestId('copy-md-btn');
    expect(btn).toHaveTextContent('Copy markdown');
    await userEvent.click(btn);
    expect(oncopy).toHaveBeenCalledWith('# Note');
    expect(btn).toHaveTextContent('Copied');
  });

  it('shows transient "Copied" feedback after copying the path (and still calls oncopyloc)', async () => {
    const oncopyloc = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), oncopyloc });
    const btn = screen.getByTestId('copy-loc-btn');
    await userEvent.click(btn);
    expect(oncopyloc).toHaveBeenCalledWith('src/x.ts:2–4');
    expect(btn).toHaveTextContent('Copied');
  });
});
