# vscode-annotated — Phase 3c: Inline ＋New Tag in Edit-Tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Offer a **＋ New tag…** item in the detail panel's **edit-tags** QuickPick (prompt name + color → write `annotated.tags` → include the new tag in the selection), matching the Create-Annotation flow which already does this. Extract the shared pick-parsing into a pure, tested helper.

**Architecture:** The Create-Annotation `pickTags()` already implements ＋New tag (Phase 1). 3c (a) extracts the "split picked labels into names + new-tag intent" logic into a pure `splitPickedTags` helper (`src/core/tags.ts`) with unit tests, (b) refactors `pickTags()` to use it (no behavior change), and (c) adds the ＋New tag item + prompt/write to the host `onEditTags` handler using the same helper + the existing `addTagToPalette` config writer. Native QuickPick/InputBox is not webview UI, so there is **no e2e** for it (documented); coverage is the pure helper + the existing create-flow unit tests.

**Tech Stack:** TypeScript. Builds on Phase 1 + 2 + 3a + 3b. Vitest unit + `@vscode/test-web` integration + Playwright e2e (unchanged counts).

> **Conventions:** branch `phase-3` (already checked out); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + Bash `timeout: 600000` and `pkill -f vscode-test-web || true` first.

---

## Context (exact current shapes)

- `src/core/tags.ts` — `interface Tag { name; color }`; `parseTagPalette(raw): Tag[]`; `tagColor(...)` may live elsewhere; `DEFAULT_COLOR = '#888888'`. READ it.
- `src/web/tagPalette.ts` — `readTagPalette(): Tag[]` (reads `annotated.tags`); `addTagToPalette(name, color = DEFAULT_COLOR): Promise<void>` (dedups by name — returns early if the name exists — then `config.update('tags', [...current, { name, color }], Global)`). READ it.
- `src/web/createAnnotationCommand.ts` — `const NEW_TAG_LABEL = '$(add) New tag…';` and `async function pickTags(): Promise<string[] | undefined>` which builds QuickPick items `[...palette.map(t => ({label: t.name})), { label: NEW_TAG_LABEL, alwaysShow: true }]`, multi-picks, then loops the picked items splitting `NEW_TAG_LABEL` (→ `addNew`) from real names, and if `addNew` prompts name + color (`showInputBox`), calls `addTagToPalette`, and pushes the name. READ it for the EXACT current loop + prompts.
- `src/web/extension.ts` — `onEditTags` handler builds `palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name) }))`, multi-picks, then `patchGroup(groupId, { tags: picked.map((p) => p.label) })`. **It does NOT offer ＋New tag yet.** `patchGroup(groupId, patch)` + `readTagPalette` are in scope. READ the handler.
- Create-flow unit tests inject `pickTags` as a stub, so the REAL `pickTags()` QuickPick/new-tag logic is currently UNtested → extracting `splitPickedTags` adds genuine coverage.
- After Phase 3b: full suite is check-types + unit + **10 integration** + **10 e2e**.

---

## Design notes
- **`splitPickedTags(labels)` pure helper** in `src/core/tags.ts`, plus exporting `NEW_TAG_LABEL` from there (single source of truth). Returns `{ names: string[]; addNew: boolean }`.
- **No behavior change** to the create flow — just refactor its inline loop to call `splitPickedTags`.
- **Edit-tags** gains the ＋New tag item + the same prompt(name)+prompt(color)+`addTagToPalette`+append logic, then `patchGroup({ tags })`.
- **No e2e** (native QuickPick/InputBox is not reachable by Playwright, which only drives webview iframes). This is a deliberate, documented coverage boundary — the pure `splitPickedTags` + existing create-flow tests cover the logic; the QuickPick wiring is host glue verified by check-types/compile + manual.
- Color: accept any string (VSCode themes accept CSS colors); default `'#888888'` when blank — matches the existing create flow. No hex validation (consistent with current behavior).

---

## File Structure (3c)

```
src/core/tags.ts                          (modify) # + NEW_TAG_LABEL + splitPickedTags
src/core/tags.unit.test.ts                (modify) # splitPickedTags tests
src/web/createAnnotationCommand.ts        (modify) # import NEW_TAG_LABEL + use splitPickedTags (no behavior change)
src/web/extension.ts                      (modify) # onEditTags: ＋New tag item + prompt/write + splitPickedTags
```

---

## Task 1: Pure `splitPickedTags` helper + create-flow refactor

**Files:** Modify `src/core/tags.ts`(+test), `src/web/createAnnotationCommand.ts`

- [ ] **Step 1: Append tests** to `src/core/tags.unit.test.ts` (add `NEW_TAG_LABEL`, `splitPickedTags` to the import from `./tags`):
```ts
describe('splitPickedTags', () => {
  it('separates real tag names from the new-tag sentinel', () => {
    expect(splitPickedTags(['security', 'todo'])).toEqual({ names: ['security', 'todo'], addNew: false });
    expect(splitPickedTags(['security', NEW_TAG_LABEL])).toEqual({ names: ['security'], addNew: true });
    expect(splitPickedTags([NEW_TAG_LABEL])).toEqual({ names: [], addNew: true });
    expect(splitPickedTags([])).toEqual({ names: [], addNew: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tags.unit.test.ts`
