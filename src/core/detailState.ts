import { type AnnotationGroup, type ThreadComment } from '../shared/model';
import { type HostToDetail, type TagColor } from '../shared/protocol';

export interface DetailState {
  group: AnnotationGroup | null;
  palette: TagColor[];
  selectedAnnotationId: string | null;
  mode: 'group' | 'annotation';
  staleIds: string[];
  comments: ThreadComment[];
  currentAuthor: string;
}

export function initialDetailState(): DetailState {
  return { group: null, palette: [], selectedAnnotationId: null, mode: 'group', staleIds: [], comments: [], currentAuthor: '' };
}

/** Apply a host→detail message, returning a new state. */
export function applyDetailMessage(state: DetailState, message: HostToDetail): DetailState {
  switch (message.type) {
    case 'setGroup': {
      const keep =
        state.mode === 'annotation' &&
        state.selectedAnnotationId !== null &&
        (message.group?.annotations.some((a) => a.id === state.selectedAnnotationId) ?? false);
      return {
        group: message.group,
        palette: message.palette,
        selectedAnnotationId: keep ? state.selectedAnnotationId : null,
        mode: keep ? 'annotation' : 'group',
        staleIds: message.staleIds ?? [],
        comments: message.comments ?? [],
        currentAuthor: message.currentAuthor ?? '',
      };
    }
    case 'openAnnotation':
      return openAnnotation(state, message.annotationId);
    default:
      return state;
  }
}

/** Whether the annotation `id` is flagged stale in this state. */
export function isStale(state: DetailState, id: string): boolean {
  return state.staleIds.includes(id);
}

/** Open the annotation view for `id`. */
export function openAnnotation(state: DetailState, id: string): DetailState {
  return { ...state, mode: 'annotation', selectedAnnotationId: id };
}

/** Return to the group view. */
export function backToGroup(state: DetailState): DetailState {
  return { ...state, mode: 'group', selectedAnnotationId: null };
}

/** First non-empty line of `content`, trimmed, truncated to `max` chars with an ellipsis. */
export function oneLine(content: string, max = 60): string {
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

/** Reorder ids by removing `moved` and inserting it immediately before `target`. */
export function moveBefore(ids: string[], moved: string, target: string): string[] {
  if (moved === target) {
    return [...ids];
  }
  const without = ids.filter((id) => id !== moved);
  const index = without.indexOf(target);
  if (index < 0) {
    return [...without, moved];
  }
  return [...without.slice(0, index), moved, ...without.slice(index)];
}

/** Index of the selected annotation in the group, or -1. */
export function selectedAnnotationIndex(state: DetailState): number {
  if (!state.group || state.selectedAnnotationId === null) {
    return -1;
  }
  return state.group.annotations.findIndex((a) => a.id === state.selectedAnnotationId);
}

/** Id of the annotation after the selected one, or null at the end. */
export function nextAnnotationId(state: DetailState): string | null {
  const index = selectedAnnotationIndex(state);
  if (index < 0 || !state.group) {
    return null;
  }
  const next = state.group.annotations[index + 1];
  return next ? next.id : null;
}

/** Id of the annotation before the selected one, or null at the start. */
export function prevAnnotationId(state: DetailState): string | null {
  const index = selectedAnnotationIndex(state);
  if (index <= 0 || !state.group) {
    return null;
  }
  return state.group.annotations[index - 1].id;
}

/** 1-based position of the selected annotation + the group total, or null. */
export function annotationPosition(state: DetailState): { current: number; total: number } | null {
  const index = selectedAnnotationIndex(state);
  if (index < 0 || !state.group) {
    return null;
  }
  return { current: index + 1, total: state.group.annotations.length };
}

/** Comments belonging to one annotation (already timestamp-sorted by the host). */
export function commentsFor(state: DetailState, annotationId: string): ThreadComment[] {
  return (state.comments ?? []).filter((c) => c.annotationId === annotationId);
}
