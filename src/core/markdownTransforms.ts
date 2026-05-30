/** True for an http(s) URL. */
export function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Replace `doc[from..to]` with `[selected](url)`; returns the new doc + the link's range. */
export function linkSelection(
  doc: string,
  from: number,
  to: number,
  url: string,
): { doc: string; selectionFrom: number; selectionTo: number } {
  const selected = doc.slice(from, to);
  const replacement = `[${selected}](${url})`;
  return {
    doc: doc.slice(0, from) + replacement + doc.slice(to),
    selectionFrom: from,
    selectionTo: from + replacement.length,
  };
}
