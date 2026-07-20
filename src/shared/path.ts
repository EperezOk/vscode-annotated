/** The last segment (basename) of a POSIX path; the input itself if it has no slash. */
export function fileName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Split a workspace-relative path into safe segments for `vscode.Uri.joinPath`, or null when the
 * path is absolute (POSIX or a Windows drive) or escapes the folder via a `..` segment.
 */
export function safeRelativeSegments(path: string): string[] | null {
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return null;
  }
  const segments = path.split(/[/\\]/).filter((s) => s.length > 0 && s !== '.');
  return segments.some((s) => s === '..') ? null : segments;
}

/**
 * Resolve `input` to safe workspace-relative segments for `vscode.Uri.joinPath`, accepting
 * ABSOLUTE paths that live inside `workspaceRoot` (normalized to relative). Returns null for an
 * absolute path with no root context or one that lies outside the root, and for any `..` escape.
 * A relative input falls through to `safeRelativeSegments` unchanged.
 */
export function toWorkspaceRelativeSegments(input: string, workspaceRoot?: string): string[] | null {
  const normalized = input.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized);
  if (!isAbsolute) {
    return safeRelativeSegments(normalized);
  }
  if (!workspaceRoot) {
    return null;
  }
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === root) {
    return [];
  }
  const prefix = `${root}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  // The remainder is relative; safeRelativeSegments still rejects any "../" escape.
  return safeRelativeSegments(normalized.slice(prefix.length));
}
