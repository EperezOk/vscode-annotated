import { describe, it, expect } from 'vitest';
import { parseGitConfigIdentity, readGitIdentityFromFs } from './gitConfig';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = new TextEncoder();

describe('parseGitConfigIdentity', () => {
  it('reads name and email from the [user] section', () => {
    const config = `[core]
\tbare = false
[user]
\tname = Ada Lovelace
\temail = ada@example.com
[remote "origin"]
\turl = https://example.com/repo.git
`;
    expect(parseGitConfigIdentity(config)).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  it('is case-insensitive on the section name and strips surrounding quotes', () => {
    const config = `[USER]
\tname = "Grace Hopper"
\temail = grace@example.com
`;
    expect(parseGitConfigIdentity(config)).toEqual({ name: 'Grace Hopper', email: 'grace@example.com' });
  });

  it('ignores keys outside [user] and comment lines', () => {
    const config = `; a comment
[core]
\tname = not-a-user-name
[user]
\t# inline note
\tname = Alan Turing
`;
    expect(parseGitConfigIdentity(config)).toEqual({ name: 'Alan Turing' });
  });

  it('returns {} when there is no [user] section', () => {
    expect(parseGitConfigIdentity('[core]\n\tbare = false\n')).toEqual({});
  });

  it('keeps the first value when a key is repeated', () => {
    expect(parseGitConfigIdentity('[user]\n\tname = First\n\tname = Second\n')).toEqual({ name: 'First' });
  });
});

describe('readGitIdentityFromFs', () => {
  it('reads and parses .git/config', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('.git/config', enc.encode('[user]\n\tname = Ada\n\temail = ada@example.com\n'));
    expect(await readGitIdentityFromFs(fs)).toEqual({ name: 'Ada', email: 'ada@example.com' });
  });

  it('returns {} when .git/config is missing', async () => {
    expect(await readGitIdentityFromFs(new MemoryFileSystem())).toEqual({});
  });
});
