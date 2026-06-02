# Phase 5c — Tag Color Resolution + Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a tag's display color by precedence **local config > global config > JSON**, send that resolved palette to the webviews + use it when stamping, and **auto-add** group tags missing from both configs to the **workspace** config on load (TODO #3, the behavior half).

**Architecture:** A new pure module `core/tagResolve.ts` (resolution + reconciliation candidates). `web/tagPalette.ts` reads the two config sources via `inspect`, exposes `displayPalette(groups)` and `reconcileWorkspaceTags(groups)`. `extension.ts` / `sidebarViewProvider.ts` send `displayPalette(...)` instead of the raw effective config, stamp tag-edits with it, and reconcile on activation + annotation-file changes.

**Tech Stack:** TypeScript, VSCode config API (`inspect`, `update(Workspace)`), Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
`core/tagResolve.ts` is fully unit-tested. `web/tagPalette.ts` (`inspect`/`update`) and the `extension.ts`/`sidebarViewProvider.ts` wiring are `vscode`-glue — type-check + the existing suite staying green; reconciliation writing workspace settings is verified manually/integration. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Create** `src/core/tagResolve.ts` (+ `.unit.test.ts`) — `jsonTagColors`, `resolveTagColor`, `resolveDisplayPalette`, `missingWorkspaceTags`.
- **Modify** `src/web/tagPalette.ts` — `readTagSources`, `displayPalette`, `reconcileWorkspaceTags`.
- **Modify** `src/web/sidebarViewProvider.ts` — send `displayPalette(groups)`.
- **Modify** `src/web/extension.ts` — resolved palette for detail panel + gutter + tag-edits; reconcile triggers; config-change also refreshes the sidebar.
- **Modify** `src/web/createAnnotationCommand.ts` — `pickTags` resolves via the resolved palette.

---

### Task 1: `core/tagResolve.ts` resolution + reconciliation logic (pure)

**Files:**
- Create: `src/core/tagResolve.ts`
- Test: `src/core/tagResolve.unit.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/tagResolve.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jsonTagColors, resolveTagColor, resolveDisplayPalette, missingWorkspaceTags } from './tagResolve';
import { type AnnotationGroup } from '../shared/model';

function group(tags: { name: string; color: string }[]): AnnotationGroup {
  return { id: 'g', title: 'G', author: 'A', tags, gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('jsonTagColors', () => {
  it('takes the first-seen color per tag name across groups', () => {
    const m = jsonTagColors([group([{ name: 'sec', color: '#111' }]), group([{ name: 'sec', color: '#999' }, { name: 'perf', color: '#222' }])]);
    expect(m.get('sec')).toBe('#111');
    expect(m.get('perf')).toBe('#222');
  });
});

describe('resolveTagColor', () => {
  const sources = {
    local: [{ name: 'a', color: '#local' }],
    global: [{ name: 'a', color: '#global' }, { name: 'b', color: '#global-b' }],
    json: new Map([['a', '#json'], ['c', '#json-c']]),
  };
  it('prefers local, then global, then JSON, then default', () => {
    expect(resolveTagColor('a', sources)).toBe('#local');   // local wins
    expect(resolveTagColor('b', sources)).toBe('#global-b'); // only in global
    expect(resolveTagColor('c', sources)).toBe('#json-c');   // only in JSON
    expect(resolveTagColor('z', sources)).toBe('#888888');   // nowhere → default
  });
});

describe('resolveDisplayPalette', () => {
  it('unions all tag names (config ∪ groups), sorted, each color resolved by precedence', () => {
    const palette = resolveDisplayPalette(
      [{ name: 'a', color: '#local' }],
      [{ name: 'b', color: '#global' }],
      [group([{ name: 'a', color: '#json-a' }, { name: 'c', color: '#json-c' }])],
    );
    expect(palette).toEqual([
      { name: 'a', color: '#local' },   // local beats JSON
      { name: 'b', color: '#global' },
      { name: 'c', color: '#json-c' },
    ]);
  });
});

describe('missingWorkspaceTags', () => {
  it('returns group tags absent from both configs, deduped, with their JSON color', () => {
    const missing = missingWorkspaceTags(
      [{ name: 'a', color: '#l' }],
      [{ name: 'b', color: '#g' }],
      [group([{ name: 'a', color: '#ja' }, { name: 'c', color: '#jc' }]), group([{ name: 'c', color: '#jc2' }, { name: 'd', color: '#jd' }])],
    );
    expect(missing).toEqual([
      { name: 'c', color: '#jc' }, // first-seen color, only once
      { name: 'd', color: '#jd' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/tagResolve.unit.test.ts`
