import { writable } from 'svelte/store';
import { initialDetailState, applyDetailMessage, openAnnotation as openAnnotationState, backToGroup as backToGroupState, type DetailState } from '../../core/detailState';
import { type HostToDetail } from '../../shared/protocol';
import { postToHost } from './vscodeApi';

export const detail = writable<DetailState>(initialDetailState());

/** Apply a host message to the store. */
export function handleHostMessage(message: HostToDetail): void {
  detail.update((state) => applyDetailMessage(state, message));
}

/** Switch the panel to the annotation view for `id`. */
export function openAnnotationView(id: string): void {
  detail.update((state) => openAnnotationState(state, id));
}

/** Return to the group view. */
export function showGroupView(): void {
  detail.update((state) => backToGroupState(state));
}

/** Persist an annotation's content (host saves + re-posts the group). */
export function saveAnnotationContent(annotationId: string, content: string): void {
  postToHost({ type: 'updateAnnotation', annotationId, content });
}

/** Ask the host to copy text to the clipboard. */
export function copyToClipboard(text: string): void {
  postToHost({ type: 'copyText', text });
}

/** Rename the active group. */
export function renameGroup(title: string): void {
  postToHost({ type: 'setGroupTitle', title });
}

/** Ask the host to edit the active group's tags (native picker). */
export function requestEditTags(): void {
  postToHost({ type: 'editTags' });
}

/** Ask the host to edit the active group's Git ref (native picker). */
export function requestEditGitRef(): void {
  postToHost({ type: 'editGitRef' });
}

/** Persist an annotation's edited line range (host recomputes the hash). */
export function saveAnnotationRange(annotationId: string, startLine: number, endLine: number): void {
  postToHost({ type: 'updateAnnotationRange', annotationId, startLine, endLine });
}

/** Persist a new annotation order (host validates it is a permutation). */
export function reorderAnnotations(annotationIds: string[]): void {
  postToHost({ type: 'reorderAnnotations', annotationIds });
}

/** Set the current group's status (open/resolved). */
export function setGroupStatus(status: 'open' | 'resolved'): void {
  postToHost({ type: 'updateGroupStatus', status });
}

/** Add a comment to the given annotation (host attributes + persists). */
export function addComment(annotationId: string, content: string): void {
  postToHost({ type: 'addComment', annotationId, content });
}

/** Edit one of the current user's own comments. */
export function editComment(commentId: string, content: string): void {
  postToHost({ type: 'editComment', commentId, content });
}

/** Delete one of the current user's own comments. */
export function deleteComment(commentId: string): void {
  postToHost({ type: 'deleteComment', commentId });
}
