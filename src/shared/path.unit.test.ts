import { describe, it, expect } from 'vitest';
import { fileName } from './path';
import { safeRelativeSegments } from './path';
import { toWorkspaceRelativeSegments } from './path';

describe('fileName', () => {
  it('returns the last segment of a POSIX path', () => {
    expect(fileName('src/auth/login.ts')).toBe('login.ts');
    expect(fileName('src/base/Nonce.sol')).toBe('Nonce.sol');
  });
  it('returns the input unchanged when there is no slash', () => {
    expect(fileName('file.ts')).toBe('file.ts');
  });
});

describe('safeRelativeSegments', () => {
  it('splits a relative POSIX path into segments', () => {
    expect(safeRelativeSegments('src/core/foo.ts')).toEqual(['src', 'core', 'foo.ts']);
  });
  it('drops "." and empty segments', () => {
    expect(safeRelativeSegments('./src//foo.ts')).toEqual(['src', 'foo.ts']);
  });
  it('returns null for an absolute or Windows-drive path', () => {
    expect(safeRelativeSegments('/etc/passwd')).toBeNull();
    expect(safeRelativeSegments('C:/x.ts')).toBeNull();
  });
  it('returns null when any segment is ".." (escape)', () => {
    expect(safeRelativeSegments('../secrets.ts')).toBeNull();
    expect(safeRelativeSegments('src/../../x.ts')).toBeNull();
  });
});

describe('toWorkspaceRelativeSegments', () => {
  it('splits a relative path just like safeRelativeSegments', () => {
    expect(toWorkspaceRelativeSegments('src/core/foo.ts', '/ws')).toEqual(['src', 'core', 'foo.ts']);
  });
  it('strips the workspace root from an absolute path inside it', () => {
    expect(toWorkspaceRelativeSegments('/ws/src/foo.ts', '/ws')).toEqual(['src', 'foo.ts']);
  });
  it('tolerates a trailing slash on the workspace root', () => {
    expect(toWorkspaceRelativeSegments('/ws/src/foo.ts', '/ws/')).toEqual(['src', 'foo.ts']);
  });
  it('normalizes backslashes before matching', () => {
    expect(toWorkspaceRelativeSegments('\\ws\\src\\foo.ts', '/ws')).toEqual(['src', 'foo.ts']);
  });
  it('returns null for an absolute path outside the workspace', () => {
    expect(toWorkspaceRelativeSegments('/other/foo.ts', '/ws')).toBeNull();
  });
  it('returns null for an absolute path when no workspace root is given', () => {
    expect(toWorkspaceRelativeSegments('/etc/passwd')).toBeNull();
  });
  it('returns null when an absolute path resolves to a "../" escape', () => {
    expect(toWorkspaceRelativeSegments('/ws/../etc/passwd', '/ws')).toBeNull();
  });
  it('returns null for a relative "../" escape', () => {
    expect(toWorkspaceRelativeSegments('../secrets.ts', '/ws')).toBeNull();
  });
});
