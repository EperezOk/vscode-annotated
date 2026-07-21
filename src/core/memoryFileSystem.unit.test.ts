import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = new TextEncoder();

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
