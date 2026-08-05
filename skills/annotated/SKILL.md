---
name: annotated
description: Use when the user wants to annotate a codebase, or when the user asks you to perform ANY task based on existing or new annotations. Also use this skill if the user asks to update the tag palette / identity config of the vscode-annotated extension.
---

# Annotated

Participate in a `vscode-annotated` workspace by reading and writing its on-disk artifacts
directly. Everything the extension stores lives in `.annotations/` JSON files plus a few
VSCode settings — no extension API or server is involved.

## When to use

A repo has a `.annotations/groups/` directory and the user wants to: **surf** existing
annotations/threads, **reply** in a thread (annotation threads and group-level threads),
**create** annotation groups/annotations, or **update** the tag palette / agent identity.

## How to work

1. Read `references/data-contract.md` for the exact on-disk schema, the invariants, and the
   node-free recipes (content hash, UUID, timestamp, author slug). **Get the schema and the
   `contentHash` recipe right — a wrong hash makes your annotation render "stale."** An
   annotation anchors to a line range, or is a **whole-file annotation** targeting the
   file itself (`"range": null`, `"contentHash": ""`).
2. Read `references/operations.md` for the step-by-step recipe for the operation at hand
   (surf / reply / create / manage-own / config).
3. When composing annotation `content`, use **local links**
   (`[label](path/to/file.ts#L10-L20)`) to reference other code locations instead
   of adding extra annotations — see `references/data-contract.md` → "Local links
   in annotation content".

## Identity

You act under a **distinct agent identity** — not the human's. Your identity is
`annotated.agentName` from config (workspace or global). You write your groups under that
`author` and your comments to `.annotations/comments/<slug-of-agentName>.json`.

**If `annotated.agentName` is unset, establish it before your first write** — never silently
default. Ask the user to choose a name — **suggest your own identity** as the default (the
assistant you are, e.g. if you're Claude propose "Claude"; if Codex, "Codex"), but let them pick
any other — then ask where to save it: **Project** (workspace `.vscode/settings.json`),
**Global** (user `settings.json`), or **Don't save** (this session only). Once set, reuse it
without re-asking. Full steps: `references/operations.md` §0.

## Hard rules (always)

- **Establish identity before writing.** If `annotated.agentName` is unset, ask the user to
  choose one (and whether to persist it) **before** any comment, annotation, or group — never
  write under an assumed default. Reads (surfing) need no identity.
- **Own-only writes.** Create groups/annotations and reply anywhere, but **edit/resolve/delete
  only what you authored** (groups whose `author` is your identity, and your own comment file).
  Never modify or delete a human's group or another author's comments.
- **Hash honesty.** Always compute `contentHash` with the documented recipe — never a placeholder.
- **Uphold the invariants.** Group filename is `<title-slug>-<idseg>.json` (the extension keys off the in-file `id`, not the name); comment filename == author slug;
  1-based integer line ranges; epoch-**second** timestamps; 2-space JSON with no trailing newline.
- **Read fresh before write.** The extension reloads files live; re-read a file right before
  mutating it to avoid clobbering concurrent edits.
- **Leave version control to the human.** Write the files; don't `git add`/commit `.annotations/`
  unless asked.

## Installation

This skill is maintained in the `vscode-annotated` repo
(<https://github.com/EperezOk/vscode-annotated>) under `skills/annotated/`. Install it
with `gh skill install EperezOk/vscode-annotated annotated` (GitHub CLI ≥ 2.93) or
`npx skills add EperezOk/vscode-annotated` (skills.sh); both also accept local paths for
installing from a clone. For more detailed instructions or to inspect the extension's source,
look at that repo.
