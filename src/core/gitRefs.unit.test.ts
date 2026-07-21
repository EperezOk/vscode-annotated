import { describe, it, expect } from 'vitest';
import { currentRef, gitRefSuggestions } from './gitRefs';

describe('gitRefSuggestions', () => {
  it('lists the HEAD short SHA first, then branches, then tags', () => {
    const out = gitRefSuggestions({ headSha: 'abcdef1234567890', branches: ['main', 'dev'], tags: ['v1.0'] });
    expect(out).toEqual([
      { ref: 'abcdef1', label: 'abcdef1', description: 'current commit (HEAD)' },
      { ref: 'main', label: 'main', description: 'branch' },
      { ref: 'dev', label: 'dev', description: 'branch' },
      { ref: 'v1.0', label: 'v1.0', description: 'tag' },
    ]);
  });

  it('omits HEAD when there is no headSha', () => {
    expect(gitRefSuggestions({ branches: ['main'], tags: [] })).toEqual([
      { ref: 'main', label: 'main', description: 'branch' },
    ]);
  });

  it('returns [] when there is no git info', () => {
    expect(gitRefSuggestions({ branches: [], tags: [] })).toEqual([]);
  });
});

describe('currentRef', () => {
  it('prefers the current branch name', () => {
    expect(currentRef({ headBranch: 'feature/x', headSha: 'abcdef1234', branches: [], tags: [] })).toBe('feature/x');
  });
  it('falls back to the short HEAD SHA when detached', () => {
    expect(currentRef({ headSha: 'abcdef1234567', branches: [], tags: [] })).toBe('abcdef1');
  });
  it('returns null when there is no ref info', () => {
    expect(currentRef({ branches: [], tags: [] })).toBeNull();
  });
});

describe('gitRefSuggestions — remote branches and recent commits', () => {
  it('lists HEAD, local branches, remote branches, tags, then recent commits', () => {
    const out = gitRefSuggestions({
      headSha: 'abcdef1234567890',
      branches: ['main'],
      remoteBranches: ['origin/main'],
      tags: ['v1.0'],
      commits: [{ sha: '1234567', summary: 'fix things' }],
    });
    expect(out).toEqual([
      { ref: 'abcdef1', label: 'abcdef1', description: 'current commit (HEAD)' },
      { ref: 'main', label: 'main', description: 'branch' },
      { ref: 'origin/main', label: 'origin/main', description: 'remote branch' },
      { ref: 'v1.0', label: 'v1.0', description: 'tag' },
      { ref: '1234567', label: '1234567 — fix things', description: 'commit' },
    ]);
  });

  it('still works when the new optional fields are absent', () => {
    expect(gitRefSuggestions({ branches: ['main'], tags: [] })).toEqual([
      { ref: 'main', label: 'main', description: 'branch' },
    ]);
  });
});

import { readGitRefInfoFromFs } from './gitRefs';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = new TextEncoder();
const HEXA = 'a'.repeat(40);
const HEXB = 'b'.repeat(40);
const HEXC = 'c'.repeat(40);

async function seedGit(files: Record<string, string>): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    await fs.writeFile(path, enc.encode(content));
  }
  return fs;
}

describe('readGitRefInfoFromFs', () => {
  it('returns empty info when there is no .git/HEAD', async () => {
    expect(await readGitRefInfoFromFs(new MemoryFileSystem())).toEqual({ branches: [], tags: [] });
  });

  it('reads HEAD branch, loose + packed refs, and reflog commits', async () => {
    const fs = await seedGit({
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/refs/heads/main': `${HEXA}\n`,
      '.git/refs/heads/feature/x': `${HEXB}\n`,
      '.git/refs/remotes/origin/main': `${HEXA}\n`,
      '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/main\n',
      '.git/refs/tags/v1.0': `${HEXC}\n`,
      '.git/packed-refs': `# pack-refs with: peeled fully-peeled sorted \n${HEXC} refs/tags/v0.9\n`,
      '.git/logs/HEAD': `${'0'.repeat(40)} ${HEXA} Dev <d@e.f> 1 -0300\tcommit: hello world\n`,
    });
    const info = await readGitRefInfoFromFs(fs);
    expect(info.headBranch).toBe('main');
    expect(info.headSha).toBe(HEXA);
    expect(info.branches.sort()).toEqual(['feature/x', 'main']);
    expect(info.remoteBranches).toEqual(['origin/main']); // remote HEAD symref excluded
    expect((info.tags ?? []).sort()).toEqual(['v0.9', 'v1.0']); // packed + loose merged
    expect(info.commits).toEqual([{ sha: 'a'.repeat(7), summary: 'hello world' }]);
  });

  it('handles a detached HEAD (sha, no branch)', async () => {
    const info = await readGitRefInfoFromFs(await seedGit({ '.git/HEAD': `${HEXA}\n` }));
    expect(info.headBranch).toBeUndefined();
    expect(info.headSha).toBe(HEXA);
  });
});
