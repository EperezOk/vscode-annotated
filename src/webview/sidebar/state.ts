import { writable } from 'svelte/store';
import { initialSidebarState, applyHostMessage, toggleInList, type SidebarState } from '../../core/sidebarState';
import { type HostToWebview } from '../../shared/protocol';
import { postToHost } from './vscodeApi';

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

/** Toggle a git ref in the active git-ref filter. */
export function toggleGitRefFilter(ref: string): void {
  sidebar.update((state) => ({ ...state, selectedGitRefs: toggleInList(state.selectedGitRefs, ref) }));
}

/** Show or hide resolved groups. */
export function setShowResolved(value: boolean): void {
  sidebar.update((state) => ({ ...state, showResolved: value }));
}

/** Enter/exit bulk-select mode (clears the selection on toggle). */
export function toggleBulkMode(): void {
  sidebar.update((state) => ({ ...state, bulkMode: !state.bulkMode, selectedGroupIds: [] }));
}

/** Toggle a group in the bulk selection. */
export function toggleGroupSelection(groupId: string): void {
  sidebar.update((state) => ({ ...state, selectedGroupIds: toggleInList(state.selectedGroupIds, groupId) }));
}

/** Bulk-action intents (host runs any native UI + applies to all selected). */
export function bulkEditTags(groupIds: string[]): void {
  postToHost({ type: 'bulkEditTags', groupIds });
}
export function bulkEditGitRef(groupIds: string[]): void {
  postToHost({ type: 'bulkEditGitRef', groupIds });
}
export function bulkResolveRestore(groupIds: string[]): void {
  postToHost({ type: 'bulkResolveRestore', groupIds });
}
export function bulkDelete(groupIds: string[]): void {
  postToHost({ type: 'bulkDelete', groupIds });
}
