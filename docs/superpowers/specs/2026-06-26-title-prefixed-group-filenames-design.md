# Title-prefixed group filenames

## Problem

Annotation groups are stored one-per-file as `.annotations/groups/<uuid>.json`. The UUID
stem makes files hard to identify or reference when chatting with an agent. We want the
filename to start with the group's title (e.g. `misleading-docs-550e8400.json`) while
remaining fully backward compatible with existing `<uuid>.json` files.

## Decisions

- **ID segment:** short — the first 8 hex chars of the id with hyphens removed
  (`550e8400`). The internal `id` field stays the full UUID and is never changed.
- **Rename behavior:** the filename tracks the current title. Retitling a group renames its
  file; legacy `<uuid>.json` files acquire a slug the next time they are written. Pure reads
  never rewrite.

## Filename scheme

New groups are stored as:

```
.annotations/groups/<title-slug>-<idseg>.json
```

- `<title-slug>` — the title lowercased, each run of non-`[a-z0-9]` collapsed to a single
  `-`, leading/trailing `-` stripped, then capped to **40 chars** (trim a trailing `-` left
  by the cap). Empty result → fallback `untitled`.
- `<idseg>` — the de-hyphenated id's first **8** hex chars. Extended only by the save-time
  collision guard (below).

Example: id `550e8400-e29b-41d4-a716-446655440000`, title `Misleading docs` →
`misleading-docs-550e8400.json`.

## Guiding principle — filename is cosmetic, internal `id` is canonical

`listGroups()` already reads every `*.json` and takes the id from inside the JSON, so
listing, comment threads, and group references are unaffected by the filename. **Only the
three by-id operations** (`getGroup`, `saveGroup`, `deleteGroup`) resolve a filename from an
id, and they are the only methods that change.

## `GroupStore` changes (`src/core/groupStore.ts`)

### `resolvePath(id): Promise<string | null>` (new, private)

Lists the directory once and returns the real on-disk path for `id`, or `null`.

A file belongs to `id` when either:

- **Legacy:** its stem is a UUID (matches the UUID regex) and equals `id` → `<id>.json`.
- **New format:** its stem contains a `-`, and the trailing `-`-delimited token is a hex
  string that is a prefix of the de-hyphenated `id`
  (`dehyphenate(id).startsWith(trailingToken)`).

Resolution:

1. Fast filter the directory names by the two rules above to get candidates.
2. Exactly one candidate → return it.
3. More than one candidate → read each candidate's JSON and return the path whose internal
   `id` equals the requested `id` (disambiguates the rare shared-prefix case). None match →
   `null`.
4. Zero candidates → `null`.

`dehyphenate(id)` = `id.replace(/-/g, '')`. The id segment is always hyphen-free (the slug
may contain hyphens, but the id segment is the final token), so "trailing token" parsing is
unambiguous; legacy UUID stems (which contain hyphens) are matched by the separate legacy
rule.

### `getGroup(id)`

Resolve the path; if `null`, return `null`; otherwise read + `parseGroup`. On any error,
return `null` (unchanged contract).

### `deleteGroup(id)`

Resolve the path; if found, delete it. No-op if absent (unchanged contract).

### `saveGroup(group)`

1. Compute `desired = `<slugifyTitle(group.title)>-<idseg(group.id)>.json``.
2. `existing = await resolvePath(group.id)`.
3. If `desired` is already occupied by a **different** group's id (read the occupant's
   internal id to confirm; this is the collision guard), extend `idseg` by one more hex char
   and recompute `desired`; repeat until free (bounded by the full 32-char hex id).
4. Write the group JSON to `desired`.
5. If `existing` is non-null and differs from the final `desired`, delete `existing` (this
   performs both the retitle-rename and the lazy legacy migration).

All methods that mutate then persist (`updateAnnotation`, `updateAnnotationRange`,
`reorderAnnotations`, `deleteAnnotation`, `updateGroup`) already route through
`getGroup` + `saveGroup`, so they inherit the new behavior with no changes.

