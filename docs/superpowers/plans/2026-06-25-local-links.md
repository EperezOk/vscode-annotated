# Local Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let annotation markdown contain `[label](src/foo.ts#L10-L20)` local links that open the file and highlight the lines (distinct from the annotation's own highlight) without changing the annotation view, with a "Refocus code" button to return.

**Architecture:** A new pure module (`src/shared/locationLink.ts`) parses/formats the GitHub-style link syntax and is the single source of truth. The webview intercepts clicks on local links and posts a typed `openLocalLink` message; the host reveals the target with a second, link-colored decoration (mirroring the existing `revealAnnotation`). Authoring is a copy-location command (producer) plus paste-to-link wrapping in the markdown editor (consumer). Returning reuses the existing `selectAnnotation` reveal path.

**Tech Stack:** TypeScript, Svelte 5 (runes), CodeMirror 6, markdown-it + DOMPurify, VS Code extension API (web-compatible), Vitest (unit/component), Mocha `@vscode/test-web` (integration).

## Global Constraints

- **Web-compatible extension:** no Node built-ins (`fs`/`path`/etc.) anywhere in `src/`. Use `vscode.workspace.fs` / `vscode.Uri.joinPath`. (Pure logic only in `src/shared` + `src/core`; `vscode` only in `src/web`; webviews in `src/webview`.)
- **Layering:** `src/shared` may NOT import from `src/core` or `src/web`. `src/core` may import `src/shared` only. `src/webview` may import `src/shared` + `src/core` (never `src/web`).
- **Model line numbers** are 1-based inclusive (`LineRange { startLine, endLine }`); VS Code ranges are 0-based.
- **Local gate** (run after every task): `npm run check-types` and `npm run test:unit` must pass. Integration/e2e tiers need network and are not part of the local gate.
- **Commits:** conventional-commit style (`feat(...)`, `test(...)`, `refactor(...)`, `docs(...)`), small and frequent.
- Branch: `local-links` (already created; the spec is committed there).

---

### Task 1: Pure location-link module

**Files:**
- Create: `src/shared/locationLink.ts`
- Test: `src/shared/locationLink.unit.test.ts`

**Interfaces:**
- Consumes: `LineRange` from `src/shared/model.ts`.
- Produces:
  - `formatLocationLink(file: string, range: LineRange): string` → `"src/foo.ts#L10-L20"` (or `"src/foo.ts#L42"` when single-line).
  - `parseLocationLink(href: string): { file: string; range: LineRange } | null`.
  - `isLocationLink(text: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/locationLink.unit.test.ts
import { describe, it, expect } from 'vitest';
import { formatLocationLink, parseLocationLink, isLocationLink } from './locationLink';

describe('formatLocationLink', () => {
  it('formats a multi-line range as path#Lstart-Lend', () => {
    expect(formatLocationLink('src/foo.ts', { startLine: 10, endLine: 20 })).toBe('src/foo.ts#L10-L20');
  });
  it('collapses a single-line range to path#Lstart', () => {
    expect(formatLocationLink('src/foo.ts', { startLine: 42, endLine: 42 })).toBe('src/foo.ts#L42');
  });
});

describe('parseLocationLink', () => {
  it('parses a range', () => {
    expect(parseLocationLink('src/foo.ts#L10-L20')).toEqual({ file: 'src/foo.ts', range: { startLine: 10, endLine: 20 } });
  });
  it('parses a single line as start===end', () => {
    expect(parseLocationLink('src/foo.ts#L42')).toEqual({ file: 'src/foo.ts', range: { startLine: 42, endLine: 42 } });
  });
  it('normalizes backslashes to forward slashes', () => {
    expect(parseLocationLink('src\\foo.ts#L1')).toEqual({ file: 'src/foo.ts', range: { startLine: 1, endLine: 1 } });
  });
  it('round-trips with formatLocationLink', () => {
    const href = formatLocationLink('a/b/c.ts', { startLine: 3, endLine: 9 });
    expect(parseLocationLink(href)).toEqual({ file: 'a/b/c.ts', range: { startLine: 3, endLine: 9 } });
  });
  it('returns null for http(s) URLs even with a line fragment', () => {
    expect(parseLocationLink('https://example.com/x#L1')).toBeNull();
    expect(parseLocationLink('http://x.co#L1-L2')).toBeNull();
  });
  it('returns null when there is no #L fragment', () => {
    expect(parseLocationLink('src/foo.ts')).toBeNull();
    expect(parseLocationLink('src/foo.ts#section')).toBeNull();
  });
  it('returns null for an empty file part', () => {
    expect(parseLocationLink('#L1')).toBeNull();
  });
  it('returns null for a reversed or zero range', () => {
    expect(parseLocationLink('src/foo.ts#L9-L3')).toBeNull();
    expect(parseLocationLink('src/foo.ts#L0')).toBeNull();
  });
  it('returns null for a scheme/absolute/Windows-drive path', () => {
    expect(parseLocationLink('mailto:x#L1')).toBeNull();
    expect(parseLocationLink('C:/foo.ts#L1')).toBeNull();
  });
});

describe('isLocationLink', () => {
  it('is true for a local link (trims surrounding whitespace)', () => {
    expect(isLocationLink('  src/foo.ts#L1-L2  ')).toBe(true);
  });
  it('is false for a URL or plain text', () => {
    expect(isLocationLink('https://example.com')).toBe(false);
    expect(isLocationLink('hello world')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/locationLink.unit.test.ts`
