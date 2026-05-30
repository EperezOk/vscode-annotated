import { writable } from 'svelte/store';
import { initialDetailState, applyDetailMessage, type DetailState } from '../../core/detailState';
import { type HostToDetail } from '../../shared/protocol';

export const detail = writable<DetailState>(initialDetailState());

/** Apply a host message to the store. */
export function handleHostMessage(message: HostToDetail): void {
  detail.update((state) => applyDetailMessage(state, message));
}

/** Record the locally-selected annotation. */
export function setSelectedAnnotation(id: string): void {
  detail.update((state) => ({ ...state, selectedAnnotationId: id }));
}
