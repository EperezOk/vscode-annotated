import { type AnnotationGroup } from '../shared/model';
import { type HostToWebview, type TagColor } from '../shared/protocol';

const DEFAULT_COLOR = '#888888';

export interface SidebarState {
  groups: AnnotationGroup[];
  palette: TagColor[];
  selectedId: string | null;
}

export function initialSidebarState(): SidebarState {
  return { groups: [], palette: [], selectedId: null };
}

/** Apply a host→webview message, returning a new state. */
export function applyHostMessage(state: SidebarState, message: HostToWebview): SidebarState {
  switch (message.type) {
    case 'setState': {
      const stillExists = state.selectedId !== null && message.groups.some((g) => g.id === state.selectedId);
      return {
        groups: message.groups,
        palette: message.palette,
        selectedId: stillExists ? state.selectedId : null,
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