Expected: FAIL — `Failed to resolve import './locationLink'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/locationLink.ts
// Pure parse/format for "local link" targets: workspace-relative path + #L line fragment.
// GitHub-style. No vscode/I-O dependency. Single source of truth for the local-link syntax.
import { type LineRange } from './model';

/** Format a workspace-relative file + range as `path#L10-L20` (or `path#L42` when single-line). */
export function formatLocationLink(file: string, range: LineRange): string {
  return range.startLine === range.endLine
    ? `${file}#L${range.startLine}`
    : `${file}#L${range.startLine}-L${range.endLine}`;
}

/**
 * Parse `path#L10-L20` / `path#L42` → { file, range }, or null when `href` is not a local link.
 * Rejects anything with a URL scheme (`http://`, `mailto:`, a Windows drive `C:` …) — the http(s)
 * check is self-contained here so `shared` does not depend upward on `core`'s `isUrl`.
 */
export function parseLocationLink(href: string): { file: string; range: LineRange } | null {
  if (typeof href !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }
  const hash = href.lastIndexOf('#');
  if (hash < 0) {
    return null;
  }
  const file = href.slice(0, hash).replace(/\\/g, '/');
  if (file.length === 0) {
    return null;
  }
  const match = /^L(\d+)(?:-L(\d+))?$/.exec(href.slice(hash + 1));
  if (!match) {
    return null;
  }
  const startLine = Number(match[1]);
  const endLine = match[2] !== undefined ? Number(match[2]) : startLine;
  if (!Number.isInteger(startLine) || startLine < 1) {
    return null;
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    return null;
  }
  return { file, range: { startLine, endLine } };
}

