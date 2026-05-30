import { writable } from 'svelte/store';
import { initialSidebarState, applyHostMessage, toggleInList, type SidebarState } from '../../core/sidebarState';
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

/** Toggle a tag in the active tag filter. */
export function toggleTagFilter(tag: string): void {
  sidebar.update((state) => ({ ...state, selectedTags: toggleInList(state.selectedTags, tag) }));
}

/** Toggle an author in the active author filter. */
export function toggleAuthorFilter(author: string): void {
  sidebar.update((state) => ({ ...state, selectedAuthors: toggleInList(state.selectedAuthors, author) }));
}

/** Show or hide resolved groups. */
export function setShowResolved(value: boolean): void {
  sidebar.update((state) => ({ ...state, showResolved: value }));
}
