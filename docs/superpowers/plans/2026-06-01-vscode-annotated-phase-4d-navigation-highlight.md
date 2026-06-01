# Phase 4d — Navigation Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the code highlight shown when opening an annotation **clearly visible** (TODO #6), and **clear it when the annotation view closes** — on Back and when the detail panel is hidden (TODO #8).

**Architecture:** Strengthen the decoration in `navigateToCode.ts` (stronger background + left-border accent + overview-ruler mark). Add a `navigationClosed` detail→host message that the webview posts when leaving the annotation view; the host clears the highlight on that message and on the detail panel's visibility going false.

**Tech Stack:** TypeScript, Svelte 5, VSCode extension API (`TextEditorDecorationType`, `ThemeColor`, `OverviewRulerLane`, `WebviewView.onDidChangeVisibility`), Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality

The decoration appearance (#6) and the clear-on-close behavior (#8) live in `vscode`-dependent code (`navigateToCode.ts`, `detailPanelProvider.ts`, `extension.ts`) — not unit-testable, and decorations aren't queryable via the test API, so those are verified by `npm run check-types` + **manual** check. The one purely-testable piece is the new `navigationClosed` protocol arm (Task 1, TDD). **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/shared/protocol.ts` (+ `.unit.test.ts`) — add `navigationClosed` to `DetailToHost` + parse arm.
- **Modify** `src/webview/detail/state.ts` — `showGroupView` also posts `navigationClosed`.
- **Modify** `src/web/detailPanelProvider.ts` — handle `navigationClosed` + clear on `onDidChangeVisibility`.
- **Modify** `src/web/extension.ts` — set `onNavigationClosed = clearHighlight`.
- **Modify** `src/web/navigateToCode.ts` — strengthen the highlight decoration.

---

### Task 1: Add the `navigationClosed` detail→host message

**Files:**
- Modify: `src/shared/protocol.ts`
- Test: `src/shared/protocol.unit.test.ts`

- [ ] **Step 1: Write the failing test** — add inside the `describe('parseDetailMessage', ...)` block in `src/shared/protocol.unit.test.ts`:

```ts
  it('accepts navigationClosed', () => {
    expect(parseDetailMessage({ type: 'navigationClosed' })).toEqual({ type: 'navigationClosed' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: FAIL — returns `null` (unknown type) instead of the message.

- [ ] **Step 3: Implement.** In `src/shared/protocol.ts`:

(a) Add a member to the `DetailToHost` union (after the `deleteComment` member):

```ts
  | { type: 'deleteComment'; commentId: string }
  | { type: 'navigationClosed' };
```

(b) Add a parse arm in `parseDetailMessage`'s `switch`, before `default:`:

```ts
    case 'navigationClosed':
      return { type: 'navigationClosed' };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: PASS (all protocol tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat(protocol): add navigationClosed detail→host message (TODO #8)"
```

---

### Task 2: Post `navigationClosed` when leaving the annotation view

**Files:**
- Modify: `src/webview/detail/state.ts`

- [ ] **Step 1: Update `showGroupView`.** In `src/webview/detail/state.ts`, change:

```ts
/** Return to the group view. */
export function showGroupView(): void {
  detail.update((state) => backToGroupState(state));
}
```

to:

```ts
/** Return to the group view, and tell the host to clear the code highlight. */
export function showGroupView(): void {
  detail.update((state) => backToGroupState(state));
  postToHost({ type: 'navigationClosed' });
}
```

(`postToHost` is already imported at the top of this file.)

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/webview/detail/state.ts
git commit -m "feat(detail): post navigationClosed on Back (TODO #8)"
```

---

### Task 3: Clear on `navigationClosed` and on panel-hidden in `DetailPanelProvider`

**Files:**
- Modify: `src/web/detailPanelProvider.ts`

- [ ] **Step 1: Add the callback field.** In `src/web/detailPanelProvider.ts`, add a public field alongside the other `on...` callbacks (e.g. right after `public onSelectAnnotation?: ...`):

```ts
  /** Set by the extension: the annotation view closed (Back) or the panel was hidden. */
  public onNavigationClosed?: () => void;
```

- [ ] **Step 2: Handle the message.** In `resolveWebviewView`'s `onDidReceiveMessage` handler, add a branch (e.g. after the `copyText` branch):

```ts
      } else if (message.type === 'navigationClosed') {
        this.onNavigationClosed?.();
```

- [ ] **Step 3: Clear when the panel is hidden.** Still in `resolveWebviewView`, after the `webviewView.webview.onDidReceiveMessage(...)` block, add:

```ts
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        this.onNavigationClosed?.();
      }
    });
```

- [ ] **Step 4: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/web/detailPanelProvider.ts
git commit -m "feat(detail): clear highlight on navigationClosed + panel hidden (TODO #8)"
```

---

### Task 4: Wire `onNavigationClosed` to `clearHighlight` in `extension.ts`

**Files:**
- Modify: `src/web/extension.ts`

- [ ] **Step 1: Import `clearHighlight`.** Change the navigateToCode import line from `import { revealAnnotation } from './navigateToCode';` to:

```ts
import { revealAnnotation, clearHighlight } from './navigateToCode';
```

- [ ] **Step 2: Wire the callback.** Add this near the other `detailProvider.on... =` assignments (e.g. right after `detailProvider.onSelectAnnotation = ...`):

```ts
  detailProvider.onNavigationClosed = (): void => {
    clearHighlight();
  };
```

- [ ] **Step 3: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/extension.ts
git commit -m "feat(detail): clear navigation highlight when the annotation view closes (TODO #8)"
```

---

### Task 5: Make the highlight noticeably stronger

**Files:**
- Modify: `src/web/navigateToCode.ts`

- [ ] **Step 1: Strengthen the decoration.** In `src/web/navigateToCode.ts`, replace the body of `decorationType()`'s `createTextEditorDecorationType({ ... })` call:

```ts
    highlightType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      isWholeLine: true,
    });
```

with:

```ts
    highlightType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('focusBorder'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/web/navigateToCode.ts
git commit -m "feat(navigate): stronger annotation highlight — bg + left border + ruler (TODO #6)"
```

---

### Task 6: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS (the new protocol test included).

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** TODO #6 (stronger highlight) → Task 5. TODO #8 (clear on close) → `navigationClosed` message (Tasks 1,2) + host handling on message and on panel-hidden (Task 3) + wiring to `clearHighlight` (Task 4). ✓
- **Type consistency:** `DetailToHost` gains `{ type: 'navigationClosed' }`, produced by `showGroupView` (`postToHost`), parsed by `parseDetailMessage`, handled in `DetailPanelProvider` via `onNavigationClosed?: () => void`, wired to the existing `clearHighlight()` export. `OverviewRulerLane.Full` + `ThemeColor` are valid `@types/vscode` APIs. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** `clearHighlight` is a value import (added to the existing `revealAnnotation` import). ✓
- **Scope note:** clearing the highlight when a *different group* is selected (panel stays open in group mode) is out of scope — #8 is about closing the annotation view; Back + panel-hidden cover it.
