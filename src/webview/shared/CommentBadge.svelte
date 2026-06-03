<script lang="ts">
  // Message icon + count, shown only when there is at least one comment (round-3 #11).
  let { count = 0 }: { count?: number } = $props();
</script>

{#if count > 0}
  <span class="badge" data-testid="comment-badge" title="{count} comment{count === 1 ? '' : 's'}">
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3.5-3H14a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"
      />
    </svg>
    {count}
  </span>
{/if}

<style>
  /* No inline styles anywhere — the sidebar webview CSP has no 'unsafe-inline'. */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-descriptionForeground, #9a9a9a);
    white-space: nowrap;
  }
</style>
