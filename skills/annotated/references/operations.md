# Operations

All paths are workspace-relative. See `data-contract.md` for the exact schema, invariants,
and the node-free recipes (hash / id / timestamp / slug). **Always uphold the invariants and
the safety rules in `SKILL.md`.**

> Reminder: generate `<uuidgen>` ids in **lowercase**, and take `contentHash` and the author
> slug from the recipes in `data-contract.md` — don't hand-write them.

## 0. Establish identity (before any write)

Surfing/reading needs no identity. But before writing **any** comment, annotation, or group:

1. Read `annotated.agentName` from the workspace `.vscode/settings.json`, then the global user
   `settings.json` (paths in `data-contract.md`). If set, that's your `agentName` — done.
2. If **unset**, ask the user to choose an identity. **Suggest your own** as the recommended
   default — the assistant you are (e.g. Claude → "Claude", Codex → "Codex") — and let them
   enter any other name. Propose and confirm; don't silently assume one.
3. Ask where to persist the chosen name:
   - **Project:** write `annotated.agentName` into the workspace `.vscode/settings.json`.
   - **Global:** write it into the user `settings.json` (resolve the OS/flavor path; confirm first).
   - **Don't save:** keep it for this session only (you'll re-ask next session).
   Persist via the read-merge-write recipe in §5, preserving other keys.
4. Use that `agentName` for the rest of the session — your group `author` and the basis for
   your comment-file slug.

## 1. Surf / read

- **List groups:** read each `.annotations/groups/*.json`; for each report
  `title` · `author` · `tags` · `status` · `annotations.length`.
- **Filter:** by tag (`tags` includes X), author (`author` == X), or status
  (`status` == `open`/`resolved`).
- **Open an annotation:** read its `file` over the lines in `range` to see the code in context.
- **Assemble a thread for an annotation `A`:** read every `.annotations/comments/*.json`,
  collect comments where `annotationId == A.id`, sort ascending by `timestamp`, and present
  each as `author` · (relative time from `timestamp`) · `content`.
- **Assemble a group's own thread for group `G`:** same, but collect comments where
  `groupId == G.id` (group-level remarks, separate from any annotation's thread).

`grep`/`jq` are optional conveniences; your Read tool over the JSON is sufficient.

## 2. Reply in a thread

1. Resolve your `agentName` per §0 (ask the user first if it's unset) — never default silently.
2. Compute your comment-file slug from `agentName` (slug recipe) → path
   `.annotations/comments/<slug>.json`.
3. Read that file if it exists; otherwise start `{ "author": "<agentName>", "email": "", "comments": [] }`.
4. Append a comment targeting **exactly one** thread (omit the other key entirely):
   - **Annotation thread:** `{ "id": "<uuidgen>", "annotationId": "<the annotation's id>", "content": "<markdown>", "timestamp": <date +%s> }`
   - **Group thread** (a remark on the group itself): `{ "id": "<uuidgen>", "groupId": "<the group's id>", "content": "<markdown>", "timestamp": <date +%s> }`
5. Write the file back (2-space indent, no trailing newline).

You may reply on **any** annotation or group, but only ever write your **own** slug file.

## 3. Create an annotation group (and annotations)

Resolve your `agentName` per §0 first (ask the user if it's unset) — it becomes the group `author`.

1. For each annotation, gather `file` (workspace-relative POSIX), 1-based inclusive `range`,
   and markdown `content`. Compute `contentHash` via the hash recipe with that `file`/range.
   - **Reference other code with local links instead of extra annotations.** When a
     note needs to point at a *different* location (a call site, a related type,
     prior art), embed a local link `[label](path/to/file.ts#L10-L20)` in the
     `content` rather than creating a separate annotation just to point there. Keep
     the annotation's own `file`/`range` for the code the note is *about*. Paths are
     workspace-relative POSIX; line ranges are 1-based inclusive. See
     `data-contract.md` → "Local links in annotation content".
2. **Choose the group's tag(s) — ask the user.** Gather the existing tags from `annotated.tags`
   (workspace then global config) and from existing `.annotations/groups/*.json` (dedup by
   `name`) and offer them as suggestions. Ask which to apply: one or more existing tags and/or a
   new tag. For a **new** tag, ask for a color but **don't make the user supply hex** — accept a
   color *name* (e.g. "teal", "amber") just as readily, and convert it to a `#rrggbb` hex
   yourself. The stored `color` must be a `#rrggbb` hex (the extension parses it to pick legible
   text contrast). When the name maps to one of the extension's built-in swatches, use its hex:
   Red `#E5484D`, Amber `#F5A623`, Yellow `#E5C100`, Green `#3FB950`, Teal `#14B8A6`,
   Blue `#3794FF`, Indigo `#5B5BD6`, Gray `#8B949E`. Reuse an existing tag's known color — don't
   invent a new one for a name that already has a color. A group may carry several tags (or none,
   if the user prefers). Writing the chosen tags into the group JSON is enough — no need to
   pre-register them in `annotated.tags`.
3. Build the group:
   ```jsonc
   {
     "id": "<uuidgen>",
     "title": "<title>",
     "author": "<agentName>",
     "tags": [{ "name": "...", "color": "#rrggbb" }, …],  // the tag(s) chosen in step 2, each with its color
     "gitRef": null,            // or a branch/tag/SHA string
     "status": "open",
     "createdAt": <date +%s>,
     "updatedAt": <same as createdAt>,
     "annotations": [ { "id": "<uuidgen>", "file": "...", "range": {...}, "content": "...", "contentHash": "..." } ]
   }
   ```
4. Write `.annotations/groups/<title-slug>-<first-8-hex-of-id>.json` (title-slug recipe in
   `data-contract.md`). The extension reads the canonical `id` from inside the file, so the
   filename is a human-friendly handle, not load-bearing.

**Add an annotation to a group you already authored:** append to its `annotations`, recompute
nothing for existing entries, set the new entry's `contentHash`, bump `updatedAt` to `date +%s`,
and keep the group's existing tags (don't re-ask) — never add to a group authored by someone else.

## 4. Manage your own

Only on groups whose `author` is your `agentName`, and your own comment file:
- **Resolve / restore a group:** set `status` to `"resolved"` / `"open"`, bump `updatedAt`.
- **Delete an annotation:** remove it from the group's `annotations`, bump `updatedAt` — an
  emptied group (`"annotations": []`) stays valid; keep the file.
- **Delete a group:** remove its file under `.annotations/groups/` — the one whose name ends
  with the group's id segment (or the legacy `<id>.json`).
- **Edit/delete your comment:** in your own slug file, change a comment's `content`, or drop it
  from `comments`; write back.

Never modify or delete a group authored by someone else, or another author's comment file.

## 5. Update config (tags / identity)

- **Add a tag** to `annotated.tags` (`{ "name": "...", "color": "#rrggbb" }`), dedup by `name`:
  > **Optional step** — the extension auto-reconciles group tags written into the JSON into the
  > workspace config on load. You only need this step to set or override a tag's color centrally
  > rather than relying on the per-group value.
  - Choose the target: **workspace** config (`.vscode/settings.json`) or the **global** user
    config. For global, resolve the OS/flavor path (see `data-contract.md`) and confirm it before
    writing.
  - Read the target settings JSON (create `{}` if absent), merge `annotated.tags` (append or
    replace-by-name), write it back preserving other keys.
- **Set agent identity:** write `annotated.agentName` — **Project** = workspace
  `.vscode/settings.json`, **Global** = user `settings.json`. This is also how you persist the
  identity chosen in §0.