Expected: FAIL — `NEW_TAG_LABEL`/`splitPickedTags` not exported.

- [ ] **Step 3: Add to `src/core/tags.ts`:**
```ts
/** The pinned QuickPick item label that triggers inline tag creation. */
export const NEW_TAG_LABEL = '$(add) New tag…';

/** Split picked QuickPick labels into real tag names + whether ＋New tag was chosen. */
export function splitPickedTags(labels: string[]): { names: string[]; addNew: boolean } {
  const names: string[] = [];
  let addNew = false;
  for (const label of labels) {
    if (label === NEW_TAG_LABEL) {
      addNew = true;
    } else {
      names.push(label);
    }
  }
  return { names, addNew };
}
```
(Keep `NEW_TAG_LABEL`'s string byte-identical to the value currently in `createAnnotationCommand.ts` so the create flow is unchanged.)

- [ ] **Step 4: Refactor `pickTags()` in `src/web/createAnnotationCommand.ts`** to use the shared helper. Remove the local `const NEW_TAG_LABEL = …` and import `NEW_TAG_LABEL, splitPickedTags` from `../core/tags`. Replace the inline split loop with:
```ts
  const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
  if (addNew) {
    const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
    if (name && name.trim()) {
      const color = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: '#888888' });
      await addTagToPalette(name.trim(), color?.trim() || '#888888');
      names.push(name.trim());
    }
  }
  return names;
```
(Keep the item-building + `showQuickPick` exactly as-is; only the post-pick split changes. `names` from `splitPickedTags` is a fresh mutable array — pushing the new name is fine. Confirm `picked.map((item) => item.label)` matches the `QuickPickItem[]` shape.)

- [ ] **Step 5: Run unit + check-types + create-flow tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tags.unit.test.ts src/core/createAnnotationFlow.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types 0; all unit green (the create-flow behavior is unchanged).

- [ ] **Step 6: Commit**
```bash
git add src/core/tags.ts src/core/tags.unit.test.ts src/web/createAnnotationCommand.ts
git commit -m "refactor: shared splitPickedTags helper (used by create-annotation tag picker)"
```

---

## Task 2: ＋New tag in the edit-tags QuickPick + full suite

**Files:** Modify `src/web/extension.ts`

- [ ] **Step 1: Update `onEditTags` in `src/web/extension.ts`.** Import `NEW_TAG_LABEL, splitPickedTags` from `../core/tags` and `addTagToPalette` from `./tagPalette` (merge into existing imports if present). Replace the handler body's pick + patch with:
```ts
  detailProvider.onEditTags = async (groupId): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const group = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    if (!group) {
      return;
    }
    const palette = readTagPalette();
    const items: vscode.QuickPickItem[] = [
      ...palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name) })),
      { label: NEW_TAG_LABEL, alwaysShow: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select tags for this group',
    });
    if (picked === undefined) {
      return;
    }
    const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
    if (addNew) {
      const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
      if (name && name.trim()) {
        const color = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: '#888888' });
        await addTagToPalette(name.trim(), color?.trim() || '#888888');
        names.push(name.trim());
      }
    }
    await patchGroup(groupId, { tags: names });
  };
```
(Match the file's existing brace/spacing style + the exact `GroupStore`/`VscodeFileSystem`/`readTagPalette`/`patchGroup` references already used in the current handler.)

- [ ] **Step 2: Type-check + compile + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 3: Full suite (Definition of Done)** (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm test`
Expected: `check-types` → `test:unit` (incl. splitPickedTags) → `test:integration` (**10 passing**, unchanged) → `test:e2e` (**10 passed**, unchanged — no new e2e for native QuickPick). Report ACTUAL counts.

- [ ] **Step 4: Commit**
```bash
git add src/web/extension.ts
git commit -m "feat: ＋New tag item in the edit-tags QuickPick (prompt + write to annotated.tags)"
```

---

## Phase 3c Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (splitPickedTags + earlier suites).
- [ ] `npm run test:integration` passes — **10 passing** (unchanged).
- [ ] `npm run test:e2e` passes — **10 passed** (unchanged; native QuickPick not e2e-tested — documented).
- [ ] All work committed on the `phase-3` branch.
- [ ] Manual sanity (optional): in the detail group view, "edit tags" → ＋New tag… → name + color → the new tag is created (persisted to `annotated.tags`) and applied to the group; it then appears for other groups too.

Next in Phase 3: **3d** — bulk-select mode (sidebar Select toggle, per-card checkboxes, sticky action bar: Tags / Git ref / Resolve-Restore / Delete + selected count). After 3d, Phase 3 is complete → final review → merge `phase-3` → `main` → IDEA.md fully implemented.
