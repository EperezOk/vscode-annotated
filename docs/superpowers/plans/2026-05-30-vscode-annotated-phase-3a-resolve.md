# vscode-annotated — Phase 3a: Resolve / Restore Groups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a user **Resolve** an open group and **Restore** a resolved one from the detail panel's group header. The model already has `status: 'open' | 'resolved'` and the sidebar already filters/badges resolved groups (Phase 2c) — 3a adds the missing *action* to flip the status.

**Architecture:** Pure reuse of the existing group-metadata patch path. `GroupStore.updateGroup`'s patch type widens to include `status`; a new `updateGroupStatus` `DetailToHost` message carries the target status; `GroupView` renders a Resolve/Restore toggle button; the host routes it through the existing `patchGroup` → `showGroupWithStale` refresh. No new store, no new state field (status lives on the group already).

**Tech Stack:** TypeScript + Svelte 5. Builds on Phase 1 + 2. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-3` (already checked out — Phase 3 sub-plans accumulate here per CLAUDE.md); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + Bash `timeout: 600000` and `pkill -f vscode-test-web || true` first.

---

## Context (exact current shapes)

- `src/shared/model.ts` — `GroupStatus = 'open' | 'resolved'`; `AnnotationGroup { …, status: GroupStatus, … }`.
- `src/core/groupStore.ts` — `async updateGroup(groupId: string, patch: Partial<Pick<AnnotationGroup, 'title' | 'tags' | 'gitRef'>>, now: number): Promise<boolean>` (loads via `getGroup`, returns `false` if missing, applies patch, `saveGroup` with `updatedAt: now`, returns `true`). Other mutators: `updateAnnotation`, `updateAnnotationRange`, `reorderAnnotations`, `saveGroup`, `deleteGroup`, `getGroup`, `listGroups`.
- `src/shared/protocol.ts` — imports from `./model` already (e.g. `AnnotationGroup`, `TagColor`). `DetailToHost` union ends with `| { type: 'reorderAnnotations'; annotationIds: string[] }`. `parseDetailMessage` is a `switch (raw.type)`; `raw` is typed `Record<string, unknown>`; data cases validate field types and return the typed object or `null`.
- `src/webview/detail/GroupView.svelte` — props `{ group, palette, staleIds, onrename, onedittags, oneditgitref, onselectrow, onreorder }`. Header shows the title (with inline edit), a meta line including `{group.author}` and `{group.status}`, tag chips + an edit-tags affordance, and a git-ref affordance. (READ the file for the exact header markup + the props destructure/type.)
- `src/webview/detail/DetailApp.svelte` — imports senders from `./state` and passes them to `<GroupView>` (`onrename`/`onedittags`/`oneditgitref`/`onselectrow`/`onreorder`). READ it.
- `src/webview/detail/state.ts` — senders post via `postToHost`: `renameGroup`, `requestEditTags`, `requestEditGitRef`, `reorderAnnotations`, etc.
- `src/web/detailPanelProvider.ts` — `onDidReceiveMessage` `if/else if` chain (last branch `reorderAnnotations`), each guarded by `if (this.group)`. Public hooks: `onSelectAnnotation`, `onUpdateAnnotation`, `onSetGroupTitle`, `onEditTags`, `onEditGitRef`, `onUpdateAnnotationRange`, `onReorderAnnotations`. Imports `Annotation`/`AnnotationGroup`/`TagColor` from `../shared/model`.
- `src/web/extension.ts` — `now = () => Math.floor(Date.now() / 1000)`; `showGroupWithStale(groupId)`; a `patchGroup(groupId, patch: { title?; tags?; gitRef? })` helper that calls `store.updateGroup(groupId, patch, now())` then `await showGroupWithStale(groupId)`; the `onSetGroupTitle`/`onEditTags`/`onEditGitRef`/`onReorderAnnotations` hooks. READ `patchGroup` for its exact patch type + body.
- Seed: `test-workspace/.annotations/groups/seed-group.json` (open) + `seed-resolved.json` (resolved). **e2e must not permanently change a seed's status** (other specs depend on the defaults) — 3a's e2e does a resolve→restore round-trip that leaves `seed-group` open.

---

## Design notes

- **Reuse `updateGroup`, don't add a method.** Widen its patch `Pick` to include `'status'`. `patchGroup` in `extension.ts` widens its `patch` param the same way and already routes through `showGroupWithStale`.
- **One toggle message.** The webview knows the current status, so it sends the *target* status: `{ type: 'updateGroupStatus'; status: GroupStatus }`. Button label: `status === 'open'` → "Resolve" (sends `'resolved'`); `'resolved'` → "Restore" (sends `'open'`).
- **e2e is self-cleaning.** Resolve→Restore round-trip on `seed-group`, asserting the button label flips both ways, ending with `seed-group` back to `open`. (Playwright runs the web suite serially — confirm `workers`/`fullyParallel` in the config and mirror how `e2e/group-edit.spec.ts` coexists with the other specs that read `seed-group`.)

---

## File Structure (3a)

```
src/core/groupStore.ts                            (modify) # updateGroup patch += 'status'
src/core/groupStore.unit.test.ts                  (modify) # updateGroup status test
src/shared/protocol.ts                            (modify) # DetailToHost += updateGroupStatus; parse case; import GroupStatus
src/shared/protocol.unit.test.ts                  (modify)
src/webview/detail/GroupView.svelte               (modify) # Resolve/Restore button
src/webview/detail/GroupView.svelte.test.ts       (modify)
src/webview/detail/state.ts                       (modify) # setGroupStatus sender
src/webview/detail/DetailApp.svelte               (modify) # wire onsetstatus
src/web/detailPanelProvider.ts                    (modify) # onUpdateGroupStatus hook + handler branch
src/web/extension.ts                              (modify) # patchGroup += status; onUpdateGroupStatus hook
e2e/resolve.spec.ts                               (new)    # resolve→restore round-trip (self-cleaning)
```

---

## Task 1: Store patch widening + protocol message

**Files:** Modify `src/core/groupStore.ts`(+test), `src/shared/protocol.ts`(+test)

- [ ] **Step 1: Append tests.**

In `src/core/groupStore.unit.test.ts` (inside `describe('GroupStore', …)`, using the existing `group(id)` factory + `store`):
```ts
  it('updateGroup can patch status and bumps updatedAt', async () => {
    await store.saveGroup(group('g1'));
    const ok = await store.updateGroup('g1', { status: 'resolved' }, 909);
    expect(ok).toBe(true);
    const r = await store.getGroup('g1');
    expect(r?.status).toBe('resolved');
    expect(r?.updatedAt).toBe(909);
  });
