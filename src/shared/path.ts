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
