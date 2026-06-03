# Design — UX Feedback Round 3

**Date:** 2026-06-03
**Status:** Approved (brainstormed + approved in session)
**Source:** `TODO.md` "Product feedback" section (third round of feedback)

## Overview

Thirteen items: two bug fixes with identified root causes (§A git identity, §H new-tag
QuickPick, §I autofocus), a batch of small UX tweaks, and one feature (§J group comments +
comment indicators).

| § | TODO # | Item |
|---|--------|------|
| A | 1 | Load author name from git config reliably (desktop); reword the name prompt |
| B | 2 | Create Annotation keybinding works with no selection (cursor line) |
| C | 3 | Detail view shows file basename + collapsed single-line range |
| D | 4 | Right-click delete for annotations (group view) and groups (sidebar) |
| E | 5 | Default keybinding for focusing the Annotations view |
| F | 6 | Remove the Ping command |
| G | 7 | Cmd/Ctrl+Enter submits from inside the Markdown editor |
| H | 8 | Bug: "New tag" option in tag QuickPick can silently do nothing |
| I | 9 | Bug: autofocus on the Markdown editor after create is unreliable |
| J | 10 | Group comments + comment-count indicators (cards + rows) |
| K | 11 | Other authors' comment names in a different color |
| L | 12 | Edit buttons autofocus the input/editor with cursor at end |

## Decisions locked during brainstorming

- **§A scope:** the user hit the bug on **desktop** VS Code → harden the `vscode.git`
  extension path (init race). No web-host git fallback (the git extension does not exist
  there; parsing `.git/config` only covers repo-local `user.name` — out of scope).
- **§D empty groups:** deleting the last annotation **keeps the (empty) group**; groups are
  deleted explicitly via their own context menu.
- **§E keybinding:** `ctrl+alt+l` / `cmd+alt+l` (stays in the existing Cmd/Ctrl+Alt family;
  unbound by default in VS Code).
- **§H behavior:** checking "New tag…" proceeds **immediately** to the name/color prompts;
  Enter on the highlighted-but-unchecked "New tag…" also counts. Enter with nothing checked
  and a regular tag highlighted still means "no tags" (unchanged), so cancel-free no-tag
  creation keeps working.

---

## §A — Git-config author name + prompt text (#1)

**Root cause (desktop):** `gitUserName()` (`web/authorSources.ts`) activates the built-in
`vscode.git` extension and immediately reads `getAPI(1).repositories[0]`. The git API starts
in `state: 'uninitialized'` and `repositories` stays empty until async repo discovery
finishes, so resolution falls through to the input-box prompt.

**Fix:**

- Extend the minimal `GitApi` typing with `state: 'uninitialized' | 'initialized'` and
  `onDidChangeState(listener): Disposable`.
- New helper `waitForGitInit(api, timeoutMs ≈ 2000): Promise<void>` — resolves immediately
  when `state === 'initialized'`, otherwise on the first `onDidChangeState` to
  `'initialized'` or on timeout (then the caller reads whatever `repositories` holds; empty
  → `undefined` → fall through, as today). Takes the minimal interface so Vitest can drive
  it with fakes; lives in `core/` (pure — no `vscode` import).
- `gitUserName()` and `gitUserEmail()` await the helper after `getAPI(1)`.
- Prompt text: `'Your name for annotations'` → **`'User name for annotations'`**.

The resolution chain in `core/authorIdentity.ts` (git → setting → GitHub → prompt) is
unchanged.

## §B — Create Annotation with no selection (#2)

`getSelection` (`web/createAnnotationCommand.ts`) already collapses an empty selection to
the cursor line (start == end == cursor). The only blocker is the keybinding `when` clause.

**Fix:** in `package.json`, the `annotated.createAnnotation` keybinding `when` becomes
`editorTextFocus` (drop `&& editorHasSelection`).

## §C — Detail view location: basename + collapsed range (#3)

- New pure `formatLineRange(range: LineRange): string` in `shared/model.ts` — `"12"` when
  `startLine === endLine`, else `"12–18"` (en dash, as today).
- `AnnotationView.svelte`: the location bar shows
  `${fileName(annotation.file)}:${formatLineRange(range)}` with the **full**
  `file:start–end` as the element `title`. The "⧉ path" button **keeps copying the full
  path:range** (unchanged payload). Range-edit mode keeps the two number inputs, prefixed by
  the basename instead of the full path.
