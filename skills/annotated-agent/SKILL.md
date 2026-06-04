---
name: annotated-agent
description: Use when working in a repo that has a `.annotations/` directory (the vscode-annotated extension) and the user wants to surf annotation groups or comment threads, reply in a thread (on an annotation or on a group itself), create annotation groups/annotations, or update the tag palette / identity config. The agent reads and writes the `.annotations/` JSON files directly, under a distinct agent identity, using node-free shell recipes.
---

# annotated-agent

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
   `contentHash` recipe right — a wrong hash makes your annotation render "stale."**
2. Read `references/operations.md` for the step-by-step recipe for the operation at hand
   (surf / reply / create / manage-own / config).

## Identity

You act under a **distinct agent identity** — not the human's. Your identity is
`annotated.agentName` from config, falling back to `"Claude"`. You write your groups under that
`author` and your comments to `.annotations/comments/<slug-of-agentName>.json`.

## Hard rules (always)

- **Own-only writes.** Create groups/annotations and reply anywhere, but **edit/resolve/delete
  only what you authored** (groups whose `author` is your identity, and your own comment file).
  Never modify or delete a human's group or another author's comments.
- **Hash honesty.** Always compute `contentHash` with the documented recipe — never a placeholder.
- **Uphold the invariants.** Group `id` == filename stem; comment filename == author slug;
  1-based integer line ranges; epoch-**second** timestamps; 2-space JSON with no trailing newline.
- **Read fresh before write.** The extension reloads files live; re-read a file right before
  mutating it to avoid clobbering concurrent edits.
- **Leave version control to the human.** Write the files; don't `git add`/commit `.annotations/`
  unless asked.

## Installation

This skill is maintained in the `vscode-annotated` repo
(<https://github.com/EperezOk/vscode-annotated>) under `skills/annotated-agent/`. To use
it elsewhere, run its `install.sh` (see `README.md`) to symlink/copy it into `~/.claude/skills`
(global) or a target repo's `.claude/skills`. For more detailed instructions or to inspect the
extension's source, look at that repo.
