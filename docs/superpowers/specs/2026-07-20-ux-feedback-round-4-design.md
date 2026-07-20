# UX Feedback Round 4 — Design

**Date:** 2026-07-20
**Status:** Approved (user pre-waived the written-spec review gate)

## Summary

A batch of feedback gathered from real use of the extension (items 1–7 of
`TODO.md`; the separate "Share on X" item is out of scope). Five largely
independent changes — two bug fixes, one docs update, one feature cluster, and
one input-handling change:

1. **Undo (Cmd+Z)** in the markdown editors double-dispatches to the workbench.
2. The **agent skill** never documents the **internal (local) link** syntax.
3. **Git ref**: make it a sidebar **filter**, auto-capture the ref at creation,
   improve the ref **suggestions**, and add **Select All** to bulk mode.
4. Long **unbroken tokens overflow** the detail panel (no `overflow-wrap`).
5. **Absolute paths** are rejected / mis-resolved; accept them and **normalize
   to workspace-relative**.

Each item slots into an established pattern; none introduces new infrastructure.

## Decisions locked with the user

- **Git ref capture:** *auto-capture the current branch/HEAD at group creation*
  (still editable/clearable; `null` on the web host where no git extension exists).
- **Absolute paths:** *normalize to workspace-relative*. Absolute paths inside the
  workspace are converted to relative before storing/resolving; paths genuinely
  **outside** the workspace are **rejected with a clear warning** (never silently
  mis-joined).

---

## 1. Undo (Cmd+Z) in the markdown editors — bug fix

### Root cause

The CodeMirror history stack **is** wired: `MarkdownEditor.svelte` includes
`history()` and `...historyKeymap` (from `@codemirror/commands`). But the
`historyKeymap` bindings set only `preventDefault: true`, **not**
`stopPropagation: true`. In a VS Code webview a handled keydown that does not
stop propagation still bubbles to the window-level keydown forwarder, which fires
the **workbench** "Undo" keybinding. So Cmd+Z runs CodeMirror's local `undo`
**and** the global Undo — a double-dispatch that produces the "undo behaves
wrong" symptom.

This is the exact asymmetry the repo already fixed for Cmd+B/I/E: `markdownKeymap`
in `editorExtensions.ts:55-59` sets `stopPropagation: true` for precisely this
reason (the comment at `:45-53` documents the mechanism). Undo/redo were never
given the same treatment.

### Fix

In `src/webview/detail/editorExtensions.ts`, export a **contained** history
keymap — the `@codemirror/commands` `historyKeymap` entries with
`stopPropagation: true` added:

```ts
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

/** historyKeymap (undo/redo/undoSelection/redoSelection) with stopPropagation so
 *  the combo does not also fire VS Code's workbench Undo — see markdownKeymap. */
export const containedHistoryKeymap: readonly KeyBinding[] =
  historyKeymap.map((b) => ({ ...b, stopPropagation: true }));
```

In `src/webview/detail/MarkdownEditor.svelte`, replace `...historyKeymap` in the
keymap array with `...containedHistoryKeymap`. Keep it after `...defaultKeymap`
(so it still overrides), and keep the `history()` extension as-is.

Native single-line inputs (group-title rename, line-range `number` inputs, the
filter query box) are **out of scope** — they use Svelte `bind:value`, which in
Svelte 5 only writes back when the model differs from the DOM value, so native
undo is not clobbered; none of their `onkeydown` handlers intercept Cmd+Z.

### Testing

- `editorExtensions.unit.test.ts`: assert every entry in `containedHistoryKeymap`
  has `stopPropagation === true`, and that it covers the undo/redo keys (`Mod-z`,
  `Mod-y` / `Mod-Shift-z`, `Mod-u`).

---

## 2. Teach the agent skill to author internal links — docs

### Root cause

