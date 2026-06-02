# Tag Management (rename / recolor / delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add palette-level tag management — rename a tag, change an existing tag's color, and delete a tag — reachable from a sidebar title-bar button and a Command Palette command.

**Architecture:** Pure, unit-tested logic in a new `src/core/tagAdmin.ts` (config-array mutations + per-group tag patches); a thin host-side orchestrator in `src/web/tagAdminCommand.ts` that drives two QuickPicks (pick tag → pick action), applies changes to both `annotated.tags` config and every affected group `.annotations` file, then refreshes the UI. All three operations rewrite both config and group files for full on-disk consistency.

**Tech Stack:** TypeScript, VSCode extension API (`workspace.getConfiguration`, `window.showQuickPick`/`showInputBox`/`showWarningMessage`, `view/title` menu), Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-01-tag-management-design.md`

**Build/test note:** Tests need Node ≥20.19. Prefix every node/npm/npx command with:
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`

---

## File Structure

- **Create `src/core/tagAdmin.ts`** — pure logic, no `vscode` import:
  - `TagOp` discriminated union
  - `paletteHasName(arr, name)` — collision / presence check
  - `renameInConfig`, `recolorInConfig`, `deleteFromConfig` — config-array mutations
  - `groupTagPatches(groups, op)` — per-group new `tags[]` (changed groups only)
  - `groupsUsingTag(groups, name)` — count for the delete confirm
- **Create `src/core/tagAdmin.unit.test.ts`** — unit tests for all of the above.
- **Modify `src/web/tagPalette.ts`** — extract a reusable `promptTagColor(initial?)` out of `promptNewTag`.
- **Create `src/web/tagAdminCommand.ts`** — `manageTags(afterApply)` orchestrator (host glue; vscode-only, not unit-tested per repo convention).
- **Modify `src/web/extension.ts`** — register `annotated.manageTags`.
- **Modify `package.json`** — add the command (with icon) and a `view/title` navigation button.

---

## Task 1: tagAdmin — config-array mutations + presence check

**Files:**
- Create: `src/core/tagAdmin.ts`
- Test: `src/core/tagAdmin.unit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/tagAdmin.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { paletteHasName, renameInConfig, recolorInConfig, deleteFromConfig } from './tagAdmin';

describe('paletteHasName', () => {
  it('matches by exact name', () => {
    const arr = [{ name: 'bug', color: '#111' }];
    expect(paletteHasName(arr, 'bug')).toBe(true);
    expect(paletteHasName(arr, 'Bug')).toBe(false);
    expect(paletteHasName(arr, 'perf')).toBe(false);
  });
});

describe('renameInConfig', () => {
  it('renames a matching entry, preserving its color; no-op if absent', () => {
    const arr = [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }];
    expect(renameInConfig(arr, 'bug', 'defect')).toEqual([
      { name: 'defect', color: '#111' },
      { name: 'perf', color: '#222' },
    ]);
    expect(renameInConfig(arr, 'absent', 'x')).toEqual(arr);
  });
});

describe('recolorInConfig', () => {
  it('updates a matching entry color; no-op if absent (does not add)', () => {
    const arr = [{ name: 'bug', color: '#111' }];
    expect(recolorInConfig(arr, 'bug', '#999')).toEqual([{ name: 'bug', color: '#999' }]);
    expect(recolorInConfig(arr, 'perf', '#999')).toEqual(arr);
  });
});

describe('deleteFromConfig', () => {
  it('removes a matching entry; no-op if absent', () => {
    const arr = [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }];
    expect(deleteFromConfig(arr, 'bug')).toEqual([{ name: 'perf', color: '#222' }]);
    expect(deleteFromConfig(arr, 'absent')).toEqual(arr);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tagAdmin.unit.test.ts`
Expected: FAIL — cannot find module `./tagAdmin`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/tagAdmin.ts`:

```ts
import { type Tag, type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';

export type { Tag };

/** A palette-level tag operation. */
export type TagOp =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'recolor'; name: string; color: string }
  | { kind: 'delete'; name: string };

/** True if a tag with this exact name exists in the array. */
export function paletteHasName(arr: TagColor[], name: string): boolean {
  return arr.some((t) => t.name === name);
}

/** Rename a config entry old→new, preserving its color. No-op if `oldName` is absent. */
export function renameInConfig(arr: TagColor[], oldName: string, newName: string): TagColor[] {
  return arr.map((t) => (t.name === oldName ? { name: newName, color: t.color } : t));
}

