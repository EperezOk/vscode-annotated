import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import App from './App.svelte';
import { sidebar } from './state';
import { initialSidebarState } from '../../core/sidebarState';
import { type AnnotationGroup } from '../../shared/model';

function group(
  id: string,
  title: string,
  opts: { author?: string; tags?: string[]; status?: 'open' | 'resolved' } = {},
): AnnotationGroup {
  return {
    id, title, author: opts.author ?? 'A', tags: opts.tags ?? [],
    gitRef: null, status: opts.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: [],
  };
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
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'First'), group('g2', 'Second')], palette: [] });
    render(App);
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('First');
    expect(cards[1]).toHaveTextContent('Second');
  });

  it('hides resolved groups until show-resolved is checked', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Open one'), group('g2', 'Resolved one', { status: 'resolved' })],
      palette: [],
    });
    render(App);
    expect(screen.getAllByTestId('group-card')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('show-resolved'));
    expect(screen.getAllByTestId('group-card')).toHaveLength(2);
  });

  it('filters by tag when a tag chip is selected', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Sec', { tags: ['security'] }), group('g2', 'Todo', { tags: ['todo'] })],
      palette: [],
    });
    render(App);
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Sec');
  });

  it('renders the no-matches message when the only group is resolved and hidden', () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Resolved only', { status: 'resolved' })],
      palette: [],
    });
    render(App);
    expect(screen.getByTestId('no-matches')).toBeInTheDocument();
    expect(screen.queryByTestId('group-card')).toBeNull();
  });
});
