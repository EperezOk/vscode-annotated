/** The last segment (basename) of a POSIX path; the input itself if it has no slash. */
export function fileName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}
