// Pure parse/format for "local link" targets: workspace-relative path, optionally with a #L line
// fragment. GitHub-style. No vscode/I-O dependency. Single source of truth for the syntax.
import { type LineRange } from './model';

/** `path#L10-L20` / `path#L42`, or just `path` when `range` is null (whole-file target). */
export function formatLocationLink(file: string, range: LineRange | null): string {
  if (range === null) {
    return file;
  }
  return range.startLine === range.endLine
    ? `${file}#L${range.startLine}`
    : `${file}#L${range.startLine}-L${range.endLine}`;
}

/**
 * A target with no fragment counts as a local link only if it looks like a path: no whitespace
 * (a Markdown link destination can't contain unescaped whitespace anyway, so prose like "see
 * section 3.2" or a multi-line clipboard payload is never mistaken for one) and either it ends
 * in a `.ext`, or it contains a `/` with real path-like segments (more than one character each,
 * ignoring empty segments from a leading/trailing slash) — so a short abbreviation like "N/A"
 * doesn't pass just because it has a slash in it.
 */
function looksLikePath(file: string): boolean {
  if (/\s/.test(file)) {
    return false;
  }
  if (/\.[A-Za-z0-9]+$/.test(file)) {
    return true;
  }
  if (!file.includes('/')) {
    return false;
  }
  const segments = file.split('/').filter((s) => s.length > 0);
  return segments.length > 0 && segments.every((s) => s.length > 1);
}

/**
 * Parse `path#L10-L20` / `path#L42` → a line range, or `path` → `range: null` (whole file).
 * Returns null when `href` is not a local link. Rejects anything with a URL scheme (`http://`,
 * `mailto:`, a Windows drive `C:` …) — the check is self-contained here so `shared` does not
 * depend upward on `core`'s `isUrl`. A fragment that is not a valid `#L…` spec is NOT a local
 * link (e.g. `docs/adr.md#heading` stays an ordinary link).
 */
export function parseLocationLink(href: string): { file: string; range: LineRange | null } | null {
  if (typeof href !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }
  const hash = href.lastIndexOf('#');
  if (hash < 0) {
    const file = href.replace(/\\/g, '/');
    return file.length > 0 && looksLikePath(file) ? { file, range: null } : null;
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
  if (!Number.isSafeInteger(startLine) || startLine < 1) {
    return null;
  }
  if (!Number.isSafeInteger(endLine) || endLine < startLine) {
    return null;
  }
  return { file, range: { startLine, endLine } };
}

/** True when `text` (trimmed) parses as a local link — convenience for the paste guard. */
export function isLocationLink(text: string): boolean {
  return parseLocationLink(text.trim()) !== null;
}
