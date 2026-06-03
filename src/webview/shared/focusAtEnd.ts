/**
 * Svelte action: focus an input on mount and place the cursor at the end of its
 * value (round-3 #13 — edit buttons should drop you straight into the field).
 */
export function focusAtEnd(el: HTMLInputElement): void {
  el.focus();
  const end = el.value.length;
  el.setSelectionRange(end, end);
}