Expected: FAIL — cannot resolve `./tagResolve`.

- [ ] **Step 3: Implement** — create `src/core/tagResolve.ts`:

```ts
import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';

const DEFAULT_COLOR = '#888888';

/** First-seen JSON color per tag name across the given groups. */
export function jsonTagColors(groups: AnnotationGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const tag of group.tags) {
      if (!map.has(tag.name)) {
        map.set(tag.name, tag.color);
      }
    }
  }
  return map;
}

/** Resolve a tag's display color: local config → global config → JSON → default. */
export function resolveTagColor(
  name: string,
  sources: { local: TagColor[]; global: TagColor[]; json: Map<string, string> },
): string {
  const find = (arr: TagColor[]): string | undefined => arr.find((t) => t.name === name)?.color;
  return find(sources.local) ?? find(sources.global) ?? sources.json.get(name) ?? DEFAULT_COLOR;
}

/** The full display palette: every tag name (config ∪ groups), each color precedence-resolved. */
export function resolveDisplayPalette(
  local: TagColor[],
  global: TagColor[],
  groups: AnnotationGroup[],
): TagColor[] {
  const json = jsonTagColors(groups);
  const names = new Set<string>([
    ...local.map((t) => t.name),
    ...global.map((t) => t.name),
    ...groups.flatMap((g) => g.tags.map((t) => t.name)),
  ]);
  return [...names].sort().map((name) => ({ name, color: resolveTagColor(name, { local, global, json }) }));
}

/** Tags used by groups but absent from BOTH config sources, deduped, with their JSON color. */
export function missingWorkspaceTags(
  local: TagColor[],
  global: TagColor[],
  groups: AnnotationGroup[],
): TagColor[] {
  const json = jsonTagColors(groups);
  const have = new Set<string>([...local.map((t) => t.name), ...global.map((t) => t.name)]);
  const out: TagColor[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const tag of group.tags) {
      if (!have.has(tag.name) && !seen.has(tag.name)) {
        seen.add(tag.name);
        out.push({ name: tag.name, color: json.get(tag.name) ?? DEFAULT_COLOR });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/tagResolve.unit.test.ts`