- `AnnotationRow.svelte` adopts `formatLineRange` for its range too (consistency); basename
  display there already landed in round 2.

## §D — Right-click deletes via native webview context menus (#4)

Native VS Code webview context menus: elements set a `data-vscode-context` attribute;
commands contributed to `menus.webview/context` appear in the native right-click menu and
receive the context object as their argument. (Rejected alternative: a custom Svelte
context-menu component — more code, non-native look, focus/dismiss handling.)

- `GroupCard.svelte` root element:
  `data-vscode-context={JSON.stringify({ webviewSection: 'group', groupId: group.id, preventDefaultContextMenuItems: true })}`.
- `GroupView.svelte` annotation row wrapper:
  `{ webviewSection: 'annotation', groupId, annotationId, preventDefaultContextMenuItems: true }`.
- `package.json`:
  - commands `annotated.deleteGroup` ("Delete Group") and `annotated.deleteAnnotation`
    ("Delete Annotation");
  - `menus.webview/context`: deleteGroup when
    `webviewId == 'annotated.sidebar' && webviewSection == 'group'`; deleteAnnotation when
    `webviewId == 'annotated.detail' && webviewSection == 'annotation'`;
  - both hidden from the palette (`menus.commandPalette` with `"when": "false"`) — they
    require args.
- Core: pure `removeAnnotation(group, annotationId, now)` in `core/annotationFactory.ts`
  (mirror of `addAnnotation`; bumps `updatedAt`) + `GroupStore.deleteAnnotation(groupId,
  annotationId, now)` returning `false` when group/annotation is missing. Deleting the last
  annotation leaves an empty group.
- Host handlers (`web/extension.ts`): both confirm with the existing modal
  "…cannot be undone" pattern (group delete names the group title), then delete, then
  `provider.refresh()` + decoration refresh, mirroring existing delete paths. Detail-panel
  sync: `deleteAnnotation` is initiated from the detail webview, so the group is displayed —
  refresh it unconditionally via `showGroupWithStale(groupId)`. `deleteGroup` is
  sidebar-initiated — only clear/refresh the detail panel when it currently shows that group
  (new `DetailPanelProvider.currentGroupId(): string | null` getter; a deleted group then
  resolves to `null` → empty panel). Bulk delete keeps its existing behavior (out of scope).

## §E — Focus-annotations-view keybinding (#5)

`package.json` keybindings += `{ "command": "annotated.sidebar.focus", "key": "ctrl+alt+l",
"mac": "cmd+alt+l" }` — the command is auto-generated by VS Code for the view; no `when`
clause (works from anywhere).

## §F — Remove Ping (#6)

Remove the `annotated.ping` command from `package.json` and `extension.ts`. The activation
smoke test (`web/test/suite/extension.test.ts`) asserts instead that
`annotated.createAnnotation` appears in `vscode.commands.getCommands(true)`.

## §G — Mod-Enter submits (#7)

- `MarkdownEditor.svelte` gains `onSubmit?: () => void`; a `Mod-Enter` keybinding is placed
  **ahead of** the default keymap (which otherwise maps Mod-Enter to `insertBlankLine`) and
  returns `true` only when the prop is provided.
- Wired in all three hosts: `AnnotationView` content editor → `save()`; `CommentThread`
  composer → `addReply()` (the empty-draft guard stays); `CommentThread` edit editor →
  `saveEdit(id)`.
- `__mocks__/MarkdownEditorStub.svelte` passes `onSubmit` through so component tests can
  trigger it.

## §H — New-tag QuickPick bug (#8)

**Root cause:** all three tag pickers use `showQuickPick(..., { canPickMany: true })` with a
pinned `$(add) New tag…` item. In a multi-select QuickPick, **Enter accepts the *checked*
items** — pressing Enter while "New tag…" is merely highlighted returns `[]`, so `addNew`
stays false and (in the create flow) the group is created tag-less. Likeliest repro: empty
palette, where "New tag…" is the only item.

**Fix:** new shared `pickTagsWithNewOption(palette, { placeHolder, preselectedNames? }):
Promise<Tag[] | undefined>` in `web/tagPalette.ts`, built on `createQuickPick`:

