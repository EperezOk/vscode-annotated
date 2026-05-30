import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('MemoryFileSystem', () => {
  let fs: MemoryFileSystem;
  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  it('writes then reads a file', async () => {
    await fs.writeFile('a/b.json', enc('hello'));
    expect(dec(await fs.readFile('a/b.json'))).toBe('hello');
  });

  it('readFile throws for a missing file', async () => {
    await expect(fs.readFile('nope.json')).rejects.toThrow();
  });

  it('readDirectory lists only files directly under the path', async () => {
    await fs.writeFile('d/one.json', enc('1'));
    await fs.writeFile('d/two.json', enc('2'));
    await fs.writeFile('d/sub/three.json', enc('3'));
    const names = (await fs.readDirectory('d')).sort();
    expect(names).toEqual(['one.json', 'two.json']);
  });

  it('readDirectory returns [] for a missing directory', async () => {
    expect(await fs.readDirectory('missing')).toEqual([]);
  });

  it('exists reflects writes and deletes', async () => {
    await fs.writeFile('x.json', enc('x'));
    expect(await fs.exists('x.json')).toBe(true);
    await fs.delete('x.json');
    expect(await fs.exists('x.json')).toBe(false);
  });

  it('normalizes leading/trailing/duplicate slashes', async () => {
    await fs.writeFile('/p//q.json/', enc('v'));
    expect(dec(await fs.readFile('p/q.json'))).toBe('v');
  });
});