The local-links feature (`[label](src/core/foo.ts#L10-L20)`) shipped
(`2026-06-25-local-links-design.md`) but the agent skill
(`skills/annotated/{SKILL.md,references/data-contract.md,references/operations.md}`)
contains **zero** mention of it. A grep for `link`/`href`/`#L` across the skill
returns nothing. Agents therefore never use local links and reach for extra
annotations where a single link would do.

### Fix

Document the syntax the extension already owns, keeping the skill's canonical
guidance (**write workspace-relative POSIX paths for portability**):

- **`references/data-contract.md`** — add a short *"Local links in annotation
  content"* note near the group schema: markdown links whose target is a
  workspace-relative path plus an `#L` line fragment are recognized and become
  click-to-reveal links in the detail panel.
  - Syntax: `[label](path/to/file.ts#L42)` (single line) or
    `[label](path/to/file.ts#L10-L20)` (range, 1-based inclusive).
  - A target with an `http(s)`/`scheme:` prefix or no `#L` fragment is a normal
    link, not a local link.
- **`references/operations.md` §3 (create)** — add a bullet under composing
  `content`: prefer a local link to reference *other* code locations
  (call sites, related types, prior art) instead of creating extra annotations
  just to point at them; keep the annotation's own `file`/`range` for the code
  the note is *about*.
- **`SKILL.md`** — one line under "How to work" pointing at the local-link note
  (so the three docs stay discoverable together).

### Testing

- Extend `src/shared/skillContract.unit.test.ts` with a light drift guard: assert
  the canonical link-syntax token (`#L`) appears in both `data-contract.md` and
  `operations.md`, so the two references cannot silently drift out of lockstep
  (mirrors the existing group-filename invariant guard).

---

## 3. Git ref — filter, auto-capture, better suggestions, Select All

Groups already carry `gitRef: string | null` (`model.ts:47`), validated in
`parseGroup`, defaulted in `createGroup` (`annotationFactory.ts`), and patchable
via `GroupStore.updateGroup`. Today it is **display/edit-only** (shown read-only
in `GroupView.svelte`, set via the `onEditGitRef` / `onBulkEditGitRef` QuickPicks
in `extension.ts`); it is never used for filtering and never auto-populated.

### 3a. Auto-capture at creation

- **`src/core/gitRefs.ts`** — add a pure `currentRef(info: GitRefInfo): string | null`
  that prefers the current **branch name**, else the **short HEAD SHA**, else
  `null`.
- **`src/web/gitRefsSource.ts`** — extend `readGitRefInfo` to also read the HEAD
  branch name. The git API's `HEAD` object exposes `name` (branch) in addition
  to `commit`; extend the local `GitRepository` interface accordingly and set a
  new `GitRefInfo.headBranch?: string`.
- **`src/core/createAnnotationFlow.ts`** — `createGroup(...)` already accepts a
  `gitRef`; thread a resolved ref into it (a new dependency
  `getGitRef?: () => string | null` or pass the value in).
- **`src/web/createAnnotationCommand.ts`** — resolve the ref at command time via
  `readGitRefInfo()` + `currentRef(...)` and pass it into the flow. On the web
  host (no git extension) this is `null` — new groups simply carry no ref, which
  is fine.
- The ref remains fully editable/clearable afterward (existing edit/bulk-edit
  paths unchanged).

### 3b. Better ref suggestions

Today `readGitRefInfo` returns only **local** branches (`ref.type === 0`), tags
(`type === 2`), and one HEAD short SHA. Remote branches (`type === 1`) are
dropped and there are no recent commits.

- **`src/web/gitRefsSource.ts`** — also collect **remote branches**
  (`ref.type === 1`) into a new `remoteBranches: string[]`, and **recent commits**
  via `repo.log({ maxEntries: 20 })` into `commits: { sha: string; summary: string }[]`
  (short sha + first line of the message). Extend the `GitRepository`/`GitApi`
  interfaces for `log`. Guard with try/catch (as today) so a `log` failure
  degrades to no commits rather than throwing.
