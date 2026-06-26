import { describe, it, expect } from 'vitest';
import { slugify, slugifyTitle } from './slug';

describe('slugify', () => {
  it('lowercases and collapses non-alphanumeric runs to single dashes', () => {
    expect(slugify('Hello, World!!', { fallback: 'x' })).toBe('hello-world');
  });
  it('strips leading and trailing dashes', () => {
    expect(slugify('  --Hi--  ', { fallback: 'x' })).toBe('hi');
  });
  it('falls back when the result is empty', () => {
    expect(slugify('', { fallback: 'anon' })).toBe('anon');
    expect(slugify('@@@', { fallback: 'anon' })).toBe('anon');
  });
  it('caps to max and strips a trailing dash left by the cut', () => {
    expect(slugify('abcdefghij', { fallback: 'x', max: 5 })).toBe('abcde');
    expect(slugify('ab cd ef', { fallback: 'x', max: 3 })).toBe('ab'); // 'ab-' -> 'ab'
  });
});

describe('slugifyTitle', () => {
  it('uses untitled as the fallback', () => {
    expect(slugifyTitle('')).toBe('untitled');
    expect(slugifyTitle('###')).toBe('untitled');
  });
  it('caps at 40 characters', () => {
    expect(slugifyTitle('a'.repeat(50))).toBe('a'.repeat(40));
  });
  it('slugifies a normal title', () => {
    expect(slugifyTitle('Misleading docs')).toBe('misleading-docs');
  });
});
