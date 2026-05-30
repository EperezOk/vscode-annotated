# `annotated-agent` Skill — Design

**Status:** Approved design (brainstorm). Next: implementation plan via writing-plans.
**Date:** 2026-05-30

## Goal

A **markdown Claude Code skill** that lets an AI agent participate in a `vscode-annotated`
workspace by reading and writing the extension's on-disk artifacts directly — surfing
groups and comment threads, replying in threads, and creating its own annotation groups,
plus updating config. The agent writes files the extension reads back natively (correct
schema, IDs, content hashes), acts under a **distinct identity**, and only mutates **what it
authored**. No UI driving, no server, **no Node dependency** — only standard POSIX shell
utilities the agent already has via Bash.

## Why this exists

`vscode-annotated` stores everything as JSON under `.annotations/` plus a few VSCode
settings. That makes the data trivially agent-accessible: an agent with file tools can read,
summarize, reply to, and create annotations without any extension API — *if* it respects the
exact on-disk contract (schema, filename⇄id invariants, the SHA-256 content hash, the
author-slug rule). This skill encodes that contract and the safe procedures for using it, so
an agent becomes a first-class collaborator in the annotation workflow.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| **Form** | Markdown-only skill (SKILL.md + references); agent uses Read/Write/Bash/Grep | Lightest; no program to maintain; transparent. |
| **Identity** | Distinct agent identity (own author name + own comment file) | Clear attribution in a shared repo; humans can tell agent vs. teammate; edit/delete-own stays scoped. |
| **Write scope** | Create + manage-own + config | Create groups/annotations, reply anywhere, edit/resolve/delete **only what the agent authored**, update config. Reads everything; never modifies/deletes a human's groups or comments. |
| **Location** | Source-in-repo, installable anywhere | Canonical SKILL.md committed here, versioned in lockstep with the data contract; an install step copies/symlinks it into `~/.claude/skills` (global) or a consuming repo's `.claude/skills`. |
| **Runtime** | Node-free; POSIX shell only | `awk` + `sha256sum`/`shasum`, `uuidgen`, `date` cover every computed value. |

## Architecture & layout

```
skills/annotated-agent/
  SKILL.md                      # entry point: when-to-use + the procedures
  references/
    data-contract.md            # exact on-disk schema + the node-free recipes
    operations.md               # step-by-step recipes per operation (loaded on demand)
  install.sh                    # symlink/copy into ~/.claude/skills or <repo>/.claude/skills
  README.md                     # what it is + how to install
```

- **Canonical source lives in this repo.** If the data model changes, the skill (and its
  contract-drift test, below) is updated here in one place.
- **`SKILL.md` frontmatter** carries `name: annotated-agent` and a `description` naming the
  triggers ("annotations, comment threads, `.annotations/` directory, vscode-annotated"), so
  Claude auto-invokes it in a repo that uses the extension.
- **`install.sh`** documents two targets: global (`~/.claude/skills/annotated-agent/`) and
  per-repo (`<target>/.claude/skills/annotated-agent/`), via symlink (default) or copy.
- **Reference split:** `SKILL.md` stays short (when-to-use + a map of operations + the
  hard safety rules); the verbose schema and per-operation recipes live in `references/`,
  loaded on demand. This keeps the always-loaded surface small.

## Data contract

The skill documents this precisely so agent-written files parse cleanly via the extension's
`parseGroup` / `parseCommentFile`.

### Directory layout
```
.annotations/
  groups/<group-id>.json            # one AnnotationGroup per file
  comments/<author-slug>.json       # one CommentFile per author
```
Config lives in VSCode settings (`.vscode/settings.json` for the workspace).

### Group — `.annotations/groups/<id>.json`
```jsonc
{
  "id": "550e8400-e29b-41d4-a716-446655440000",   // MUST equal the filename stem
  "title": "Login review",
  "author": "Claude",                              // the agent's identity for agent-created groups
  "tags": ["security"],                            // tag names (colors live in config)
  "gitRef": null,                                  // branch / tag / SHA, or null
  "status": "open",                                // "open" | "resolved"
  "createdAt": 1730000000,                         // epoch SECONDS
  "updatedAt": 1730000000,                         // epoch SECONDS
  "annotations": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "file": "src/auth/login.ts",                 // workspace-relative POSIX path
      "range": { "startLine": 42, "endLine": 47 }, // 1-based, inclusive
      "content": "Markdown body…",
      "contentHash": "<sha256-hex of the anchored lines>"
    }
  ]
}
```

