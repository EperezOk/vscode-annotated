// Typed message contract between the extension host and webviews.
import { type AnnotationGroup, type GroupStatus, type ThreadComment } from './model';

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
  | { type: 'refresh' }
  | { type: 'selectGroup'; groupId: string }
  | { type: 'bulkEditTags'; groupIds: string[] }
  | { type: 'bulkEditGitRef'; groupIds: string[] }
  | { type: 'bulkResolveRestore'; groupIds: string[] }
  | { type: 'bulkDelete'; groupIds: string[] };

/** Host → detail-panel messages. */
export type HostToDetail =
  | {
      type: 'setGroup';
      group: AnnotationGroup | null;
      palette: TagColor[];
      staleIds?: string[];
      comments?: ThreadComment[];
      currentAuthor?: string;
    }
  | { type: 'openAnnotation'; annotationId: string };

/** Detail-panel → host messages. */
export type DetailToHost =
  | { type: 'ready' }
  | { type: 'selectAnnotation'; annotationId: string }
  | { type: 'updateAnnotation'; annotationId: string; content: string }
  | { type: 'copyText'; text: string }
  | { type: 'setGroupTitle'; title: string }
  | { type: 'editTags' }
  | { type: 'editGitRef' }
  | { type: 'updateAnnotationRange'; annotationId: string; startLine: number; endLine: number }
  | { type: 'reorderAnnotations'; annotationIds: string[] }
  | { type: 'updateGroupStatus'; status: GroupStatus }
  | { type: 'addComment'; annotationId: string; content: string }
  | { type: 'editComment'; commentId: string; content: string }
  | { type: 'deleteComment'; commentId: string }
  | { type: 'navigationClosed' };

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
    case 'refresh':
      return { type: 'refresh' };
    case 'selectGroup':
      return typeof raw.groupId === 'string' ? { type: 'selectGroup', groupId: raw.groupId } : null;
    case 'bulkEditTags':
    case 'bulkEditGitRef':
    case 'bulkResolveRestore':
    case 'bulkDelete':
      return Array.isArray(raw.groupIds) && (raw.groupIds as unknown[]).every((id) => typeof id === 'string')
        ? { type: raw.type as 'bulkEditTags' | 'bulkEditGitRef' | 'bulkResolveRestore' | 'bulkDelete', groupIds: raw.groupIds as string[] }
        : null;
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
    case 'updateAnnotationRange':
      return typeof raw.annotationId === 'string' &&
        typeof raw.startLine === 'number' &&
        typeof raw.endLine === 'number'
        ? { type: 'updateAnnotationRange', annotationId: raw.annotationId, startLine: raw.startLine, endLine: raw.endLine }
        : null;
    case 'reorderAnnotations':
      return Array.isArray(raw.annotationIds) && (raw.annotationIds as unknown[]).every((id) => typeof id === 'string')
        ? { type: 'reorderAnnotations', annotationIds: raw.annotationIds as string[] }
        : null;
    case 'updateGroupStatus':
      return raw.status === 'open' || raw.status === 'resolved'
        ? { type: 'updateGroupStatus', status: raw.status }
        : null;
    case 'addComment':
      return typeof raw.annotationId === 'string' && typeof raw.content === 'string'
        ? { type: 'addComment', annotationId: raw.annotationId, content: raw.content }
        : null;
    case 'editComment':
      return typeof raw.commentId === 'string' && typeof raw.content === 'string'
        ? { type: 'editComment', commentId: raw.commentId, content: raw.content }
        : null;
    case 'deleteComment':
      return typeof raw.commentId === 'string'
        ? { type: 'deleteComment', commentId: raw.commentId }
        : null;
    case 'navigationClosed':
      return { type: 'navigationClosed' };
    default:
      return null;
  }
}
