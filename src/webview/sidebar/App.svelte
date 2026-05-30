<script lang="ts">
  let { name = '' }: { name?: string } = $props();
</script>

<main data-testid="hello">
  {#if name}
    <h1>Hello, {name}</h1>
  {:else}
    <h1>Annotated is alive</h1>
  {/if}
</main>

<style>
  main {
    padding: 0.75rem;
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground, #ccc);
  }
  h1 {
    font-size: 1rem;
    font-weight: 600;
  }
</style>
