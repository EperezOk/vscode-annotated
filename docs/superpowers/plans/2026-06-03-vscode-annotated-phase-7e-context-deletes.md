# Phase 7e — Right-Click Deletes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click delete for groups (sidebar cards) and annotations (group-view rows) via native VSCode webview context menus (round-3 TODO #4, spec §D). Deleting the last annotation keeps the (empty) group.

**Architecture:** Webview elements set `data-vscode-context`; two new commands are contributed to `menus.webview/context` and receive that context object as their argument. A pure `removeAnnotation` + `GroupStore.deleteAnnotation` handle persistence. Host handlers confirm with the existing modal pattern, then refresh sidebar/detail/decorations; `DetailPanelProvider.currentGroupId()` guards the detail-panel sync for the sidebar-initiated group delete.

**Tech Stack:** TypeScript, VSCode `webview/context` menus + `data-vscode-context`, Svelte 5, Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

> **Shared-checkout caution:** another session may have files staged in this repo. Always commit with an explicit pathspec — `git commit -m "…" -- <file1> <file2>` — never a bare `git commit` after `git add`.

### Testing reality
`removeAnnotation`/`deleteAnnotation` are unit-tested (memory fs); the `data-vscode-context` attributes are component-tested; commands/menus/handlers are `vscode`-glue — package.json validity + type-check + an integration-test assertion that the commands register; the actual context-menu UX is manual. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/core/annotationFactory.ts` (+ `.unit.test.ts`) — pure `removeAnnotation`.
- **Modify** `src/core/groupStore.ts` (+ `.unit.test.ts`) — `deleteAnnotation`.
- **Modify** `src/webview/sidebar/GroupCard.svelte` (+ `.svelte.test.ts`) — card context attribute.
- **Modify** `src/webview/detail/GroupView.svelte` (+ `.svelte.test.ts`) — row context attribute.
- **Modify** `package.json` — commands + `webview/context` + `commandPalette` menus.
- **Modify** `src/web/extension.ts` — `annotated.deleteGroup` / `annotated.deleteAnnotation` handlers.
- **Modify** `src/web/detailPanelProvider.ts` — `currentGroupId()` getter.
- **Modify** `src/web/test/suite/extension.test.ts` — assert the new commands register.

---

### Task 1: Pure `removeAnnotation` (§D)

**Files:**
- Modify: `src/core/annotationFactory.ts`
- Test: `src/core/annotationFactory.unit.test.ts`

- [ ] **Step 1: Write the failing test** — in `src/core/annotationFactory.unit.test.ts`, add `removeAnnotation` to the import from `./annotationFactory`, then append:

```ts
describe('removeAnnotation', () => {
  it('removes the annotation and bumps updatedAt without mutating the input', () => {
    const g = addAnnotation(
      createGroup({ id: 'g1', title: 'T', author: 'A', tags: [], now: 1 }),
      makeAnnotation({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, contentHash: 'h' }),
      2,
    );
    const next = removeAnnotation(g, 'a1', 300);
    expect(next?.annotations).toEqual([]);
    expect(next?.updatedAt).toBe(300);
    expect(g.annotations).toHaveLength(1); // original unchanged
  });

  it('returns null when the annotation id is absent', () => {
    const g = createGroup({ id: 'g1', title: 'T', author: 'A', tags: [], now: 1 });
    expect(removeAnnotation(g, 'missing', 2)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/annotationFactory.unit.test.ts`
Expected: FAIL — `removeAnnotation` is not exported.

- [ ] **Step 3: Implement** — in `src/core/annotationFactory.ts`, append after `addAnnotation`:

```ts
/**
 * Return a copy of `group` without the annotation `annotationId` (updatedAt = `now`),
 * or null when the id is absent. The group is kept even when emptied — deleting the
 * last annotation does not delete the group (round-3 #4 decision).
 */
export function removeAnnotation(group: AnnotationGroup, annotationId: string, now: number): AnnotationGroup | null {
  const annotations = group.annotations.filter((a) => a.id !== annotationId);
  if (annotations.length === group.annotations.length) {
    return null;
  }
  return { ...group, annotations, updatedAt: now };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/annotationFactory.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(core): removeAnnotation pure helper (TODO #4)" -- src/core/annotationFactory.ts src/core/annotationFactory.unit.test.ts
```

---

### Task 2: `GroupStore.deleteAnnotation` (§D)

**Files:**
- Modify: `src/core/groupStore.ts`
- Test: `src/core/groupStore.unit.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the `describe('GroupStore', ...)` block of `src/core/groupStore.unit.test.ts`:

```ts
  describe('deleteAnnotation', () => {
    function withAnnotations(id: string): AnnotationGroup {
      return {
        ...group(id),
        annotations: [
          { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
          { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
        ],
      };
    }

    it('removes the annotation, bumps updatedAt, and persists', async () => {
      await store.saveGroup(withAnnotations('g1'));
      expect(await store.deleteAnnotation('g1', 'a1', 99)).toBe(true);
      const got = await store.getGroup('g1');
      expect(got?.annotations.map((a) => a.id)).toEqual(['a2']);
      expect(got?.updatedAt).toBe(99);
    });

    it('keeps the (now empty) group file when the last annotation is deleted', async () => {
      const base = withAnnotations('g1');
      await store.saveGroup({ ...base, annotations: [base.annotations[0]] });
      expect(await store.deleteAnnotation('g1', 'a1', 99)).toBe(true);
      expect((await store.getGroup('g1'))?.annotations).toEqual([]);
      expect(await fs.exists('.annotations/groups/g1.json')).toBe(true);
    });

    it('returns false for a missing group or annotation', async () => {
      expect(await store.deleteAnnotation('nope', 'a1', 1)).toBe(false);
      await store.saveGroup(withAnnotations('g1'));
      expect(await store.deleteAnnotation('g1', 'missing', 1)).toBe(false);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/groupStore.unit.test.ts`
Expected: FAIL — `deleteAnnotation` does not exist.

- [ ] **Step 3: Implement.** In `src/core/groupStore.ts`:

(a) Add the import after the existing model import:

```ts
import { removeAnnotation } from './annotationFactory';
```

(b) Append the method after `deleteGroup`:

```ts
  /**
   * Delete one annotation from a group; the group itself is kept, even when
   * emptied. Returns false when the group or annotation does not exist.
   */
  async deleteAnnotation(groupId: string, annotationId: string, now: number): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const updated = removeAnnotation(group, annotationId, now);
    if (!updated) {
      return false;
    }
    await this.saveGroup(updated);
    return true;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/groupStore.unit.test.ts`
Expected: PASS (all GroupStore tests).

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(core): GroupStore.deleteAnnotation keeps emptied groups (TODO #4)" -- src/core/groupStore.ts src/core/groupStore.unit.test.ts
```

---

### Task 3: Webview context attributes (§D)

**Files:**
- Modify: `src/webview/sidebar/GroupCard.svelte`
- Test: `src/webview/sidebar/GroupCard.svelte.test.ts`
- Modify: `src/webview/detail/GroupView.svelte`
- Test: `src/webview/detail/GroupView.svelte.test.ts`

- [ ] **Step 1: Write the failing tests.**

(a) Append inside `describe('GroupCard', ...)` of `src/webview/sidebar/GroupCard.svelte.test.ts`:

```ts
  it('exposes the right-click delete context on the card', () => {
    render(GroupCard, { group: group(), palette: [] });
    const raw = screen.getByTestId('group-card').getAttribute('data-vscode-context');
    expect(JSON.parse(raw ?? '{}')).toEqual({
      webviewSection: 'group',
      groupId: 'g1',
      preventDefaultContextMenuItems: true,
    });
  });
```

(b) Append inside `describe('GroupView', ...)` of `src/webview/detail/GroupView.svelte.test.ts`:

```ts
  it('exposes the right-click delete context on annotation rows', () => {
    render(GroupView, { group: group(), palette });
    const raw = screen.getByTestId('annotation-drag').getAttribute('data-vscode-context');
    expect(JSON.parse(raw ?? '{}')).toEqual({
      webviewSection: 'annotation',
      groupId: 'g1',
      annotationId: 'a1',
      preventDefaultContextMenuItems: true,
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/GroupCard.svelte.test.ts src/webview/detail/GroupView.svelte.test.ts`
Expected: FAIL — attribute missing (JSON.parse('{}') ≠ expected object).

- [ ] **Step 3: Implement.**

(a) In `src/webview/sidebar/GroupCard.svelte`, add the attribute to the root `<button class="card" …>` (after the `data-testid="group-card"` line):

```svelte
  data-vscode-context={JSON.stringify({ webviewSection: 'group', groupId: group.id, preventDefaultContextMenuItems: true })}
```

(b) In `src/webview/detail/GroupView.svelte`, add the attribute to the `.row-wrap` div (after its `data-testid="annotation-drag"` line):

```svelte
        data-vscode-context={JSON.stringify({ webviewSection: 'annotation', groupId: group.id, annotationId: annotation.id, preventDefaultContextMenuItems: true })}
```

- [ ] **Step 4: Run to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/GroupCard.svelte.test.ts src/webview/detail/GroupView.svelte.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(webview): right-click context data on group cards + annotation rows (TODO #4)" -- src/webview/sidebar/GroupCard.svelte src/webview/sidebar/GroupCard.svelte.test.ts src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts
```

---

### Task 4: Commands, menus, and host handlers (§D)

**Files:**
- Modify: `package.json`
- Modify: `src/web/detailPanelProvider.ts`
- Modify: `src/web/extension.ts`
- Modify: `src/web/test/suite/extension.test.ts`

- [ ] **Step 1: `package.json`.**

(a) Append to the `commands` array (after the `annotated.manageTags` entry):

```json
      { "command": "annotated.deleteGroup", "title": "Delete Group" },
      { "command": "annotated.deleteAnnotation", "title": "Delete Annotation" }
```

(b) In `menus`, alongside the existing `view/title`, add:

```json
      "webview/context": [
        {
          "command": "annotated.deleteGroup",
          "when": "webviewId == 'annotated.sidebar' && webviewSection == 'group'"
        },
        {
          "command": "annotated.deleteAnnotation",
          "when": "webviewId == 'annotated.detail' && webviewSection == 'annotation'"
        }
      ],
      "commandPalette": [
        { "command": "annotated.deleteGroup", "when": "false" },
        { "command": "annotated.deleteAnnotation", "when": "false" }
      ]
```

- [ ] **Step 2: `DetailPanelProvider` getter.** In `src/web/detailPanelProvider.ts`, add after the `openAnnotation` method:

```ts
  /** Id of the group currently shown in the panel, or null when empty. */
  currentGroupId(): string | null {
    return this.group?.id ?? null;
  }
```

- [ ] **Step 3: Host handlers.** In `src/web/extension.ts`, add after the `annotated.manageTags` registration block:

```ts
  // Webview context-menu commands (args come from each element's data-vscode-context).
  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.deleteGroup', async (args?: { groupId?: string }) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder || typeof args?.groupId !== 'string') {
        return;
      }
      const store = new GroupStore(new VscodeFileSystem(folder.uri));
      const group = await store.getGroup(args.groupId);
      if (!group) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `Delete group "${group.title}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (choice !== 'Delete') {
        return;
      }
      await store.deleteGroup(group.id);
      await provider.refresh();
      if (detailProvider.currentGroupId() === group.id) {
        await showGroupWithStale(group.id); // group is gone → empty panel
      }
      await refreshDecorations();
    }),
    vscode.commands.registerCommand(
      'annotated.deleteAnnotation',
      async (args?: { groupId?: string; annotationId?: string }) => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder || typeof args?.groupId !== 'string' || typeof args?.annotationId !== 'string') {
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          'Delete this annotation? This cannot be undone.',
          { modal: true },
          'Delete',
        );
        if (choice !== 'Delete') {
          return;
        }
        const store = new GroupStore(new VscodeFileSystem(folder.uri));
        const ok = await store.deleteAnnotation(args.groupId, args.annotationId, now());
        if (ok) {
          await provider.refresh();
          await showGroupWithStale(args.groupId);
          await refreshDecorations();
        }
      },
    ),
  );
```

- [ ] **Step 4: Integration-test assertion.** In `src/web/test/suite/extension.test.ts`, inside the existing activation test, after the `annotated.ping` absence check, add:

```ts
    for (const cmd of ['annotated.deleteGroup', 'annotated.deleteAnnotation']) {
      if (!commands.includes(cmd)) {
        throw new Error(`${cmd} should be registered`);
      }
    }
```

- [ ] **Step 5: Verify**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')" && npm run check-types && npm run compile`
Expected: `json ok`, type-check + compile clean.

- [ ] **Step 6: Commit (pathspec form)**

```bash
git commit -m "feat(web): right-click Delete Group / Delete Annotation via webview context menus (TODO #4)" -- package.json src/web/detailPanelProvider.ts src/web/extension.ts src/web/test/suite/extension.test.ts
```

---

### Task 5: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage (§D):** context attributes (Task 3) → menus/commands (Task 4) → pure removal + store (Tasks 1–2) → handlers with modal confirm, sidebar/detail/decoration refresh, `currentGroupId()` guard for the sidebar-initiated delete (Task 4). Empty groups kept (Task 1 doc + Task 2 test). Palette-hidden via `commandPalette: when false`. ✓
- **Type consistency:** `removeAnnotation(group, annotationId, now): AnnotationGroup | null`; `deleteAnnotation(groupId, annotationId, now): Promise<boolean>`; handlers validate arg fields before use; `now()` already exists in `activate()`'s scope, as do `provider`, `detailProvider`, `showGroupWithStale`, `refreshDecorations`, `GroupStore`, `VscodeFileSystem` — all in scope at the insertion point (after manageTags registration). ✓
- **`data-vscode-context` placement:** card root button (sidebar webview) and `.row-wrap` (detail webview) — right-click anywhere on the element or its children stacks the context. `preventDefaultContextMenuItems` hides the browser Copy/Paste items. ✓
- **Shared-checkout safety:** all commits use the `git commit -- <paths>` form. ✓
- **No placeholders.** ✓
