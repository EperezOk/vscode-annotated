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
    // stopPropagation is the load-bearing call: VS Code's webview registers a window-level click
    // handler that opens ANY anchor's resolved href in a new browser tab and ignores
    // preventDefault — so the event must not reach it. We listen in the CAPTURE phase (below) so
    // we run before that bubble handler. preventDefault additionally stops the iframe from
    // navigating to the relative href itself.
    event.preventDefault();
    event.stopPropagation();
    onlocallink(loc.file, loc.range);
  }

  // Attach in the CAPTURE phase: capture descends from window before any bubble handler runs, so
  // this fires ahead of VS Code's window-level link handler, and stopPropagation keeps the click
  // from ever reaching it. A bubble handler here would be too late (the window handler is an
  // ancestor and the delegated-vs-native ordering is fragile).
  $effect(() => {
    const el = container;
    if (!el) {
      return;
    }
    el.addEventListener('click', onClick, true);
    return () => el.removeEventListener('click', onClick, true);
  });

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

<div class="md-preview" data-testid="md-preview" bind:this={container}>{@html html}</div>

<style>
  .md-preview { font-size: 13px; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; }
  .md-preview :global(h1) { font-size: 1.3em; }
  .md-preview :global(h2) { font-size: 1.15em; }
  .md-preview :global(code) { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 4px; border-radius: 3px; overflow-wrap: break-word; }
  .md-preview :global(pre) { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 8px; border-radius: 4px; overflow-x: auto; }
  .md-preview :global(a) { color: var(--vscode-textLink-foreground, #3794ff); overflow-wrap: break-word; }
  /* Local (code) link cue: a leading glyph + dotted underline so it reads apart from web links. */
  :global(.md-preview a.local-link) { text-decoration-style: dotted; }
  :global(.md-preview a.local-link)::before { content: '⤷ '; opacity: 0.75; }
</style>
