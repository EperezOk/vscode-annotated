import { type AnnotationGroup, type GroupStatus } from '../shared/model';
import { type HostToWebview, type TagColor } from '../shared/protocol';

const DEFAULT_COLOR = '#888888';

export interface SidebarState {
  groups: AnnotationGroup[];
  palette: TagColor[];
  selectedId: string | null;
  selectedTags: string[];
  selectedAuthors: string[];
  showResolved: boolean;
  bulkMode: boolean;
  selectedGroupIds: string[];
}

export function initialSidebarState(): SidebarState {
  return { groups: [], palette: [], selectedId: null, selectedTags: [], selectedAuthors: [], showResolved: false, bulkMode: false, selectedGroupIds: [] };
}

/** Apply a host→webview message, returning a new state. */
export function applyHostMessage(state: SidebarState, message: HostToWebview): SidebarState {
  switch (message.type) {
    case 'setState': {
      const stillExists = state.selectedId !== null && message.groups.some((g) => g.id === state.selectedId);
      const tags = new Set(message.groups.flatMap((g) => g.tags));
      const authors = new Set(message.groups.map((g) => g.author));
      return {
        groups: message.groups,
        palette: message.palette,
        selectedId: stillExists ? state.selectedId : null,
        selectedTags: state.selectedTags.filter((t) => tags.has(t)),
        selectedAuthors: state.selectedAuthors.filter((a) => authors.has(a)),
        showResolved: state.showResolved,
        bulkMode: state.bulkMode,
        selectedGroupIds: state.selectedGroupIds.filter((id) => message.groups.some((g) => g.id === id)),
      };
    }
    default:
      return state;
  }
}

/** Resolve a tag name to its palette color, or a neutral default. */
export function tagColor(palette: TagColor[], name: string): string {
  return palette.find((t) => t.name === name)?.color ?? DEFAULT_COLOR;
}

/** Sorted, de-duplicated tag names across all groups (filter options). */
export function availableTags(groups: AnnotationGroup[]): string[] {
  return [...new Set(groups.flatMap((g) => g.tags))].sort();
}

/** Sorted, de-duplicated author names across all groups (filter options). */
export function availableAuthors(groups: AnnotationGroup[]): string[] {
  return [...new Set(groups.map((g) => g.author))].sort();
}

/** Toggle a value's membership in a list (immutable). */
export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * The groups to display given the current filters:
 * - resolved groups are hidden unless `showResolved`;
 * - if any tags are selected, keep groups with ANY of them;
 * - if any authors are selected, keep groups whose author is selected.
 */
export function filterGroups(state: SidebarState): AnnotationGroup[] {
  return state.groups.filter((g) => {
    if (g.status === 'resolved' && !state.showResolved) {
      return false;
    }
    if (state.selectedTags.length > 0 && !g.tags.some((t) => state.selectedTags.includes(t))) {
      return false;
    }
    if (state.selectedAuthors.length > 0 && !state.selectedAuthors.includes(g.author)) {
      return false;
    }
    return true;
  });
}

/** The status to apply when bulk-toggling: all-open → resolved, all-resolved → open, mixed/empty → resolved. */
export function bulkStatusToggle(groups: AnnotationGroup[]): GroupStatus {
  return groups.length > 0 && groups.every((g) => g.status === 'resolved') ? 'open' : 'resolved';
}
