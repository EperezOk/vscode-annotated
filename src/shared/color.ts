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
