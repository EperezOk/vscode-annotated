<script lang="ts">
  let { doc = '', onChange }: { doc?: string; onChange?: (value: string) => void } = $props();
</script>

<textarea
  data-testid="md-editor"
  value={doc}
  oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
></textarea>
