import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterBar from './FilterBar.svelte';

const base = { tags: [] as string[], authors: [] as string[], selectedTags: [] as string[], selectedAuthors: [] as string[], showResolved: false };

describe('FilterBar', () => {
  it('renders a chip per tag and author and a show-resolved checkbox', () => {
    render(FilterBar, { ...base, tags: ['security'], authors: ['Ana'] });
    expect(screen.getByRole('button', { name: 'security' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByTestId('show-resolved')).toBeInTheDocument();
  });
  it('marks a selected tag chip active', () => {
    render(FilterBar, { ...base, tags: ['security'], selectedTags: ['security'] });
    expect(screen.getByRole('button', { name: 'security' })).toHaveClass('active');
  });
  it('calls ontoggletag when a tag chip is clicked', async () => {
    const ontoggletag = vi.fn();
    render(FilterBar, { ...base, tags: ['security'], ontoggletag });
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    expect(ontoggletag).toHaveBeenCalledWith('security');
  });
  it('calls ontoggleauthor when an author chip is clicked', async () => {
    const ontoggleauthor = vi.fn();
    render(FilterBar, { ...base, authors: ['Ana'], ontoggleauthor });
    await userEvent.click(screen.getByRole('button', { name: 'Ana' }));
    expect(ontoggleauthor).toHaveBeenCalledWith('Ana');
  });
  it('calls onshowresolved with the new checkbox state', async () => {
    const onshowresolved = vi.fn();
    render(FilterBar, { ...base, onshowresolved });
    await userEvent.click(screen.getByTestId('show-resolved'));
    expect(onshowresolved).toHaveBeenCalledWith(true);
  });
});