- **`src/core/gitRefs.ts`** — `GitRefInfo` gains **optional** `remoteBranches?:
  string[]` and `commits?: { sha: string; summary: string }[]` (both treated as
  `[]` when absent, so existing callers/tests that build `{ headSha, branches,
  tags }` keep compiling). `gitRefSuggestions` appends, in order: HEAD short SHA →
  local branches → remote branches (`description: 'remote branch'`) → tags →
  recent commits (`label: '<short sha> — <summary>'`, **`ref: '<short sha>'`**,
  `description: 'commit'`).
- **`src/web/extension.ts`** — the `onEditGitRef` / `onBulkEditGitRef` QuickPicks
  currently store `picked.label` as the ref. For recent commits `label` (`sha —
  summary`) ≠ `ref` (`sha`), so the QuickPick items must **carry `ref`** and store
  `picked.ref ?? picked.label` (an item type with an optional `ref` field).
- Web-host degradation is unchanged and acceptable: no git extension → empty
  suggestions → the QuickPick falls back to free-text entry (existing behavior in
  `extension.ts`). This is called out, not silently accepted.

### 3c. Filter groups by git ref (sidebar)

Mirror the existing **author** filter exactly:

- **`src/core/sidebarState.ts`**
  - `SidebarState`: add `selectedGitRefs: string[]`.
  - `initialSidebarState`: add `selectedGitRefs: []`.
  - `applyHostMessage`/`setState`: prune `selectedGitRefs` to refs that still
    exist (mirror the `selectedAuthors.filter(...)` retention).
  - add `availableGitRefs(groups): string[]` — sorted, de-duped, non-null
    `g.gitRef` values.
  - add a git-ref clause to `filterGroups`: if any refs selected, keep groups
    whose `gitRef` is in the set.
- **`src/webview/sidebar/state.ts`** — add `toggleGitRefFilter` (mirror
  `toggleAuthorFilter`).
- **`src/webview/sidebar/FilterBar.svelte`** — add a third
  `<FilterPicker label="Git ref" …>` after Authors, wired to
  `availableGitRefs`, `selectedGitRefs`, `toggleGitRefFilter` (no color swatch).
- **`src/webview/sidebar/App.svelte`** — pass the new options/selection/handler
  through.

### 3d. "Select All" in bulk mode

The "select multiple groups" flow is the sidebar **bulk mode** (a per-card
checkbox set — not a `canPickMany` QuickPick). Add batch selection to the bulk
action bar:

- **`src/webview/sidebar/state.ts`** — add `selectAll(visibleIds: string[])`
  (sets `selectedGroupIds = visibleIds`) and `clearSelection()` (sets `[]`).
- **`src/webview/sidebar/App.svelte`** — in the `{#if $sidebar.bulkMode}` action
  bar, add a **"Select all (N)"** / **"Clear"** control. **N and the target set
  are the currently *filtered/visible* groups** (`filterGroups($sidebar)`,
  already computed in `App.svelte`), so Select All respects active filters.
  Toggle to "Clear" when all visible are already selected.

### Testing

- `gitRefs.unit.test.ts`: `currentRef` (branch > short-sha > null);
  `gitRefSuggestions` includes remote branches + recent commits in the specified
  order.
- `sidebarState.unit.test.ts`: `availableGitRefs`; `filterGroups` git-ref clause;
  `selectedGitRefs` pruning in `applyHostMessage`.
- `FilterBar.svelte.test.ts`: renders the Git ref picker; toggling fires the
  handler.
- `App.svelte.test.ts`: Select All selects exactly the visible/filtered ids;
  Clear empties; the control reflects all-selected state.
- Auto-capture: `createAnnotationFlow.unit.test.ts` passes a stub ref through to
  the created group; the thin command wiring (readGitRefInfo → currentRef) is
  covered in the integration tier where feasible.

---

## 4. Long unbroken tokens overflow the detail panel — CSS

### Root cause

