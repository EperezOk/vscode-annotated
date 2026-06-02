import { describe, it, expect } from 'vitest';
import { jsonTagColors, resolveTagColor, resolveDisplayPalette, missingWorkspaceTags } from './tagResolve';
import { type AnnotationGroup } from '../shared/model';

function group(tags: { name: string; color: string }[]): AnnotationGroup {
  return { id: 'g', title: 'G', author: 'A', tags, gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('jsonTagColors', () => {
  it('takes the first-seen color per tag name across groups', () => {
    const m = jsonTagColors([group([{ name: 'sec', color: '#111' }]), group([{ name: 'sec', color: '#999' }, { name: 'perf', color: '#222' }])]);
    expect(m.get('sec')).toBe('#111');
    expect(m.get('perf')).toBe('#222');
  });
});

describe('resolveTagColor', () => {
  const sources = {
    local: [{ name: 'a', color: '#local' }],
    global: [{ name: 'a', color: '#global' }, { name: 'b', color: '#global-b' }],
    json: new Map([['a', '#json'], ['c', '#json-c']]),
  };
  it('prefers local, then global, then JSON, then default', () => {
    expect(resolveTagColor('a', sources)).toBe('#local');   // local wins
    expect(resolveTagColor('b', sources)).toBe('#global-b'); // only in global
    expect(resolveTagColor('c', sources)).toBe('#json-c');   // only in JSON
    expect(resolveTagColor('z', sources)).toBe('#888888');   // nowhere → default
  });
});

describe('resolveDisplayPalette', () => {
  it('unions all tag names (config ∪ groups), sorted, each color resolved by precedence', () => {
    const palette = resolveDisplayPalette(
      [{ name: 'a', color: '#local' }],
      [{ name: 'b', color: '#global' }],
      [group([{ name: 'a', color: '#json-a' }, { name: 'c', color: '#json-c' }])],
    );
    expect(palette).toEqual([
      { name: 'a', color: '#local' },   // local beats JSON
      { name: 'b', color: '#global' },
      { name: 'c', color: '#json-c' },
    ]);
  });
});

describe('missingWorkspaceTags', () => {
  it('returns group tags absent from both configs, deduped, with their JSON color', () => {
    const missing = missingWorkspaceTags(
      [{ name: 'a', color: '#l' }],
      [{ name: 'b', color: '#g' }],
      [group([{ name: 'a', color: '#ja' }, { name: 'c', color: '#jc' }]), group([{ name: 'c', color: '#jc2' }, { name: 'd', color: '#jd' }])],
    );
    expect(missing).toEqual([
      { name: 'c', color: '#jc' }, // first-seen color, only once
      { name: 'd', color: '#jd' },
    ]);
  });
});
