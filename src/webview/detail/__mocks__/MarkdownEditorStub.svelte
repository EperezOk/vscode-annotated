<script lang="ts">
  let { doc = '', autofocus = false, onChange, onSubmit }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void; onSubmit?: () => void } = $props();
</script>

<textarea
  data-testid="md-editor"
  data-autofocus={autofocus}
  value={doc}
  oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
  onkeydown={(e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    }
  }}
></textarea>
