# Tag management (rename / recolor / delete) — design

**Date:** 2026-06-01
**Status:** Approved (brainstorm)

## Problem

The extension can **create** tags (`promptNewTag` → global config) and **assign / unassign**
them to a group (the `editTags` / `bulkEditTags` QuickPick). It cannot **rename** a tag,
change an **existing** tag's color, or **delete** a tag from the palette. The only way to
recolor today is hand-editing `settings.json`.

This feature adds palette-level management — operations on tag *definitions*, not per-group
assignments.

## Background: how tags work today

- A tag is `{ name, color }` (`src/shared/model.ts`).
- The **palette** (catalog of known tags) is the union of three sources:
  1. workspace config `annotated.tags`,
  2. user / global config `annotated.tags`,
  3. tags stamped on groups in the `.annotations/*.json` files.
- **Display color** resolves by precedence: **local config → global config → JSON → default**
  (`resolveTagColor` in `src/core/tagResolve.ts`).
- `reconcileWorkspaceTags` copies any group-used tag that is missing from **both** configs
  back into **workspace** config. Consequence: a rename/delete that only edits config would be
  **resurrected** on the next reconcile — so rename and delete must also rewrite the affected
  group files.

## Decisions (from brainstorming)

1. **Delete** = full delete: remove the tag definition from config **and** strip it from every
   group that uses it. The tag truly disappears and cannot resurrect via reconcile.
2. **Entry point** = a **sidebar title-bar button** (`view/title`, navigation group) **plus** a
   Command Palette command.
3. **Recolor reach** = recoloring rewrites the stored color in **every** group's `.annotations`
   file too (full on-disk consistency), in addition to updating config.
4. **UI shape** = **Approach A**: two-step QuickPick (pick tag → pick action), reusing the
   existing `showQuickPick` / `showInputBox` primitives. (Rejected: per-item-button QuickPick —
   introduces the `createQuickPick` API used nowhere else; dedicated Svelte webview — YAGNI.)

Net effect: **all three operations rewrite both config and every affected group file.**

## Behavior

### Rename `old → new`
- If `new` already exists in the palette → **blocked** with a message (no merge semantics).
- In each config array (workspace / global) that holds `{ name: old }`, replace the name,
  preserving that array's color.
- Rewrite every group whose `tags[]` contains `old` to use `new` (preserve stored color).

### Recolor `name → color`
- Set the color in each config array that holds the tag.
- If the tag is config-less (JSON-only), add `{ name, color }` to **workspace** config (the same
  target `reconcileWorkspaceTags` uses) so the new color wins via precedence.
- Re-stamp the stored color in every group that uses the tag.

### Delete `name`
- Modal confirm showing how many groups use it
  (e.g. *"Delete tag 'X'? It will be removed from N group(s). This cannot be undone."*).
- Remove `{ name }` from **workspace and global** config.
- Strip the tag from every group's `tags[]`.

## Architecture

### Pure logic — new `src/core/tagAdmin.ts` (no `vscode`; fully unit-tested)

- `renameInConfig(arr: TagColor[], oldName: string, newName: string): TagColor[]`
- `recolorInConfig(arr: TagColor[], name: string, color: string): TagColor[]`
- `deleteFromConfig(arr: TagColor[], name: string): TagColor[]`
- `groupTagPatches(groups, op): { id: string; tags: Tag[] }[]` — the per-group new `tags[]` for a
  rename / recolor / delete op, returning **only** groups that actually change. `op` is a small
  discriminated union: `{ kind: 'rename'; from; to } | { kind: 'recolor'; name; color } |
  { kind: 'delete'; name }`.
- `groupsUsingTag(groups, name): number` — for the delete confirm message.
- `paletteHasName(palette: TagColor[], name: string): boolean` — collision check for rename.

### VSCode layer

- Extract the color-prompt half of `promptNewTag` into a reusable
  `promptTagColor(initial?: string): Promise<string | undefined>` in `src/web/tagPalette.ts`,
  used by both create and recolor. (`promptNewTag` keeps its current behavior, now delegating to it.)
- New `manageTags()` orchestrator (host side, e.g. in `tagPalette.ts` or a new
  `src/web/tagAdminCommand.ts`):
  1. Read `displayPalette(allGroups)`. If empty → info message *"No tags yet."* and return.
  2. If no workspace folder → info message and return (consistent with other handlers).
  3. QuickPick of palette tags (swatch icons via `swatchIconSvg`).
  4. Second QuickPick: *Rename* / *Change color* / *Delete*.
  5. Prompt as needed (input box for rename with non-empty + collision validation; `promptTagColor`
     for recolor; modal confirm for delete).
  6. Apply: update config via `config.update(...)` for the arrays that change; rewrite each
     affected group via `GroupStore.updateGroup(id, { tags }, now())`.
  7. `provider.refresh()` + decoration refresh (config change + file-watcher also fire, but
     refreshing directly gives immediate feedback — matches existing handlers).
- `src/web/extension.ts`: register `annotated.manageTags`; wire the orchestrator with access to the
  store / provider / refresh helpers it already constructs.
- `package.json`:
  - New command `annotated.manageTags` — title `Annotated: Manage Tags…`.
  - `menus.view/title` entry: `command: annotated.manageTags`, `when: view == annotated.sidebar`,
    `group: navigation`, with a tag-style icon (e.g. `$(tag)`).

### Data flow

```
sidebar title button / command palette
  → annotated.manageTags
    → manageTags() orchestrator (src/web)
       → tagAdmin pure fns compute config arrays + group patches
       → config.update(...)  +  GroupStore.updateGroup(...) per affected group
       → provider.refresh() + decoration refresh
```

Display color continues to resolve through the existing `tagResolve` precedence; this feature only
changes the *stored* values (config + JSON), never the resolution rule.

## Error handling & edge cases

- **Rename collision** — `new` already in palette → blocked, no change.
- **JSON-only tag recolor** — no config entry → add to workspace config so the new color wins.
- **Empty palette** — info message, no pickers.
- **No workspace folder** — info message (group rewrites need a folder).
- **Reconcile resurrection** — avoided because rename/delete always rewrite group files.
- **`updatedAt`** — bulk rewrites bump `updatedAt` via the existing `updateGroup` path. The sidebar
  lists groups in file order (no timestamp sort), so this does **not** reorder the visible list.

## Testing

- **Unit (`test:unit`, the local gate alongside check-types):** every `tagAdmin` function —
  rename/recolor/delete config mutations, `groupTagPatches` for each op (incl. "only changed groups
  returned"), `groupsUsingTag` count, `paletteHasName` collision, and the JSON-only recolor edge.
- **Host orchestration** stays thin (QuickPick / input-box glue) and is not unit-tested directly,
  consistent with the repo's "pure logic lives in core" rule. Optional integration coverage
  (`@vscode/test-web`) is out of scope for the local gate (needs network).

## Out of scope (YAGNI)

- Merging two tags during rename.
- A dedicated webview tag-manager UI.
- Bulk multi-tag operations in one pass (one tag per invocation; re-open to do another).
