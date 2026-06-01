# Phase 4c — Create → Focus Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After creating an annotation, open the detail panel directly on that new annotation in edit mode with the editor focused, ready to type (TODO #2, end-to-end). The editor-side pieces (auto-edit on empty content + `autofocus`) already exist from 4b; this wires the create command to drive the panel.

**Architecture:** Add an `openAnnotation` host→detail protocol message; `runCreateAnnotation` returns the created annotation's id alongside the group; the create command takes an `onCreated` callback, supplied by `extension.ts`, which loads the group into the detail panel, posts `openAnnotation`, focuses the panel, and reveals/highlights the code.

**Tech Stack:** TypeScript, Svelte 5, Vitest (unit), VSCode extension API.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality

The two pure pieces — the `openAnnotation` reducer case (`detailState.ts`) and `runCreateAnnotation`'s new return shape — are unit-tested. The host wiring (`createAnnotationCommand.ts`, `extension.ts`, `detailPanelProvider.ts`, `main.ts`) imports `vscode` and is not unit-testable; it is verified by `npm run check-types` + the unit suite. (Creating an annotation through the real UI requires driving a file selection + QuickPicks, which the existing e2e suite doesn't do; this flow is left to manual verification.) **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/shared/protocol.ts` — make `HostToDetail` a union adding `openAnnotation`.
- **Modify** `src/core/detailState.ts` (+ `.unit.test.ts`) — handle the `openAnnotation` message.
- **Modify** `src/core/createAnnotationFlow.ts` (+ `.unit.test.ts`) — return `{ group, annotationId }`.
- **Modify** `src/web/detailPanelProvider.ts` — add an `openAnnotation()` poster.
- **Modify** `src/webview/detail/main.ts` — forward the `openAnnotation` message to the store.
- **Modify** `src/web/createAnnotationCommand.ts` — accept an `onCreated` callback.
- **Modify** `src/web/extension.ts` — wire `onCreated` (show group → open annotation → focus → reveal).

---

### Task 1: Add the `openAnnotation` host→detail protocol message

**Files:**
- Modify: `src/shared/protocol.ts`

- [ ] **Step 1: Make `HostToDetail` a union.** Replace the current `HostToDetail` type:

```ts
/** Host → detail-panel messages. */
export type HostToDetail = {
  type: 'setGroup';
  group: AnnotationGroup | null;
  palette: TagColor[];
  staleIds?: string[];
  comments?: ThreadComment[];
  currentAuthor?: string;
};
```

with:

```ts
/** Host → detail-panel messages. */
export type HostToDetail =
  | {
      type: 'setGroup';
      group: AnnotationGroup | null;
      palette: TagColor[];
      staleIds?: string[];
      comments?: ThreadComment[];
      currentAuthor?: string;
    }
  | { type: 'openAnnotation'; annotationId: string };
```

- [ ] **Step 2: Type-check (the existing `post()` in detailPanelProvider must still satisfy the union)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/shared/protocol.ts
git commit -m "feat(protocol): add openAnnotation host→detail message (TODO #2)"
```

---

### Task 2: Handle `openAnnotation` in `applyDetailMessage`

**Files:**
- Modify: `src/core/detailState.ts`
- Test: `src/core/detailState.unit.test.ts`

- [ ] **Step 1: Write the failing test** — add to the `describe('applyDetailMessage', ...)` block in `src/core/detailState.unit.test.ts` (the `group()` helper already exists in that file):

```ts
  it('openAnnotation switches to annotation mode for the given id and keeps the group', () => {
    const start = { ...initialDetailState(), group: group() };
    const next = applyDetailMessage(start, { type: 'openAnnotation', annotationId: 'a1' });
    expect(next.mode).toBe('annotation');
    expect(next.selectedAnnotationId).toBe('a1');
    expect(next.group?.id).toBe('g1');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/detailState.unit.test.ts`
Expected: FAIL — `mode` is still `'group'` (the message hits the `default` case).

- [ ] **Step 3: Implement.** In `src/core/detailState.ts`, add a case to the `switch` in `applyDetailMessage`, immediately before `default:` (the `openAnnotation` helper is already defined lower in this file):

```ts
    case 'openAnnotation':
      return openAnnotation(state, message.annotationId);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/detailState.unit.test.ts`
