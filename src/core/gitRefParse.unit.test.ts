import { describe, it, expect } from 'vitest';
import { parseHead, parsePackedRefs, classifyRef, parseReflog } from './gitRefParse';

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

describe('parseHead', () => {
  it('reads a symbolic ref to a branch (including nested names)', () => {
    expect(parseHead('ref: refs/heads/main\n')).toEqual({ branch: 'main' });
    expect(parseHead('ref: refs/heads/feature/x\n')).toEqual({ branch: 'feature/x' });
  });
  it('reads a detached HEAD sha', () => {
    expect(parseHead(`${SHA}\n`)).toEqual({ sha: SHA });
  });
  it('returns {} for anything else', () => {
    expect(parseHead('ref: refs/tags/v1\n')).toEqual({});
    expect(parseHead('garbage')).toEqual({});
  });
});

describe('parsePackedRefs', () => {
  it('parses ref lines and skips the header and peeled lines', () => {
    const content = `# pack-refs with: peeled fully-peeled sorted \n${SHA} refs/heads/main\n${SHA2} refs/tags/v1.0\n^${SHA}\n`;
    expect(parsePackedRefs(content)).toEqual([
      { ref: 'refs/heads/main', sha: SHA },
      { ref: 'refs/tags/v1.0', sha: SHA2 },
    ]);
  });
  it('ignores malformed lines', () => {
    expect(parsePackedRefs('nope\n\n')).toEqual([]);
  });
});

describe('classifyRef', () => {
  it('classifies and strips the prefix', () => {
    expect(classifyRef('refs/heads/feature/x')).toEqual({ kind: 'branch', name: 'feature/x' });
    expect(classifyRef('refs/remotes/origin/main')).toEqual({ kind: 'remote', name: 'origin/main' });
    expect(classifyRef('refs/tags/v1.0')).toEqual({ kind: 'tag', name: 'v1.0' });
    expect(classifyRef('refs/stash')).toEqual({ kind: 'other', name: 'refs/stash' });
  });
});

describe('parseReflog', () => {
  it('returns commit-ish entries newest first, deduped, capped', () => {
    const line = (newSha: string, msg: string) =>
      `${SHA} ${newSha} Dev <d@e.f> 1700000000 -0300\t${msg}`;
    const content = [
      line('1'.repeat(40), 'commit: first'),
      line('2'.repeat(40), 'checkout: moving from a to b'), // dropped (not commit-ish)
      line('3'.repeat(40), 'commit: second'),
      line('3'.repeat(40), 'commit (amend): second again'), // dedup by short sha
    ].join('\n');
    expect(parseReflog(content, 10)).toEqual([
      { sha: '3'.repeat(7), summary: 'second' },
      { sha: '1'.repeat(7), summary: 'first' },
    ]);
  });
  it('respects the max cap', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      `${SHA} ${String(i).repeat(40)} Dev <d@e.f> 1 -0300\tcommit: c${i}`).join('\n');
    expect(parseReflog(many, 2)).toHaveLength(2);
  });
});
