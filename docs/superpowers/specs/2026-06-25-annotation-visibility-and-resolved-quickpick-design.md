# Annotation line-highlight + resolved-group QuickPick filtering — design

Date: 2026-06-25

Two independent UX improvements based on real usage:

1. **Editor visibility** — make annotated lines more noticeable with a generic-color
   whole-line background tint, *in addition to* the existing per-tag gutter bars. A toggle
   (toolbar button + keybinding) reverts to the current gutter-only look.
2. **Resolved groups in the create flow** — stop offering resolved groups in the
   "Add annotation to group…" QuickPick.

A third request — moving the "＋ New tag…" item to the top of the tag QuickPick — was
**deferred** (not in scope here): putting it first makes it the default-highlighted item,
which turns a plain "open → Enter" (meaning "no tags") into an accidental add-new. The
clean fix changes accept semantics and warrants its own pass.

---

## Change #1 — Whole-line highlight for annotated lines

### Behavior

- Every line covered by a **non-resolved** annotation gets a subtle whole-line background
  tint, on top of the existing gutter bars + overview-ruler marks. Resolved groups get
  neither (already excluded upstream) — consistent.
- The tint is a single **generic** color (not per-tag): the per-tag distinction stays in
  the gutter bars.
- A toggle flips the highlight on/off. **Default: on.** The state persists across sessions
  and is **user-wide** (one preference for all workspaces), stored in the extension's
  `globalState` Memento — there is intentionally **no Settings checkbox**; the toolbar
  button is the primary control and the keybinding the secondary one.

### Appearance (theme color)

Contribute a color id `annotated.lineHighlightBackground` via `contributes.colors`, with
`defaults` referencing `editor.rangeHighlightBackground` for every variant
(`dark` / `light` / `highContrast` / `highContrastLight`). This gives a theme-adaptive,
subtle default out of the box and lets power users retint it via
`workbench.colorCustomizations` — without adding a checkbox-style setting. The highlight
decoration is **background-only**: no border, no extra overview-ruler mark (the gutter
decoration already contributes the ruler mark).

### Components & data flow

- **`src/core/gutterIndicators.ts`** — add a tiny pure helper:
  ```ts
  /** Sorted 1-based line numbers that should receive the generic highlight. */
  export function highlightableLines(barsByLine: Map<number, string[]>): number[]
  ```
  It is just the sorted keys of the existing `gutterBarsByLine(...)` map, factored out so
  the line-selection logic is unit-testable without `vscode`. (Resolved groups are already
  filtered out by `gutterBarsByLine`, so they never appear.)

- **`src/web/gutterDecorations.ts`** — `GutterDecorationManager`:
  - Add a single lazily-created, cached highlight `TextEditorDecorationType`:
    `{ isWholeLine: true, backgroundColor: new vscode.ThemeColor('annotated.lineHighlightBackground') }`.
  - `refresh(editors, groups, palette, highlightLines: boolean)` gains the `highlightLines`
    flag. For each editor: if `highlightLines` is true, apply the highlight type to
    `highlightableLines(byLine)` (clamped to the document's valid line range, same clamp the
    bars use); if false, apply `[]` to clear it.
  - `dispose()` also disposes the highlight type.

- **`src/web/extension.ts`**:
  - State accessor backed by `globalState`:
    `const highlightOn = () => context.globalState.get<boolean>('annotated.highlightAnnotatedLines', true)`.
  - `refreshDecorations()` passes `highlightOn()` as the new `refresh(...)` arg.
  - On activate, set the context key `annotated.lineHighlightEnabled` from `highlightOn()`
    (for the toolbar icon state) and do the initial paint.
  - A shared helper `setHighlight(enabled: boolean)`:
    `await context.globalState.update('annotated.highlightAnnotatedLines', enabled)` →
    `setContext('annotated.lineHighlightEnabled', enabled)` → `refreshDecorations()`.
  - Register two commands wired to `setHighlight`:
    - `annotated.enableLineHighlight` → `setHighlight(true)`
    - `annotated.disableLineHighlight` → `setHighlight(false)`

  Two complementary commands (rather than one toggle) so the toolbar can show a
  state-reflecting icon — the standard VSCode toggle-button pattern (cf. word-wrap). No
  `onDidChangeConfiguration` wiring is needed for the highlight, since state lives in
  `globalState` and only these commands mutate it.

