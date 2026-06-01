# Design — UX Feedback Round 2

**Date:** 2026-06-01
**Status:** Proposed
**Source:** `TODO.md` (second round of feedback after testing the round-1 build)

## Overview

Five items. Four are small UX polish; one (tag colors in JSON + config reconciliation) is a
data-model change with config-precedence logic.

| § | Item | Summary |
|---|------|---------|
| A | #1 | Tag-selection QuickPicks show each tag's **color swatch** next to the name |
| B | #2 | Sidebar **Refresh** button shows transient "✓ Refreshed" feedback |
| C | #3 | Store tag **colors in group JSON** (`tags: {name,color}[]`); auto-add group tags missing from settings to **workspace** config; color precedence **local > global > JSON** |
| D | #4 | Group-view annotation rows show **filename + line range** only, not the full path |
| E | #5 | Gutter **hover** shows group name + **truncated annotation content**, not the file path |

## Decisions locked during brainstorming

- **C — JSON shape:** `tags` becomes a list of `{ name, color }` objects (not a side map). Invasive
  (touches every `group.tags` consumer) but the cleanest self-contained format. Legacy `string[]`
  tag arrays are migrated on read.
- **C — reconciliation trigger:** automatically on load (activation + annotation-file changes),
  writing missing tags to **workspace** settings (`.vscode/settings.json`). Idempotent.
- **C — new-tag target:** unchanged — newly created tags still go to **global** user settings.

---

## §A — Tag color in selection QuickPicks (#1)

Three QuickPicks let you pick existing tags for a group: `pickTags` (create flow,
`createAnnotationCommand.ts`), `onEditTags`, and `onBulkEditTags` (`extension.ts`). Today each
palette item is `{ label: t.name }`. Add the color swatch icon already used by `promptNewTag`:
`iconPath: vscode.Uri.parse(swatchIconSvg(t.color))`. The palette comes from the existing read
(config palette pre-§C; the §C resolved palette improves the colors automatically once it lands).
Mechanical, mirrors `promptNewTag`.

---

## §B — Refresh success feedback (#2)

Mirror the §5 "Copied" pattern from round 1: the sidebar `refresh-btn` in `App.svelte` shows a
transient **"✓ Refreshed"** label for ~1.5s after click, then reverts. Optimistic (shown on click,
local Svelte state + timeout) — the host reload is reliable and a round-trip ack would be noisier.
Component-tested: click → label flips → (revert not asserted, timer-flush). No host/protocol change.

---

## §C — Tag colors in JSON + config reconciliation + precedence (#3)

The headline item. Today `AnnotationGroup.tags: string[]` (names only) and colors live solely in
`annotated.tags` config. We make groups self-contained and add a precedence/reconciliation model.

### C1 — Model change (`shared/model.ts`)

`AnnotationGroup.tags` becomes `Tag[]` where `Tag = { name: string; color: string }` (reuse the
existing `core/tags.ts` `Tag`). `parseGroup` accepts **both** formats for backward compatibility:

- New: `tags: [{ name, color }]` → validated as objects (name + color strings).
- Legacy: `tags: ["security"]` → migrated to `[{ name: "security", color: "#888888" }]` (the neutral
  default; the real color resolves from config, and gets stamped on the next save).

Mixed arrays are tolerated element-by-element. `serializeGroup` is unchanged (JSON.stringify emits
the objects).

### C2 — Display vs. persisted color (precedence: local > global > JSON)

Two distinct color notions:

- **Persisted (JSON) color** — `group.tags[i].color`, a snapshot written at save time. Lowest precedence.
- **Display color** — what chips/gutter/pickers show, resolved per tag name by **local config color →
  global config color → JSON color → `#888888`**.

A new pure module `core/tagResolve.ts`:
- `jsonTagColors(groups): Map<string,string>` — first-seen color per tag name across groups.
- `resolveTagColor(name, { local, global, json }): string` — the precedence chain.
- `resolveDisplayPalette(local, global, groups): TagColor[]` — union of all tag names (config ∪
  groups), each resolved → the palette the host sends to webviews (replaces raw `readTagPalette()`).
- `missingWorkspaceTags(local, global, groups): TagColor[]` — tags used by groups but absent from
  **both** local and global config, paired with their JSON color (for reconciliation).

Local vs. global config is read via `config.inspect('annotated.tags')` → `workspaceValue` (local) /
`globalValue` (global) in `web/tagPalette.ts` (`readTagSources()`).

### C3 — Stamping colors on save

When a group's **tags change** (create + tag edits), the web layer resolves each tag's display color
and writes it into `group.tags[].color` before persisting (so the JSON snapshot reflects the
best-known color). Other saves (content/range/reorder/status) leave tags untouched. The create flow
already carries `Tag[]` once `pickTags` returns resolved `{name,color}`; tag-edit patches
(`updateGroup`) take `Tag[]` instead of `string[]`.

### C4 — Reconciliation (auto-add to workspace config)

On **activation** and on **annotation-file changes** (the existing `.annotations/**/*.json` watcher),
the host computes `missingWorkspaceTags(...)` and, if non-empty, appends them to the **workspace**
`annotated.tags` (`ConfigurationTarget.Workspace`). Idempotent — once present, nothing is written, so
it converges and won't loop with the config-change listener (which only refreshes decorations).