`MarkdownPreview.svelte`'s `.md-preview` sets no `overflow-wrap`/`word-break`, so
the default `overflow-wrap: normal` applies and text only breaks at whitespace —
a long unbroken token (bare URL via `linkify`, long identifier, inline code)
overflows horizontally and bleeds past / scrolls the whole panel. Only `<pre>`
sets `overflow-x: auto`, which is why fenced code blocks scroll correctly and
must stay that way. The same gap exists on some sidebar/detail titles.

### Fix (style-only)

- `MarkdownPreview.svelte`: add `overflow-wrap: break-word;` to `.md-preview`
  (and to inline `code` and `a`, the usual offenders). **Leave `<pre>` as-is**
  (keep horizontal scroll for code blocks).
- `sidebar/GroupCard.svelte`: `overflow-wrap: break-word` on `.title`, `.meta`,
  and `.chip`.
- `detail/GroupView.svelte`: `overflow-wrap: break-word` on `.title` and
  `.gitref-row code`.

### Testing

Style-only and visual. Verified by running the app (`/run`) and a manual smoke
(paste a long unbroken URL/identifier into an annotation body and a group title;
confirm it wraps while a fenced code block still scrolls). No brittle CSS unit
assertions — the plan states this verification explicitly rather than claiming a
test tier it can't honestly cover.

---

## 5. Accept absolute paths → normalize to workspace-relative

### Root cause

Paths are stored workspace-relative (`asRelativePath(uri, false)` at capture).
Absolute paths break at resolution:

- `src/shared/path.ts` `safeRelativeSegments` returns `null` for any `/`-leading
  or `[a-zA-Z]:` path — the hard gate.
- `src/web/navigateToCode.ts` `revealLocation` (local links) turns that `null`
  into an "outside the workspace" warning.
- `revealAnnotation` uses raw `annotation.file.split('/').filter(Boolean)` with
  **no** absolute handling → an absolute annotation `file` is silently
  mis-joined under the workspace root (wrong file / open failure, no warning).
- `src/shared/locationLink.ts` `parseLocationLink`'s scheme regex
  (`/^[a-z][a-z0-9+.-]*:/i`) rejects `C:/…` drive paths at parse time.

### Fix

**Normalize to relative** (per the locked decision), keeping everything web-safe
(no Node `path`; still `vscode.Uri.joinPath(folder, …segments)`):

- **`src/shared/path.ts`** — add a pure
  `toWorkspaceRelativeSegments(input: string, workspaceRoot?: string): string[] | null`:
  - If `input` is absolute (`/`-leading or drive) **and** `workspaceRoot` is
    provided **and** `input` is inside `workspaceRoot` → strip the root prefix and
    return the remaining safe segments.
  - If absolute and **outside** `workspaceRoot` (or `workspaceRoot` absent) →
    `null` (reject).
  - If relative → today's `safeRelativeSegments` behavior (still rejects `..`
    escapes and `scheme:`/drive forms when no root context).
  - Keep `safeRelativeSegments` (or express it in terms of the new helper) so
    existing callers keep compiling.
- **`src/web/navigateToCode.ts`**
  - `revealLocation`: use `toWorkspaceRelativeSegments(file, folderUri.path)`;
    on `null` keep the existing warning.
  - `revealAnnotation`: replace the raw `split('/')` with the same helper +
    workspace root; on `null` show a warning (a clear message) instead of
    silently mis-joining — an honest improvement over today.
- **`src/shared/locationLink.ts`** — **no code change.** A leading-`/` POSIX
  absolute already parses (it has no URL scheme). A Windows **drive** absolute
  (`C:/…`) stays rejected at parse (it matches the scheme guard) — accepted as a
  documented limitation, since POSIX/darwin + the web host are the primary
  targets and relaxing the guard risks misreading real single-letter schemes.
  A confirming test is added.
- **Capture side** — `createAnnotationCommand.ts` / `copyLocationLinkCommand.ts`
  already emit relative for in-workspace files via `asRelativePath(uri, false)`;
  no change required. (Out-of-workspace capture remains an edge case handled at
  resolution by the reject-with-warning path.)
