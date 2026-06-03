import { type AnnotationGroup, type CommentFile, type ThreadComment } from '../shared/model';

/** A filesystem-safe slug of an author display name (collisions are tolerated). */
export function slugifyAuthor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'anon';
}

/** Merge every comment across all files (author attached), sorted ascending by timestamp. */
export function flattenComments(files: CommentFile[]): ThreadComment[] {
  return files
    .flatMap((file) => file.comments.map((c) => ({ ...c, author: file.author })))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Comments attached to the group itself (not to its annotations); order preserved. */
export function groupCommentsOf(comments: ThreadComment[], groupId: string): ThreadComment[] {
  return comments.filter((c) => c.groupId === groupId);
}

/**
 * Per-group comment totals for the sidebar badges: comments on the group's
 * annotations plus comments on the group itself. Every group gets an entry
 * (0 when comment-less); comments on unknown targets are ignored.
 */
export function commentCountsByGroup(groups: AnnotationGroup[], comments: ThreadComment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const groupByAnnotation = new Map<string, string>();
  for (const g of groups) {
    counts[g.id] = 0;
    for (const a of g.annotations) {
      groupByAnnotation.set(a.id, g.id);
    }
  }
  for (const c of comments) {
    const gid = c.groupId ?? (c.annotationId !== undefined ? groupByAnnotation.get(c.annotationId) : undefined);
    if (gid !== undefined && Object.hasOwn(counts, gid)) {
      counts[gid] += 1;
    }
  }
  return counts;
}

/** Coarse "x ago" label. `now` and `ts` are epoch seconds. */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
