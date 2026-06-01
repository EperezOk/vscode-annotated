import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AnnotationRow from './AnnotationRow.svelte';
import { type Annotation } from '../../shared/model';

function annotation(content: string): Annotation {
  return { id: 'a1', file: 'src/auth/login.ts', range: { startLine: 42, endLine: 47 }, content, contentHash: 'h' };
}

describe('AnnotationRow', () => {
  it('renders the one-line content and filename:range (full path on hover)', () => {
    render(AnnotationRow, { annotation: annotation('## First line\nsecond') });
    const row = screen.getByTestId('annotation-row');
    expect(row).toHaveTextContent('## First line');
    expect(row).toHaveTextContent('login.ts:42–47');
    expect(row).not.toHaveTextContent('src/auth/login.ts');
    expect(screen.getByTestId('annotation-loc')).toHaveAttribute('title', 'src/auth/login.ts:42–47');
  });

  it('shows "(empty)" for an annotation with no content', () => {
    render(AnnotationRow, { annotation: annotation('') });
    expect(screen.getByTestId('annotation-row')).toHaveTextContent('(empty)');
  });

  it('calls onselect with the annotation id when clicked', async () => {
    const onselect = vi.fn();
    render(AnnotationRow, { annotation: annotation('hi'), onselect });
    await userEvent.click(screen.getByTestId('annotation-row'));
    expect(onselect).toHaveBeenCalledWith('a1');
  });

  it('shows a stale dot when stale', () => {
    render(AnnotationRow, { annotation: annotation('hi'), stale: true });
    expect(screen.getByTestId('stale-dot')).toBeInTheDocument();
  });
  it('has no stale dot by default', () => {
    render(AnnotationRow, { annotation: annotation('hi') });
    expect(screen.queryByTestId('stale-dot')).toBeNull();
  });
});
