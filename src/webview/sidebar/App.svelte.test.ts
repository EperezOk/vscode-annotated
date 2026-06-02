import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from './App.svelte';
import { sidebar } from './state';
import { initialSidebarState } from '../../core/sidebarState';
import { type AnnotationGroup } from '../../shared/model';
import { postToHost } from './vscodeApi';
vi.mock('./vscodeApi', () => ({ postToHost: vi.fn() }));

function group(
  id: string,
  title: string,
  opts: { author?: string; tags?: { name: string; color: string }[]; status?: 'open' | 'resolved' } = {},
): AnnotationGroup {
  return {
    id, title, author: opts.author ?? 'A', tags: opts.tags ?? [],
    gitRef: null, status: opts.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: [],
  };
}

describe('App.svelte', () => {
  beforeEach(() => {
    sidebar.set(initialSidebarState());
    vi.clearAllMocks();
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

  it('filters by tag selected from the dropdown', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Sec', { tags: [{ name: 'security', color: '#888888' }] }), group('g2', 'Todo', { tags: [{ name: 'todo', color: '#888888' }] })],
      palette: [],
    });
    render(App);
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
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
  it('enters bulk mode: shows the action bar, checkboxes, and a live count', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One'), group('g2', 'Two')], palette: [] });
    render(App);
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();
    await userEvent.click(screen.getByTestId('bulk-toggle'));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getAllByTestId('bulk-checkbox')).toHaveLength(2);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 selected');
    await userEvent.click(screen.getAllByTestId('group-card')[0]);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');
  });
  it('dispatches a bulk resolve/restore for the selected ids', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One'), group('g2', 'Two')], palette: [], bulkMode: true, selectedGroupIds: ['g1'] });
    render(App);
    await userEvent.click(screen.getByTestId('bulk-resolve-btn'));
    expect(postToHost).toHaveBeenCalledWith({ type: 'bulkResolveRestore', groupIds: ['g1'] });
  });

  it('posts a refresh message when the refresh button is clicked', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One')], palette: [] });
    render(App);
    await userEvent.click(screen.getByTestId('refresh-btn'));
    expect(postToHost).toHaveBeenCalledWith({ type: 'refresh' });
  });

  it('shows transient "Refreshed" feedback after clicking refresh', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One')], palette: [] });
    render(App);
    const btn = screen.getByTestId('refresh-btn');
    expect(btn).toHaveTextContent('↻ Refresh');
    await userEvent.click(btn);
    expect(btn).toHaveTextContent('✓ Refreshed');
    expect(postToHost).toHaveBeenCalledWith({ type: 'refresh' });
  });
});
