import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { describe, it, expect, vi } from 'vitest';
import MarkdownPreview from './MarkdownPreview.svelte';

describe('MarkdownPreview', () => {
  it('renders Markdown as HTML', () => {
    render(MarkdownPreview, { source: '# Title\n\nSome **bold** text.' });
    const el = screen.getByTestId('md-preview');
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
  });

  it('sanitizes dangerous HTML', () => {
    render(MarkdownPreview, { source: 'ok <img src=x onerror="alert(1)"> <script>bad()<\/script>' });
    const el = screen.getByTestId('md-preview');
    expect(el.querySelector('script')).toBeNull();
    expect(el.innerHTML).not.toContain('onerror');
  });

  it('fires onlocallink with the parsed file + range when a local link is clicked', async () => {
    const onlocallink = vi.fn();
    render(MarkdownPreview, { source: 'see [the helper](src/core/foo.ts#L10-L20).', onlocallink });
    await userEvent.click(screen.getByText('the helper'));
    expect(onlocallink).toHaveBeenCalledWith('src/core/foo.ts', { startLine: 10, endLine: 20 });
  });

  it('does not fire onlocallink for an external link', async () => {
    const onlocallink = vi.fn();
    render(MarkdownPreview, { source: 'see [site](https://example.com).', onlocallink });
    await userEvent.click(screen.getByText('site'));
    expect(onlocallink).not.toHaveBeenCalled();
  });

  it('marks local links with the local-link class + a title, but not external ones', async () => {
    const { container } = render(MarkdownPreview, {
      source: '[local](src/x.ts#L5) and [ext](https://e.com)',
      onlocallink: () => {},
    });
    await tick();
    const local = container.querySelector('a.local-link');
    expect(local?.textContent).toBe('local');
    expect(local?.getAttribute('title')).toBe('src/x.ts:5');
    expect(container.querySelectorAll('a').length).toBe(2);
    expect(container.querySelectorAll('a.local-link').length).toBe(1);
  });

  it('does not mark or intercept when onlocallink is absent', async () => {
    const { container } = render(MarkdownPreview, { source: '[local](src/x.ts#L5)' });
    await tick();
    expect(container.querySelector('a.local-link')).toBeNull();
  });

  // VS Code's webview registers a window-level click handler that opens ANY anchor as an external
  // link and does NOT honour preventDefault — so a local-link click must STOP PROPAGATION before it
  // bubbles out, or the file opens in a new browser tab. `globalClick` stands in for that handler.
  it('stops a local-link click from bubbling to a window-level handler (and prevents default)', async () => {
    const onlocallink = vi.fn();
    const globalClick = vi.fn();
    window.addEventListener('click', globalClick);
    try {
      render(MarkdownPreview, { source: '[local](src/x.ts#L5)', onlocallink });
      await userEvent.click(screen.getByText('local'));
      expect(onlocallink).toHaveBeenCalledWith('src/x.ts', { startLine: 5, endLine: 5 });
      expect(globalClick).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', globalClick);
    }
  });

  it('lets an external-link click bubble through (so the webview can open it in the browser)', async () => {
    const globalClick = vi.fn();
    window.addEventListener('click', globalClick);
    try {
      render(MarkdownPreview, { source: '[ext](https://example.com)', onlocallink: () => {} });
      await userEvent.click(screen.getByText('ext'));
      expect(globalClick).toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', globalClick);
    }
  });
});
