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
    expect(screen.getByRole('option', { name: 'security' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'todo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'perf' })).toBeInTheDocument();
  });

  it('filters the list as you type', async () => {
    render(FilterPicker, { ...base });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.type(screen.getByTestId('picker-input-Tags'), 'se');
    expect(screen.getByRole('option', { name: 'security' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'todo' })).toBeNull();
  });

  it('calls onToggle when an option is chosen', async () => {
    const onToggle = vi.fn();
    render(FilterPicker, { ...base, onToggle });
    await userEvent.click(screen.getByTestId('picker-input-Tags'));
    await userEvent.click(screen.getByRole('option', { name: 'security' }));
    expect(onToggle).toHaveBeenCalledWith('security');
  });

  it('exposes combobox/listbox/option ARIA roles', async () => {
    render(FilterPicker, { ...base });
    const input = screen.getByTestId('picker-input-Tags');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('picker-menu-Tags')).toHaveAttribute('role', 'listbox');
    const first = screen.getByRole('option', { name: 'security' });
    expect(first).toHaveAttribute('aria-selected', 'true'); // highlighted index 0
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

  it('applies colorFor to selected pills with readable contrast text', () => {
    render(FilterPicker, { ...base, selected: ['security'], colorFor: () => '#ffff00' });
    const pill = screen.getByTestId('pill-Tags');
    expect(pill).toHaveStyle('background: rgb(255, 255, 0)');
    expect(pill).toHaveStyle('color: rgb(0, 0, 0)'); // contrastColor(light yellow) → black
  });
});
