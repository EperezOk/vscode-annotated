import { describe, it, expect } from 'vitest';
import { paletteHasName, renameInConfig, recolorInConfig, deleteFromConfig } from './tagAdmin';

describe('paletteHasName', () => {
  it('matches by exact name', () => {
    const arr = [{ name: 'bug', color: '#111' }];
    expect(paletteHasName(arr, 'bug')).toBe(true);
    expect(paletteHasName(arr, 'Bug')).toBe(false);
    expect(paletteHasName(arr, 'perf')).toBe(false);
  });
});

describe('renameInConfig', () => {
  it('renames a matching entry, preserving its color; no-op if absent', () => {
    const arr = [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }];
    expect(renameInConfig(arr, 'bug', 'defect')).toEqual([
      { name: 'defect', color: '#111' },
      { name: 'perf', color: '#222' },
    ]);
    expect(renameInConfig(arr, 'absent', 'x')).toEqual(arr);
  });
});

describe('recolorInConfig', () => {
  it('updates a matching entry color; no-op if absent (does not add)', () => {
    const arr = [{ name: 'bug', color: '#111' }];
    expect(recolorInConfig(arr, 'bug', '#999')).toEqual([{ name: 'bug', color: '#999' }]);
    expect(recolorInConfig(arr, 'perf', '#999')).toEqual(arr);
  });
});

describe('deleteFromConfig', () => {
  it('removes a matching entry; no-op if absent', () => {
    const arr = [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }];
    expect(deleteFromConfig(arr, 'bug')).toEqual([{ name: 'perf', color: '#222' }]);
    expect(deleteFromConfig(arr, 'absent')).toEqual(arr);
  });
});
