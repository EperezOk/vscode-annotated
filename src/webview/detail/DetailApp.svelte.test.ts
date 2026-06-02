import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import DetailApp from './DetailApp.svelte';
import { detail } from './state';
import { initialDetailState } from '../../core/detailState';
import { type AnnotationGroup } from '../../shared/model';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'Login review', author: 'Ezequiel', tags: [{ name: 'security', color: '#888888' }], gitRef: 'main', status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 2 }, content: 'First', contentHash: 'h' },
      { id: 'a2', file: 'b.ts', range: { startLine: 5, endLine: 5 }, content: 'Second', contentHash: 'h' },
    ],
  };
}

describe('DetailApp.svelte', () => {
  beforeEach(() => {
    detail.set(initialDetailState());
  });

  it('shows an empty state when no group is selected', () => {
    render(DetailApp);
    expect(screen.getByTestId('detail-empty')).toBeInTheDocument();
  });

  it('renders the group header and an annotation row per annotation in group mode', () => {
    detail.set({ group: group(), palette: [{ name: 'security', color: '#c0392b' }], selectedAnnotationId: null, mode: 'group' });
    render(DetailApp);
    expect(screen.getByTestId('detail-title')).toHaveTextContent('Login review');
    expect(screen.getAllByTestId('annotation-row')).toHaveLength(2);
  });

  it('renders the annotation view in annotation mode', () => {
    detail.set({ group: group(), palette: [], selectedAnnotationId: 'a1', mode: 'annotation' });
    render(DetailApp);
    expect(screen.getByTestId('annotation-view')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-title')).toBeNull();
  });
});
