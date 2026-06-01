<script lang="ts">
  let { doc = '', autofocus = false, onChange }: { doc?: string; autofocus?: boolean; onChange?: (value: string) => void } = $props();
</script>

<textarea
  data-testid="md-editor"
  data-autofocus={autofocus}
  value={doc}
  oninput={(e) => onChange?.((e.currentTarget as HTMLTextAreaElement).value)}
></textarea>
