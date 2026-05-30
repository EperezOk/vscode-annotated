import { describe, it, expect } from 'vitest';
import { sha256Hex, anchorText } from './hash';

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is deterministic and content-sensitive', async () => {
    expect(await sha256Hex('hello')).toBe(await sha256Hex('hello'));
    expect(await sha256Hex('hello')).not.toBe(await sha256Hex('world'));
  });
});

describe('anchorText', () => {
  const file = 'l1\nl2\nl3\nl4\nl5';

  it('extracts an inclusive 1-based line range', () => {
    expect(anchorText(file, { startLine: 2, endLine: 4 })).toBe('l2\nl3\nl4');
  });

  it('extracts a single line', () => {
    expect(anchorText(file, { startLine: 3, endLine: 3 })).toBe('l3');
  });
});
