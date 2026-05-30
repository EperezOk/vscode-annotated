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
  it('shows a preview and the file:range for a non-empty annotation', () => {
    render(AnnotationView, { annotation: annotation('# Note') });
    expect(screen.getByTestId('md-preview')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-loc')).toHaveTextContent('src/x.ts:2–4');
    expect(screen.queryByTestId('md-editor')).toBeNull();
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
});
