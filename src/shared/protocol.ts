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