### Comment file — `.annotations/comments/<author-slug>.json`
```jsonc
{
  "author": "Claude",
  "email": "",                                     // best-effort; "" is valid
  "comments": [
    {
      "id": "uuid",
      "annotationId": "f47ac10b-…",                // references an annotation in ANY group file
      "content": "Markdown body…",
      "timestamp": 1730000050                      // epoch SECONDS; thread order
    }
  ]
}
```
A **thread** for an annotation is every comment, across **all** `comments/*.json` files, whose
`annotationId` matches — sorted ascending by `timestamp`.

### Invariants (the agent must uphold)
- **Group `id` == filename stem.** `getGroup(id)` reads `groups/<id>.json`; a mismatch makes
  the group invisible.
- **Comment filename == author slug.** Slug rule (exactly the extension's `slugifyAuthor`):
  lowercase → replace each run of non-`[a-z0-9]` with `-` → strip leading/trailing `-` →
  fallback `anon` if empty. Edit/delete-own only works when the agent writes to *its own*
  slug file.
- **`contentHash` is mandatory and exact** (see recipe). A wrong/placeholder hash makes the
  annotation render "stale" (amber) in the extension.
- **Line ranges** are 1-based, inclusive, integers.
- **Timestamps** are epoch **seconds** (not ms).
- **JSON formatting:** `JSON.stringify(value, null, 2)` — 2-space indent, **no trailing
  newline** — to match the extension's serializer and minimize diffs.

### Node-free computed values

**contentHash** — reproduce `anchorText(fileText, range)` (= `fileText.split('\n').slice(start-1,
end).join('\n')`, **no trailing newline**) then SHA-256 it:
```bash
# $FILE = workspace-relative path; $START/$END = 1-based inclusive line numbers
awk -v s="$START" -v e="$END" 'NR>=s && NR<=e { printf "%s%s", sep, $0; sep="\n" }' "$FILE" \
  | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } \
  | cut -d' ' -f1
```
- `awk` matches `anchorText` byte-for-byte: keeps blank lines, preserves any `\r` (it splits
  on `\n` only, same as `String.split('\n')`), naturally clamps a past-EOF range, and
  `printf` emits **no trailing newline**.
- `sha256sum` (Linux/coreutils) with `shasum -a 256` fallback (always on macOS) → identical
  lowercase hex to the extension's Web-Crypto `sha256Hex`.

**IDs** — `uuidgen | tr '[:upper:]' '[:lower:]'` (macOS `uuidgen` is uppercase; the
extension's `crypto.randomUUID()` is lowercase, so normalize).

**Timestamps** — `date +%s` (epoch seconds).

### Config — VSCode settings
- `annotated.tags`: `[{ "name": string, "color": string }]` — the tag palette. **Tag writes
  may target either the workspace config or the user's global config — the user decides per
  write** (default: workspace):
  - **Workspace:** `.vscode/settings.json` in the repo (shared/committed). Always
    file-accessible.
  - **Global (user):** the user's `settings.json`, whose path depends on OS + VSCode flavor —
    macOS `~/Library/Application Support/Code/User/settings.json`, Linux
    `~/.config/Code/User/settings.json`, Windows `%APPDATA%\Code\User\settings.json` (swap the
    `Code` segment for `Code - Insiders` / `VSCodium` / `Cursor` as appropriate). The skill
    documents how to locate it and **confirms the resolved path with the user before writing**.

  Either target: read-merge-write the `annotated.tags` array, **dedup by `name`** (last write
  wins on color). Both files may be absent — create them with a minimal `{ }` shell if needed,
  preserving any unrelated existing keys.
- `annotated.authorName` / `annotated.authorEmail`: the human's identity (the agent reads but
  does not overwrite these).
- **Agent identity convention:** `annotated.agentName` (optional) → fallback `"Claude"`. The
  agent uses this as its `author` for groups and as the basis for its comment-file slug. The
  agent's own groups/comments are always workspace files under `.annotations/`.

## Operations (each a copy-pasteable recipe in `references/operations.md`)

1. **Surf / read.** List & summarize groups (Read each `groups/*.json`; report
   title / author / tags / status / annotation count). Filter by tag, author, or status. Open
   an annotation's `file:range` to read the code. **Assemble a thread:** scan all
   `comments/*.json`, collect comments with the matching `annotationId`, sort ascending by
   `timestamp`, present author + relative time + body. (`jq`/`grep` optional conveniences;
   the agent's Read tool is sufficient.)
2. **Reply in a thread.** Resolve agent identity → slug → comment-file path. Read-or-init the
   agent's own comment file (`{ author, email, comments: [] }`). Append
   `{ id: <uuid>, annotationId, content, timestamp: <now> }`. Write back (pretty, no trailing
   newline).
3. **Create a group / annotation.** Gather `file` + 1-based `range` + markdown `content`.
   Compute each annotation's `contentHash` via the recipe. Build the group
   (`id: <uuid>`, `author: <agent>`, `tags`, `gitRef: null` or a ref, `status: "open"`,
   `createdAt`/`updatedAt: <now>`, `annotations: [...]`). Write `groups/<id>.json`. To add an
   annotation to an **agent-authored** group: append + bump `updatedAt`.
4. **Manage own.** Resolve/restore (flip `status`) or delete **agent-authored** groups; delete
   the agent's own comments (filter its own comment file). Never on others' files.
5. **Update config.** Add a tag to `annotated.tags` (dedup by name) — to the **workspace**
   `.vscode/settings.json` or, when the user chooses, the **global** user `settings.json`
   (resolve the path per OS/flavor and confirm it before writing). Or set `annotated.agentName`.

## Safety & etiquette (hard rules stated in SKILL.md)

- **Identity boundary.** Only ever write the agent's **own** comment file and **agent-authored**
  groups. Never edit or delete a human's group file or another author's comment file. Determine
  authorship by the group's `author` field / the comment file's slug.
- **Hash honesty.** Always compute `contentHash` via the recipe; never placeholder it.
- **Uphold invariants.** Group `id` == filename stem; comment filename == author slug; integer
  1-based lines; epoch-second timestamps; serializer-matching JSON.
- **Read fresh before write.** The extension's `FileSystemWatcher` reloads on change; re-read a
  file immediately before mutating it to avoid clobbering concurrent edits.
- **Leave version control to the human.** The agent writes files; it does not `git add`/commit
  `.annotations/` unless explicitly asked.

## Testing

A **contract-drift test** in this repo keeps the skill's recipes honest as the model evolves
(it runs under Node/vitest — only the *skill the agent follows* must be node-free):

1. **Hash recipe parity.** Shell out to run the documented `awk | sha256` pipeline and assert
   its output equals `sha256Hex(anchorText(fileText, range))` for sample inputs, including edge
   cases: single line; a blank line inside the range; a file with no trailing newline; a
   multi-line range; a past-EOF `endLine`.
2. **Schema round-trip.** Hand-build a group JSON and a comment-file JSON exactly as the skill
   documents, and assert they parse cleanly via `parseGroup` / `parseCommentFile` and serialize
   identically to `serializeGroup` / `serializeCommentFile`.
3. **Slug parity.** Assert the documented slug rule equals the extension's `slugifyAuthor` for a
   handful of names (spaces, symbols, empty).

If any assertion fails after a model change, the skill is flagged for update in the same repo.

## Non-goals

- No driving the VSCode UI / executing extension commands.
- No MCP server or compiled CLI (markdown + shell recipes only).
- No full human-equivalent power: the agent never edits, resolves, or deletes others' groups or
  comments.
- No conflict resolution for `.annotations/` — concurrent edits are git's concern.
- No reliance on `jq`/Node; they may be mentioned as optional conveniences but are never required.

## Open questions / future

- **Richer surfing helpers** (e.g., a saved query for "unresolved groups touching files I
  changed") could be added later as optional recipes.
- **Reactions / structured replies** are out of scope until the extension models them.
- If hand-written hashing ever proves error-prone in practice, a tiny committed shell helper
  (`skills/annotated-agent/bin/anno-hash`) is a low-cost upgrade that stays node-free.