Expected: PASS (all detailState tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/detailState.ts src/core/detailState.unit.test.ts
git commit -m "feat(detail): apply openAnnotation message → annotation mode (TODO #2)"
```

---

### Task 3: `runCreateAnnotation` returns the created annotation id

**Files:**
- Modify: `src/core/createAnnotationFlow.ts`
- Test: `src/core/createAnnotationFlow.unit.test.ts`

- [ ] **Step 1: Update the test (TDD: change the contract first).** In `src/core/createAnnotationFlow.unit.test.ts`, in the test `'creates a new group with the annotation and saves it'`, replace the last assertion:

```ts
    expect(result?.id).toBe(saved.id);
```

with:

```ts
    expect(result?.group.id).toBe(saved.id);
    expect(result?.annotationId).toBe(saved.annotations[0].id);
```

(The other tests assert `result` is `undefined` on cancel — those stay correct.)

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/createAnnotationFlow.unit.test.ts`
Expected: FAIL — `result.group` is `undefined` (the function still returns the group directly), or a type/shape error.

- [ ] **Step 3: Implement.** In `src/core/createAnnotationFlow.ts`:

(a) Change the function's return type from `Promise<AnnotationGroup | undefined>` to:

```ts
export async function runCreateAnnotation(
  deps: CreateAnnotationDeps,
): Promise<{ group: AnnotationGroup; annotationId: string } | undefined> {
```

(b) In the existing-group branch, change `return updated;` to:

```ts
    return { group: updated, annotationId: annotation.id };
```

(c) In the new-group branch (end of the function), change `return group;` to:

```ts
  return { group, annotationId: annotation.id };
```

(Leave the three `return undefined;` cancel/no-selection paths unchanged.)

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/createAnnotationFlow.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/createAnnotationFlow.ts src/core/createAnnotationFlow.unit.test.ts
git commit -m "feat(create): return created annotation id alongside the group (TODO #2)"
```

---

### Task 4: Post `openAnnotation` from the host + forward it in the webview

**Files:**
- Modify: `src/web/detailPanelProvider.ts`
- Modify: `src/webview/detail/main.ts`

- [ ] **Step 1: Add an `openAnnotation` poster to `DetailPanelProvider`.** In `src/web/detailPanelProvider.ts`, add this public method right after the existing `showGroup(...)` method (`HostToDetail` is already imported at the top of the file):

```ts
  /** Tell the webview to open a specific annotation in the annotation view. */
  openAnnotation(annotationId: string): void {
    const message: HostToDetail = { type: 'openAnnotation', annotationId };
    void this.view?.webview.postMessage(message);
  }
```

- [ ] **Step 2: Forward the message in `main.ts`.** In `src/webview/detail/main.ts`, change the message-filter condition from:

```ts
  if (message && typeof message === 'object' && message.type === 'setGroup') {
    handleHostMessage(message);
  }
```

to:

```ts
  if (message && typeof message === 'object' && (message.type === 'setGroup' || message.type === 'openAnnotation')) {
    handleHostMessage(message);
  }
```

- [ ] **Step 3: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/detailPanelProvider.ts src/webview/detail/main.ts
git commit -m "feat(detail): host poster + webview forwarding for openAnnotation (TODO #2)"
```

---

### Task 5: `createAnnotationCommand` accepts an `onCreated` callback

**Files:**
- Modify: `src/web/createAnnotationCommand.ts`

- [ ] **Step 1: Add the parameter and invoke it.** In `src/web/createAnnotationCommand.ts`, change the function signature:

```ts
export function registerCreateAnnotationCommand(): vscode.Disposable {
```

to:

```ts
export function registerCreateAnnotationCommand(
  onCreated?: (groupId: string, annotationId: string) => void | Promise<void>,
): vscode.Disposable {
```

Then change the final line of the command body from:

```ts
    await runCreateAnnotation(deps);
```

to:

```ts
    const result = await runCreateAnnotation(deps);
    if (result && onCreated) {
      await onCreated(result.group.id, result.annotationId);
    }
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean (the call in `extension.ts` passes no arg yet — the param is optional, so this still compiles).

- [ ] **Step 3: Commit**

```bash
git add src/web/createAnnotationCommand.ts
git commit -m "feat(create): onCreated callback hook on the create command (TODO #2)"
```

---

### Task 6: Wire `onCreated` in `extension.ts`

**Files:**
- Modify: `src/web/extension.ts`

- [ ] **Step 1: Build and pass the callback.** In `src/web/extension.ts`, replace the registration line near the end of `activate(...)`:

```ts
  context.subscriptions.push(registerCreateAnnotationCommand());
```

with:

```ts
  const onAnnotationCreated = async (groupId: string, annotationId: string): Promise<void> => {
    await showGroupWithStale(groupId);
    detailProvider.openAnnotation(annotationId);
    await vscode.commands.executeCommand('annotated.detail.focus');
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const group = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    const annotation = group?.annotations.find((a) => a.id === annotationId);
    if (annotation) {
      await revealAnnotation(folder.uri, annotation);
    }
  };
  context.subscriptions.push(registerCreateAnnotationCommand(onAnnotationCreated));
```

(`showGroupWithStale`, `detailProvider`, `GroupStore`, `VscodeFileSystem`, and `revealAnnotation` are all already in scope inside `activate`.)

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/web/extension.ts
git commit -m "feat(create): open + focus + reveal the new annotation after create (TODO #2)"
```

---

### Task 7: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS (the updated detailState + createAnnotationFlow tests included).

- [ ] **Step 2: Confirm the command captures the result**

Run: `grep -n "runCreateAnnotation(deps)" src/web/createAnnotationCommand.ts`
Expected: one match, assigned to `const result = await runCreateAnnotation(deps);` (not a bare call).

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** TODO #2 end-to-end → openAnnotation message (Tasks 1,2,4), created-id return (Task 3), command hook (Task 5), and the show→open→focus→reveal wiring (Task 6). The editor auto-edit + autofocus that make the opened annotation "ready to type" landed in 4b. ✓
- **Type consistency:** `HostToDetail` union member `{ type: 'openAnnotation'; annotationId: string }` is produced by `DetailPanelProvider.openAnnotation`, consumed by `applyDetailMessage` (and `main.ts` forwards it). `runCreateAnnotation` now returns `{ group: AnnotationGroup; annotationId: string } | undefined`; `createAnnotationCommand` reads `result.group.id` / `result.annotationId`; `onCreated(groupId, annotationId)` signatures line up between command and `extension.ts`. ✓
- **Ordering:** setGroup is posted (via `showGroupWithStale`) before `openAnnotation`, so the group is present when the reducer switches to annotation mode. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** no new type-only imports introduced; existing `type` imports unchanged. ✓
