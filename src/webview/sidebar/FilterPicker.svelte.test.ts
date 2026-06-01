import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterPicker from './FilterPicker.svelte';

const base = { label: 'Tags', options: ['security', 'todo', 'perf'], selected: [] as string[] };

describe('FilterPicker', () => {
  it('shows no option menu until the input is focused', () => {
    render(FilterPicker, { ...base });
    expect(screen.queryByTestId('picker-menu-Tags')).toBeNull();
  });

  it('reveals the full option list on focus', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    expect(screen.getByRole('button', { name: 'security' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'perf' })).toBeInTheDocument();
  });

  it('filters the list as you type', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.type(screen.getByTestId('picker-input-Tags'), 'se');
    expect(screen.getByRole('button', { name: 'security' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'todo' })).toBeNull();
  });

  it('calls onToggle when an option is chosen', async () => {
    const onToggle = vi.fn();
    render(FilterPicker, { ...base, onToggle });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.click(screen.getByRole('button', { name: 'security' }));
    expect(onToggle).toHaveBeenCalledWith('security');
  });

  it('renders selected values as removable pills and removes on ✕', async () => {
    const onToggle = vi.fn();
    render(FilterPicker, { ...base, selected: ['security'], onToggle });
    expect(screen.getByTestId('pill-Tags')).toHaveTextContent('security');
    await userEvent.click(screen.getByTestId('pill-remove-Tags'));
    expect(onToggle).toHaveBeenCalledWith('security');
  });

  it('closes the menu on Escape', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    expect(screen.getByTestId('picker-menu-Tags')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('picker-menu-Tags')).toBeNull();
  });
});
