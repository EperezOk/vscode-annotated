import { type Annotation, type AnnotationGroup, type LineRange } from '../shared/model';

/** Build a new, empty open group. Caller supplies id, timestamps (`now`), and tags. */
export function createGroup(input: {
  id: string;
  title: string;
  author: string;
  tags: string[];
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
  range: LineRange;
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
