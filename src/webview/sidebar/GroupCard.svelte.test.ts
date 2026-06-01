import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import GroupCard from './GroupCard.svelte';
import { type AnnotationGroup } from '../../shared/model';

function group(): AnnotationGroup {
  return {
    id: 'g1',
    title: 'Login review',
    author: 'Ezequiel',
    tags: ['security'],
    gitRef: null,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    annotations: [
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' },
    ],
  };
}

describe('GroupCard', () => {
  it('renders title, author, annotation count, and tag chips', () => {
    render(GroupCard, { group: group(), palette: [{ name: 'security', color: '#c0392b' }] });
    const card = screen.getByTestId('group-card');
    expect(card).toHaveTextContent('Login review');
    expect(card).toHaveTextContent('Ezequiel');
    expect(card).toHaveTextContent('1 annotation');
    expect(card).toHaveTextContent('security');
  });

  it('calls onselect with the group id when clicked', async () => {
    const onselect = vi.fn();
    render(GroupCard, { group: group(), palette: [], onselect });
    await userEvent.click(screen.getByTestId('group-card'));
    expect(onselect).toHaveBeenCalledWith('g1');
  });

  it('shows a resolved badge and dims when the group is resolved', () => {
    render(GroupCard, { group: { ...group(), status: 'resolved' }, palette: [] });
    expect(screen.getByTestId('resolved-badge')).toBeInTheDocument();
    expect(screen.getByTestId('group-card')).toHaveClass('resolved');
  });
  it('has no resolved badge for an open group', () => {
    render(GroupCard, { group: group(), palette: [] });
    expect(screen.queryByTestId('resolved-badge')).toBeNull();
  });
  it('shows a checkbox in bulk mode and toggles selection on card click', async () => {
    const oncheck = vi.fn();
    render(GroupCard, { group: group(), palette: [], bulkMode: true, checked: false, oncheck });
    expect(screen.getByTestId('bulk-checkbox')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('group-card'));
    expect(oncheck).toHaveBeenCalledWith('g1');
  });
  it('uses readable (auto-contrast) text color on tag chips', () => {
    const dark = render(GroupCard, { group: group(), palette: [{ name: 'security', color: '#c0392b' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(255, 255, 255)'); // dark bg → white
    dark.unmount();
    render(GroupCard, { group: group(), palette: [{ name: 'security', color: '#ffff00' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(0, 0, 0)'); // light bg → black
  });

  it('reflects the checked state and has no checkbox outside bulk mode', () => {
    const { unmount } = render(GroupCard, { group: group(), palette: [], bulkMode: true, checked: true });
    expect(screen.getByTestId('bulk-checkbox')).toBeChecked();
    unmount();
    render(GroupCard, { group: group(), palette: [] });
    expect(screen.queryByTestId('bulk-checkbox')).toBeNull();
  });
});
