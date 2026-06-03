# Phase 7g — Markdown-Editor Autofocus Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the create-annotation → detail-panel → Markdown-editor autofocus reliable (round-3 TODO #10, spec §I). Root causes: (1) `DetailPanelProvider.openAnnotation()` posts ephemerally — when the detail view isn't resolved yet the message is lost and only `setGroup` is replayed on `ready`, landing in group view; (2) the webview may run CodeMirror's `.focus()` before the iframe itself has OS focus.

**Architecture:** Three independent hardenings: the provider remembers the last open-annotation target and replays it after `setGroup` on `ready` (membership-guarded; cleared on Back, updated on row navigation); `openAnnotationInPanel` focuses the view *first* so it resolves before messages are sent; `MarkdownEditor`'s autofocus retries briefly (and once on window `focus`) until the view actually has focus.

**Tech Stack:** TypeScript, VSCode WebviewView lifecycle, CodeMirror `EditorView`.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

> **Shared-checkout caution:** another session may have files staged. Always commit with an explicit pathspec — `git commit -m "…" -- <files>`.

### Testing reality
All three changes are `vscode`/CodeMirror glue (no provider unit harness; CodeMirror-in-jsdom intentionally avoided) — type-check + compile + careful review + a manual checklist (Task 4). This matches the spec's honest-gaps list for §I. **Hard gate:** `npm run check-types` + `npm run test:unit` (regression only).

---

## File Structure

- **Modify** `src/web/detailPanelProvider.ts` — pending-target replay.
- **Modify** `src/web/extension.ts` — `openAnnotationInPanel` ordering.
- **Modify** `src/webview/detail/MarkdownEditor.svelte` — focus retry.

---

### Task 1: Provider replays the last `openAnnotation` on `ready` (§I-1)

**Files:**
- Modify: `src/web/detailPanelProvider.ts`

- [ ] **Step 1: Track the pending target.** Add the private field after `private currentAuthor = '';`:

```ts
  /** Last annotation the host asked to open — replayed after a webview (re)load. */
  private pendingAnnotationId: string | null = null;
```

- [ ] **Step 2: Record it.** Replace the `openAnnotation` method body:

```ts
  /** Tell the webview to open a specific annotation in the annotation view. */
  openAnnotation(annotationId: string): void {
    this.pendingAnnotationId = annotationId;
    const message: HostToDetail = { type: 'openAnnotation', annotationId };
    void this.view?.webview.postMessage(message);
  }
```

- [ ] **Step 3: Replay on `ready`.** In `onDidReceiveMessage`, change the `ready` branch:

```ts
      if (message.type === 'ready') {
        this.post();
        this.replayOpenAnnotation();
      }
```

and add the private method after `openAnnotation`:

```ts
  /**
   * Re-send the last openAnnotation after a webview (re)load. Without this, an
   * openAnnotation posted before the view resolved is silently lost and the
   * panel lands in group view (the round-3 #10 autofocus bug). Guarded: only
   * replayed while the shown group still contains that annotation.
   */
  private replayOpenAnnotation(): void {
    const id = this.pendingAnnotationId;
    if (id !== null && (this.group?.annotations.some((a) => a.id === id) ?? false)) {
      const message: HostToDetail = { type: 'openAnnotation', annotationId: id };
      void this.view?.webview.postMessage(message);
    }
  }
```

- [ ] **Step 4: Keep the target in sync with webview-side navigation.**

(a) In the `selectAnnotation` branch (user clicked a row — that annotation is now the open one), record it before the callback:

```ts
      } else if (message.type === 'selectAnnotation') {
        this.pendingAnnotationId = message.annotationId;
        const annotation = this.group?.annotations.find((a) => a.id === message.annotationId);
        if (annotation) {
          this.onSelectAnnotation?.(annotation);
        }
```

(b) In the `navigationClosed` branch (user pressed Back — group view is now the truth; a later reload must NOT jump back into the annotation):

```ts
      } else if (message.type === 'navigationClosed') {
        this.pendingAnnotationId = null;
        this.onNavigationClosed?.();
```

- [ ] **Step 5: Verify**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: clean.

- [ ] **Step 6: Commit (pathspec form)**

```bash
git commit -m "fix(detail): replay openAnnotation after webview load (TODO #10)" -- src/web/detailPanelProvider.ts
```

---

### Task 2: Focus the view before sending messages (§I-2)

**Files:**
- Modify: `src/web/extension.ts`

- [ ] **Step 1: Reorder `openAnnotationInPanel`.** Replace the function:

```ts
  const openAnnotationInPanel = async (groupId: string, annotationId: string): Promise<void> => {
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
```