- items: palette tags with swatch icons (+ `picked` from `preselectedNames`) + pinned
  "New tag…";
- `onDidChangeSelection`: the moment "New tag…" becomes checked → accept (it is an action,
  not a tag);
- `onDidAccept`: `names` = checked tag labels; `addNew` additionally true when nothing is
  checked and the **active** item is "New tag…";
- `addNew` → existing `promptNewTag()`; created tag appended; result mapped to `Tag[]` via
  `tagColor(palette, name)`;
- hide without accept → `undefined` (cancel).

The accept decision is extracted as a pure function (e.g. `resolveTagPickAccept(checkedLabels,
activeLabel)` in `core/tags.ts`) for unit tests. The three call sites — `pickTags` in
`createAnnotationCommand.ts`, `onEditTags`, `onBulkEditTags` in `extension.ts` — collapse to
calls of the helper (fixes the bug everywhere, dedups ~40 lines).

## §I — Reliable Markdown-editor autofocus after create (#9)

**Root cause:** `DetailPanelProvider.openAnnotation()` posts ephemerally. When the detail
view is not yet resolved, the message is dropped; on the webview's `ready` only `setGroup`
is replayed, so the panel lands in **group view** — nothing to focus. Secondary: the
CodeMirror `view.focus()` on mount can run before the webview iframe itself has focus.

**Fix (three parts):**

1. **Replay:** the provider remembers the last `openAnnotation` target and, on `ready`,
   posts it after `setGroup` — guarded: only when the current group contains that annotation
   (stale targets from an earlier group are ignored).
2. **Ordering:** `openAnnotationInPanel` (`extension.ts`) executes `annotated.detail.focus`
   **first** (resolving/revealing the view), then `showGroupWithStale` + `openAnnotation` +
   `revealAnnotation` (which already uses `preserveFocus: true`).
3. **Retry:** `MarkdownEditor`'s autofocus re-asserts until `view.hasFocus` — a few short
   timeouts (~50/150/400 ms) plus once on the window `focus` event, all within ~1.5 s; then
   gives up silently.

## §J — Group comments + comment indicators (#10)

### J1 — Model (`shared/model.ts`)

`Comment` becomes `{ id, annotationId?, groupId?, content, timestamp }` with **exactly one**
of `annotationId` / `groupId` (enforced by `parseComment`; both/neither → parse error).
Existing per-author comment files parse unchanged; `CommentFile` format and `CommentStore`
are untouched (update/delete are commentId-keyed, so group comments **reuse** the existing
`editComment` / `deleteComment` messages). `JSON.stringify` omits the undefined field.
(Rejected alternative: a separate group-comment store/file — more surface, no benefit.)

### J2 — Pure helpers (`core/comments.ts`)

- `commentCountsByGroup(groups, comments): Record<string, number>` — per group: comments on
  its annotations + comments on the group itself.
- `groupCommentsOf(comments, groupId): ThreadComment[]`.
- `commentsFor` (`core/detailState.ts`) is already correct for annotations (group comments
  have `annotationId === undefined`).

### J3 — Protocol (`shared/protocol.ts`)

