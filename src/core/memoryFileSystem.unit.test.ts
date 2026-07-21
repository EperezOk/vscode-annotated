import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = new TextEncoder();
const enc2 = (s: string) => new TextEncoder().encode(s);
const dec2 = (b: Uint8Array) => new TextDecoder().decode(b);

describe('MemoryFileSystem.list', () => {
  it('reports files and subdirectories directly under a path', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('.git/HEAD', enc.encode('ref: refs/heads/main\n'));
    await fs.writeFile('.git/refs/heads/main', enc.encode('a'.repeat(40)));
    await fs.writeFile('.git/refs/heads/feature/x', enc.encode('b'.repeat(40)));

    const top = await fs.list('.git');
    expect(top).toContainEqual({ name: 'HEAD', isDirectory: false });
    expect(top).toContainEqual({ name: 'refs', isDirectory: true });

    const heads = await fs.list('.git/refs/heads');
    expect(heads).toContainEqual({ name: 'main', isDirectory: false });
    expect(heads).toContainEqual({ name: 'feature', isDirectory: true });
  });

  it('returns [] for a missing directory', async () => {
    const fs = new MemoryFileSystem();
    expect(await fs.list('.git/nope')).toEqual([]);
  });
});

describe('MemoryFileSystem', () => {
  let fs: MemoryFileSystem;
  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  it('writes then reads a file', async () => {
    await fs.writeFile('a/b.json', enc2('hello'));
    expect(dec2(await fs.readFile('a/b.json'))).toBe('hello');
  });

  it('readFile throws for a missing file', async () => {
    await expect(fs.readFile('nope.json')).rejects.toThrow();
  });

  it('readDirectory lists only files directly under the path', async () => {
    await fs.writeFile('d/one.json', enc2('1'));
    await fs.writeFile('d/two.json', enc2('2'));
    await fs.writeFile('d/sub/three.json', enc2('3'));
    const names = (await fs.readDirectory('d')).sort();
    expect(names).toEqual(['one.json', 'two.json']);
  });

  it('readDirectory returns [] for a missing directory', async () => {
    expect(await fs.readDirectory('missing')).toEqual([]);
  });

  it('exists reflects writes and deletes', async () => {
    await fs.writeFile('x.json', enc2('x'));
    expect(await fs.exists('x.json')).toBe(true);
    await fs.delete('x.json');
    expect(await fs.exists('x.json')).toBe(false);
  });

  it('normalizes leading/trailing/duplicate slashes', async () => {
    await fs.writeFile('/p//q.json/', enc2('v'));
    expect(dec2(await fs.readFile('p/q.json'))).toBe('v');
  });
});
