import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MarkdownEditor from './MarkdownEditor.svelte';

describe('MarkdownEditor', () => {
  it('shows the initial doc value', () => {
    render(MarkdownEditor, { doc: 'hello' });
    expect((screen.getByTestId('md-editor') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(MarkdownEditor, { doc: '', onChange });
    await userEvent.type(screen.getByTestId('md-editor'), 'hi');
    expect(onChange).toHaveBeenLastCalledWith('hi');
  });
});
