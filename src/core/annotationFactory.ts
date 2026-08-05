import { type Annotation, type AnnotationGroup, type LineRange, type Tag } from '../shared/model';

/** Build a new, empty open group. Caller supplies id, timestamps (`now`), and tags. */
export function createGroup(input: {
  id: string;
  title: string;
  author: string;
  tags: Tag[];
  gitRef?: string | null;
  now: number;
}): AnnotationGroup {
  return {
    id: input.id,
    title: input.title,
    author: input.author,
    tags: [...input.tags],
    gitRef: input.gitRef ?? null,
    status: 'open',
    createdAt: input.now,
    updatedAt: input.now,
    annotations: [],
  };
}

/** Build a new annotation (empty Markdown content by default). */
export function makeAnnotation(input: {
  id: string;
  file: string;
  /** null for a whole-file annotation. */
  range: LineRange | null;
  content?: string;
  contentHash: string;
}): Annotation {
  return {
    id: input.id,
    file: input.file,
    range: input.range,
    content: input.content ?? '',
    contentHash: input.contentHash,
  };
}

/** Return a copy of `group` with `annotation` appended and `updatedAt` set to `now`. */
export function addAnnotation(group: AnnotationGroup, annotation: Annotation, now: number): AnnotationGroup {
  return {
    ...group,
    annotations: [...group.annotations, annotation],
    updatedAt: now,
  };
}

/**
 * Return a copy of `group` without the annotation `annotationId` (updatedAt = `now`),
 * or null when the id is absent. The group is kept even when emptied — deleting the
 * last annotation does not delete the group (round-3 #4 decision).
 */
export function removeAnnotation(group: AnnotationGroup, annotationId: string, now: number): AnnotationGroup | null {
  const annotations = group.annotations.filter((a) => a.id !== annotationId);
  if (annotations.length === group.annotations.length) {
    return null;
  }
  return { ...group, annotations, updatedAt: now };
}