/** Set a config entry's color. No-op if `name` is absent (does NOT add). */
export function recolorInConfig(arr: TagColor[], name: string, color: string): TagColor[] {
  return arr.map((t) => (t.name === name ? { name: t.name, color } : t));
}

/** Remove a config entry by name. No-op if absent. */
export function deleteFromConfig(arr: TagColor[], name: string): TagColor[] {
  return arr.filter((t) => t.name !== name);
}
```

Note: `AnnotationGroup` is imported now because Task 2 adds functions that use it in the same file; importing it here keeps the single edit point. If your linter flags it as unused before Task 2, that is expected and resolved in Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tagAdmin.unit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tagAdmin.ts src/core/tagAdmin.unit.test.ts
git commit -m "feat(tags): tagAdmin config-array mutations + paletteHasName"
```

---

## Task 2: tagAdmin — per-group tag patches + usage count

**Files:**
- Modify: `src/core/tagAdmin.ts`
- Test: `src/core/tagAdmin.unit.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/tagAdmin.unit.test.ts`:

```ts
import { groupTagPatches, groupsUsingTag } from './tagAdmin';
import { type AnnotationGroup } from '../shared/model';

function grp(id: string, tags: { name: string; color: string }[]): AnnotationGroup {
  return { id, title: id, author: 'A', tags, gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('groupTagPatches', () => {
  const groups = [
    grp('g1', [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }]),
    grp('g2', [{ name: 'perf', color: '#222' }]),
  ];

  it('rename: patches only groups that use the old name, preserving color', () => {
    expect(groupTagPatches(groups, { kind: 'rename', from: 'bug', to: 'defect' })).toEqual([
      { id: 'g1', tags: [{ name: 'defect', color: '#111' }, { name: 'perf', color: '#222' }] },
    ]);
  });

  it('recolor: patches only groups whose stored color differs', () => {
    const mixed = [
      grp('g1', [{ name: 'bug', color: '#111' }]),
      grp('g2', [{ name: 'bug', color: '#999' }]),
    ];
    expect(groupTagPatches(mixed, { kind: 'recolor', name: 'bug', color: '#999' })).toEqual([
      { id: 'g1', tags: [{ name: 'bug', color: '#999' }] },
    ]);
  });

  it('delete: strips the tag from each group that has it', () => {
    expect(groupTagPatches(groups, { kind: 'delete', name: 'perf' })).toEqual([
      { id: 'g1', tags: [{ name: 'bug', color: '#111' }] },
      { id: 'g2', tags: [] },
    ]);
  });

  it('returns nothing when no group is affected', () => {
    expect(groupTagPatches(groups, { kind: 'delete', name: 'absent' })).toEqual([]);
  });
});

describe('groupsUsingTag', () => {
  it('counts groups whose tags include the name', () => {
    const groups = [
      grp('g1', [{ name: 'bug', color: '#111' }]),
      grp('g2', [{ name: 'bug', color: '#111' }, { name: 'perf', color: '#222' }]),
      grp('g3', [{ name: 'perf', color: '#222' }]),
    ];
    expect(groupsUsingTag(groups, 'bug')).toBe(2);
    expect(groupsUsingTag(groups, 'absent')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tagAdmin.unit.test.ts`
Expected: FAIL — `groupTagPatches`/`groupsUsingTag` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/tagAdmin.ts`:

```ts
/** Per-group new `tags[]` for an op — returns ONLY groups that actually change. */
export function groupTagPatches(groups: AnnotationGroup[], op: TagOp): { id: string; tags: Tag[] }[] {
  const out: { id: string; tags: Tag[] }[] = [];
  for (const g of groups) {
    if (op.kind === 'rename') {
      if (!g.tags.some((t) => t.name === op.from)) continue;
      out.push({ id: g.id, tags: g.tags.map((t) => (t.name === op.from ? { name: op.to, color: t.color } : t)) });
    } else if (op.kind === 'recolor') {
      if (!g.tags.some((t) => t.name === op.name && t.color !== op.color)) continue;
      out.push({ id: g.id, tags: g.tags.map((t) => (t.name === op.name ? { name: t.name, color: op.color } : t)) });
    } else {
      if (!g.tags.some((t) => t.name === op.name)) continue;
      out.push({ id: g.id, tags: g.tags.filter((t) => t.name !== op.name) });
    }
  }
  return out;
}

