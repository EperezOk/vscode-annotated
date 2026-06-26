# Data contract — `.annotations/` on disk

The `vscode-annotated` extension stores everything as JSON files (plus a few VSCode
settings). An agent participates by reading/writing these files directly. Write files that
match this contract **exactly** or the extension won't read them back.

## Directory layout

```
.annotations/
  groups/<title-slug>-<idseg>.json   # one annotation group per file
  comments/<author-slug>.json   # one comment file per author
```

## Group — `.annotations/groups/<title-slug>-<idseg>.json`

```jsonc
{
  "id": "550e8400-e29b-41d4-a716-446655440000",   // canonical id (full UUID); filename's <idseg> = its first 8 hex
  "title": "Login review",
  "author": "Claude",                              // your agent identity for groups you create
  "tags": [{ "name": "security", "color": "#E5484D" }], // tags carry their color (self-contained)
  "gitRef": null,                                  // branch / tag / SHA, or null
  "status": "open",                                // "open" | "resolved"
  "createdAt": 1730000000,                         // epoch SECONDS
  "updatedAt": 1730000000,                         // epoch SECONDS
  "annotations": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "file": "src/auth/login.ts",                 // workspace-relative POSIX path
      "range": { "startLine": 42, "endLine": 47 }, // 1-based, inclusive, integers
      "content": "Markdown body…",
      "contentHash": "<sha256 hex of the anchored lines — see recipe>"
    }
  ]
}
```

> **Tags** are objects `{ name, color }` — colors travel with the group so it's self-contained.
> The displayed color resolves **local config > global config > this JSON**. Legacy `"tags":
> ["security"]` string arrays still load (auto-migrated), but write the object form.

> `"annotations": []` is **valid** (it happens when the last annotation is deleted) — an empty
> group is not corrupt; don't "repair" or delete it.

## Comment file — `.annotations/comments/<author-slug>.json`

```jsonc
{
  "author": "Claude",
  "email": "",                                     // best-effort; "" is valid
  "comments": [
    {
      "id": "uuid",
      "annotationId": "f47ac10b-…",                // → an annotation in ANY group file
      "content": "Markdown body…",
      "timestamp": 1730000050                      // epoch SECONDS; thread order (ascending)
    },
    {
      "id": "uuid",
      "groupId": "550e8400-…",                     // → a GROUP itself (group-level remark)
      "content": "Markdown body…",
      "timestamp": 1730000060
    }
  ]
}
```

Each comment targets **exactly one** of `annotationId` / `groupId` — never both, never
neither. **Omit** the unused key (don't write `null`).

Threads (each across **all** `comments/*.json`, sorted ascending by `timestamp`):
- **Annotation thread:** comments whose `annotationId` matches — shown in the annotation view.
- **Group thread:** comments whose `groupId` matches — shown in the group detail view.

The UI's comment badges count a group's annotation comments **plus** its group comments.

## Invariants (must hold or the extension can't read your writes)

- **Filename = `<title-slug>-<idseg>.json`** (e.g. `misleading-docs-550e8400.json`), where
  `<idseg>` is the first 8 hex chars of the de-hyphenated `id`. The extension keys off the
  in-file `id`, not the filename, so a stale slug is cosmetic, not corrupting. Legacy
  `groups/<id>.json` files are still read. When you create a group, name it this way; when you
  edit/delete one, find it by its `id` (its filename ends with the id segment, or is the legacy
  `<id>.json`).
- **Comment filename == author slug** (see slug recipe). Edit/delete-own only works on your own slug file.
- **One comment target.** Exactly one of `annotationId` / `groupId` per comment — a single
  invalid comment makes the extension skip the **whole** comment file.
- **`contentHash` is mandatory + exact** (see hash recipe). A wrong/placeholder hash renders the annotation "stale" (amber).
- **Line ranges:** 1-based, inclusive, integers.
- **Timestamps:** epoch **seconds** (not milliseconds).
- **JSON formatting:** 2-space indent, **no trailing newline** (matches the extension's
  `JSON.stringify(value, null, 2)` serializer → minimal diffs).

## Node-free recipes (POSIX shell only)

### contentHash

Reproduce `anchorText` (the full lines in `[START,END]`, 1-based inclusive, joined by `\n`,
**no trailing newline**) then SHA-256 it. `$FILE` is the workspace-relative path; `$START`/`$END`
are line numbers:

```bash
awk -v s="$START" -v e="$END" 'NR>=s && NR<=e { printf "%s%s", sep, $0; sep="\n" }' "$FILE" \
  | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } \
  | cut -d' ' -f1
```

- `awk` keeps blank lines, preserves any `\r` (splits on `\n` only — same as the source), clamps a past-EOF range, and `printf` emits **no trailing newline**.
- `sha256sum` (Linux) with `shasum -a 256` fallback (macOS) → the lowercase hex the extension expects.

### IDs

```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```
(macOS `uuidgen` is uppercase; the extension's IDs are lowercase, so normalize.)

### Timestamps

```bash
date +%s
```

### Author slug (for the comment filename)

Lowercase → replace each run of non-`[a-z0-9]` with `-` → strip leading/trailing `-` →
fallback `anon` if empty:

```bash
s=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$s" ] || s=anon
printf '%s\n' "$s"
```

Examples: `Claude` → `claude`; `Ana Díaz!` → `ana-d-az`; `` (empty) → `anon`.

### Title slug (for the group filename)

Same as the author slug, then **cap to 40 characters** (strip a trailing `-` left by the cut)
and fall back to `untitled` if empty. `$TITLE` is the group title:

```bash
s=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 | sed -E 's/-+$//')
[ -n "$s" ] || s=untitled
printf '%s\n' "$s"
```

The group filename is then `<title-slug>-<first-8-hex-of-id>.json`.

## Config — VSCode settings

- `annotated.tags`: `[{ "name": string, "color": string }]` — the tag palette.
  The extension **auto-reconciles** group tags missing from settings into the **workspace** config
  on load, so writing colors into the group JSON is sufficient and updating `annotated.tags` is
  **optional**. Use it only to set or override a tag's color centrally.

  When you do need to write to config, choose the target:
  - **Workspace:** `.vscode/settings.json` in the repo (shared/committed).
  - **Global (user):** the user's `settings.json` — path varies by OS + VSCode flavor:
    - macOS: `~/Library/Application Support/Code/User/settings.json`
    - Linux: `~/.config/Code/User/settings.json`
    - Windows: `%APPDATA%\Code\User\settings.json`
    - (swap the `Code` segment for `Code - Insiders` / `VSCodium` / `Cursor` as needed)

  Either target: read-merge-write `annotated.tags`, **dedup by `name`**, preserve other keys.
  Both files may be absent — create with `{ }` if needed.
- `annotated.authorName` / `annotated.authorEmail`: the **human's** identity — read, never overwrite.
- **Agent identity:** `annotated.agentName` (optional). Used as your group `author` and the
  basis for your comment-file slug. If unset, the agent asks the user to choose one (and whether
  to save it to project/global config) before writing — see `SKILL.md` / `operations.md` §0 —
  rather than assuming a default.
