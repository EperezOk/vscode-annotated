# Phase 7b — Tag QuickPick New-Tag Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where choosing "New tag…" in a tag QuickPick silently does nothing (round-3 TODO #9, spec §H): in a `canPickMany` QuickPick, Enter accepts only *checked* items, so Enter on the highlighted-but-unchecked "$(add) New tag…" row returns `[]` and the group is created tag-less.

**Architecture:** A pure accept-decision helper (`resolveTagPickAccept` in `core/tags.ts`, unit-tested) + one shared `vscode`-glue picker (`pickTagsWithNewOption` in `web/tagPalette.ts`, built on `createQuickPick` so we can see the *active* item and auto-accept when "New tag…" is checked). The three near-identical call sites (create flow, `onEditTags`, `onBulkEditTags`) collapse to calls of the helper.

**Tech Stack:** TypeScript, VSCode `createQuickPick` API, Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
`resolveTagPickAccept` is unit-tested. `pickTagsWithNewOption` and the call-site rewiring are `vscode`-glue — type-check + existing unit suites (the create flow's `pickTags` dep is injected, so `createAnnotationFlow` tests are unaffected) + manual QuickPick verification. **Hard gate:** `npm run check-types` + `npm run test:unit`.

### Behavior contract (from spec §H)
- Checking "New tag…" (click or space) **immediately** proceeds to the name/color prompts, keeping any other checked tags.
- Enter with nothing checked while "New tag…" is the **active** (highlighted) item also counts as add-new.
- Enter with nothing checked and a regular tag highlighted still means **no tags** (the cancel-free no-tag path is unchanged).
- Escape / dismiss → cancel (`undefined`), aborting the surrounding flow as today.

---

## File Structure

- **Modify** `src/core/tags.ts` (+ `tags.unit.test.ts`) — pure `resolveTagPickAccept`.
- **Modify** `src/web/tagPalette.ts` — `pickTagsWithNewOption(palette, options)`.
- **Modify** `src/web/createAnnotationCommand.ts` — replace the local `pickTags` with the helper; drop dead imports.
- **Modify** `src/web/extension.ts` — `onEditTags` / `onBulkEditTags` use the helper; drop dead imports.

---

### Task 1: Pure `resolveTagPickAccept` (§H)

**Files:**
- Modify: `src/core/tags.ts`
- Test: `src/core/tags.unit.test.ts`

- [ ] **Step 1: Write the failing test** — in `src/core/tags.unit.test.ts`, add `resolveTagPickAccept` and `NEW_TAG_LABEL` to the existing import from `./tags` (if `NEW_TAG_LABEL` isn't already imported), then append at the end of the file:

```ts
describe('resolveTagPickAccept', () => {
  it('returns checked tag names with addNew=false', () => {
    expect(resolveTagPickAccept(['security', 'perf'], 'security')).toEqual({
      names: ['security', 'perf'],
      addNew: false,
    });
  });

  it('detects a checked "New tag…" item alongside other tags', () => {
    expect(resolveTagPickAccept(['security', NEW_TAG_LABEL], undefined)).toEqual({
      names: ['security'],
      addNew: true,
    });
  });

  it('treats Enter on the highlighted "New tag…" with nothing checked as add-new', () => {
    expect(resolveTagPickAccept([], NEW_TAG_LABEL)).toEqual({ names: [], addNew: true });
  });

  it('keeps the no-tags path: nothing checked + a regular tag highlighted', () => {
    expect(resolveTagPickAccept([], 'security')).toEqual({ names: [], addNew: false });
  });

  it('keeps the no-tags path: nothing checked + no active item', () => {
    expect(resolveTagPickAccept([], undefined)).toEqual({ names: [], addNew: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/tags.unit.test.ts`
Expected: FAIL — `resolveTagPickAccept` is not exported.

- [ ] **Step 3: Implement** — in `src/core/tags.ts`, append after `splitPickedTags`:

```ts
/**
 * Decide the outcome of a multi-select tag QuickPick accept. `checkedLabels` are
 * the checked items' labels; `activeLabel` is the highlighted item's label. Enter
 * with nothing checked while "＋New tag…" is highlighted counts as choosing it —
 * a plain multi-select accept treats that as an empty selection and would
 * silently create the group with no tag (the round-3 #9 bug).
 */
export function resolveTagPickAccept(
  checkedLabels: string[],
  activeLabel: string | undefined,
): { names: string[]; addNew: boolean } {
  const { names, addNew } = splitPickedTags(checkedLabels);
  if (checkedLabels.length === 0 && activeLabel === NEW_TAG_LABEL) {
    return { names, addNew: true };
  }
  return { names, addNew };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/tags.unit.test.ts`
Expected: PASS (all tags tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tags.ts src/core/tags.unit.test.ts
git commit -m "feat(tags): resolveTagPickAccept handles Enter on highlighted New-tag (TODO #9)"
```

---

### Task 2: `pickTagsWithNewOption` shared picker (§H)

**Files:**
- Modify: `src/web/tagPalette.ts`

> `vscode`-glue (`createQuickPick`) — type-check + manual. The decision logic is the Task 1 helper.

- [ ] **Step 1: Implement.** In `src/web/tagPalette.ts`:

(a) Update the core/tags import (top of file) to include the new names:

```ts
import { type Tag, parseTagPalette, TAG_SWATCHES, NEW_TAG_LABEL, resolveTagPickAccept } from '../core/tags';
```

(b) Add the import for the palette color lookup (next to the other core imports):

```ts
import { tagColor } from '../core/sidebarState';
```

(c) Append at the end of the file:

```ts
/** Options for `pickTagsWithNewOption`. */
export interface PickTagsOptions {
  placeHolder: string;
  /** Tag names to show pre-checked (e.g. the group's current tags). */
  preselectedNames?: string[];
}

/**
 * Multi-select tag QuickPick with a pinned "＋New tag…" action item, shared by the
 * create flow and the tag-edit handlers. Built on `createQuickPick` (not
 * `showQuickPick`) so that:
 * - checking "New tag…" accepts immediately (it is an action, not a tag), and
 * - Enter on the highlighted-but-unchecked "New tag…" still counts as add-new
 *   (a plain multi-select accept would return [] and silently skip the prompts).
 * Returns the picked tags (with any newly created tag appended), [] for "no tags",
 * or undefined if the user cancelled.
 */
export async function pickTagsWithNewOption(
  palette: TagColor[],
  options: PickTagsOptions,
): Promise<Tag[] | undefined> {
  const preselected = new Set(options.preselectedNames ?? []);
  const quickPick = vscode.window.createQuickPick();
  quickPick.canSelectMany = true;
  quickPick.placeholder = options.placeHolder;
  quickPick.items = [
    ...palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
    { label: NEW_TAG_LABEL, alwaysShow: true },
  ];
  quickPick.selectedItems = quickPick.items.filter((item) => preselected.has(item.label));

  const accepted = await new Promise<{ names: string[]; addNew: boolean } | undefined>((resolve) => {
    // Checking "New tag…" is an action: accept right away (later resolves are no-ops).
    quickPick.onDidChangeSelection((selection) => {
      if (selection.some((item) => item.label === NEW_TAG_LABEL)) {
        resolve(resolveTagPickAccept(selection.map((item) => item.label), undefined));
        quickPick.hide();
      }
    });
    quickPick.onDidAccept(() => {
      resolve(
        resolveTagPickAccept(
          quickPick.selectedItems.map((item) => item.label),
          quickPick.activeItems[0]?.label,
        ),
      );
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      resolve(undefined); // cancel; no-op when accept already resolved
      quickPick.dispose();
    });
    quickPick.show();
  });

  if (!accepted) {
    return undefined;
  }
  const tags: Tag[] = accepted.names.map((name) => ({ name, color: tagColor(palette, name) }));
  if (accepted.addNew) {
    const created = await promptNewTag();
    if (created) {
      tags.push(created);
    }
  }
  return tags;
}
```

(`vscode`, `swatchIconSvg`, `TagColor`, and `promptNewTag` are already imported/defined in this file.)

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/web/tagPalette.ts
git commit -m "feat(tags): shared pickTagsWithNewOption QuickPick with reliable New-tag accept (TODO #9)"
```

---

### Task 3: Create flow uses the shared picker (§H)

**Files:**
- Modify: `src/web/createAnnotationCommand.ts`

- [ ] **Step 1: Rewire.** In `src/web/createAnnotationCommand.ts`:

(a) Change the deps wiring line inside `registerCreateAnnotationCommand`:

```ts
      pickTags: async () => pickTags(displayPalette(await store.listGroups())),
```

to:

```ts
      pickTags: async () =>
        pickTagsWithNewOption(displayPalette(await store.listGroups()), {
          placeHolder: 'Select tags (optional)',
        }),
```

(b) Delete the whole local `pickTags` function at the bottom of the file (the `async function pickTags(palette: TagColor[]): Promise<Tag[] | undefined> { … }` block).

(c) Update imports — the file header becomes (only the changed lines shown):

- `import { displayPalette, promptNewTag } from './tagPalette';` → `import { displayPalette, pickTagsWithNewOption } from './tagPalette';`
- Delete `import { type TagColor } from '../shared/protocol';`
- Delete `import { swatchIconSvg } from '../shared/svgIcon';`
- Delete `import { NEW_TAG_LABEL, splitPickedTags } from '../core/tags';`
- Delete `import { tagColor } from '../core/sidebarState';`
- In `import { type AnnotationGroup, type Tag } from '../shared/model';` keep `Tag` only if still referenced; after (b) it is NOT (the deps type provides it) → it becomes `import { type AnnotationGroup } from '../shared/model';`

- [ ] **Step 2: Type-check + unit tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npx vitest run --project unit src/core/createAnnotationFlow.unit.test.ts`
Expected: clean + PASS (the flow's `pickTags` dep is injected; its tests don't touch this file).

- [ ] **Step 3: Commit**

```bash
git add src/web/createAnnotationCommand.ts
git commit -m "refactor(create): use shared pickTagsWithNewOption (TODO #9)"
```

---

### Task 4: Tag-edit handlers use the shared picker (§H)

**Files:**
- Modify: `src/web/extension.ts`

- [ ] **Step 1: `onEditTags`.** Replace its body's picker section — the lines:

```ts
    const palette = displayPalette(await store.listGroups());
    const items: vscode.QuickPickItem[] = [
      ...palette.map((t) => ({ label: t.name, picked: group.tags.some((gt) => gt.name === t.name), iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
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
    const tags: Tag[] = names.map((name) => ({ name, color: tagColor(palette, name) }));
    if (addNew) {
      const created = await promptNewTag();
      if (created) {
        tags.push(created);
      }
    }
    await patchGroup(groupId, { tags });
```

with:

```ts
    const palette = displayPalette(await store.listGroups());
    const tags = await pickTagsWithNewOption(palette, {
      placeHolder: 'Select tags for this group',
      preselectedNames: group.tags.map((t) => t.name),
    });
    if (tags === undefined) {
      return;
    }
    await patchGroup(groupId, { tags });
```

- [ ] **Step 2: `onBulkEditTags`.** Replace its picker section — the lines:

```ts
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const palette = displayPalette(await store.listGroups());
    const items: vscode.QuickPickItem[] = [
      ...palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
      { label: NEW_TAG_LABEL, alwaysShow: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Set tags on ${groupIds.length} group(s)`,
    });
    if (picked === undefined) {
      return;
    }
    const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
    const tags: Tag[] = names.map((name) => ({ name, color: tagColor(palette, name) }));
    if (addNew) {
      const created = await promptNewTag();
      if (created) {
        tags.push(created);
      }
    }
    for (const id of groupIds) {
```

with:

```ts
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const tags = await pickTagsWithNewOption(displayPalette(await store.listGroups()), {
      placeHolder: `Set tags on ${groupIds.length} group(s)`,
    });
    if (tags === undefined) {
      return;
    }
    for (const id of groupIds) {
```

- [ ] **Step 3: Import cleanup.** In `src/web/extension.ts`:

- `import { displayPalette, reconcileWorkspaceTags, promptNewTag } from './tagPalette';` → `import { displayPalette, reconcileWorkspaceTags, pickTagsWithNewOption } from './tagPalette';`
- `import { NEW_TAG_LABEL, splitPickedTags } from '../core/tags';` → delete the line.
- `import { bulkStatusToggle, tagColor } from '../core/sidebarState';` → `import { bulkStatusToggle } from '../core/sidebarState';`
- `import { swatchIconSvg } from '../shared/svgIcon';` → delete the line (only those two handlers used it).
- In `import { formatLineRange, type AnnotationGroup, type GroupStatus, type Tag } from '../shared/model';` keep `Tag` — it is still used by `patchGroup`'s signature and the detail-provider callbacks.

- [ ] **Step 4: Type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean + all PASS (no unused-import errors; nothing references the removed identifiers).

- [ ] **Step 5: Commit**

```bash
git add src/web/extension.ts
git commit -m "refactor(tags): edit-tags handlers use shared pickTagsWithNewOption (TODO #9)"
```

---

### Task 5: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage (§H):** immediate-accept on check → `onDidChangeSelection` in Task 2; Enter-on-highlighted-new-tag → `resolveTagPickAccept` (Tasks 1–2); no-tags path preserved → Task 1 tests; all three call sites replaced → Tasks 3–4; pure logic extracted for tests → Task 1. ✓
- **Type consistency:** `resolveTagPickAccept(checkedLabels: string[], activeLabel: string | undefined): { names: string[]; addNew: boolean }` used identically in both Task 2 handlers; `pickTagsWithNewOption(palette: TagColor[], options: PickTagsOptions): Promise<Tag[] | undefined>` matches the `CreateAnnotationDeps.pickTags` return type (`Promise<Tag[] | undefined>`). ✓
- **Double-resolve safety:** `onDidAccept` resolves, then `hide()` triggers `onDidHide` whose `resolve(undefined)` is a no-op (promises resolve once). ✓
- **Preselection can't auto-accept:** `NEW_TAG_LABEL` is never in `preselectedNames`, so programmatic `selectedItems` assignment can't trip the selection listener's add-new branch. ✓
- **No placeholders; imports stated exactly** (verbatimModuleSyntax: `type` qualifiers preserved). ✓