- **Skill docs** stay consistent: agents should still **write** workspace-relative
  paths; absolute input is accepted and normalized on read, but relative is the
  portable, canonical form (noted in `data-contract.md`).

### Testing

- `path.unit.test.ts`: `toWorkspaceRelativeSegments` — absolute-inside-root →
  relative segments; absolute-outside-root → `null`; `..`-escape → `null`;
  relative passthrough; no-root + absolute → `null`.
- `locationLink.unit.test.ts`: leading-`/` POSIX absolute parses to `{file,range}`;
  a Windows drive absolute stays `null` (documented limitation); a real
  `http(s)://…#L1` stays `null`.
- `navigate.integration.test.ts`: an absolute-inside annotation/link resolves to
  the correct document + highlight; an absolute-outside target warns and no-ops
  (no throw).

---

## Non-goals

- **"Share on X"** (`TODO.md` item 8) — separate effort.
- **Multi-root workspaces** — resolution still uses the first workspace folder
  (a pre-existing deferral).
- **Drift/anchoring of local-link line numbers** — unchanged from the local-links
  v1 non-goal.
- **Storing absolute paths** — explicitly rejected in favor of normalization to
  keep annotation JSON portable.
- **Windows drive-letter absolute paths in local links** (`C:/…#L1`) — stay
  rejected at parse (POSIX/darwin + web are the primary targets).

## Packaging & execution

- One spec (this file). Executed **subagent-driven** on a single
  `ux-feedback-round-4` branch, merged to `main` locally when green (no push —
  the user pushes).
- The five items are largely independent → separate sub-plans / commits. Suggested
  order (foundation-first, cheap-verification-first):
  1. **Item 1** (undo) — small, self-contained.
  2. **Item 4** (overflow CSS) — self-contained, visual verify.
  3. **Item 5** (paths) — pure helper + navigation wiring; foundational.
  4. **Item 3** (git ref) — the largest cluster (3a–3d).
  5. **Item 2** (skill docs) — references item-5's relative-path guidance; do last.
- Local gate: `npm run check-types` + `npm run test:unit`
  (integration/e2e need network — run when available).

## File change summary

**Changed (code):**
- `src/webview/detail/editorExtensions.ts` — `containedHistoryKeymap`
- `src/webview/detail/MarkdownEditor.svelte` — use it
- `src/core/gitRefs.ts` — `currentRef`, `GitRefInfo` gains `headBranch`,
  `remoteBranches?`, `commits?`; `gitRefSuggestions` extended
- `src/web/gitRefsSource.ts` — read HEAD branch, remote branches, recent commits
- `src/web/extension.ts` — capture ref on create; QuickPick items carry `ref`
- `src/core/createAnnotationFlow.ts` + `src/web/createAnnotationCommand.ts` —
  thread the captured ref into `createGroup`
- `src/core/sidebarState.ts` — `selectedGitRefs`, `availableGitRefs`,
  `filterGroups` clause, pruning
- `src/webview/sidebar/{state.ts,FilterBar.svelte,App.svelte}` — git-ref picker;
  `selectAll`/`clearSelection` + Select All control
- `src/shared/path.ts` — `toWorkspaceRelativeSegments`
- `src/web/navigateToCode.ts` — use it in `revealLocation` + `revealAnnotation`
- `src/webview/detail/MarkdownPreview.svelte`,
  `src/webview/sidebar/GroupCard.svelte`,
  `src/webview/detail/GroupView.svelte` — `overflow-wrap: break-word`

**Changed (docs):**
- `skills/annotated/SKILL.md`
- `skills/annotated/references/data-contract.md`
- `skills/annotated/references/operations.md`

**Tests:** `editorExtensions.unit.test.ts`, `gitRefs.unit.test.ts`,
`sidebarState.unit.test.ts`, `FilterBar.svelte.test.ts`, `App.svelte.test.ts`,
`createAnnotationFlow.unit.test.ts`, `path.unit.test.ts`,
`locationLink.unit.test.ts`, `skillContract.unit.test.ts`,
`navigate.integration.test.ts`.
