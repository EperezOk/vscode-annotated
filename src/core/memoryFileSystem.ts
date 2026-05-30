import { type FileSystem, normalizePath } from './fileSystem';

/** In-memory FileSystem for unit tests. */
export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>();

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(normalizePath(path));
    if (!data) {
      throw new Error(`File not found: ${normalizePath(path)}`);
    }
    return data;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    this.files.set(p, data);
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (parent) {
      await this.createDirectory(parent);
    }
  }

  async readDirectory(path: string): Promise<string[]> {
    const dir = normalizePath(path);
    const prefix = dir === '' ? '' : `${dir}/`;
    const names: string[] = [];
    for (const key of this.files.keys()) {
      if (prefix === '' ? !key.includes('/') : key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (rest !== '' && !rest.includes('/')) {
          names.push(rest);
        }
      }
    }
    return names;
  }

  async createDirectory(path: string): Promise<void> {
    this.dirs.add(normalizePath(path));
  }

  async delete(path: string): Promise<void> {
    this.files.delete(normalizePath(path));
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return this.files.has(p) || this.dirs.has(p);
  }
}
