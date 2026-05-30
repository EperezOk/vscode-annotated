// Typed message contract between the extension host and webviews.
import { type AnnotationGroup } from './model';

/** A tag's display info sent to the webview (structurally matches core `Tag`). */
export interface TagColor {
  name: string;
  color: string;
}

/** Host → webview messages. */
export type HostToWebview = {
  type: 'setState';
  groups: AnnotationGroup[];
  palette: TagColor[];
};

/** Webview → host messages. */
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'selectGroup'; groupId: string };

/** Host → detail-panel messages. */
export type HostToDetail = {
  type: 'setGroup';
  group: AnnotationGroup | null;
  palette: TagColor[];
};

/** Detail-panel → host messages. */
export type DetailToHost =
  | { type: 'ready' }
  | { type: 'selectAnnotation'; annotationId: string }
  | { type: 'updateAnnotation'; annotationId: string; content: string }
  | { type: 'copyText'; text: string }
  | { type: 'setGroupTitle'; title: string }
  | { type: 'editTags' }
  | { type: 'editGitRef' };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Validate an untrusted webview→host message; returns it narrowed, or null. */
export function parseWebviewMessage(raw: unknown): WebviewToHost | null {
  if (!isObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'selectGroup':
      return typeof raw.groupId === 'string' ? { type: 'selectGroup', groupId: raw.groupId } : null;
    default:
      return null;
  }
}

/** Validate an untrusted detail→host message; returns it narrowed, or null. */
export function parseDetailMessage(raw: unknown): DetailToHost | null {
  if (!isObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'selectAnnotation':
      return typeof raw.annotationId === 'string' ? { type: 'selectAnnotation', annotationId: raw.annotationId } : null;
    case 'updateAnnotation':
      return typeof raw.annotationId === 'string' && typeof raw.content === 'string'
        ? { type: 'updateAnnotation', annotationId: raw.annotationId, content: raw.content }
        : null;
    case 'copyText':
      return typeof raw.text === 'string' ? { type: 'copyText', text: raw.text } : null;
    case 'setGroupTitle':
      return typeof raw.title === 'string' ? { type: 'setGroupTitle', title: raw.title } : null;
    case 'editTags':
      return { type: 'editTags' };
    case 'editGitRef':
      return { type: 'editGitRef' };
    default:
      return null;
  }
}
