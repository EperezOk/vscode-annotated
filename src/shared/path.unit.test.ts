import { describe, it, expect } from 'vitest';
import { fileName } from './path';
import { safeRelativeSegments } from './path';

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