## Slug utility (`src/shared/`)

Extract a general helper so author and title slugs cannot diverge:

```ts
// src/shared/slug.ts (no vscode import)
export function slugify(text: string, opts: { fallback: string; max?: number }): string
```

- Lowercase → collapse non-`[a-z0-9]` runs to `-` → strip leading/trailing `-`.
- If `opts.max` is set, truncate to `max` chars and strip a trailing `-`.
- Empty result → `opts.fallback`.

`slugifyAuthor` (currently in `src/core/comments.ts`) is reimplemented as
`slugify(name, { fallback: 'anon' })` — behavior-preserving. Add
`slugifyTitle(title) = slugify(title, { fallback: 'untitled', max: 40 })`.

## Backward compatibility & migration

- Existing `<uuid>.json` files remain readable/editable/deletable via the legacy branch of
  `resolvePath`.
- A legacy file is renamed to `<slug>-<idseg>.json` only when the group is next **written**
  (any edit: retitle, annotation add/edit/reorder/delete, status change). Reads never
  rewrite, so there is no surprise git churn — files migrate incrementally as touched.
- No bulk migration pass on activation.

## Agent contract updates

The contract docs must reflect that the filename no longer equals the id stem.

`skills/annotated/references/data-contract.md`:

- Directory-layout line and the `## Group` heading: `groups/<title-slug>-<idseg>.json`.
- Drop the `"id"` comment "MUST equal the filename stem"; replace with: the filename ends
  with the short id segment; the canonical `id` is read from inside the file.
- Invariants: replace "Group `id` == filename stem … a mismatch hides the group" with the
  new rule — the filename SHOULD start with the title slug and end with `-<first-8-of-id>`;
  the extension keys off the internal `id`, so a slug mismatch is cosmetic, not corrupting.
- Add a **Title slug** recipe under "Node-free recipes", mirroring the author-slug recipe,
  with `max 40` semantics and `untitled` fallback.

`skills/annotated/references/operations.md`:

- "Create a group" step: write `.annotations/groups/<title-slug>-<first-8-of-id>.json`
  (drop "the filename stem MUST equal `id`").
- "Delete a group": remove its file (found by id; no longer a fixed `<id>.json` path).

## Tests

`src/core/groupStore.unit.test.ts` (Vitest + `MemoryFileSystem`):

- New group saved as `<slug>-<idseg>.json`; `getGroup` round-trips it.
- Retitle via `updateGroup` renames the file and removes the old one (old name gone, new
  name present, single file for the id).
- Legacy `<uuid>.json`: `getGroup`/`deleteGroup` work; first `saveGroup` migrates it to the
  slugged name and deletes the legacy file.
- `resolvePath` disambiguation: two groups whose ids share the first 8 hex chars resolve to
  the correct file (verified via internal id).
- Save-time collision guard: saving a second group whose desired filename collides with a
  different existing id produces a distinct filename (extended `idseg`); both groups remain
  retrievable.
- Slug edge cases: empty title → `untitled-…`; all-symbol title → `untitled-…`; very long
  title → capped at 40 chars with no trailing `-`.
- `listGroups` is unaffected by filename (still finds groups regardless of name).

`src/core/comments.unit.test.ts` (or existing slug tests): `slugifyAuthor` unchanged.

`src/shared/skillContract.unit.test.ts`: add a title-slug parity test (TS `slugifyTitle` ⇄
the documented shell recipe) and assert `data-contract.md` embeds the recipe verbatim,
mirroring the existing author-slug parity test.

## Out of scope (YAGNI)

- No bulk migration on activation.
- No change to the `id` format, comment files, or local-link references.
- No UI changes — the sidebar/detail views key off the internal `id`.

## Local verification gate

`npm run check-types` + `npm run test:unit` (integration/e2e need network and are out of
scope for this change).