### C5 — Consumers of `group.tags` to update (name access)

The shape change ripples to every name-based consumer; display colors come from the resolved palette,
not `tag.color` directly:
- `core/sidebarState.ts`: `availableTags` (`g.tags.map(t => t.name)`), `filterGroups`
  (`g.tags.some(t => selected.includes(t.name))`).
- `webview GroupView.svelte` / `GroupCard.svelte`: `{#each group.tags as t}` → `t.name`; chip
  background still `tagColor(palette, t.name)` (resolved palette).
- `core/createAnnotationFlow.ts` + `web/createAnnotationCommand.ts`: `pickTags(): Promise<Tag[]>`
  (web resolves names→colors); flow stores `Tag[]`.
- `core/annotationFactory.ts` `createGroup`: `tags: Tag[]`.
- `core/groupStore.ts` `updateGroup` patch: `tags?: Tag[]`.
- `web/extension.ts` `onEditTags`/`onBulkEditTags`: resolve picked names → `Tag[]` before patching.
- Test fixtures with non-empty `tags` must be updated to the `{name,color}` shape (the format change's
  main churn — isolated to sub-plan 5b).

### C6 — Webview palette

The host already sends `palette: TagColor[]` with every `setGroup`/`setState`. It now sends
`resolveDisplayPalette(...)` (config + JSON, precedence-resolved) instead of raw `readTagPalette()`,
so chips/pills reflect precedence and include JSON-only tags. The webview's `tagColor(palette, name)`
lookup is unchanged.

---

## §D — Group-view rows: filename + range only (#4)

`AnnotationRow.svelte` shows `${annotation.file}:${start}–${end}` (full workspace-relative path). Show
only the **basename**. Add a pure `fileName(path)` helper in `src/shared/path.ts` returning the last
`/` segment; the row shows `${fileName(file)}:${start}–${end}` with the full path as the element `title`
(hover tooltip). The detail-panel bar (`AnnotationView`, used for "copy path") keeps the full path.

---

## §E — Gutter hover: group + truncated content (#5)

In `GutterDecorationManager.hoverFor`, the per-annotation link label is currently
`${group.title} · ${annotation.file}:${range}`. Change it to `${group.title} · ${snippet}` where
`snippet = oneLine(annotation.content) || '(empty)'` (reuse `detailState.oneLine`, which trims to one
line and truncates with an ellipsis). The `hoverMarkdown` pure function is unchanged (it formats
whatever label it's given); only the label construction in the manager changes.

---

## Out of scope / non-goals

- No change to the comment file format.
- New-tag creation target stays global (per decision); only reconciliation writes to workspace.
- Multi-root workspaces: `inspect().workspaceValue` is treated as "local"; folder-specific
  (`workspaceFolderValue`) handling is not added.
- The detail-panel location bar keeps the full path (it backs "copy path").

## Testing strategy

- **Unit (Vitest):** `parseGroup` round-trips new `{name,color}` tags AND migrates legacy `string[]`;
  `jsonTagColors`, `resolveTagColor`, `resolveDisplayPalette`, `missingWorkspaceTags`; `fileName`;
  updated `availableTags`/`filterGroups`; `createAnnotationFlow` storing `Tag[]`.
- **Svelte component tests:** `App` refresh "✓ Refreshed" transient; `AnnotationRow` shows basename
  (+ full path title); `GroupView`/`GroupCard` chips updated for `t.name`/resolved palette.
- **Integration (`@vscode/test-web`):** reconciliation writes missing tags to workspace config;
  resolved palette reaches the webview. (Config writes/decorations are partly observable.)
- **Honest gaps:** QuickPick swatch icons (§A) and the gutter hover (§E) are `vscode`-glue / not
  decoration-queryable — verified by type-check + manual. `config.inspect`/`update(Workspace)` paths
  are integration/manual-verified.

## Decomposition into sub-plans (single branch `phase-5`)

Built subagent-driven (fresh subagent per task, spec + code-quality review between tasks), proceeding
autonomously across sub-plans.

1. **5a — Small UX batch (§A, §B, §D, §E):** swatch icons in selection QuickPicks; refresh "✓
   Refreshed"; `fileName` + basename rows; gutter hover content snippet. Independent, low-risk; ships
   first.
2. **5b — Tag model format change (§C1, §C3 mechanism, §C5):** `tags: Tag[]` + `parseGroup` migration;
   update every name-based consumer + fixtures so the codebase compiles and all tests pass with
   **behavior unchanged** — `pickTags`/tag-edits resolve colors from the **config palette**
   (`readTagPalette`) and stamp them into `group.tags[].color`. Isolates the churn.
3. **5c — Color resolution + reconciliation (§C2, §C4, §C6, refines §C3):** `core/tagResolve.ts`;
   `web/tagPalette.ts` `readTagSources`/`resolveDisplayPalette`/`reconcileWorkspaceTags`; switch
   stamping **and** the webview palette from the raw config palette to the **resolved** precedence
   (local > global > JSON); reconcile on activation + watcher. Layers the new precedence behavior.