### `package.json` contributions

- **`contributes.colors`**: the `annotated.lineHighlightBackground` entry above.
- **`contributes.commands`**: the two commands, each with an icon —
  - `annotated.disableLineHighlight` → `$(eye)` (shown when highlight is ON; click hides)
  - `annotated.enableLineHighlight` → `$(eye-closed)` (shown when highlight is OFF; click shows)
- **`contributes.menus` → `view/title`** (on `view == annotated.sidebar`, `group: navigation`,
  alongside the existing Manage-Tags button):
  - `annotated.disableLineHighlight` when `annotated.lineHighlightEnabled`
  - `annotated.enableLineHighlight` when `!annotated.lineHighlightEnabled`
- **`contributes.keybindings`** — one chord (`ctrl+alt+h` / `cmd+alt+h`, matching the
  existing `cmd+alt+a/o/l` family; no default collision), bound to whichever command is
  currently applicable via complementary `when`:
  - `annotated.disableLineHighlight` when `annotated.lineHighlightEnabled`
  - `annotated.enableLineHighlight` when `!annotated.lineHighlightEnabled`
- **`contributes.menus` → `commandPalette`**: leave both commands palette-visible (each is
  gated by its `when`, so only the contextually-correct one shows). Titles:
  "Annotated: Show Annotation Line Highlight" / "Annotated: Hide Annotation Line Highlight".

### Interaction notes

- The transient navigation highlight in `navigateToCode.ts` (find-match background + left
  border, applied when you open an annotation) stacks on top of this persistent tint on the
  target lines; the stronger nav highlight dominates while active, then clears — no conflict
  to resolve.

### Testing

- **Unit (`gutterIndicators.unit.test.ts`)**: `highlightableLines` returns the sorted union
  of annotated lines and excludes resolved groups (mirrors the existing `gutterBarsByLine`
  cases).
- The decoration application and the command/`globalState`/context-key wiring live in the
  `vscode` layer; covered by the existing manual/integration surface rather than new unit
  tests (the local gate is `check-types` + `test:unit`).

---

## Change #2 — Hide resolved groups in the create-annotation QuickPick

### Behavior

When creating an annotation and choosing a target group, resolved groups are not listed.
"＋ Create new group…" is unaffected.

### Components

- **`src/core/createAnnotationFlow.ts`** — in `runCreateAnnotation`, pass only non-resolved
  groups to the picker:
  ```ts
  const choice = await deps.pickGroup(groups.filter((g) => g.status !== 'resolved'));
  ```
  The full `groups` list is still used for the subsequent find-by-id, so the chosen group
  always resolves. Doing the filter in the core flow (not in the `vscode` `pickGroup`
  adapter) keeps it unit-testable.

### Testing

- **Unit (`createAnnotationFlow.unit.test.ts`)**: a resolved group present in `listGroups()`
  is not included in the array handed to `pickGroup`; a non-resolved group is.

---

## Out of scope (this pass)

- Moving "＋ New tag…" to the top of the tag QuickPick (deferred; needs an accept-semantics
  redesign as noted above).
- Per-workspace override of the highlight preference (it is intentionally a single user-wide
  preference; no Settings checkbox).
- Any change to gutter bars, overview-ruler marks, or per-tag coloring.

## Execution

Per the project working agreement: single feature branch (`annotation-visibility`),
subagent-driven TDD, spec + code-quality review between tasks. Both changes are independent
(disjoint files), so their sub-plans may be pipelined.
