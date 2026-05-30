<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';

  let { source }: { source: string } = $props();

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
</script>

<div class="md-preview" data-testid="md-preview">{@html html}</div>

<style>
  .md-preview { font-size: 13px; line-height: 1.5; }
  .md-preview :global(h1) { font-size: 1.3em; }
  .md-preview :global(h2) { font-size: 1.15em; }
  .md-preview :global(code) { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 4px; border-radius: 3px; }
  .md-preview :global(pre) { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 8px; border-radius: 4px; overflow-x: auto; }
  .md-preview :global(a) { color: var(--vscode-textLink-foreground, #3794ff); }
</style>
