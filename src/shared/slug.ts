/**
 * Filesystem-safe slug of arbitrary text: lowercase, each run of non-`[a-z0-9]`
 * collapsed to a single `-`, leading/trailing `-` stripped, optionally capped to
 * `opts.max` characters (a trailing `-` left by the cut is removed). An empty
 * result becomes `opts.fallback`.
 */
export function slugify(text: string, opts: { fallback: string; max?: number }): string {
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (opts.max !== undefined && slug.length > opts.max) {
    slug = slug.slice(0, opts.max).replace(/-+$/g, '');
  }
  return slug || opts.fallback;
}

/** Slug for a group title, used in its filename: ≤40 chars, fallback `untitled`. */
export function slugifyTitle(title: string): string {
  return slugify(title, { fallback: 'untitled', max: 40 });
}
