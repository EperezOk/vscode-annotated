import { describe, it, expect } from 'vitest';
import { isAnnotationStale } from './drift';
import { sha256Hex, anchorText } from '../shared/hash';

const file = 'l1\nl2\nl3\nl4\nl5';

describe('isAnnotationStale', () => {
  it('is false when the anchored lines still match the stored hash', async () => {
    const hash = await sha256Hex(anchorText(file, { startLine: 2, endLine: 3 }));
    expect(await isAnnotationStale(file, { startLine: 2, endLine: 3 }, hash)).toBe(false);
  });

  it('is true when the anchored lines changed', async () => {
    const hash = await sha256Hex(anchorText(file, { startLine: 2, endLine: 3 }));
    const edited = 'l1\nCHANGED\nl3\nl4\nl5';
    expect(await isAnnotationStale(edited, { startLine: 2, endLine: 3 }, hash)).toBe(true);
  });
});
