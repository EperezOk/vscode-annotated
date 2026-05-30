/**
 * Minimal file-system abstraction over workspace-relative POSIX paths
 * ('/'-separated, no leading slash). Implemented in-memory for tests and
 * over `vscode.workspace.fs` for the running extension.
 */
export interface FileSystem {
  /** Read a file's bytes. Rejects if the file does not exist. */
  readFile(path: string): Promise<Uint8Array>;
  /** Write a file's bytes, creating ancestor directories as needed. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Names of files directly under `path`. Returns [] if the directory does not exist. */
  readDirectory(path: string): Promise<string[]>;
  /** Create `path` and any missing ancestors. Idempotent. */
  createDirectory(path: string): Promise<void>;
  /** Delete a file. No-op if it does not exist. */
  delete(path: string): Promise<void>;
  /** Whether a file or directory exists at `path`. */
  exists(path: string): Promise<boolean>;
}

/** Normalize a path: drop leading/trailing slashes, collapse duplicates. */
export function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Parent directory of a normalized path, or '' for a top-level path. */
export function parentOf(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
