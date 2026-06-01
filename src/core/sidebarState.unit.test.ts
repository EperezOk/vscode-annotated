import { describe, it, expect } from 'vitest';
import { initialSidebarState, applyHostMessage, tagColor, filterGroups, availableTags, availableAuthors, toggleInList, bulkStatusToggle, filterOptions } from './sidebarState';
import { type AnnotationGroup } from '../shared/model';

function group(
  id: string,
  opts: { author?: string; tags?: string[]; status?: 'open' | 'resolved' } = {},
): AnnotationGroup {
  return {
    id, title: id, author: opts.author ?? 'A', tags: opts.tags ?? [],
    gitRef: null, status: opts.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: [],
  };
}

describe('initialSidebarState', () => {
  it('is empty with no selection and no filters', () => {
    expect(initialSidebarState()).toEqual({
      groups: [], palette: [], selectedId: null,
      selectedTags: [], selectedAuthors: [], showResolved: false,
      bulkMode: false, selectedGroupIds: [],
    });
  });
});

describe('applyHostMessage', () => {
  it('setState replaces groups and palette', () => {
    const next = applyHostMessage(initialSidebarState(), {
      type: 'setState',
      groups: [group('g1')],
      palette: [{ name: 'security', color: '#c0392b' }],
    });
    expect(next.groups.map((g) => g.id)).toEqual(['g1']);
    expect(next.palette).toEqual([{ name: 'security', color: '#c0392b' }]);
  });

  it('preserves the selection when the selected group still exists', () => {
    const state = { ...initialSidebarState(), selectedId: 'g1' };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g1'), group('g2')], palette: [] });
    expect(next.selectedId).toBe('g1');
  });

  it('clears the selection when the selected group is gone', () => {
    const state = { ...initialSidebarState(), selectedId: 'g1' };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g2')], palette: [] });
    expect(next.selectedId).toBeNull();
  });
});

describe('tagColor', () => {
  it('resolves a known tag color', () => {
    expect(tagColor([{ name: 'todo', color: '#f39c12' }], 'todo')).toBe('#f39c12');
  });

  it('falls back to a neutral default for unknown tags', () => {
    expect(tagColor([], 'unknown')).toBe('#888888');
  });
});

describe('availableTags / availableAuthors', () => {
  it('returns sorted, de-duplicated tags across all groups', () => {
    const groups = [group('g1', { tags: ['security', 'todo'] }), group('g2', { tags: ['todo', 'arch'] })];
    expect(availableTags(groups)).toEqual(['arch', 'security', 'todo']);
  });
  it('returns sorted, de-duplicated authors', () => {
    const groups = [group('g1', { author: 'Zoe' }), group('g2', { author: 'Ana' }), group('g3', { author: 'Zoe' })];
    expect(availableAuthors(groups)).toEqual(['Ana', 'Zoe']);
  });
});

describe('toggleInList', () => {
  it('adds a value that is absent', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b']);
  });
  it('removes a value that is present', () => {
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('filterGroups', () => {
  const base = initialSidebarState();
  const groups = [
    group('open-sec', { author: 'Ana', tags: ['security'], status: 'open' }),
    group('open-todo', { author: 'Zoe', tags: ['todo'], status: 'open' }),
    group('res-sec', { author: 'Ana', tags: ['security'], status: 'resolved' }),
  ];

  it('hides resolved groups by default', () => {
    expect(filterGroups({ ...base, groups }).map((g) => g.id)).toEqual(['open-sec', 'open-todo']);
  });
  it('includes resolved groups when showResolved is true', () => {
    expect(filterGroups({ ...base, groups, showResolved: true }).map((g) => g.id)).toEqual(
      ['open-sec', 'open-todo', 'res-sec'],
    );
  });
  it('OR-matches selected tags (and still hides resolved by default)', () => {
    expect(filterGroups({ ...base, groups, selectedTags: ['security'] }).map((g) => g.id)).toEqual(['open-sec']);
  });
  it('OR-matches selected authors', () => {
    expect(filterGroups({ ...base, groups, selectedAuthors: ['Zoe'] }).map((g) => g.id)).toEqual(['open-todo']);
  });
  it('ANDs the tag and author facets together', () => {
    expect(
      filterGroups({ ...base, groups, selectedTags: ['security'], selectedAuthors: ['Zoe'] }).map((g) => g.id),
    ).toEqual([]);
  });
  it('combines showResolved with a tag filter', () => {
    expect(
      filterGroups({ ...base, groups, selectedTags: ['security'], showResolved: true }).map((g) => g.id),
    ).toEqual(['open-sec', 'res-sec']);
  });
});

describe('applyHostMessage preserves + prunes filters', () => {
  it('keeps showResolved and prunes selected tags/authors no longer present', () => {
    const state = {
      ...initialSidebarState(),
      selectedTags: ['security', 'gone'],
      selectedAuthors: ['Ana', 'ghost'],
      showResolved: true,
    };
    const next = applyHostMessage(state, {
      type: 'setState',
      groups: [group('g1', { author: 'Ana', tags: ['security'] })],
      palette: [],
    });
    expect(next.selectedTags).toEqual(['security']);
    expect(next.selectedAuthors).toEqual(['Ana']);
    expect(next.showResolved).toBe(true);
  });
});

describe('bulk-select state', () => {
  it('initial state is not in bulk mode with no selection', () => {
    expect(initialSidebarState().bulkMode).toBe(false);
    expect(initialSidebarState().selectedGroupIds).toEqual([]);
  });
  it('setState preserves bulkMode and prunes selectedGroupIds to present groups', () => {
    const state = { ...initialSidebarState(), bulkMode: true, selectedGroupIds: ['g1', 'gone'] };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g1')], palette: [] });
    expect(next.bulkMode).toBe(true);
    expect(next.selectedGroupIds).toEqual(['g1']);
  });
});

describe('bulkStatusToggle', () => {
  it('all open → resolved', () => {
    expect(bulkStatusToggle([group('a'), group('b')])).toBe('resolved');
  });
  it('all resolved → open', () => {
    expect(bulkStatusToggle([group('a', { status: 'resolved' }), group('b', { status: 'resolved' })])).toBe('open');
  });
  it('mixed → resolved', () => {
    expect(bulkStatusToggle([group('a'), group('b', { status: 'resolved' })])).toBe('resolved');
  });
  it('empty → resolved', () => {
    expect(bulkStatusToggle([])).toBe('resolved');
  });
});

describe('filterOptions', () => {
  const all = ['security', 'todo', 'perf', 'bug'];

  it('returns all unselected options for an empty query', () => {
    expect(filterOptions(all, ['todo'], '')).toEqual({ visible: ['security', 'perf', 'bug'], more: 0 });
  });

  it('filters by case-insensitive substring', () => {
    expect(filterOptions(all, [], 'E')).toEqual({ visible: ['security', 'perf'], more: 0 });
  });

  it('excludes already-selected options', () => {
    expect(filterOptions(all, ['security'], 'se')).toEqual({ visible: [], more: 0 });
  });

  it('caps the list and reports how many more matched', () => {
    const many = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const result = filterOptions(many, [], '', 50);
    expect(result.visible).toHaveLength(50);
    expect(result.more).toBe(10);
  });
});
