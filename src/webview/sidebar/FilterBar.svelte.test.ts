import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterBar from './FilterBar.svelte';

const base = {
  tags: [] as string[], authors: [] as string[],
  selectedTags: [] as string[], selectedAuthors: [] as string[],
  showResolved: false, palette: [] as { name: string; color: string }[],
};

describe('FilterBar', () => {
  it('shows the show-resolved checkbox and no options until a picker is focused', () => {
    render(FilterBar, { ...base, tags: ['security'], authors: ['Ana'] });
    expect(screen.getByTestId('show-resolved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'security' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ana' })).toBeNull();
  });

  it('toggles a tag when chosen from the tag picker', async () => {
    const ontoggletag = vi.fn();
    render(FilterBar, { ...base, tags: ['security'], ontoggletag });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.click(screen.getByRole('option', { name: 'security' }));
    expect(ontoggletag).toHaveBeenCalledWith('security');
  });

  it('toggles an author when chosen from the author picker', async () => {
    const ontoggleauthor = vi.fn();
    render(FilterBar, { ...base, authors: ['Ana'], ontoggleauthor });
    await userEvent.click(screen.getByTestId('picker-input-Authors'));
    await userEvent.click(screen.getByRole('option', { name: 'Ana' }));
    expect(ontoggleauthor).toHaveBeenCalledWith('Ana');
  });

  it('shows a selected tag as a pill', () => {
    render(FilterBar, { ...base, tags: ['security'], selectedTags: ['security'] });
    expect(screen.getByTestId('pill-Tags')).toHaveTextContent('security');
  });

  it('calls onshowresolved with the new checkbox state', async () => {
    const onshowresolved = vi.fn();
    render(FilterBar, { ...base, onshowresolved });
    await userEvent.click(screen.getByTestId('show-resolved'));
    expect(onshowresolved).toHaveBeenCalledWith(true);
  });
});
