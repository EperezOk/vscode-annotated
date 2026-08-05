import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
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

  it('styles top-level lists and quotes flush-left', () => {
    render(MarkdownPreview, { source: '- one\n  - nested\n\n> quoted' });
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n')
      .replace(/\s+/g, ' ');
    // jsdom in this environment does not expose the component CSS that vite-plugin-svelte
    // injects (the `style` tags collected above come back empty), so fall back to asserting
    // the same four rules are present in the component's raw <style> block source. (Note:
    // jsdom's global `URL` mis-resolves relative-to-file: bases against window.location, so
    // derive the sibling path from fileURLToPath(import.meta.url) instead of `new URL(rel, base)`.)
    const testFilePath = fileURLToPath(import.meta.url);
    const componentPath = join(dirname(testFilePath), 'MarkdownPreview.svelte');
    const source = css.trim().length > 0
      ? css
      : readFileSync(componentPath, 'utf8').replace(/\s+/g, ' ');
    // Lists indent by one small step per nesting level instead of the UA's 40px.
    expect(source).toMatch(/ul[^{]*{[^}]*padding-left: 1\.4em/);
    expect(source).toMatch(/ol[^{]*{[^}]*padding-left: 1\.4em/);
    // Quotes use a left border, not a 40px side margin.
    expect(source).toMatch(/blockquote[^{]*{[^}]*margin: 0\.5em 0/);
    expect(source).toMatch(/blockquote[^{]*{[^}]*border-left: 3px solid/);
  });

  it('fires onlocallink with a null range for a file-only link', async () => {
    const onlocallink = vi.fn();
    render(MarkdownPreview, { source: 'see [the module](src/core/foo.ts).', onlocallink });
    await userEvent.click(screen.getByText('the module'));
    expect(onlocallink).toHaveBeenCalledWith('src/core/foo.ts', null);
  });

  it('titles a file-only local link with the bare path', async () => {
    const { container } = render(MarkdownPreview, { source: '[mod](src/core/foo.ts)', onlocallink: () => {} });
    await tick();
    expect(container.querySelector('a.local-link')?.getAttribute('title')).toBe('src/core/foo.ts');
  });

  it('leaves prose links alone', async () => {
    const onlocallink = vi.fn();
    const { container } = render(MarkdownPreview, { source: '[see above](whatever)', onlocallink });
    await tick();
    expect(container.querySelector('a.local-link')).toBeNull();
    await userEvent.click(screen.getByText('see above'));
    expect(onlocallink).not.toHaveBeenCalled();
  });
});
