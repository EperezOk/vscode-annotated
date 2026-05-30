import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import App from './App.svelte';
import { sidebar } from './state';
import { initialSidebarState } from '../../core/sidebarState';
import { type AnnotationGroup } from '../../shared/model';

function group(id: string, title: string): AnnotationGroup {
  return { id, title, author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('App.svelte', () => {
  beforeEach(() => {
    sidebar.set(initialSidebarState());
  });

  it('shows an empty-state message when there are no groups', () => {
    render(App);
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });

  it('renders a card per group from the store', () => {
    sidebar.set({ groups: [group('g1', 'First'), group('g2', 'Second')], palette: [], selectedId: null });
    render(App);
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('First');
    expect(cards[1]).toHaveTextContent('Second');
  });
});