/** True when `text` (trimmed) parses as a local link — convenience for the paste guard. */
export function isLocationLink(text: string): boolean {
  return parseLocationLink(text.trim()) !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/locationLink.unit.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Local gate + commit**

```bash
npm run check-types && npm run test:unit
git add src/shared/locationLink.ts src/shared/locationLink.unit.test.ts
git commit -m "feat(shared): pure local-link parse/format module"
```

---

### Task 2: `openLocalLink` protocol message

**Files:**
- Modify: `src/shared/protocol.ts` (add to `DetailToHost` union ~line 42-57; add a case in `parseDetailMessage` ~line 88-142)
- Test: `src/shared/protocol.unit.test.ts` (add cases in the `parseDetailMessage` describe block)

**Interfaces:**
- Produces: `DetailToHost` variant `{ type: 'openLocalLink'; file: string; startLine: number; endLine: number }`, validated by `parseDetailMessage`.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe('parseDetailMessage', …)` block)

```ts
  it('accepts openLocalLink with a string file + number lines', () => {
    expect(parseDetailMessage({ type: 'openLocalLink', file: 'src/x.ts', startLine: 3, endLine: 7 })).toEqual({
      type: 'openLocalLink', file: 'src/x.ts', startLine: 3, endLine: 7,
    });
  });
  it('rejects openLocalLink with a non-string file or non-number lines', () => {
    expect(parseDetailMessage({ type: 'openLocalLink', file: 5, startLine: 3, endLine: 7 })).toBeNull();
    expect(parseDetailMessage({ type: 'openLocalLink', file: 'src/x.ts', startLine: '3', endLine: 7 })).toBeNull();
    expect(parseDetailMessage({ type: 'openLocalLink', file: 'src/x.ts', startLine: 3 })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/protocol.unit.test.ts`
Expected: FAIL — `parseDetailMessage` returns `null` for the valid `openLocalLink` (case not handled yet).

- [ ] **Step 3: Add the union member** in `src/shared/protocol.ts`, in the `DetailToHost` union (after the `updateAnnotationRange` line):

```ts
  | { type: 'openLocalLink'; file: string; startLine: number; endLine: number }
```

- [ ] **Step 4: Add the validation case** in `parseDetailMessage`, before `default:`:

```ts
    case 'openLocalLink':
      return typeof raw.file === 'string' &&
        typeof raw.startLine === 'number' &&
        typeof raw.endLine === 'number'
        ? { type: 'openLocalLink', file: raw.file, startLine: raw.startLine, endLine: raw.endLine }
        : null;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/shared/protocol.unit.test.ts`
Expected: PASS.

- [ ] **Step 6: Local gate + commit**

```bash
npm run check-types && npm run test:unit
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat(protocol): openLocalLink detail→host message"
```

---

### Task 3: Paste-to-link in the markdown editor

**Files:**
- Modify: `src/core/markdownTransforms.ts` (add `linkPasteEdit`, reusing existing `isUrl` + `linkSelection`)
- Modify: `src/webview/detail/editorExtensions.ts` (refactor `urlPasteHandler` to delegate to `linkPasteEdit`; update imports lines ~1-5, ~8-26)
- Test: `src/core/markdownTransforms.unit.test.ts` (add a `describe('linkPasteEdit', …)`)

**Interfaces:**
- Consumes: `isLocationLink` from `src/shared/locationLink.ts` (Task 1); existing `isUrl`, `linkSelection` from `markdownTransforms.ts`.
- Produces: `linkPasteEdit(doc: string, from: number, to: number, pasted: string): { doc: string; selectionFrom: number; selectionTo: number } | null`.

- [ ] **Step 1: Write the failing test** (append to `src/core/markdownTransforms.unit.test.ts`)

```ts
import { linkPasteEdit } from './markdownTransforms';

describe('linkPasteEdit', () => {
  it('wraps a selection with a pasted http URL', () => {
    expect(linkPasteEdit('see foo bar', 4, 7, 'https://e.com')).toEqual({
      doc: 'see [foo](https://e.com) bar', selectionFrom: 4, selectionTo: 24,
    });
  });
  it('wraps a selection with a pasted local location (trimmed)', () => {
    const r = linkPasteEdit('see foo bar', 4, 7, '  src/x.ts#L10-L20  ');
    expect(r).toEqual({ doc: 'see [foo](src/x.ts#L10-L20) bar', selectionFrom: 4, selectionTo: 27 });
  });
  it('returns null when there is no selection (from === to)', () => {
    expect(linkPasteEdit('see foo', 4, 4, 'src/x.ts#L1')).toBeNull();
  });
  it('returns null when the pasted text is neither a URL nor a location', () => {
    expect(linkPasteEdit('see foo bar', 4, 7, 'just text')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/markdownTransforms.unit.test.ts`
Expected: FAIL — `Failed to resolve` / `linkPasteEdit is not a function`.

- [ ] **Step 3: Implement `linkPasteEdit`** in `src/core/markdownTransforms.ts` (add an import at the top, then the function below `linkSelection`):

```ts
import { isLocationLink } from '../shared/locationLink';
```

```ts
/**
 * Paste-over-selection decision: when `pasted` (trimmed) is an http(s) URL or a local link
 * target and a non-empty selection exists, the wrapped-link edit; otherwise null (paste falls
 * through to default). Pure — shared by the editor's paste handler.
 */
export function linkPasteEdit(
  doc: string,
  from: number,
  to: number,
  pasted: string,
): { doc: string; selectionFrom: number; selectionTo: number } | null {
  const text = pasted.trim();
  if (from >= to || !(isUrl(text) || isLocationLink(text))) {
    return null;
  }
  return linkSelection(doc, from, to, text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/markdownTransforms.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `urlPasteHandler` to delegate** — in `src/webview/detail/editorExtensions.ts`, change the import on line 5 and the handler on lines 8-26:

```ts
import { linkPasteEdit, toggleMarker } from '../../core/markdownTransforms';
```

```ts
/** Paste an http(s) URL or a local-link location over a selection → wrap as a Markdown link. */
export const urlPasteHandler: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const { main } = view.state.selection;
    const result = linkPasteEdit(view.state.doc.toString(), main.from, main.to, text);
    if (!result) {
      return false;
    }
    event.preventDefault();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.doc },
      selection: EditorSelection.range(result.selectionFrom, result.selectionTo),
    });
    return true;
  },
});
```

Note: `isUrl` and `linkSelection` are no longer imported in `editorExtensions.ts` (now used only inside `markdownTransforms.ts`). `EditorSelection` is still imported there (line 2) — keep it.

- [ ] **Step 6: Local gate + commit**

Run: `npm run check-types && npm run test:unit`
Expected: PASS (existing `editorExtensions`/`markdownTransforms` tests still green).

```bash
git add src/core/markdownTransforms.ts src/core/markdownTransforms.unit.test.ts src/webview/detail/editorExtensions.ts
git commit -m "feat(editor): paste a local-link location over a selection to wrap it"
```

---

### Task 4: MarkdownPreview — click interception + visual cue

**Files:**
- Modify: `src/webview/detail/MarkdownPreview.svelte`
- Test: `src/webview/detail/MarkdownPreview.svelte.test.ts`

**Interfaces:**
- Consumes: `parseLocationLink` from `src/shared/locationLink.ts` (Task 1); `formatLineRange`, `LineRange` from `src/shared/model.ts`.
- Produces: new optional prop `onlocallink?: (file: string, range: LineRange) => void`. When provided, local-link `<a>`s get a `local-link` class + a `title`, and clicking one fires `onlocallink` (and prevents default). When absent, links render plain (no cue, no interception).

- [ ] **Step 1: Write the failing test** (replace the file contents)

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/webview/detail/MarkdownPreview.svelte.test.ts`
Expected: FAIL — onlocallink not called / no `.local-link` class.

- [ ] **Step 3: Implement** — replace `src/webview/detail/MarkdownPreview.svelte` with:

```svelte
<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';
  import { parseLocationLink } from '../../shared/locationLink';
  import { formatLineRange, type LineRange } from '../../shared/model';

  let { source, onlocallink }: { source: string; onlocallink?: (file: string, range: LineRange) => void } = $props();

  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  const html = $derived(
    DOMPurify.sanitize(md.render(source ?? ''), {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
        'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      ],
      ALLOWED_ATTR: ['href', 'title'],
      ALLOW_DATA_ATTR: false,
    }),
  );

  let container: HTMLDivElement;

  // Read the raw href attribute (not a.href, which the webview resolves to an absolute URL).
  function localLinkFor(a: HTMLAnchorElement): { file: string; range: LineRange } | null {
    return parseLocationLink(a.getAttribute('href') ?? '');
  }

  function onClick(event: MouseEvent): void {
    if (!onlocallink) {
      return;
    }
    const a = (event.target as HTMLElement).closest('a');
    const loc = a ? localLinkFor(a) : null;
    if (!loc) {
      return;
    }
    event.preventDefault();
    onlocallink(loc.file, loc.range);
  }

  // After each render, mark local-link anchors with a class + tooltip (the visual cue).
  // Active only when navigation is wired (annotation body); comments render plain.
  $effect(() => {
    html; // re-run when the rendered markup changes
    if (!onlocallink || !container) {
      return;
    }
    for (const a of Array.from(container.querySelectorAll('a'))) {
      const loc = localLinkFor(a);
      if (loc) {
        a.classList.add('local-link');
        a.title = `${loc.file}:${formatLineRange(loc.range)}`;
      }
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="md-preview" data-testid="md-preview" bind:this={container} onclick={onClick}>{@html html}</div>

<style>
  .md-preview { font-size: 13px; line-height: 1.5; }
  .md-preview :global(h1) { font-size: 1.3em; }
  .md-preview :global(h2) { font-size: 1.15em; }
  .md-preview :global(code) { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 4px; border-radius: 3px; }
  .md-preview :global(pre) { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 8px; border-radius: 4px; overflow-x: auto; }
  .md-preview :global(a) { color: var(--vscode-textLink-foreground, #3794ff); }
  /* Local (code) link cue: a leading glyph + dotted underline so it reads apart from web links. */
  :global(.md-preview a.local-link) { text-decoration-style: dotted; }
  :global(.md-preview a.local-link)::before { content: '⤷ '; opacity: 0.75; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/webview/detail/MarkdownPreview.svelte.test.ts`
Expected: PASS. (A jsdom "Not implemented: navigation" log on the external-link click is benign.)

- [ ] **Step 5: Local gate + commit**

Run: `npm run check-types && npm run test:unit`

```bash
git add src/webview/detail/MarkdownPreview.svelte src/webview/detail/MarkdownPreview.svelte.test.ts
git commit -m "feat(detail): intercept local-link clicks + cue in MarkdownPreview"
```

---

### Task 5: AnnotationView — "Refocus code" button + onlocallink pass-through

**Files:**
- Modify: `src/webview/detail/AnnotationView.svelte` (props block lines ~9-41; `.bar` row lines ~102-114; the `<MarkdownPreview>` use line ~137)
- Test: `src/webview/detail/AnnotationView.svelte.test.ts`

**Interfaces:**
- Consumes: `LineRange` from `src/shared/model.ts`; `MarkdownPreview`'s `onlocallink` prop (Task 4).
- Produces: two new optional props on `AnnotationView`:
  - `onlocallink?: (file: string, range: LineRange) => void` — forwarded to `MarkdownPreview`.
  - `onrevealcode?: (id: string) => void` — fired by the "↩ Refocus code" button with `annotation.id`.

- [ ] **Step 1: Write the failing test** (append inside `describe('AnnotationView', …)`)

```ts
  it('fires onrevealcode with the annotation id when Refocus code is clicked', async () => {
    const onrevealcode = vi.fn();
    render(AnnotationView, { annotation: annotation('# Note'), onrevealcode });
    await userEvent.click(screen.getByTestId('refocus-btn'));
    expect(onrevealcode).toHaveBeenCalledWith('a1');
  });

  it('forwards onlocallink to the preview (local link click bubbles up)', async () => {
    const onlocallink = vi.fn();
    render(AnnotationView, {
      annotation: annotation('see [helper](src/core/foo.ts#L10-L20)'),
      onlocallink,
    });
    await userEvent.click(screen.getByText('helper'));
    expect(onlocallink).toHaveBeenCalledWith('src/core/foo.ts', { startLine: 10, endLine: 20 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — `refocus-btn` not found; `onlocallink` not called.

- [ ] **Step 3: Add the props** — in `src/webview/detail/AnnotationView.svelte`, extend the destructured props and the type. Add the import for `LineRange` (line 3 currently imports from `../../shared/model`):

```ts
  import { formatLineRange, type Annotation, type LineRange, type ThreadComment } from '../../shared/model';
```

Add `onlocallink` and `onrevealcode` to both the destructure and the type annotation in the `$props()` block (alongside `onback`, `onsave`, …):

```ts
    onlocallink,
    onrevealcode,
```

```ts
    onlocallink?: (file: string, range: LineRange) => void;
    onrevealcode?: (id: string) => void;
```

- [ ] **Step 4: Add the button** — in the `.bar` div, immediately after the `{/if}` that closes the editingRange block and before the copy-loc button (around line 113):

```svelte
    <button type="button" class="link" data-testid="refocus-btn" onclick={() => onrevealcode?.(annotation.id)}>↩ Refocus code</button>
```

- [ ] **Step 5: Forward onlocallink to the preview** — change the `<MarkdownPreview>` use (line ~137):

```svelte
    <MarkdownPreview source={annotation.content} {onlocallink} />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 7: Local gate + commit**

Run: `npm run check-types && npm run test:unit`

```bash
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(detail): Refocus code button + forward local-link clicks"
```

---

### Task 6: Detail store + DetailApp wiring

**Files:**
- Modify: `src/webview/detail/state.ts` (add `openLocalLink`, `refocusCode`)
- Modify: `src/webview/detail/DetailApp.svelte` (import the two helpers; pass `onlocallink` + `onrevealcode` to `<AnnotationView>`)

**Interfaces:**
- Consumes: `postToHost` (existing); `openLocalLink`/`refocusCode` message types — `openLocalLink` (Task 2) and the existing `selectAnnotation`; `LineRange` from `src/shared/model.ts`; `AnnotationView`'s new props (Task 5).
- Produces (in `state.ts`):
  - `openLocalLink(file: string, range: LineRange): void` → posts `{ type: 'openLocalLink', file, startLine, endLine }`.
  - `refocusCode(annotationId: string): void` → posts `{ type: 'selectAnnotation', annotationId }` (reuses the host's reveal path).

This task is verified by `check-types` + the component wiring; there is no store-level unit test (consistent with the existing `state.ts`, which has none — the message functions are thin `postToHost` wrappers).

- [ ] **Step 1: Add the helpers** — in `src/webview/detail/state.ts`, add the model import at the top and the two functions at the end:

```ts
import { type LineRange } from '../../shared/model';
```

```ts
/** Open a local link target in the editor. Does NOT change the annotation view. */
export function openLocalLink(file: string, range: LineRange): void {
  postToHost({ type: 'openLocalLink', file, startLine: range.startLine, endLine: range.endLine });
}

/** Re-reveal the current annotation's own code (reuses the selectAnnotation reveal path). */
export function refocusCode(annotationId: string): void {
  postToHost({ type: 'selectAnnotation', annotationId });
}
```

- [ ] **Step 2: Wire DetailApp** — in `src/webview/detail/DetailApp.svelte`, add `openLocalLink, refocusCode` to the import from `./state` (the existing multi-name import on lines 3-7), then add two props to the `<AnnotationView … />` use:

```svelte
        onlocallink={(file, range) => openLocalLink(file, range)}
        onrevealcode={(id) => refocusCode(id)}
```

- [ ] **Step 3: Local gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS (existing `DetailApp.svelte.test.ts` still green — the new props are optional and don't change default rendering).

- [ ] **Step 4: Commit**

```bash
git add src/webview/detail/state.ts src/webview/detail/DetailApp.svelte
git commit -m "feat(detail): wire local-link open + Refocus code to the host"
```

---

### Task 7: Host navigation — `revealLocation`, `clearAllHighlights`, path safety

**Files:**
- Modify: `src/shared/path.ts` (add `safeRelativeSegments`)
- Test: `src/shared/path.unit.test.ts` (add a `describe` for it)
- Modify: `src/web/navigateToCode.ts` (add the link decoration, `revealLocation`, `clearLinkHighlight`, `clearAllHighlights`; clear the link highlight inside `revealAnnotation`)
- Test: `src/web/test/suite/navigate.integration.test.ts` (add a `revealLocation` case — integration tier, not the local gate)

**Interfaces:**
- Consumes: `LineRange` from `src/shared/model.ts`; `safeRelativeSegments` (below).
- Produces:
  - `safeRelativeSegments(path: string): string[] | null` (in `src/shared/path.ts`) — safe, workspace-relative path segments, or `null` if absolute / escapes via `..`.
  - `revealLocation(folderUri: vscode.Uri, file: string, range: LineRange): Promise<void>`.
  - `clearAllHighlights(): void` (clears both the annotation and link highlights).

- [ ] **Step 1: Write the failing test for `safeRelativeSegments`** (append to `src/shared/path.unit.test.ts`)

```ts
import { safeRelativeSegments } from './path';

describe('safeRelativeSegments', () => {
  it('splits a relative POSIX path into segments', () => {
    expect(safeRelativeSegments('src/core/foo.ts')).toEqual(['src', 'core', 'foo.ts']);
  });
  it('drops "." and empty segments', () => {
    expect(safeRelativeSegments('./src//foo.ts')).toEqual(['src', 'foo.ts']);
  });
  it('returns null for an absolute or Windows-drive path', () => {
    expect(safeRelativeSegments('/etc/passwd')).toBeNull();
    expect(safeRelativeSegments('C:/x.ts')).toBeNull();
  });
  it('returns null when any segment is ".." (escape)', () => {
    expect(safeRelativeSegments('../secrets.ts')).toBeNull();
    expect(safeRelativeSegments('src/../../x.ts')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/path.unit.test.ts`
Expected: FAIL — `safeRelativeSegments is not a function`.

- [ ] **Step 3: Implement `safeRelativeSegments`** in `src/shared/path.ts`:

```ts
/**
 * Split a workspace-relative path into safe segments for `vscode.Uri.joinPath`, or null when the
 * path is absolute (POSIX or a Windows drive) or escapes the folder via a `..` segment.
 */
export function safeRelativeSegments(path: string): string[] | null {
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return null;
  }
  const segments = path.split(/[/\\]/).filter((s) => s.length > 0 && s !== '.');
  return segments.some((s) => s === '..') ? null : segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/path.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the link decoration + `revealLocation` + clears** — edit `src/web/navigateToCode.ts`. Update the imports (line 2) and add the new module-level state + functions. Also add a `clearLinkHighlight()` call inside `revealAnnotation` right after its existing `clearHighlight()`.

Replace the import line:

```ts
import { type Annotation, type LineRange } from '../shared/model';
import { safeRelativeSegments } from '../shared/path';
```

Add, after the existing `clearHighlight` function:

```ts
let linkHighlightType: vscode.TextEditorDecorationType | undefined;
let lastLinkEditor: vscode.TextEditor | undefined;

function linkDecorationType(): vscode.TextEditorDecorationType {
  if (!linkHighlightType) {
    linkHighlightType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('textLink.foreground'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
  }
  return linkHighlightType;
}

/** Clear the link-target highlight applied by the previous local-link navigation, if any. */
export function clearLinkHighlight(): void {
  if (lastLinkEditor && linkHighlightType) {
    lastLinkEditor.setDecorations(linkHighlightType, []);
  }
  lastLinkEditor = undefined;
}

/** Clear both the annotation highlight and the link-target highlight. */
export function clearAllHighlights(): void {
  clearHighlight();
  clearLinkHighlight();
}

/**
 * Open a local-link target (workspace-relative `file` + 1-based `range`), reveal + select the
 * lines, and apply the link-target highlight (distinct from the annotation highlight). Keeps
 * focus in the panel (preserveFocus) so the annotation view is untouched. Out-of-workspace or
 * unopenable targets warn and no-op rather than throw.
 */
export async function revealLocation(folderUri: vscode.Uri, file: string, range: LineRange): Promise<void> {
  const segments = safeRelativeSegments(file);
  if (!segments) {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}" (outside the workspace).`);
    return;
  }
  const uri = vscode.Uri.joinPath(folderUri, ...segments);
  const vsRange = new vscode.Range(range.startLine - 1, 0, range.endLine - 1, Number.MAX_SAFE_INTEGER);
  clearLinkHighlight();
  let editor: vscode.TextEditor;
  try {
    editor = await vscode.window.showTextDocument(uri, { selection: vsRange, preserveFocus: true });
  } catch {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}".`);
    return;
  }
  editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(linkDecorationType(), [vsRange]);
  lastLinkEditor = editor;
}
```

In `revealAnnotation`, after the existing `clearHighlight();` line, add:

```ts
  clearLinkHighlight(); // re-anchoring on the annotation drops any stale link-target highlight
```

- [ ] **Step 6: Write the integration test** (append a `test` inside the `suite('navigate-to-code', …)` in `src/web/test/suite/navigate.integration.test.ts`)

```ts
  test('revealLocation opens a workspace-relative target and selects its range', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const { revealLocation } = await import('../../navigateToCode');
    await revealLocation(folder.uri, 'README.md', { startLine: 1, endLine: 2 });
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.uri.path.endsWith('/README.md')) {
      throw new Error('expected README.md to be the active editor');
    }
    if (editor.selection.start.line !== 0 || editor.selection.end.line !== 1) {
      throw new Error(`unexpected selection ${editor.selection.start.line}-${editor.selection.end.line}`);
    }
  });
```

(Add `revealLocation` to the top-level `import { revealAnnotation } from '../../navigateToCode';` instead of the dynamic import if preferred — either compiles.)

- [ ] **Step 7: Local gate + commit**

Run: `npm run check-types && npm run test:unit`
Expected: PASS (the integration test is not run locally; it runs in the integration tier with network).

```bash
git add src/shared/path.ts src/shared/path.unit.test.ts src/web/navigateToCode.ts src/web/test/suite/navigate.integration.test.ts
git commit -m "feat(web): revealLocation with a distinct link-target highlight + path safety"
```

---

### Task 8: Host wiring — provider hook + extension

**Files:**
- Modify: `src/web/detailPanelProvider.ts` (add `onOpenLocalLink` field ~after line 24; handle the message in `onDidReceiveMessage` ~lines 82-90)
- Modify: `src/web/extension.ts` (imports line 10; `onNavigationClosed` lines 210-212; add `onOpenLocalLink`)

**Interfaces:**
- Consumes: `openLocalLink` message (Task 2); `revealLocation`, `clearAllHighlights` (Task 7).
- Produces: `DetailPanelProvider.onOpenLocalLink?: (file: string, startLine: number, endLine: number) => void`.

Verified by `check-types` + the integration tier (the provider's message routing has no unit test, consistent with the existing handlers).

- [ ] **Step 1: Add the provider hook field** — in `src/web/detailPanelProvider.ts`, after the `onUpdateAnnotation` declaration (~line 24):

```ts
  /** Set by the extension: open a local-link target in the editor (no annotation-view change). */
  public onOpenLocalLink?: (file: string, startLine: number, endLine: number) => void;
```

- [ ] **Step 2: Handle the message** — in `onDidReceiveMessage`, add a branch (e.g. after the `updateAnnotationRange` branch ~line 85):

```ts
      } else if (message.type === 'openLocalLink') {
        this.onOpenLocalLink?.(message.file, message.startLine, message.endLine);
```

- [ ] **Step 3: Update extension imports** — in `src/web/extension.ts` line 10:

```ts
import { revealAnnotation, revealLocation, clearAllHighlights } from './navigateToCode';
```

- [ ] **Step 4: Wire the hook + clear-all** — replace the `onNavigationClosed` assignment (lines 210-212) and add the `onOpenLocalLink` assignment next to it:

```ts
  detailProvider.onNavigationClosed = (): void => {
    clearAllHighlights();
  };
  detailProvider.onOpenLocalLink = (file, startLine, endLine): void => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      void revealLocation(folder.uri, file, { startLine, endLine });
    }
  };
```

- [ ] **Step 5: Local gate + commit**

Run: `npm run check-types && npm run test:unit`
Expected: PASS. (Confirm no remaining reference to the old `clearHighlight` import in `extension.ts` — it is now `clearAllHighlights`.)

```bash
git add src/web/detailPanelProvider.ts src/web/extension.ts
git commit -m "feat(web): route openLocalLink to revealLocation; clear both highlights on close"
```

---

### Task 9: Copy-location command + package.json contributions

**Files:**
- Create: `src/web/copyLocationLinkCommand.ts`
- Modify: `src/web/extension.ts` (import + register)
- Modify: `package.json` (`contributes.commands`, `contributes.menus.editor/context`)
- Test: `src/web/test/suite/extension.test.ts` (assert the command is registered — integration tier)

**Interfaces:**
- Consumes: `formatLocationLink` (Task 1).
- Produces: `registerCopyLocationLinkCommand(): vscode.Disposable` registering `annotated.copyLocationLink`.

- [ ] **Step 1: Create the command module** — `src/web/copyLocationLinkCommand.ts`:

```ts
import * as vscode from 'vscode';
import { formatLocationLink } from '../shared/locationLink';

/**
 * Register `annotated.copyLocationLink`: copy the active editor's selection (or cursor line) as a
 * `path#L10-L20` location string, ready to paste over a selection in an annotation (paste-to-link).
 */
export function registerCopyLocationLinkCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.copyLocationLink', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('Annotated: open a file and select lines to copy a location link.');
      return;
    }
    const file = vscode.workspace.asRelativePath(editor.document.uri, false);
    const sel = editor.selection;
    // VS Code lines are 0-based; the model is 1-based inclusive. A selection ending at column 0 of
    // a later line does not really include that line (mirrors createAnnotationCommand.getSelection).
    const startLine = sel.start.line + 1;
    const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
    const location = formatLocationLink(file, { startLine, endLine });
    await vscode.env.clipboard.writeText(location);
    void vscode.window.showInformationMessage(`Annotated: copied ${location}`);
  });
}
```

- [ ] **Step 2: Register it** — in `src/web/extension.ts`, add the import near the other command imports (line ~3):

```ts
import { registerCopyLocationLinkCommand } from './copyLocationLinkCommand';
```

and register it alongside the other `context.subscriptions.push(...)` command registrations (e.g. right after `registerCreateAnnotationCommand(openAnnotationInPanel)` ~line 472):

```ts
  context.subscriptions.push(registerCopyLocationLinkCommand());
```

- [ ] **Step 3: Add the package.json contributions** — in `package.json`, add to `contributes.commands`:

```json
    {
      "command": "annotated.copyLocationLink",
      "title": "Annotated: Copy Location for Annotation Link"
    }
```

and add an `editor/context` block to `contributes.menus` (a new key alongside `view/title` / `webview/context` / `commandPalette`):

```json
    "editor/context": [
      {
        "command": "annotated.copyLocationLink",
        "when": "editorTextFocus",
        "group": "9_cutcopypaste"
      }
    ]
```

- [ ] **Step 4: Write the registration test** — in `src/web/test/suite/extension.test.ts`, add an assertion that the command is registered. First inspect the existing file's style; the check is:

```ts
  test('registers the copyLocationLink command', async () => {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.copyLocationLink')) {
      throw new Error('annotated.copyLocationLink not registered');
    }
  });
```

(Match the file's existing `suite`/`test` + assertion idiom; the extension activates in that suite already.)

- [ ] **Step 5: Local gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS. Also validate the JSON: `node -e "require('./package.json')"` (no output = valid).

- [ ] **Step 6: Commit**

```bash
git add src/web/copyLocationLinkCommand.ts src/web/extension.ts package.json src/web/test/suite/extension.test.ts
git commit -m "feat(web): Copy Location for Annotation Link command + editor menu"
```

---

### Task 10: Manual verification + docs

**Files:**
- Modify: `CLAUDE.md` / `README.md` only if they enumerate features or keybindings (check first; skip if not applicable).

- [ ] **Step 1: Full local gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 2: Manual smoke test** (the author runs the extension; agent records the checklist)

1. Select lines in a source file → right-click → **Copy Location for Annotation Link** → clipboard holds `path#Lx-Ly`.
2. Open an annotation, Edit, select label text, paste → becomes `[label](path#Lx-Ly)`; Save.
3. In the rendered annotation the link shows the `⤷` cue + dotted underline and a `path:lines` tooltip; an external link does not.
4. Click the local link → the target file opens, the lines get the link-colored highlight, the annotation view is unchanged, focus stays in the panel.
5. Click **↩ Refocus code** → editor returns to the annotation's own lines (link highlight gone, annotation highlight back).
6. Click Back / hide the panel → both highlights clear.

- [ ] **Step 3: Commit any doc updates** (if made)

```bash
git add -A
git commit -m "docs: note local links feature"
```

---

## Self-Review

**Spec coverage:**
- Syntax `path#L10-L20` → Task 1. ✓
- Copy-location command (producer) → Task 9. ✓
- Paste-to-link (consumer) → Task 3. ✓
- Click interception → Tasks 4 (preview) + 6 (wiring) + 8 (host). ✓
- Distinct highlight + lifecycle (clear on refocus/open/close) → Task 7 (`revealLocation`, `clearLinkHighlight`, `clearAllHighlights`, clear-in-`revealAnnotation`) + Task 8 (`onNavigationClosed` → `clearAllHighlights`). ✓
- Annotation view unchanged (preserveFocus) → Task 7. ✓
- "↩ Refocus code" return → Task 5 (button) + Task 6 (`refocusCode` reuses `selectAnnotation`). ✓
- Visual cue v1 → Task 4. ✓
- Path safety (reject `..`/absolute, warn on not-found) → Task 7 (`safeRelativeSegments` + try/catch). ✓
- Protocol message + validation → Task 2. ✓
- package.json command + menu → Task 9. ✓
- Tests across `locationLink`, paste, preview, AnnotationView, protocol, navigate → Tasks 1-9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:**
- `onlocallink: (file: string, range: LineRange) => void` — identical in MarkdownPreview (T4), AnnotationView (T5), DetailApp/state (T6). ✓
- `openLocalLink` message shape `{ file, startLine, endLine }` — protocol (T2), state.ts post (T6), provider handler (T8), extension wiring (T8). ✓
- `revealLocation(folderUri, file, range)` — defined T7, called T8. ✓
- `clearAllHighlights()` — defined T7, used T8. ✓
- `formatLocationLink`/`parseLocationLink`/`isLocationLink` — defined T1; used T3 (`isLocationLink`), T4 (`parseLocationLink`), T9 (`formatLocationLink`). ✓
- `safeRelativeSegments` — defined T7 (path.ts), used T7 (navigateToCode). ✓
- `refocusCode(id)` posts `selectAnnotation` — host handler already exists (`detailPanelProvider` line ~72). ✓
