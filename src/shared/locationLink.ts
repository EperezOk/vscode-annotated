// Pure parse/format for "local link" targets: workspace-relative path + #L line fragment.
// GitHub-style. No vscode/I-O dependency. Single source of truth for the local-link syntax.
import { type LineRange } from './model';

/** Format a workspace-relative file + range as `path#L10-L20` (or `path#L42` when single-line). */
export function formatLocationLink(file: string, range: LineRange): string {
  return range.startLine === range.endLine
    ? `${file}#L${range.startLine}`
    : `${file}#L${range.startLine}-L${range.endLine}`;
}

/**
 * Parse `path#L10-L20` / `path#L42` → { file, range }, or null when `href` is not a local link.
 * Rejects anything with a URL scheme (`http://`, `mailto:`, a Windows drive `C:` …) — the http(s)
 * check is self-contained here so `shared` does not depend upward on `core`'s `isUrl`.
 */
export function parseLocationLink(href: string): { file: string; range: LineRange } | null {
  if (typeof href !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }
  const hash = href.lastIndexOf('#');
  if (hash < 0) {
    return null;
  }
  const file = href.slice(0, hash).replace(/\\/g, '/');
  if (file.length === 0) {
    return null;
  }
  const match = /^L(\d+)(?:-L(\d+))?$/.exec(href.slice(hash + 1));
  if (!match) {
    return null;
  }
  const startLine = Number(match[1]);
  const endLine = match[2] !== undefined ? Number(match[2]) : startLine;
  if (!Number.isInteger(startLine) || startLine < 1) {
    return null;
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    return null;
  }
  return { file, range: { startLine, endLine } };
}

/** True when `text` (trimmed) parses as a local link — convenience for the paste guard. */
export function isLocationLink(text: string): boolean {
  return parseLocationLink(text.trim()) !== null;
}
