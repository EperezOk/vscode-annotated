# Operations

All paths are workspace-relative. See `data-contract.md` for the exact schema, invariants,
and the node-free recipes (hash / id / timestamp / slug). **Always uphold the invariants and
the safety rules in `SKILL.md`.**

## 1. Surf / read

- **List groups:** read each `.annotations/groups/*.json`; for each report
  `title` · `author` · `tags` · `status` · `annotations.length`.
- **Filter:** by tag (`tags` includes X), author (`author` == X), or status
  (`status` == `open`/`resolved`).
- **Open an annotation:** read its `file` over the lines in `range` to see the code in context.
- **Assemble a thread for an annotation `A`:** read every `.annotations/comments/*.json`,
  collect comments where `annotationId == A.id`, sort ascending by `timestamp`, and present
  each as `author` · (relative time from `timestamp`) · `content`.

`grep`/`jq` are optional conveniences; your Read tool over the JSON is sufficient.

## 2. Reply in a thread

1. Determine your identity: `agentName` = `annotated.agentName` from config, else `"Claude"`.
2. Compute your comment-file slug from `agentName` (slug recipe) → path
   `.annotations/comments/<slug>.json`.
3. Read that file if it exists; otherwise start `{ "author": "<agentName>", "email": "", "comments": [] }`.
4. Append a comment: `{ "id": "<uuidgen>", "annotationId": "<the annotation's id>", "content": "<markdown>", "timestamp": <date +%s> }`.
5. Write the file back (2-space indent, no trailing newline).

You may reply to **any** annotation, but only ever write your **own** slug file.

## 3. Create an annotation group (and annotations)

1. For each annotation, gather `file` (workspace-relative POSIX), 1-based inclusive `range`,
   and markdown `content`. Compute `contentHash` via the hash recipe with that `file`/range.
2. Build the group:
   ```jsonc
   {
     "id": "<uuidgen>",
     "title": "<title>",
     "author": "<agentName>",
     "tags": [<tag names — must exist in the palette, or add them first (op 5)>],
     "gitRef": null,            // or a branch/tag/SHA string
     "status": "open",
     "createdAt": <date +%s>,
     "updatedAt": <same as createdAt>,
     "annotations": [ { "id": "<uuidgen>", "file": "...", "range": {...}, "content": "...", "contentHash": "..." } ]
   }
   ```
3. Write `.annotations/groups/<id>.json` — **the filename stem MUST equal `id`**.

**Add an annotation to a group you already authored:** append to its `annotations`, recompute
nothing for existing entries, set the new entry's `contentHash`, and bump `updatedAt` to `date +%s`.

## 4. Manage your own

Only on groups whose `author` is your `agentName`, and your own comment file:
- **Resolve / restore a group:** set `status` to `"resolved"` / `"open"`, bump `updatedAt`.
- **Delete a group:** remove its `.annotations/groups/<id>.json`.
- **Edit/delete your comment:** in your own slug file, change a comment's `content`, or drop it
  from `comments`; write back.

Never modify or delete a group authored by someone else, or another author's comment file.

## 5. Update config (tags / identity)

- **Add a tag** to `annotated.tags` (`{ "name": "...", "color": "#rrggbb" }`), dedup by `name`:
  - Ask the user whether to write the **workspace** config (`.vscode/settings.json`) or the
    **global** user config. For global, resolve the OS/flavor path (see `data-contract.md`) and
    **confirm it before writing**.
  - Read the target settings JSON (create `{}` if absent), merge `annotated.tags` (append or
    replace-by-name), write it back preserving other keys.
- **Set agent identity:** write `annotated.agentName` to the workspace `.vscode/settings.json`.
