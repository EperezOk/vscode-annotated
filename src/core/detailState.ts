import { type AnnotationGroup } from '../shared/model';
import { type HostToDetail, type TagColor } from '../shared/protocol';

export interface DetailState {
  group: AnnotationGroup | null;
  palette: TagColor[];
  selectedAnnotationId: string | null;
  mode: 'group' | 'annotation';
  staleIds: string[];
}

export function initialDetailState(): DetailState {
  return { group: null, palette: [], selectedAnnotationId: null, mode: 'group', staleIds: [] };
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
      };
    }
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