- `setState` gains `commentCounts: Record<string, number>`.
- New detail→host message `{ type: 'addGroupComment'; content: string }` (group implicit via
  the provider's current group, like `setGroupTitle`).
- Parsers updated accordingly.

### J4 — Host (`web/`)

- `SidebarViewProvider.refresh()` reads comment files (`CommentStore` + `flattenComments`)
  and sends `commentCounts` via `commentCountsByGroup`.
- `showGroupWithStale` (`extension.ts`) widens its comment filter to
  `ids.has(c.annotationId) || c.groupId === groupId`.
- `DetailPanelProvider` routes `addGroupComment` → `onAddGroupComment(groupId, content)`;
  the extension handler mirrors `onAddComment` but persists `{ groupId }`.

### J5 — Webviews

- New shared `src/webview/shared/CommentBadge.svelte`: inline SVG message icon + count,
  rendered **only when count > 0**. No inline `style` attributes (the sidebar CSP has no
  `'unsafe-inline'`).
- `GroupCard.svelte`: badge in the meta row (total = `commentCounts[group.id]`, passed down
  from `App.svelte` / sidebar state, which mirrors the new `setState` field).
- `GroupView.svelte`: gains `comments`, `currentAuthor` and comment handlers; renders a
  per-annotation `CommentBadge` on each row (`AnnotationRow` gains `commentCount?: number`,
  shown between summary and location) and a reused `CommentThread` below the rows for
  group-level comments (add → `addGroupComment`; edit/delete → existing messages).
- `DetailApp.svelte` passes the new props; `webview/detail/state.ts` adds
  `addGroupComment(content)`.

## §K — Other authors' names in a different color (#11)

`CommentThread.svelte`: `<span class="cauthor" class:other={c.author !== currentAuthor}>`;
`.cauthor.other { color: var(--vscode-charts-orange, #d18616); }`. Own comments keep the
current styling.

## §L — Edit autofocus + cursor at end (#12)

- Reusable focus action (e.g. `src/webview/shared/focusAtEnd.ts`): `el.focus()` +
  `setSelectionRange(len, len)` — applied to the group **title** input (`GroupView`).
- `AnnotationView`: the editor autofocuses on **every** entry into edit mode — the
  `autofocusEditor` const (empty-content-only) is removed and `autofocus` is always set
  (the editor only renders in edit mode). This deliberately reverses the round-1 "never
  steal focus on a manual Edit" decision per this feedback round.
- `CommentThread`: edit editor gets `autofocus`; the reply composer too (same mechanism,
  natural extension).
- `MarkdownEditor` already places the cursor at the end of the doc when autofocusing.

---

## Out of scope / non-goals

- Web-host git config reading (no `vscode.git` on web; repo-local `.git/config` parsing
  deferred).
- Per-author color palettes for comments (binary own/other only).
- Comment indicators in the gutter/hover; comment counts on the sidebar are per-group only.
- Deleting groups/annotations from the command palette (context-menu only; bulk delete
  already exists).

## Testing strategy

- **Unit (Vitest):** `waitForGitInit` (fake state/event); `formatLineRange`;
  `removeAnnotation` + `GroupStore.deleteAnnotation` (memory fs); `resolveTagPickAccept`;
  `parseComment` exactly-one validation + round-trip; `commentCountsByGroup` /
  `groupCommentsOf`; protocol parsers (`addGroupComment`, `setState.commentCounts`).
- **Svelte component tests:** `AnnotationView` basename/collapsed-range display + full-path
  copy + autofocus prop + Mod-Enter via stub; `CommentThread` other-author class, edit
  autofocus, submit wiring; `GroupView` title focus-at-end, group `CommentThread`, row
  badges, `data-vscode-context` attributes; `GroupCard` badge + context attribute;
  `AnnotationRow` collapsed range + badge; `CommentBadge` hidden-at-zero.
- **Integration (`@vscode/test-web`):** commands registered (`deleteGroup` /
  `deleteAnnotation` present, `ping` gone); group/annotation deletion through the store.
- **Honest gaps (manual in dev host):** QuickPick interactions (§H), git API init timing
  (§A), native context-menu UX (§D), cross-iframe focus reliability (§I), keybindings
  (§B/§E).

## Decomposition into sub-plans (single branch `phase-7`)

Built subagent-driven (fresh subagent per task, spec + code-quality review between tasks),
proceeding autonomously across sub-plans.

1. **7a — Small batch (§B, §C, §E, §F + §A prompt text):** keybinding `when`, basename +
   `formatLineRange`, sidebar-focus keybinding, remove Ping, prompt reword.
2. **7b — Tag QuickPick fix (§H):** `pickTagsWithNewOption` + pure accept logic; replace the
   three call sites.
3. **7c — Git identity hardening (§A):** `waitForGitInit` + authorSources wiring.
4. **7d — Editor UX (§G, §K, §L):** Mod-Enter submit, edit autofocus + cursor-at-end, author
   colors. (Touches `MarkdownEditor`, `AnnotationView`, `CommentThread`, `GroupView`.)
5. **7e — Right-click deletes (§D):** context attributes, commands/menus, `removeAnnotation`
   + store + handlers.
6. **7f — Group comments + indicators (§J):** model/protocol change + host + webviews.
7. **7g — Autofocus reliability (§I):** provider replay + ordering + editor retry. Runs after
   7d (shares `MarkdownEditor`).