/** How many groups currently use the tag. */
export function groupsUsingTag(groups: AnnotationGroup[], name: string): number {
  return groups.filter((g) => g.tags.some((t) => t.name === name)).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tagAdmin.unit.test.ts`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add src/core/tagAdmin.ts src/core/tagAdmin.unit.test.ts
git commit -m "feat(tags): tagAdmin group patches + groupsUsingTag"
```

---

## Task 3: Extract reusable `promptTagColor` from `promptNewTag`

**Files:**
- Modify: `src/web/tagPalette.ts`

This is a pure refactor: behavior of `promptNewTag` is unchanged. `promptTagColor` is a thin `vscode` wrapper (no unit test — consistent with the repo's "logic in core" rule); it is verified by `check-types` and the existing unit suite.

- [ ] **Step 1: Add `promptTagColor` and make `promptNewTag` delegate to it**

In `src/web/tagPalette.ts`, replace the body of `promptNewTag` (the function currently spanning the `showInputBox` for the name through the `addTagToPalette` call) and add `promptTagColor` just above it. The `CUSTOM_HEX_LABEL` const, `TAG_SWATCHES`, `swatchIconSvg`, and `DEFAULT_TAG_COLOR` imports already exist in this file.

Replace this existing block:

```ts
export async function promptNewTag(): Promise<Tag | undefined> {
  const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
  if (!name || !name.trim()) {
    return undefined;
  }
  const items: vscode.QuickPickItem[] = [
    ...TAG_SWATCHES.map((s) => ({
      label: s.name,
      description: s.hex,
      iconPath: vscode.Uri.parse(swatchIconSvg(s.hex)),
    })),
    { label: CUSTOM_HEX_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Tag color' });
  if (!picked) {
    return undefined;
  }
  let color: string;
  if (picked.label === CUSTOM_HEX_LABEL) {
    const hex = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: DEFAULT_TAG_COLOR });
    if (hex === undefined) {
      return undefined;
    }
    color = hex.trim() || DEFAULT_TAG_COLOR;
  } else {
    color = picked.description ?? DEFAULT_TAG_COLOR;
  }
  const tag: Tag = { name: name.trim(), color };
  await addTagToPalette(tag.name, tag.color);
  return tag;
}
```

with:

```ts
/**
 * Prompt for a tag color via the visual swatch QuickPick (with a custom-hex fallback).
 * `initial` pre-fills the custom-hex input box. Returns undefined if the user cancels.
 */
export async function promptTagColor(initial: string = DEFAULT_TAG_COLOR): Promise<string | undefined> {
  const items: vscode.QuickPickItem[] = [
    ...TAG_SWATCHES.map((s) => ({
      label: s.name,
      description: s.hex,
      iconPath: vscode.Uri.parse(swatchIconSvg(s.hex)),
    })),
    { label: CUSTOM_HEX_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Tag color' });
  if (!picked) {
    return undefined;
  }
  if (picked.label === CUSTOM_HEX_LABEL) {
    const hex = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: initial });
    if (hex === undefined) {
      return undefined;
    }
    return hex.trim() || DEFAULT_TAG_COLOR;
  }
  return picked.description ?? DEFAULT_TAG_COLOR;
}

/**
 * Prompt for a new tag's name + color, persist it to the palette, and return it.
 * Returns undefined if the user cancels at any step or leaves the name blank.
 */
export async function promptNewTag(): Promise<Tag | undefined> {
  const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
  if (!name || !name.trim()) {
    return undefined;
  }
  const color = await promptTagColor();
  if (color === undefined) {
    return undefined;
  }
  const tag: Tag = { name: name.trim(), color };
  await addTagToPalette(tag.name, tag.color);
  return tag;
}
```

- [ ] **Step 2: Type-check and run the unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: PASS — no type errors; all existing unit tests still pass (behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/web/tagPalette.ts
git commit -m "refactor(tags): extract reusable promptTagColor from promptNewTag"
```

---

## Task 4: `manageTags` orchestrator

**Files:**
- Create: `src/web/tagAdminCommand.ts`

Host-side glue (vscode-only; not unit-tested). It reads the palette, runs the two QuickPicks, prompts per action, then applies via the Task 1–2 pure helpers and `GroupStore`.

- [ ] **Step 1: Create the orchestrator**

Create `src/web/tagAdminCommand.ts`:

```ts
import * as vscode from 'vscode';
import { GroupStore } from '../core/groupStore';
import { VscodeFileSystem } from './vscodeFileSystem';
import { displayPalette, readTagSources, promptTagColor } from './tagPalette';
import { swatchIconSvg } from '../shared/svgIcon';
import { type AnnotationGroup } from '../shared/model';
import {
  type TagOp,
  paletteHasName,
  renameInConfig,
  recolorInConfig,
  deleteFromConfig,
  groupTagPatches,
  groupsUsingTag,
} from '../core/tagAdmin';

const RENAME = '$(edit) Rename…';
const RECOLOR = '$(paintcan) Change color…';
const DELETE = '$(trash) Delete';

/** Apply a tag op to both config (workspace/global, wherever present) and every affected group file. */
async function applyOp(store: GroupStore, groups: AnnotationGroup[], op: TagOp): Promise<void> {
  const config = vscode.workspace.getConfiguration('annotated');
  const { local, global } = readTagSources();
  const now = Math.floor(Date.now() / 1000);

  if (op.kind === 'rename') {
    if (paletteHasName(local, op.from)) {
      await config.update('tags', renameInConfig(local, op.from, op.to), vscode.ConfigurationTarget.Workspace);
    }
    if (paletteHasName(global, op.from)) {
      await config.update('tags', renameInConfig(global, op.from, op.to), vscode.ConfigurationTarget.Global);
    }
  } else if (op.kind === 'recolor') {
    const inLocal = paletteHasName(local, op.name);
    const inGlobal = paletteHasName(global, op.name);
    if (inLocal) {
      await config.update('tags', recolorInConfig(local, op.name, op.color), vscode.ConfigurationTarget.Workspace);
    }
    if (inGlobal) {
      await config.update('tags', recolorInConfig(global, op.name, op.color), vscode.ConfigurationTarget.Global);
    }
    if (!inLocal && !inGlobal) {
      // JSON-only tag → add to workspace config so the new color wins via precedence.
      await config.update('tags', [...local, { name: op.name, color: op.color }], vscode.ConfigurationTarget.Workspace);
    }
  } else {
    if (paletteHasName(local, op.name)) {
      await config.update('tags', deleteFromConfig(local, op.name), vscode.ConfigurationTarget.Workspace);
    }
    if (paletteHasName(global, op.name)) {
      await config.update('tags', deleteFromConfig(global, op.name), vscode.ConfigurationTarget.Global);
    }
  }

  for (const patch of groupTagPatches(groups, op)) {
    await store.updateGroup(patch.id, { tags: patch.tags }, now);
  }
}

/**
 * The "Annotated: Manage Tags…" flow: pick a tag, pick an action (rename / recolor / delete),
 * apply it to config + every affected group, then run `afterApply` (UI refresh).
 */
export async function manageTags(afterApply: () => Promise<void> | void): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage('Open a folder to manage annotation tags.');
    return;
  }
  const store = new GroupStore(new VscodeFileSystem(folder.uri));
  const groups = await store.listGroups();
  const palette = displayPalette(groups);
  if (palette.length === 0) {
    void vscode.window.showInformationMessage('No tags yet.');
    return;
  }

  const pickedTag = await vscode.window.showQuickPick(
    palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
    { placeHolder: 'Manage which tag?' },
  );
  if (!pickedTag) {
    return;
  }
  const name = pickedTag.label;

  const action = await vscode.window.showQuickPick(
    [{ label: RENAME }, { label: RECOLOR }, { label: DELETE }],
    { placeHolder: `Tag “${name}”` },
  );
  if (!action) {
    return;
  }

  if (action.label === RENAME) {
    const next = await vscode.window.showInputBox({
      prompt: 'New tag name',
      value: name,
      validateInput: (v) => {
        const t = v.trim();
        if (!t) {
          return 'Name cannot be empty.';
        }
        if (t !== name && paletteHasName(palette, t)) {
          return `A tag named “${t}” already exists.`;
        }
        return undefined;
      },
    });
    const to = next?.trim();
    if (!to || to === name) {
      return;
    }
    await applyOp(store, groups, { kind: 'rename', from: name, to });
  } else if (action.label === RECOLOR) {
    const current = palette.find((t) => t.name === name)?.color;
    const color = await promptTagColor(current);
    if (color === undefined) {
      return;
    }
    await applyOp(store, groups, { kind: 'recolor', name, color });
  } else {
    const count = groupsUsingTag(groups, name);
    const choice = await vscode.window.showWarningMessage(
      `Delete tag “${name}”? It will be removed from ${count} group${count === 1 ? '' : 's'}. This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') {
      return;
    }
    await applyOp(store, groups, { kind: 'delete', name });
  }

  await afterApply();
}
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: PASS — no type errors. (Confirms `displayPalette`, `readTagSources`, `promptTagColor` are exported from `tagPalette.ts`, and `GroupStore.listGroups`/`updateGroup` signatures match.)

- [ ] **Step 3: Commit**

```bash
git add src/web/tagAdminCommand.ts
git commit -m "feat(tags): manageTags orchestrator (rename/recolor/delete flow)"
```

---

## Task 5: Register the command + package.json contributions

**Files:**
- Modify: `src/web/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Import and register the command in `extension.ts`**

Add this import alongside the other `./` imports near the top of `src/web/extension.ts` (e.g. just after the `import { displayPalette, reconcileWorkspaceTags, promptNewTag } from './tagPalette';` line):

```ts
import { manageTags } from './tagAdminCommand';
```

Then, in `activate(...)`, add a command registration next to the existing `annotated.ping` registration (the `context.subscriptions.push(vscode.commands.registerCommand('annotated.ping', () => 'pong'));` block). Insert after it:

```ts
  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.manageTags', async () => {
      await manageTags(async () => {
        await provider.refresh();
        await refreshDecorations();
      });
    }),
  );
```

`provider` and `refreshDecorations` are both already in scope in `activate`.

- [ ] **Step 2: Add the command + menu button to `package.json`**

In `package.json`, under `contributes.commands`, add a third entry (after `annotated.openAnnotationAtCursor`):

```json
    {
      "command": "annotated.manageTags",
      "title": "Annotated: Manage Tags…",
      "icon": "$(tag)"
    }
```

Then add a `menus` block under `contributes` (it is currently absent — add it as a sibling of `commands`, `configuration`, and `views`):

```json
    "menus": {
      "view/title": [
        {
          "command": "annotated.manageTags",
          "when": "view == annotated.sidebar",
          "group": "navigation"
        }
      ]
    }
```

- [ ] **Step 3: Type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: PASS — no type errors; all unit tests pass.

- [ ] **Step 4: Validate package.json is well-formed**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: prints `package.json OK`.

- [ ] **Step 5: Commit**

```bash
git add src/web/extension.ts package.json
git commit -m "feat(tags): register Manage Tags command + sidebar title button"
```

---

## Manual verification (after all tasks)

Not part of the automated gate (the sidebar QuickPick flow is host-side glue), but worth a smoke check via `npm start`. **Remember the known gotcha:** `npm start` can serve a stale `dist/` — run `npm run compile` first.

1. `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run compile && npm start`
2. Open a workspace that has annotations with tags. Confirm a **tag icon** appears in the Annotations view title bar.
3. Click it → pick a tag → **Rename**: enter an existing name → blocked with the "already exists" message; enter a fresh name → chips + filter options update to the new name across all groups.
4. Click it → pick a tag → **Change color…** → pick a swatch → the chip/gutter color updates everywhere.
5. Click it → pick a tag → **Delete** → confirm the modal shows the right group count → the tag disappears from all groups and the filter bar, and does not reappear (no reconcile resurrection).
6. Run `annotated.manageTags` from the Command Palette to confirm the palette entry works too.

---

## Self-Review

- **Spec coverage:**
  - Rename (block on collision, preserve color, rewrite config + groups) → Tasks 1, 2, 4. ✓
  - Recolor (config + re-stamp every group, JSON-only → workspace config) → Tasks 1, 2, 4. ✓
  - Delete (modal confirm with count, remove from workspace + global config + all groups) → Tasks 1, 2, 4. ✓
  - Entry point (sidebar `view/title` button + Command Palette) → Task 5. ✓
  - Reusable color prompt → Task 3. ✓
  - Pure functions unit-tested; host glue thin/untested → Tasks 1–2 tested, 3–5 type-checked. ✓
- **Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓
- **Type consistency:** `TagOp`, `paletteHasName`, `renameInConfig`, `recolorInConfig`, `deleteFromConfig`, `groupTagPatches`, `groupsUsingTag`, `promptTagColor`, `manageTags` are named identically everywhere they appear; `groupTagPatches` returns `{ id, tags }[]` consumed as `patch.id`/`patch.tags` in Task 4; `manageTags(afterApply)` signature matches its Task 5 call site. ✓
