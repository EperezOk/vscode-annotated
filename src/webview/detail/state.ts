import { writable } from 'svelte/store';
import { initialDetailState, applyDetailMessage, openAnnotation as openAnnotationState, backToGroup as backToGroupState, type DetailState } from '../../core/detailState';
import { type HostToDetail } from '../../shared/protocol';
import { postToHost } from './vscodeApi';

export const detail = writable<DetailState>(initialDetailState());

/** Apply a host message to the store. */
export function handleHostMessage(message: HostToDetail): void {
  detail.update((state) => applyDetailMessage(state, message));
}

/** Record the locally-selected annotation. */
export function setSelectedAnnotation(id: string): void {
  detail.update((state) => ({ ...state, selectedAnnotationId: id }));
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
