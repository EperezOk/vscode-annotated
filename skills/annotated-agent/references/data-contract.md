# Data contract — `.annotations/` on disk

The `vscode-annotated` extension stores everything as JSON files (plus a few VSCode
settings). An agent participates by reading/writing these files directly. Write files that
match this contract **exactly** or the extension won't read them back.

## Directory layout

```
.annotations/
  groups/<group-id>.json        # one annotation group per file
  comments/<author-slug>.json   # one comment file per author
```

## Group — `.annotations/groups/<id>.json`

```jsonc
{
  "id": "550e8400-e29b-41d4-a716-446655440000",   // MUST equal the filename stem
  "title": "Login review",
  "author": "Claude",                              // your agent identity for groups you create
  "tags": ["security"],                            // tag names (colors live in config)
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

## Comment file — `.annotations/comments/<author-slug>.json`

```jsonc
{
  "author": "Claude",
  "email": "",                                     // best-effort; "" is valid
  "comments": [
    {
      "id": "uuid",
      "annotationId": "f47ac10b-…",                // references an annotation in ANY group file
      "content": "Markdown body…",
      "timestamp": 1730000050                      // epoch SECONDS; thread order (ascending)
    }
  ]
}
```

A **thread** for an annotation = every comment, across **all** `comments/*.json`, whose
`annotationId` matches — sorted ascending by `timestamp`.

## Invariants (must hold or the extension can't read your writes)

- **Group `id` == filename stem.** `groups/<id>.json`; a mismatch hides the group.
- **Comment filename == author slug** (see slug recipe). Edit/delete-own only works on your own slug file.
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

## Config — VSCode settings

- `annotated.tags`: `[{ "name": string, "color": string }]` — the tag palette.
  **Tag writes may target the workspace OR the user's global config — ask the user which**
  (default: workspace):
  - **Workspace:** `.vscode/settings.json` in the repo (shared/committed).
  - **Global (user):** the user's `settings.json` — path varies by OS + VSCode flavor:
    - macOS: `~/Library/Application Support/Code/User/settings.json`
    - Linux: `~/.config/Code/User/settings.json`
    - Windows: `%APPDATA%\Code\User\settings.json`
    - (swap the `Code` segment for `Code - Insiders` / `VSCodium` / `Cursor` as needed)

    **Resolve the path and confirm it with the user before writing.**

  Either target: read-merge-write `annotated.tags`, **dedup by `name`**, preserve other keys.
  Both files may be absent — create with `{ }` if needed.
- `annotated.authorName` / `annotated.authorEmail`: the **human's** identity — read, never overwrite.
- **Agent identity:** `annotated.agentName` (optional) → fallback `"Claude"`. Used as your
  group `author` and the basis for your comment-file slug.
