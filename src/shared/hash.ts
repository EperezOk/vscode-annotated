import type { LineRange } from './model';

/** SHA-256 of `text`, lowercase hex. Uses Web Crypto (available in web host + Node ≥20.19). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The exact text of the full lines in `range` (1-based, inclusive) from `fileText`. */
export function anchorText(fileText: string, range: LineRange): string {
  const lines = fileText.split('\n');
  return lines.slice(range.startLine - 1, range.endLine).join('\n');
}
