import { describe, it, expect } from 'vitest';
import { gitRefSuggestions } from './gitRefs';

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