Expected: PASS (all tagResolve tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tagResolve.ts src/core/tagResolve.unit.test.ts
git commit -m "feat(tags): tagResolve — local>global>JSON color precedence + reconcile candidates (TODO #3)"
```

---

### Task 2: `web/tagPalette.ts` — config sources, display palette, reconciliation

**Files:**
- Modify: `src/web/tagPalette.ts`

- [ ] **Step 1: Add the helpers.** Add imports at the top:

```ts
import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import { resolveDisplayPalette, missingWorkspaceTags } from '../core/tagResolve';
```

Then append:

```ts
/** Local (workspace) and global (user) tag palettes, read separately for precedence. */
export function readTagSources(): { local: Tag[]; global: Tag[] } {
  const inspected = vscode.workspace.getConfiguration('annotated').inspect('tags');
  return {
    local: parseTagPalette(inspected?.workspaceValue),
    global: parseTagPalette(inspected?.globalValue),
  };
}

/** The precedence-resolved display palette (local > global > JSON) for the given groups. */
export function displayPalette(groups: AnnotationGroup[]): TagColor[] {
  const { local, global } = readTagSources();
  return resolveDisplayPalette(local, global, groups);
}

/** Add group tags missing from both configs to the workspace config (idempotent — no-op if none). */
export async function reconcileWorkspaceTags(groups: AnnotationGroup[]): Promise<void> {
  const { local, global } = readTagSources();
  const missing = missingWorkspaceTags(local, global, groups);
  if (missing.length === 0) {
    return;
  }
  await vscode.workspace
    .getConfiguration('annotated')
    .update('tags', [...local, ...missing], vscode.ConfigurationTarget.Workspace);
}
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean. (`parseTagPalette(unknown)` accepts the `inspect` values.)

- [ ] **Step 3: Commit**

```bash
git add src/web/tagPalette.ts
git commit -m "feat(tags): readTagSources + displayPalette + reconcileWorkspaceTags (TODO #3)"
```

---

### Task 3: Wire the resolved palette + reconciliation

**Files:**
- Modify: `src/web/sidebarViewProvider.ts`
- Modify: `src/web/createAnnotationCommand.ts`
- Modify: `src/web/extension.ts`

- [ ] **Step 1: `sidebarViewProvider.ts` — send the resolved palette.** Change the import of `readTagPalette` to `displayPalette`:

```ts
import { displayPalette } from './tagPalette';
```

and in `refresh()`, change the palette in the `setState` message from `readTagPalette()` to `displayPalette(groups)`:

```ts
    const message: HostToWebview = { type: 'setState', groups, palette: displayPalette(groups) };
```

- [ ] **Step 2: `createAnnotationCommand.ts` — `pickTags` takes a resolved palette.** Change the import line `import { readTagPalette, promptNewTag } from './tagPalette';` to:

```ts
import { displayPalette, promptNewTag } from './tagPalette';
```

Add `type TagColor` to the protocol import (or add an import): `import { type TagColor } from '../shared/protocol';`. Change `pickTags`'s signature + its internal palette source so the palette is passed in:

```ts
async function pickTags(palette: TagColor[]): Promise<Tag[] | undefined> {
  const items: vscode.QuickPickItem[] = [
    ...palette.map((t) => ({ label: t.name, iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
    { label: NEW_TAG_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select tags (optional)',
  });
  if (picked === undefined) {
    return undefined;
  }
  const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
  const tags: Tag[] = names.map((name) => ({ name, color: tagColor(palette, name) }));
  if (addNew) {
    const created = await promptNewTag();
    if (created) {
      tags.push(created);
    }
  }
  return tags;
}
```

And change the `deps.pickTags` wiring (in `registerCreateAnnotationCommand`) from `pickTags: () => pickTags(),` to:

```ts
      pickTags: async () => pickTags(displayPalette(await store.listGroups())),
```

- [ ] **Step 2b: Type-check the command in isolation**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: still red until Step 3 finishes extension.ts edits — that's fine; do the full type-check at the gate. (You may skip this sub-step.)

- [ ] **Step 3: `extension.ts` — resolved palette everywhere + reconciliation.**

(a) Change the tagPalette import to add the new helpers (keep `addTagToPalette`/`promptNewTag`/`readTagPalette` only if still used elsewhere — after these edits `readTagPalette` is no longer used in this file, so drop it):

```ts
import { displayPalette, reconcileWorkspaceTags, promptNewTag } from './tagPalette';
```

(b) `refreshDecorations` — resolved palette:

```ts
    gutter.refresh(vscode.window.visibleTextEditors, groups, displayPalette(groups));
```

(c) `showGroupWithStale` — resolved palette for the detail panel (the loaded group's context):

```ts
    detailProvider.showGroup(group, displayPalette(group ? [group] : []), staleIds, comments, author);
```

(d) `onBulkEditTags` — build the resolved palette from all groups, and reuse the `store` for the loop. Replace its `const palette = readTagPalette();` line with:

```ts
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const palette = displayPalette(await store.listGroups());
```

and delete the later duplicate `const store = new GroupStore(new VscodeFileSystem(folder.uri));` (just before the `for` loop) so the loop uses the `store` declared above. (The `tags`/`items`/`for` logic is otherwise unchanged.)

(e) `onEditTags` — resolved palette from all groups. It already creates a `GroupStore` to load the group; change that to a named `store` and reuse it. Replace:

```ts
    const group = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    if (!group) {
      return;
    }
    const palette = readTagPalette();
```

with:

```ts
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const group = await store.getGroup(groupId);
    if (!group) {
      return;
    }
    const palette = displayPalette(await store.listGroups());
```

(f) Reconciliation trigger. Add a `reconcile` helper near `refreshDecorations`:

```ts
  const reconcile = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const groups = await new GroupStore(new VscodeFileSystem(folder.uri)).listGroups();
    await reconcileWorkspaceTags(groups);
  };
```

Add `void reconcile();` to `onAnnotationsChanged`:

```ts
  const onAnnotationsChanged = (): void => {
    void reconcile();
    void provider.refresh();
    void refreshDecorations();
  };
```

(g) Config-change handler — also refresh the sidebar (so its colors update when config/reconcile changes `annotated.tags`):

```ts
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('annotated.tags')) {
        void provider.refresh();
        void refreshDecorations();
      }
    }),
```

(h) Initial reconcile on activation — add next to the initial paint at the end of `activate`:

```ts
  provider.onRefreshRequested = (): void => void refreshDecorations();
  void reconcile();
  void refreshDecorations(); // initial paint for already-open editors
```

- [ ] **Step 4: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean (no unused `readTagPalette`/`tagColor` import warnings — `tagColor` is still used in `extension.ts`'s `onEditTags`/`onBulkEditTags` stamping and in `createAnnotationCommand`; if `readTagPalette` is now unused anywhere, remove that import).

- [ ] **Step 5: Commit**

```bash
git add src/web/sidebarViewProvider.ts src/web/createAnnotationCommand.ts src/web/extension.ts
git commit -m "feat(tags): send resolved palette + stamp with it + reconcile on load (TODO #3)"
```

---

### Task 4: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS (component tests pass an explicit `palette`, so they're unaffected; the new tagResolve tests pass).

- [ ] **Step 2: Confirm `readTagPalette` is no longer the palette source for display**

Run: `grep -rn "readTagPalette" src/web`
Expected: it remains defined in `tagPalette.ts` and used internally by `promptNewTag`/`addTagToPalette` only — NOT used as the palette sent to webviews or for gutter/stamping (those use `displayPalette`). If any display/stamping site still calls `readTagPalette()`, switch it to `displayPalette(groups)`.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** §C2 (precedence local>global>JSON) → `tagResolve.resolveTagColor`/`resolveDisplayPalette` (Task 1) + `displayPalette` (Task 2). §C6 (webview gets the resolved palette) → Task 3 a/c + sidebar. §C3 refined (stamp with the resolved color) → Task 3 d/e + `createAnnotationCommand` pickTags. §C4 (reconcile missing tags to workspace on activation + watcher) → `reconcileWorkspaceTags` (Task 2) + `reconcile` triggers (Task 3 f/h). ✓
- **Type consistency:** `readTagSources(): {local: Tag[], global: Tag[]}` (parsed config); `displayPalette(groups): TagColor[]`; `resolveDisplayPalette(local, global, groups)`/`missingWorkspaceTags(...)` take `TagColor[]` (structurally `Tag[]`). Stamping reuses `tagColor(palette, name)` against the resolved palette. ✓
- **No loops:** `reconcileWorkspaceTags` is idempotent (writes only when `missing.length > 0`); the config-change handler refreshes sidebar/decorations but does NOT reconcile, so a reconcile write can't re-trigger itself. ✓
- **No placeholders:** exact code for all logic + wiring edits. ✓
- **`verbatimModuleSyntax`:** `AnnotationGroup`/`TagColor` imported as types; functions as values. ✓
- **Tests stay green:** component tests pass an explicit `palette` prop (don't call `displayPalette`); `applyHostMessage`/sidebar tests use explicit palettes — unaffected by the host now computing a resolved palette. ✓
