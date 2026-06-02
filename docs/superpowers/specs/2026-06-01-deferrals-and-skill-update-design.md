# Design — Deferrals Cleanup + Skill Tag-Shape Update

**Date:** 2026-06-01
**Status:** Proposed
**Source:** User request — update the annotated-agent skill for the new tag shape, and clear the follow-ups recorded after the round-1/round-2 reviews.

## Overview

A focused maintenance batch: bring the agent skill's data contract in line with the new
`tags: {name,color}[]` model, and resolve the deferred review findings. No user-facing feature
behavior changes except the FilterPicker accessibility additions.

| § | Item | Summary |
|---|------|---------|
| A | Skill | `annotated-agent` docs: group `tags` are `[{name,color}]`; config writes become optional (the extension reconciles) |
| B | DRY | One shared `DEFAULT_TAG_COLOR` constant replacing 7 copies of `'#888888'` |
| C | a11y | `FilterPicker` becomes a proper ARIA combobox/listbox (roles + `aria-*`) |
| D | Perf | Debounce the `.annotations` file-watcher so rapid changes coalesce |
| E | CSP | Rewrite the detail-panel `'unsafe-inline'` comment to state the real reason (decision: keep it) |
| F | — | Heading-color "drift" and multi-root paths: documented no-ops |

## Decisions locked during brainstorming

