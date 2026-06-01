/** Wrap a raw (ASCII) SVG string as a base64 `data:` URI usable as an icon path / img src. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** A small filled rounded-square swatch icon for the given hex color, as a `data:` URI. */
export function swatchIconSvg(hex: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<rect x="1" y="1" width="14" height="14" rx="3" fill="${hex}"/>` +
    `</svg>`;
  return svgDataUri(svg);
}