```

In `src/shared/protocol.unit.test.ts` (inside the `parseDetailMessage` describe):
```ts
  it('accepts updateGroupStatus with a valid status', () => {
    expect(parseDetailMessage({ type: 'updateGroupStatus', status: 'resolved' })).toEqual({
      type: 'updateGroupStatus', status: 'resolved',
    });
    expect(parseDetailMessage({ type: 'updateGroupStatus', status: 'open' })).toEqual({
      type: 'updateGroupStatus', status: 'open',
    });
  });
  it('rejects updateGroupStatus with an invalid status', () => {
    expect(parseDetailMessage({ type: 'updateGroupStatus', status: 'done' })).toBeNull();
    expect(parseDetailMessage({ type: 'updateGroupStatus', status: 42 })).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts src/shared/protocol.unit.test.ts`
Expected: FAIL — `updateGroup` rejects the `status` key at type-check / no `updateGroupStatus` parse case. Report output.

- [ ] **Step 3: Widen `updateGroup` in `src/core/groupStore.ts`.** Change the patch parameter type from `Partial<Pick<AnnotationGroup, 'title' | 'tags' | 'gitRef'>>` to:
```ts
    patch: Partial<Pick<AnnotationGroup, 'title' | 'tags' | 'gitRef' | 'status'>>,
```
(The body that spreads `{ ...group, ...patch, updatedAt: now }` — or whatever it does — already handles any of those keys; do NOT otherwise change the method. If the body explicitly lists fields rather than spreading `patch`, add `status` to that list the same way the others are handled.)

- [ ] **Step 4: Extend `src/shared/protocol.ts`.** Add `GroupStatus` to the existing import from `./model` (e.g. `import { type AnnotationGroup, type GroupStatus, type TagColor } from './model';` — merge into the real existing import line). Add to the `DetailToHost` union:
```ts
  | { type: 'updateGroupStatus'; status: GroupStatus }
```
Add to `parseDetailMessage`'s switch (before `default`):
```ts
    case 'updateGroupStatus':
      return raw.status === 'open' || raw.status === 'resolved'
        ? { type: 'updateGroupStatus', status: raw.status }
        : null;
```
(Mirror the sibling cases' `raw` access. The `raw.status === 'open' || raw.status === 'resolved'` guard narrows `raw.status` to `GroupStatus` so the return type-checks.)

- [ ] **Step 5: Run pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts src/shared/protocol.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types exit 0; all unit green.

- [ ] **Step 6: Commit**
```bash
git add src/core/groupStore.ts src/core/groupStore.unit.test.ts src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat: updateGroup status patch + updateGroupStatus detail message"
```

---

## Task 2: GroupView Resolve/Restore button + webview wiring

**Files:** Modify `src/webview/detail/GroupView.svelte`(+test), `src/webview/detail/state.ts`, `src/webview/detail/DetailApp.svelte`

- [ ] **Step 1: Append GroupView tests.** In `src/webview/detail/GroupView.svelte.test.ts` (using the existing `group()` factory + `palette`):
```ts
  it('shows a Resolve button for an open group and requests resolved on click', async () => {
    const onsetstatus = vi.fn();
    render(GroupView, { group: group(), palette, onsetstatus });
    const btn = screen.getByTestId('resolve-btn');
    expect(btn).toHaveTextContent('Resolve');
    await userEvent.click(btn);
    expect(onsetstatus).toHaveBeenCalledWith('resolved');
  });
  it('shows a Restore button for a resolved group and requests open on click', async () => {
    const onsetstatus = vi.fn();
    render(GroupView, { group: { ...group(), status: 'resolved' }, palette, onsetstatus });
    const btn = screen.getByTestId('resolve-btn');
    expect(btn).toHaveTextContent('Restore');
    await userEvent.click(btn);
    expect(onsetstatus).toHaveBeenCalledWith('open');
  });
```
(If the existing `group()` factory returns `status: 'open'`, the first test works directly. Match the file's existing render-prop style.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/GroupView.svelte.test.ts`
Expected: FAIL — no `resolve-btn`.

- [ ] **Step 3: Update `GroupView.svelte`.** Add to `<script>` the import if needed: `import { type GroupStatus } from '../../shared/model';` (only if not already importing from model — check; `AnnotationGroup`/`TagColor` likely already imported, add `GroupStatus` to that line). Add `onsetstatus` to the `$props()` destructure + its type: `onsetstatus?: (status: GroupStatus) => void;`. Add a derived label + handler:
```ts
  const resolveLabel = $derived(group.status === 'resolved' ? 'Restore' : 'Resolve');
  function toggleStatus(): void {
    onsetstatus?.(group.status === 'resolved' ? 'open' : 'resolved');
  }
```
In the header (near the existing edit-tags / git-ref affordances — pick a sensible spot in the header controls), add:
```svelte
  <button type="button" class="status-btn" data-testid="resolve-btn" onclick={toggleStatus}>{resolveLabel}</button>
```
Add a style consistent with the existing header buttons (reuse an existing button class if one fits; otherwise):
```css
  .status-btn { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); border: none; border-radius: 3px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
```
(Match the existing header button styling/idiom if the file already defines one — prefer reuse over a new class.)

- [ ] **Step 4: Add the sender to `src/webview/detail/state.ts`:**
```ts
/** Set the current group's status (open/resolved). */
export function setGroupStatus(status: 'open' | 'resolved'): void {
  postToHost({ type: 'updateGroupStatus', status });
}
```
(Use the `GroupStatus` type if it's convenient to import here; the inline union is fine and matches the protocol.)

- [ ] **Step 5: Wire `DetailApp.svelte`.** Add `setGroupStatus` to the `./state` import. Pass to `<GroupView>` (keep all existing props): `onsetstatus={(s) => setGroupStatus(s)}`.

- [ ] **Step 6: Run component + unit + check-types + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 7: Commit**
```bash
git add src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts src/webview/detail/state.ts src/webview/detail/DetailApp.svelte
git commit -m "feat: Resolve/Restore button in the group view"
```

---

## Task 3: Host wiring + resolve e2e + full suite

**Files:** Modify `src/web/detailPanelProvider.ts`, `src/web/extension.ts`; Create `e2e/resolve.spec.ts`

- [ ] **Step 1: `detailPanelProvider.ts` — hook + handler branch.** Add `GroupStatus` to the `../shared/model` import. Add a public hook near the others:
```ts
  /** Set by the extension: change the current group's status. */
  public onUpdateGroupStatus?: (groupId: string, status: GroupStatus) => void;
```
In `onDidReceiveMessage`, after the `reorderAnnotations` branch:
```ts
      } else if (message.type === 'updateGroupStatus') {
        if (this.group) {
          this.onUpdateGroupStatus?.(this.group.id, message.status);
        }
```

- [ ] **Step 2: `extension.ts` — widen patchGroup + wire the hook.** Widen the `patchGroup` helper's `patch` param to include `status?: GroupStatus` (add the import: merge `GroupStatus` into the existing `../shared/model` import if present, or add one). The body is unchanged — it already calls `store.updateGroup(groupId, patch, now())` and refreshes via `showGroupWithStale`. Then wire:
```ts
  detailProvider.onUpdateGroupStatus = async (groupId, status): Promise<void> => {
    await patchGroup(groupId, { status });
  };
```
(If `patchGroup` is declared with an explicit object type like `{ title?: string; tags?: string[]; gitRef?: string | null }`, add `status?: GroupStatus` to it. If `GroupStatus` isn't imported in extension.ts yet, add it to the model import.)

- [ ] **Step 3: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 4: Create `e2e/resolve.spec.ts`.** READ `e2e/group-edit.spec.ts` FIRST to copy the EXACT sidebar + detail iframe-drill (the `.first()`/`.nth(0)` sidebar form + `.nth(1)` detail form + activity-bar tab regex) AND to see how it coexists with the seed fixture without polluting it. Also check `playwright.config.*` for `workers`/`fullyParallel` (the web suite should be serial — note what you find). Then write a self-cleaning round-trip:
```ts
import { test, expect } from '@playwright/test';

test('resolve then restore a group from the detail panel', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').first().click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  // Open group → Resolve, then Restore (leaving the fixture unchanged).
  const btn = detail.getByTestId('resolve-btn');
  await expect(btn).toHaveText('Resolve', { timeout: 30_000 });
  await btn.click();
  await expect(detail.getByTestId('resolve-btn')).toHaveText('Restore', { timeout: 30_000 });
  await detail.getByTestId('resolve-btn').click();
  await expect(detail.getByTestId('resolve-btn')).toHaveText('Resolve', { timeout: 30_000 });
});
```
IMPORTANT: match `group-edit.spec.ts`'s drill EXACTLY (sidebar form, the `waitForFunction` for the detail iframe, the tab regex). The first visible card is `seed-group` (open; `seed-resolved` is hidden by default) — so it starts at "Resolve". The round-trip leaves `seed-group` open. Do NOT weaken assertions.

- [ ] **Step 5: Run the e2e** (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm run test:e2e`
Expected: 9 passed (the 8 prior + `resolve.spec`). If it fails, debug the wiring/drill — don't weaken assertions. If the round-trip leaves `seed-group` resolved (e.g. the second click didn't register), other specs may then fail — ensure both clicks land and the final state is "Resolve".

- [ ] **Step 6: Full suite (Definition of Done)** (`dangerouslyDisableSandbox: true`, `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**9 passing**, unchanged) → `test:e2e` (**9 passed**). All green. Report ACTUAL counts. Also confirm `git status` shows `test-workspace/.annotations/groups/seed-group.json` UNCHANGED (the round-trip self-cleaned) — if it's dirty, `git checkout -- test-workspace/.annotations/groups/seed-group.json` and investigate why the restore didn't persist.

- [ ] **Step 7: Commit**
```bash
git add src/web/detailPanelProvider.ts src/web/extension.ts e2e/resolve.spec.ts
git commit -m "feat: host wiring for resolve/restore + resolve round-trip e2e"
```

---

## Phase 3a Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (updateGroup status, parse, GroupView button + earlier suites).
- [ ] `npm run test:integration` passes — **9 passing** (unchanged).
- [ ] `npm run test:e2e` passes — **9 passed** (incl. resolve round-trip).
- [ ] `test-workspace` seed fixtures unchanged on disk after the run.
- [ ] All work committed on the `phase-3` branch.
- [ ] Manual sanity (optional): Resolve dims the group in the sidebar (hidden unless Show resolved); Restore brings it back to open.

Next in Phase 3: **3b** — comment threads (per-author files merged by timestamp; add/edit/delete own). Then **3c** inline +New tag, **3d** bulk-select mode. After 3d, Phase 3 is complete → final review → merge `phase-3` → `main`.