- **CSP:** keep `'unsafe-inline'` on the detail panel's `style-src`; a nonce only covers
  CodeMirror's injected `<style>` elements, not the chips' inline `style=""` attributes (CSP
  nonces can't apply to attributes). Full elimination would be a large, risky refactor for
  marginal benefit (extension-controlled DOM, DOMPurify-sanitized markdown, scripts nonce-locked).
  We **document** the constraint instead of migrating.

---

## §A — annotated-agent skill: new tag shape + simpler config story

**Files:** `skills/annotated-agent/references/data-contract.md`,
`skills/annotated-agent/references/operations.md`.

- **`data-contract.md` group example** (line ~22): change `"tags": ["security"]` to the object
  form and update the comment:
  ```jsonc
  "tags": [{ "name": "security", "color": "#E5484D" }],  // tags carry their color (self-contained)
  ```
  Add a one-line note: the display color resolves **local config > global config > this JSON**,
  and legacy `["security"]` string arrays still load (auto-migrated) but the object form is
  canonical — write that.
- **`data-contract.md` config section** (lines ~112–128): note that because group tags now carry
  their colors, the extension **reconciles** group tags missing from settings into the workspace
  config automatically on load — so an agent that writes colors into the group JSON does **not**
  need to write `annotated.tags`. Keep the config-write mechanics, but mark them **optional**
  (use only to set/override a tag's color centrally), removing the "ask the user which target"
  friction from the required path.
- **`operations.md`** — the group-write template (line ~44) `tags` becomes
  `[{ "name": "...", "color": "#rrggbb" }, …]`; drop the "must exist in the palette, or add them
  first (op 5)" precondition → "include each tag's color; no need to pre-register it in config."
  Reframe **op 5** (update config) as optional/advanced (mechanics unchanged).
- **No code/tests change.** The `skillContract.unit.test` checks the hash RECIPE text (unaffected)
  and a `parseGroup` round-trip whose literal is already `{name,color}` — it stays green. (Verify.)

---

## §B — single `DEFAULT_TAG_COLOR`

`'#888888'` is currently duplicated as `DEFAULT_COLOR` / `DEFAULT_BAR_COLOR` / inline literals in
7 places. Introduce one canonical constant and import it everywhere.

- **Add** `export const DEFAULT_TAG_COLOR = '#888888';` to `src/shared/model.ts` (lowest layer,
  next to `Tag`).
- **Replace** the local constant/inline in: `core/tagResolve.ts`, `core/sidebarState.ts`,
  `core/tags.ts`, `web/tagPalette.ts`, `core/gutterIndicators.ts` (`DEFAULT_BAR_COLOR`), and the
  two inline `'#888888'` in `shared/model.ts`'s `parseTag` — all import/use `DEFAULT_TAG_COLOR`.
- Value is unchanged, so behavior is identical; verified by `check-types` + the existing suite.
  No new test (a constant equality test adds no value).

---

## §C — `FilterPicker` ARIA combobox

Make the searchable filter a proper [ARIA combobox/listbox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
so screen readers announce it.

- **Input** → `role="combobox"`, `aria-expanded={open}`, `aria-controls={menuId}`,
  `aria-autocomplete="list"`, and `aria-activedescendant={open && result.visible.length ?
  optionId(highlighted) : undefined}`.
- **`<ul class="menu">`** → `role="listbox"` + `id={menuId}`.
- **Each option `<button>`** → `role="option"`, `id={optionId(i)}`, `aria-selected={i === highlighted}`.
- Stable ids derived from `label`: `menuId = "picker-menu-" + label`, `optionId(i) =
  "picker-opt-" + label + "-" + i`.
- **Test-query churn:** option buttons currently match `getByRole('button', { name })`; once they
  carry `role="option"` they match `getByRole('option', { name })`. Update those queries in
  `FilterPicker.svelte.test.ts`, `FilterBar.svelte.test.ts`, and the dropdown test in
  `App.svelte.test.ts` (the pill ✕ buttons and the text input are unaffected). Add assertions:
  input has `role="combobox"`, `aria-expanded` flips false→true on focus; menu has
  `role="listbox"`; options have `role="option"` with `aria-selected` tracking the highlight.

---

## §D — debounce the file-watcher

Rapid `.annotations/**/*.json` changes currently fire `reconcile` + `provider.refresh` +
`refreshDecorations` once **per** event. Coalesce them.

- **Add** `src/shared/debounce.ts`: `debounce<A extends unknown[]>(fn: (...args: A) => void, ms:
  number): (...args: A) => void` — trailing-edge debounce (resets a timer on each call, invokes
  once after `ms` of quiet). Unit-tested with Vitest fake timers (3 rapid calls → 1 invocation;
  a later call after the window → a 2nd invocation).
- **Wire** in `extension.ts`: wrap the existing `onAnnotationsChanged` handler in
  `debounce(..., 200)` and register the debounced function on `watcher.onDidCreate/Change/Delete`.
  (The activation initial `reconcile()`/`refreshDecorations()` and the manual refresh stay
  immediate — only the watcher is debounced.)

---

## §E — CSP comment rewrite (decision: keep `'unsafe-inline'`)

In `src/web/detailPanelProvider.ts`, replace the existing TODO comment above the CSP with an
accurate rationale: `'unsafe-inline'` on `style-src` is required for **both** CodeMirror's
runtime-injected `<style>` elements **and** the webview's inline `style=""` attributes (tag
chips/pills/swatches/gutter). A CSP nonce covers `<style>` elements but **not** style attributes,
so dropping `'unsafe-inline'` would require eliminating all inline styles — not worth it given the
bounded threat model (extension-controlled DOM, DOMPurify-sanitized markdown, `script-src`
nonce-locked). Doc-only; no behavior change. Drop the stale "replace with EditorView.cspNonce"
suggestion.

---

## §F — documented no-ops

- **Heading highlight color:** `editorExtensions.ts` maps headings to
  `--vscode-symbolIcon-keywordForeground` (chosen in the 4b review to avoid colliding with inline
  code's `--vscode-textPreformat-foreground`). This is the correct, intentional state — **no
  change**. (The round-1 spec's text is historical; we don't rewrite shipped specs.)
- **Multi-root workspaces:** `inspect().workspaceValue` is treated as "local"; folder-specific
  resolution is out of scope. Recorded as a known limitation.

---

## Testing strategy

- **Unit (Vitest):** `debounce` (fake timers). The `DEFAULT_TAG_COLOR` consolidation is verified
  by the unchanged-value suite + type-check (no new test).
- **Component:** `FilterPicker` ARIA roles/`aria-expanded`/`aria-selected`; updated option-role
  queries in `FilterPicker`/`FilterBar`/`App` tests still drive the same behavior.
- **Skill:** docs-only; confirm `skillContract.unit.test` stays green.
- **Hard gate:** `npm run check-types` + `npm run test:unit`.
- CSP/heading/multi-root are doc-only / no-op.

## Decomposition — single plan `phase-6` (subagent-driven)

Independent, small tasks; one implementer, then spec + code-quality review:

1. **6.1 — `DEFAULT_TAG_COLOR`** consolidation (§B).
2. **6.2 — `FilterPicker` ARIA** + test-query updates (§C).
3. **6.3 — `debounce`** util + watcher wiring (§D).
4. **6.4 — Docs:** CSP comment (§E) + skill `data-contract.md`/`operations.md` (§A).
5. **6.5 — Full gate.**
