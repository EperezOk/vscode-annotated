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

/**
 * Pick black or white text for the most legible contrast on a solid background color.
 *
 * Uses APCA (the perceptual contrast model behind WCAG 3), not a flat luminance threshold:
 * it returns whichever text polarity yields the higher perceptual lightness contrast (|Lc|).
 * A YIQ/luminance threshold mis-assigns dark text to saturated mid-tone hues (orchid/violet
 * purples, blues) because it under-weights blue; APCA gets these right.
 */
export function contrastColor(hex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(hex);
  if (!rgb) {
    return '#ffffff';
  }
  const bg = apcaLuminance(rgb);
  // Higher |Lc| = more readable. Compare black text (Y=0) against white text (Y=1).
  return apcaLc(0, bg) >= apcaLc(1, bg) ? '#000000' : '#ffffff';
}

/** APCA 0.98G screen luminance (Y) for an sRGB color, with the dark-level soft clamp. */
function apcaLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const s = (v: number): number => (v / 255) ** 2.4;
  const y = 0.2126729 * s(r) + 0.7151522 * s(g) + 0.072175 * s(b);
  return y >= 0.022 ? y : y + (0.022 - y) ** 1.414;
}

/** Absolute APCA lightness contrast (Lc) of text luminance `txt` on background luminance `bg`. */
function apcaLc(txt: number, bg: number): number {
  if (Math.abs(bg - txt) < 0.0005) {
    return 0;
  }
  if (bg > txt) {
    // Dark text on a lighter background (normal polarity).
    const sapc = (bg ** 0.56 - txt ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  // Light text on a darker background (reverse polarity).
  const sapc = (bg ** 0.65 - txt ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : -(sapc + 0.027) * 100;
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
