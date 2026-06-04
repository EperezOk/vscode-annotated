/**
 * A deterministic hue (0–359) for a comment author, so each author reads in a distinct color.
 * Orange (~30°) is reserved for the agent identity "Claude"; every other author hashes to one of
 * a curated set of hues that deliberately avoids the orange band. The component renders the hue
 * at a theme-appropriate lightness (darker on light themes, lighter on dark) so contrast holds
 * on any theme — see CommentThread.svelte.
 */
const CLAUDE_HUE = 30;
// Distinct, evenly-spread hues, none in the reserved orange band (15–50°).
const AUTHOR_HUES = [210, 145, 280, 350, 190, 320, 95, 255, 170, 235] as const;

export function authorHue(author: string): number {
  if (author.trim().toLowerCase() === 'claude') {
    return CLAUDE_HUE;
  }
  let h = 0;
  for (let i = 0; i < author.length; i++) {
    h = (Math.imul(h, 31) + author.charCodeAt(i)) | 0;
  }
  return AUTHOR_HUES[Math.abs(h) % AUTHOR_HUES.length];
}

/** Pick black or white text for legible contrast on a solid background color. */
export function contrastColor(hex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(hex);
  if (!rgb) {
    return '#ffffff';
  }
  // Perceived brightness (ITU-R BT.601 / "YIQ"), 0–255.
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness >= 128 ? '#000000' : '#ffffff';
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return null;
  }
  let h = m[1];
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
