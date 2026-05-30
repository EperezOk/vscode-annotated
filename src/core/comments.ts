import { type CommentFile, type ThreadComment } from '../shared/model';

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
