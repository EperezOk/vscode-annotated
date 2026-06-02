import { describe, it, expect } from 'vitest';
import { fileName } from './path';

describe('fileName', () => {
  it('returns the last segment of a POSIX path', () => {
    expect(fileName('src/auth/login.ts')).toBe('login.ts');
    expect(fileName('src/base/Nonce.sol')).toBe('Nonce.sol');
  });
  it('returns the input unchanged when there is no slash', () => {
    expect(fileName('file.ts')).toBe('file.ts');
  });
});