with:

```ts
  const openAnnotationInPanel = async (groupId: string, annotationId: string): Promise<void> => {
    // Focus first: resolves the detail view when it was closed, so the messages
    // below reach a live webview (the provider's 'ready' replay covers the rest
    // of the race). revealAnnotation keeps preserveFocus, so focus stays here.
    await vscode.commands.executeCommand('annotated.detail.focus');
    await showGroupWithStale(groupId);
    detailProvider.openAnnotation(annotationId);
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
```

- [ ] **Step 2: Verify**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: clean.

- [ ] **Step 3: Commit (pathspec form)**

```bash
git commit -m "fix(web): focus the detail view before posting open-annotation messages (TODO #10)" -- src/web/extension.ts
```

---

### Task 3: `MarkdownEditor` autofocus retries until it sticks (§I-3)

**Files:**
- Modify: `src/webview/detail/MarkdownEditor.svelte`

- [ ] **Step 1: Implement.** In `src/webview/detail/MarkdownEditor.svelte`, replace the autofocus block inside `onMount`:

```ts
    if (autofocus) {
      view.focus();
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    }
    return () => view?.destroy();
```

with:

```ts
    const cleanupFocus = autofocus ? focusWithRetry(view) : undefined;
    return () => {
      cleanupFocus?.();
      view?.destroy();
    };
```

and add the helper inside the `<script>` block (above `onMount`):

```ts
  /**
   * Focus + cursor-at-end, retried briefly: when the webview iframe itself isn't
   * focused yet (the host focuses the view asynchronously after this mounts),
   * the initial .focus() doesn't take. Retry on short timers and once when the
   * window gains focus, then give up quietly (round-3 #10).
   */
  function focusWithRetry(target: EditorView): () => void {
    const place = (): void => {
      target.focus();
      target.dispatch({ selection: EditorSelection.cursor(target.state.doc.length) });
    };
    const onWindowFocus = (): void => {
      if (!target.hasFocus) {
        place();
      }
    };
    place();
    const timers = [50, 150, 400].map((ms) =>
      setTimeout(() => {
        if (!target.hasFocus) {
          place();
        }
      }, ms),
    );
    window.addEventListener('focus', onWindowFocus);
    const deadline = setTimeout(() => window.removeEventListener('focus', onWindowFocus), 1500);
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      clearTimeout(deadline);
      window.removeEventListener('focus', onWindowFocus);
    };
  }
```

> Retries only fire while `!target.hasFocus` — once the user (or a retry) has focused the editor, no retry can move the cursor, so user input is never disturbed.

- [ ] **Step 2: Verify (type-check + the existing component suites that stub this file)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean + all PASS (component tests use the stub; unaffected).

- [ ] **Step 3: Commit (pathspec form)**

```bash
git commit -m "fix(editor): autofocus retries until the webview actually has focus (TODO #10)" -- src/webview/detail/MarkdownEditor.svelte
```

---

### Task 4: Gate + manual verification checklist

- [ ] **Step 1: Full local gate**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

- [ ] **Step 2: Record the manual checklist** (for the human to run in the dev host — `npm run compile && npm start`):

1. Detail panel CLOSED → select code → Cmd+Alt+A → new group → annotation view opens with the editor focused (cursor blinking).
2. Detail panel OPEN on another group → create annotation into a new group → same result.
3. Open annotation A, press Back, hide + reshow the panel → lands in group view (no jump back to A).
4. Open annotation A, hide + reshow the panel (no Back) → annotation view restored.
5. Click an annotation row → editor view opens; on an empty annotation the editor is focused.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage (§I):** replay (Task 1, with the membership guard from the spec + two sync refinements: row-clicks update the target, Back clears it — both prevent wrong-view restores); ordering (Task 2 — `revealAnnotation` already uses `preserveFocus: true`, verified); retry (Task 3 — timers + window-focus listener within ~1.5s, no-ops once focused). ✓
- **Type consistency:** `pendingAnnotationId: string | null`; `focusWithRetry(target: EditorView): () => void`; `EditorView`/`EditorSelection` already imported in MarkdownEditor.svelte. ✓
- **No regressions:** retry never fires once `hasFocus` (user input safe); replay only on `ready` (fresh loads), never on plain `setGroup`; `detail.focus` before `showGroupWithStale` means `ready` may arrive between them — then `post()` (from ready) sends a stale group and `showGroupWithStale`'s later `post()` corrects it; `openAnnotation` after both still lands or is replayed. ✓
- **All glue, no new pure logic** — consciously accepted (spec honest-gaps); the manual checklist closes the loop. ✓
