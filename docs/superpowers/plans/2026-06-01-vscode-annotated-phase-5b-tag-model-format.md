# Phase 5b — Tag Model Format Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `AnnotationGroup.tags` from `string[]` to `Tag[]` (`{ name, color }`) so colors are stored in the group JSON, with `parseGroup` migrating legacy `string[]` files. Update every consumer + test fixture so the suite stays green. **Behavior is unchanged** — display colors still come from the config palette (`readTagPalette`); the precedence/reconciliation logic is sub-plan 5c.

**Architecture:** `Tag` becomes a canonical type in `shared/model.ts` (re-exported from `core/tags.ts` for compatibility). `parseGroup` accepts both `"name"` (legacy → `{name, color:'#888888'}`) and `{name, color}`. Tag-name consumers read `t.name`; the create/edit flows resolve picked names → `Tag[]` via the config palette and stamp them.

**Tech Stack:** TypeScript, Svelte 5, Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### CRITICAL — this is ONE atomic commit

A type change to `AnnotationGroup.tags` breaks compilation **and** runtime tests across many files until *all* are updated. There is no green intermediate state, so **do not commit until the very end**. As you go, you may run individual test files with `npx vitest run --project <unit|component> <file>` (Vitest uses esbuild and ignores type errors in *other* files, so a single file's runtime test can pass before the whole project type-checks). **Run `npm run check-types` only at the final gate** — it will be red until every consumer is updated. Make a **single commit** after the full gate is green.

`FilterBar`'s `tags` prop, `availableTags(...)`'s return, `selectedTags`, and all filter option lists are tag **names** (`string[]`) and **do not change** — only the `AnnotationGroup.tags` field becomes `Tag[]`.

---

## File Structure (all modified in one commit)

**Logic:** `shared/model.ts`, `core/tags.ts`, `core/annotationFactory.ts`, `core/createAnnotationFlow.ts`,
`core/sidebarState.ts`, `core/gutterIndicators.ts`, `webview/detail/GroupView.svelte`,
`webview/sidebar/GroupCard.svelte`, `web/createAnnotationCommand.ts`, `web/extension.ts`.
(`core/groupStore.ts` needs **no** edit — its `Pick<AnnotationGroup,'tags'>` updates automatically.)

**Fixtures/tests:** `shared/model.unit.test.ts`, `shared/skillContract.unit.test.ts`,
`core/annotationFactory.unit.test.ts`, `core/groupStore.unit.test.ts`, `core/sidebarState.unit.test.ts`,
`core/gutterIndicators.unit.test.ts`, `webview/sidebar/App.svelte.test.ts`,
`webview/sidebar/GroupCard.svelte.test.ts`, `webview/detail/GroupView.svelte.test.ts`,
`webview/detail/DetailApp.svelte.test.ts`, `web/test/suite/updateGroup.integration.test.ts`,
`web/test/suite/groupStore.integration.test.ts`.

---

### Task 1: Migrate `AnnotationGroup.tags` to `Tag[]` (single atomic change)

**Step 1 — `shared/model.ts`: add `Tag`, change the field, migrate in parse.**

(a) Add the type (after the `LineRange` interface):

```ts
/** A tag on a group: a display name + color. (Colors are also resolved from user config.) */
export interface Tag {
  name: string;
  color: string;
}
```

(b) Change the `tags` field on `AnnotationGroup` and its comment:

```ts
  /** Tags with their stored colors (display color is resolved from config, then this). */
  tags: Tag[];
```

(c) Add a `parseTag` helper (above `parseGroup`):

```ts
function parseTag(raw: unknown): Tag {
  if (typeof raw === 'string') {
    // Legacy `string[]` tags → migrate; real color resolves from config / is stamped on next save.
    return { name: raw, color: '#888888' };
  }
  if (isObject(raw) && typeof (raw as { name?: unknown }).name === 'string') {
    const r = raw as { name: string; color?: unknown };
    return { name: r.name, color: typeof r.color === 'string' ? r.color : '#888888' };
  }
  return fail('tags[]', 'must be a string or { name, color }');
}
```

(d) In `parseGroup`, replace the tags validation line:

```ts
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) fail('tags', 'must be a string[]');
```

with:

```ts
  if (!Array.isArray(tags)) fail('tags', 'must be an array');
```

and replace the returned tags line:

```ts
    tags: [...tags] as string[],
```

with:

```ts
    tags: tags.map(parseTag),
```

**Step 2 — `core/tags.ts`: make `Tag` the model's type (re-export).** Remove the local `Tag` interface and instead, at the top:

```ts
import { type Tag } from '../shared/model';
export type { Tag };
```

(`parseTagPalette`'s `Tag[]` return and `TAG_SWATCHES`/`splitPickedTags`/`NEW_TAG_LABEL` are otherwise unchanged.)

**Step 3 — `core/annotationFactory.ts`:** add `type Tag` to the model import and change `createGroup`'s input `tags: string[]` → `tags: Tag[]` (the `tags: [...input.tags]` body is unchanged):

```ts
import { type Annotation, type AnnotationGroup, type LineRange, type Tag } from '../shared/model';
```
```ts
  tags: Tag[];
```

**Step 4 — `core/createAnnotationFlow.ts`:** add `type Tag` to the model import and change the `pickTags` dep type from `Promise<string[] | undefined>` to `Promise<Tag[] | undefined>` (the flow body passes `tags` straight into `createGroup`, unchanged):

```ts
  /** Tag list for a new group; [] = none, undefined = cancelled. */
  pickTags(): Promise<Tag[] | undefined>;
```

**Step 5 — `core/sidebarState.ts`: read tag names.** Two spots:

In `applyHostMessage`, change:
```ts
      const tags = new Set(message.groups.flatMap((g) => g.tags));
```
to:
```ts
      const tags = new Set(message.groups.flatMap((g) => g.tags.map((t) => t.name)));
```

In `availableTags`, change:
```ts
  return [...new Set(groups.flatMap((g) => g.tags))].sort();
```
to:
```ts
  return [...new Set(groups.flatMap((g) => g.tags.map((t) => t.name)))].sort();
```

**Step 6 — `core/gutterIndicators.ts`:** in `groupBarColor`, change `group.tags[0]` to `group.tags[0].name`:

```ts
  return group.tags.length > 0 ? tagColor(palette, group.tags[0].name) : DEFAULT_BAR_COLOR;
```

**Step 7 — `webview/detail/GroupView.svelte`:** the chip `{#each}` reads `t.name`:

```svelte
      {#each group.tags as tag (tag.name)}
        {@const bg = tagColor(palette, tag.name)}
        <span class="chip" data-testid="tag-chip" style="background:{bg}; color:{contrastColor(bg)}">{tag.name}</span>
      {/each}
```

**Step 8 — `webview/sidebar/GroupCard.svelte`:** same change (keep the `{#if group.tags.length > 0}` guard):

```svelte
      {#each group.tags as tag (tag.name)}
        {@const bg = tagColor(palette, tag.name)}
        <span class="chip" data-testid="tag-chip" style="background:{bg}; color:{contrastColor(bg)}">{tag.name}</span>
      {/each}
```

**Step 9 — `web/createAnnotationCommand.ts`: resolve picked names → `Tag[]`.**

(a) Add imports (near the existing `./` imports):
```ts
import { tagColor } from '../core/sidebarState';
import { type Tag } from '../shared/model';
```

(b) Change `pickTags` to return `Tag[]` (the QuickPick item building with `iconPath` from 5a is unchanged):
```ts
async function pickTags(): Promise<Tag[] | undefined> {
  const palette = readTagPalette();
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

(c) In `pickGroup`, change the description's `g.tags.join(', ')` to names:
```ts
      description: `${g.annotations.length} annotation(s)${g.tags.length ? ` · ${g.tags.map((t) => t.name).join(', ')}` : ''}`,
```

**Step 10 — `web/extension.ts`: resolve picked names → `Tag[]` in both tag editors.**

(a) Add imports near the top:
```ts
import { tagColor } from '../core/sidebarState';
import { type Tag } from '../shared/model';
```

(b) Change `patchGroup`'s signature `tags?: string[]` → `tags?: Tag[]`:
```ts
    patch: { title?: string; tags?: Tag[]; gitRef?: string | null; status?: GroupStatus },
```

(c) In `onEditTags`: the `picked` flag reads `t.name`, and picked names resolve to `Tag[]`:
```ts
      ...palette.map((t) => ({ label: t.name, picked: group.tags.some((gt) => gt.name === t.name), iconPath: vscode.Uri.parse(swatchIconSvg(t.color)) })),
```
and replace the `if (addNew) { ... names.push ... } await patchGroup(groupId, { tags: names });` tail with:
```ts
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

(d) In `onBulkEditTags`: same resolution. Replace its `if (addNew) {...names.push...}` + the `for...updateGroup(id, { tags: names }, now())` tail with:
```ts
    const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
    const tags: Tag[] = names.map((name) => ({ name, color: tagColor(palette, name) }));
    if (addNew) {
      const created = await promptNewTag();
      if (created) {
        tags.push(created);
      }
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.updateGroup(id, { tags }, now());
    }
```
(Keep the surrounding `palette`/`items`/`showQuickPick`/`folder` lines as they are.)

**Step 11 — Rewrite the `parseGroup` tag tests in `shared/model.unit.test.ts`.**

(a) Change `validGroup.tags` to the object form:
```ts
  tags: [
    { name: 'security', color: '#E5484D' },
    { name: 'question', color: '#3794FF' },
  ],
```

(b) Add two tests inside `describe('serializeGroup/parseGroup', ...)`:
```ts
  it('migrates legacy string[] tags to {name, color} with the default color', () => {
    const legacy = { ...validGroup, tags: ['security', 'todo'] };
    expect(parseGroup(legacy).tags).toEqual([
      { name: 'security', color: '#888888' },
      { name: 'todo', color: '#888888' },
    ]);
  });

  it('throws when a tag is neither a string nor a {name} object', () => {
    expect(() => parseGroup({ ...validGroup, tags: [42] })).toThrow(/tags/);
  });
```

**Step 12 — Update every other fixture that builds an `AnnotationGroup` (or a `createGroup`/`updateGroup`/`saveGroup` tags input).** Apply this **mechanical rule**: a tags value `['a', 'b']` becomes `[{ name: 'a', color: '#888888' }, { name: 'b', color: '#888888' }]`. For `group()` test helpers, change the option type `tags?: string[]` → `tags?: { name: string; color: string }[]`. The fixture color value is arbitrary (`'#888888'`) — these tests assert tag **names** or **palette-resolved** colors, never the fixture's stored color. Exact sites:

- `core/annotationFactory.unit.test.ts:12` — `tags: ['security']` → objects (in the `createGroup({...})` input). Any assertion comparing `saved.tags` must expect the object form.
- `core/groupStore.unit.test.ts:101` — `updateGroup('g1', { ..., tags: ['security'], ... })` → objects. `:111` — `saveGroup({ ...group(...), tags: ['a'], ... })` → objects. If `group()` here types `tags`, update its type too.
- `core/sidebarState.unit.test.ts` — `group()` helper `tags?: string[]` → objects; sites `:61, :82, :83, :84, :123` → objects. (Assertions on `availableTags`/`filterGroups` return **names** — unchanged.)
- `core/gutterIndicators.unit.test.ts` — its `group()` helper uses `Partial<AnnotationGroup>`, so only the call sites change: `:17, :29, :36, :43, :46, :87` `tags: ['x']` → objects.
- `webview/sidebar/App.svelte.test.ts` — `group()` helper `tags?: string[]` → objects; site `:57` → objects.
- `webview/sidebar/GroupCard.svelte.test.ts:12` — `tags: ['security']` → objects.
- `webview/detail/GroupView.svelte.test.ts:10` and `webview/detail/DetailApp.svelte.test.ts:10` — inline group literal `tags: ['security']` → objects.
- `shared/skillContract.unit.test.ts:81` — typed `AnnotationGroup` literal `tags: ['security']` → objects (so the `parseGroup(serialize(group))` round-trip `toEqual(group)` holds).
- `web/test/suite/updateGroup.integration.test.ts:19` — `{ ..., tags: ['x'], ... }` → objects. `web/test/suite/groupStore.integration.test.ts:17` — `tags: ['security']` → objects.

> **Do NOT change** `webview/sidebar/FilterBar.svelte.test.ts` — its `tags: ['security']` is the filter-options **name list** (`string[]`), not a group's tags.

**Step 13 — Final gate.**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest unit + component tests PASS. (If any fixture still uses `string[]`, you'll see either a tsc error or a runtime `toEqual`/`.name`-undefined failure — fix that fixture per the rule and re-run.)

**Step 14 — Single commit.**

```bash
git add -A
git commit -m "refactor(model): group tags are {name,color} objects; parseGroup migrates legacy string[] (TODO #3)"
```

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** §C1 (model `tags: Tag[]` + legacy migration) → Steps 1, 11. §C5 (every name-based consumer) → Steps 3–10, 12. §C3 mechanism (stamp colors from the config palette when tags change) → Steps 9, 10 (`names.map(name => ({name, color: tagColor(palette, name)}))`, plus `promptNewTag`'s own color). 5c later switches the stamp/display source to resolved precedence. ✓
- **Type consistency:** canonical `Tag` lives in `shared/model.ts`, re-exported by `core/tags.ts`; `createGroup`/`pickTags`/`updateGroup` patch all take `Tag[]`; `groupStore.updateGroup`'s `Pick<...,'tags'>` updates for free. Webview/sidebar read `t.name`; chip color via `tagColor(palette, t.name)`. ✓
- **No placeholders:** exact code for all logic; the fixture sweep is an exhaustive enumerated list + a single mechanical rule (not vague). ✓
- **Atomicity:** one commit; `check-types` only at the final gate (red mid-refactor is expected). ✓
- **Scope boundary:** the annotated-agent skill keeps emitting legacy `string[]` tags — `parseGroup` migrates them, so it still loads; updating the skill to emit objects is out of scope (parse stays backward-compatible). `FilterBar` tag-name props stay `string[]`. ✓
