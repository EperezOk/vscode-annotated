import { type AnnotationGroup } from '../shared/model';
import { type HostToDetail, type TagColor } from '../shared/protocol';

export interface DetailState {
  group: AnnotationGroup | null;
  palette: TagColor[];
  selectedAnnotationId: string | null;
}

export function initialDetailState(): DetailState {
  return { group: null, palette: [], selectedAnnotationId: null };
}

/** Apply a host→detail message, returning a new state. */
export function applyDetailMessage(state: DetailState, message: HostToDetail): DetailState {
  switch (message.type) {
    case 'setGroup':
      return { group: message.group, palette: message.palette, selectedAnnotationId: null };
    default:
      return state;
  }
}

/** First non-empty line of `content`, trimmed, truncated to `max` chars with an ellipsis. */
export function oneLine(content: string, max = 60): string {
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}
