import { writable } from 'svelte/store';
import { initialSidebarState, applyHostMessage, type SidebarState } from '../../core/sidebarState';
import { type HostToWebview } from '../../shared/protocol';

export const sidebar = writable<SidebarState>(initialSidebarState());

/** Apply a host message to the store. */
export function handleHostMessage(message: HostToWebview): void {
  sidebar.update((state) => applyHostMessage(state, message));
}

/** Record the locally-selected group. */
export function setSelected(id: string): void {
  sidebar.update((state) => ({ ...state, selectedId: id }));
}
