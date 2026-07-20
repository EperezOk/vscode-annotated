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
