// Domain model for annotation groups and their annotations.
// Pure data + validation; no VSCode or I/O dependency.

export interface LineRange {
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

/** A tag on a group: a display name + color. (Colors are also resolved from user config.) */
export interface Tag {
  name: string;
  color: string;
}

export interface Annotation {
  id: string;
  /** Workspace-relative POSIX path. */
  file: string;
  range: LineRange;
  /** Markdown body. */
  content: string;
  /** SHA-256 hex of the anchored lines at creation (for drift detection). */
  contentHash: string;
}

export type GroupStatus = 'open' | 'resolved';

export interface AnnotationGroup {
  id: string;
  title: string;
  author: string;
  /** Tags with their stored colors (display color is resolved from config, then this). */
  tags: Tag[];
  /** Branch / tag / SHA, or null. */
  gitRef: string | null;
  status: GroupStatus;
  /** Epoch seconds. */
  createdAt: number;
  updatedAt: number;
  annotations: Annotation[];
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function fail(field: string, detail: string): never {
  throw new Error(`Invalid group: ${field} ${detail}`);
}

function parseRange(raw: unknown): LineRange {
  if (!isObject(raw)) fail('range', 'is not an object');
  const { startLine, endLine } = raw as Record<string, unknown>;
  if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
    fail('range.startLine', 'must be an integer >= 1');
  }
  if (typeof endLine !== 'number' || !Number.isInteger(endLine) || endLine < startLine) {
    fail('range.endLine', 'must be an integer >= startLine');
  }
  return { startLine, endLine };
}

function parseAnnotation(raw: unknown): Annotation {
  if (!isObject(raw)) fail('annotation', 'is not an object');
  const { id, file, range, content, contentHash } = raw;
  if (typeof id !== 'string') fail('annotation.id', 'must be a string');
  if (typeof file !== 'string') fail('annotation.file', 'must be a string');
  if (typeof content !== 'string') fail('annotation.content', 'must be a string');
  if (typeof contentHash !== 'string') fail('annotation.contentHash', 'must be a string');
  return { id, file, range: parseRange(range), content, contentHash };
}

function parseTag(raw: unknown): Tag {
  if (typeof raw === 'string') {
    // Legacy `string[]` tags → migrate; real color resolves from config / is stamped on next save.
    return { name: raw, color: '#888888' };
  }
  if (isObject(raw) && typeof (raw as { name?: unknown }).name === 'string') {
    const r = raw as { name: string; color?: unknown };
    return { name: r.name, color: typeof r.color === 'string' ? r.color : '#888888' };
  }
  return fail('tags[]', 'must be a string or { name, color }');
}

/** Validate an untrusted parsed value as an AnnotationGroup. Throws Error on any problem. */
export function parseGroup(raw: unknown): AnnotationGroup {
  if (!isObject(raw)) fail('root', 'is not an object');
  const { id, title, author, tags, gitRef, status, createdAt, updatedAt, annotations } = raw;
  if (typeof id !== 'string') fail('id', 'must be a string');
  if (typeof title !== 'string') fail('title', 'must be a string');
  if (typeof author !== 'string') fail('author', 'must be a string');
  if (!Array.isArray(tags)) fail('tags', 'must be an array');
  if (gitRef !== null && typeof gitRef !== 'string') fail('gitRef', 'must be a string or null');
  if (status !== 'open' && status !== 'resolved') fail('status', "must be 'open' or 'resolved'");
  if (typeof createdAt !== 'number') fail('createdAt', 'must be a number');
  if (typeof updatedAt !== 'number') fail('updatedAt', 'must be a number');
  if (!Array.isArray(annotations)) fail('annotations', 'must be an array');
  return {
    id,
    title,
    author,
    tags: tags.map(parseTag),
    gitRef,
    status,
    createdAt,
    updatedAt,
    annotations: annotations.map(parseAnnotation),
  };
}

/** Serialize a group as pretty (2-space) JSON. */
export function serializeGroup(group: AnnotationGroup): string {
  return JSON.stringify(group, null, 2);
}

/** One comment in a per-author comment file. */
export interface Comment {
  id: string;
  annotationId: string;
  content: string;
  timestamp: number; // epoch seconds
}

/** A per-author comment file (.annotations/comments/<slug>.json). */
export interface CommentFile {
  author: string;
  email: string;
  comments: Comment[];
}

/** A comment flattened into a thread, with its file's author attached. */
export interface ThreadComment extends Comment {
  author: string;
}

function parseComment(raw: unknown): Comment {
  if (!isObject(raw)) fail('comment', 'is not an object');
  const { id, annotationId, content, timestamp } = raw;
  if (typeof id !== 'string') fail('comment.id', 'must be a string');
  if (typeof annotationId !== 'string') fail('comment.annotationId', 'must be a string');
  if (typeof content !== 'string') fail('comment.content', 'must be a string');
  if (typeof timestamp !== 'number') fail('comment.timestamp', 'must be a number');
  return { id, annotationId, content, timestamp };
}

/** Validate an untrusted value as a CommentFile. Throws on any problem. */
export function parseCommentFile(raw: unknown): CommentFile {
  if (!isObject(raw)) fail('commentFile', 'is not an object');
  const { author, email, comments } = raw;
  if (typeof author !== 'string') fail('commentFile.author', 'must be a string');
  if (typeof email !== 'string') fail('commentFile.email', 'must be a string');
  if (!Array.isArray(comments)) fail('commentFile.comments', 'must be an array');
  return { author, email, comments: comments.map(parseComment) };
}

export function serializeCommentFile(file: CommentFile): string {
  return JSON.stringify(file, null, 2);
}
