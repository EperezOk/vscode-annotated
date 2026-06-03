# Phase 7a — Small Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five small round-3 items (spec §B/§C/§E/§F + §A prompt text): Create Annotation works with no selection, detail view shows basename + collapsed single-line range, a default keybinding focuses the Annotations view, the Ping command is removed, and the author-name prompt is reworded.

**Architecture:** One new pure helper (`formatLineRange` in `shared/model.ts`, unit-tested); webview display changes in `AnnotationView`/`AnnotationRow` (component-tested); the rest is `package.json` contributes + `extension.ts` glue (type-check + integration-test update + manual).

**Tech Stack:** TypeScript, Svelte 5, Vitest (unit + jsdom component), VSCode contributes (keybindings/commands).

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
`formatLineRange` is unit-tested; `AnnotationView`/`AnnotationRow` are component-tested; the Ping removal updates the Mocha integration test (runs in CI/network gate, not locally here). Keybinding changes (§B/§E) and the prompt text are not unit-testable — type-check + manual. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/shared/model.ts` (+ `model.unit.test.ts`) — `formatLineRange(range)`.
- **Modify** `src/webview/detail/AnnotationView.svelte` (+ `.svelte.test.ts`) — basename + collapsed range + full-path tooltip; basename prefix in range-edit mode.
- **Modify** `src/webview/detail/AnnotationRow.svelte` (+ `.svelte.test.ts`) — collapsed single-line range.
- **Modify** `package.json` — drop `editorHasSelection` from the create keybinding; add `annotated.sidebar.focus` keybinding; remove the `annotated.ping` command.
- **Modify** `src/web/extension.ts` — remove the ping registration.
- **Modify** `src/web/test/suite/extension.test.ts` — drop ping tests, keep an activation test.
- **Modify** `src/web/authorSources.ts` — prompt reword.

---

### Task 1: `formatLineRange` helper (§C)

**Files:**
- Modify: `src/shared/model.ts`
- Test: `src/shared/model.unit.test.ts`

- [ ] **Step 1: Write the failing test** — in `src/shared/model.unit.test.ts`, add `formatLineRange` to the existing import from `./model`, then append at the end of the file:

```ts
describe('formatLineRange', () => {
  it('collapses a single-line range to one number', () => {
    expect(formatLineRange({ startLine: 12, endLine: 12 })).toBe('12');
  });
  it('formats a multi-line range with an en dash', () => {
    expect(formatLineRange({ startLine: 12, endLine: 18 })).toBe('12–18');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/model.unit.test.ts`
Expected: FAIL — `formatLineRange` is not exported.

- [ ] **Step 3: Implement** — in `src/shared/model.ts`, append after the `LineRange` interface (below line 9):

```ts
/** "12" for a single-line range, else "12–18" (en dash, 1-based inclusive). */
export function formatLineRange(range: LineRange): string {
  return range.startLine === range.endLine
    ? String(range.startLine)
    : `${range.startLine}–${range.endLine}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/model.unit.test.ts`
Expected: PASS (all model tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/model.ts src/shared/model.unit.test.ts
git commit -m "feat(model): formatLineRange collapses single-line ranges (TODO #3)"
```

---

### Task 2: `AnnotationView` shows basename + collapsed range, keeps full-path copy (§C)

**Files:**
- Modify: `src/webview/detail/AnnotationView.svelte`
- Test: `src/webview/detail/AnnotationView.svelte.test.ts`

- [ ] **Step 1: Update the tests (TDD: change the contract first).** In `src/webview/detail/AnnotationView.svelte.test.ts`, replace the first test (`'shows a preview and the file:range for a non-empty annotation'`) with:

```ts
  it('shows a preview and basename:range (full path on hover) for a non-empty annotation', () => {
    render(AnnotationView, { annotation: annotation('# Note') });
    expect(screen.getByTestId('md-preview')).toBeInTheDocument();
    const loc = screen.getByTestId('annotation-loc');
    expect(loc.textContent).toBe('x.ts:2–4');
    expect(loc).toHaveAttribute('title', 'src/x.ts:2–4');
    expect(screen.queryByTestId('md-editor')).toBeNull();
  });

  it('collapses a single-line range to one number', () => {
    render(AnnotationView, {
      annotation: { id: 'a1', file: 'src/x.ts', range: { startLine: 7, endLine: 7 }, content: '# N', contentHash: 'h' },
    });
    expect(screen.getByTestId('annotation-loc').textContent).toBe('x.ts:7');
  });
```

The existing `'shows transient "Copied" feedback after copying the path …'` test stays **unchanged** — it asserts `oncopyloc` is called with the full `'src/x.ts:2–4'`, which remains the copy payload.

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — the loc span shows the full path and has no `title`.

- [ ] **Step 3: Implement.** In `src/webview/detail/AnnotationView.svelte`:

(a) Update the model import and add the path import:

```ts
  import { formatLineRange, type Annotation, type ThreadComment } from '../../shared/model';
```

and after the other imports:

```ts
  import { fileName } from '../../shared/path';
```

(b) Replace the `location` derived line:

```ts
  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);
```

with:

```ts
  // Full path:range — stays the "copy path" payload and the hover tooltip.
  const location = $derived(`${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`);
  const shortLocation = $derived(`${fileName(annotation.file)}:${formatLineRange(annotation.range)}`);
```

(c) In the template, replace the display span:

```svelte
      <span class="loc" data-testid="annotation-loc">{location}</span>
```

with:

```svelte
      <span class="loc" data-testid="annotation-loc" title={location}>{shortLocation}</span>
```

(d) In the range-edit branch, replace the prefix `{annotation.file}:` with the basename — the line:

```svelte
      <span class="loc">{annotation.file}:
```

becomes:

```svelte
      <span class="loc">{fileName(annotation.file)}:
```

`copyPath()` is untouched (still copies `location`).

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS (all AnnotationView tests, including the unchanged copy-path test).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(detail): annotation view shows basename + collapsed range, full path on hover (TODO #3)"
```

---

### Task 3: `AnnotationRow` collapses single-line ranges (§C consistency)

**Files:**
- Modify: `src/webview/detail/AnnotationRow.svelte`
- Test: `src/webview/detail/AnnotationRow.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe` block of `src/webview/detail/AnnotationRow.svelte.test.ts` (use `.textContent` equality, not `toHaveTextContent` — `'login.ts:7'` is a substring of `'login.ts:7–7'`):

```ts
  it('collapses a single-line range to one number', () => {
    render(AnnotationRow, {
      annotation: { id: 'a9', file: 'src/auth/login.ts', range: { startLine: 7, endLine: 7 }, content: 'x', contentHash: 'h' },
    });
    expect(screen.getByTestId('annotation-loc').textContent).toBe('login.ts:7');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts`
Expected: FAIL — text is `login.ts:7–7`.

- [ ] **Step 3: Implement.** In `src/webview/detail/AnnotationRow.svelte`:

(a) Update the model import:

```ts
  import { formatLineRange, type Annotation } from '../../shared/model';
```

(b) Replace the `range` derived line:

```ts
  const range = $derived(`${annotation.range.startLine}–${annotation.range.endLine}`);
```

with:

```ts
  const range = $derived(formatLineRange(annotation.range));
```

(`shortLoc`/`fullLoc` pick the change up automatically.)

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts`
Expected: PASS (all AnnotationRow tests — existing ones use a 42–47 range and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/AnnotationRow.svelte src/webview/detail/AnnotationRow.svelte.test.ts
git commit -m "feat(detail): group-view rows collapse single-line ranges (TODO #3)"
```

---

### Task 4: Remove the Ping command (§F)

**Files:**
- Modify: `package.json`
- Modify: `src/web/extension.ts`
- Modify: `src/web/test/suite/extension.test.ts`

- [ ] **Step 1: Update the integration test first.** Replace the entire content of `src/web/test/suite/extension.test.ts` with:

```ts
import * as vscode from 'vscode';

suite('Annotated web extension', () => {
  test('activates and registers the createAnnotation command', async () => {
    const ext = vscode.extensions.getExtension('eperezok.vscode-annotated');
    if (!ext) {
      throw new Error('extension not found by id eperezok.vscode-annotated');
    }
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.createAnnotation')) {
      throw new Error('annotated.createAnnotation should be registered');
    }
    if (commands.includes('annotated.ping')) {
      throw new Error('annotated.ping should no longer be registered');
    }
  });
});
```

- [ ] **Step 2: Remove the command.** In `package.json`, delete the line:

```json
      { "command": "annotated.ping", "title": "Annotated: Ping" },
```

In `src/web/extension.ts`, delete the block:

```ts
  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.ping', () => 'pong'),
  );
```

- [ ] **Step 3: Type-check + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add package.json src/web/extension.ts src/web/test/suite/extension.test.ts
git commit -m "chore: remove the Ping command (TODO #7)"
```

---

### Task 5: Keybindings — create without selection + focus Annotations view (§B, §E)

**Files:**
- Modify: `package.json`

> `getSelection` (`src/web/createAnnotationCommand.ts:58-72`) already collapses an empty selection to the cursor line (`sel.end.character === 0 && sel.end.line > sel.start.line` is false for an empty selection, so `endLine = line + 1 = startLine`). Only the `when` clause blocks the keybinding. `annotated.sidebar.focus` is auto-generated by VSCode for the contributed view — no registration needed. Type-check/JSON-validity + manual.

- [ ] **Step 1: Edit `package.json` keybindings.** Replace the `keybindings` array with:

```json
    "keybindings": [
      {
        "command": "annotated.createAnnotation",
        "key": "ctrl+alt+a",
        "mac": "cmd+alt+a",
        "when": "editorTextFocus"
      },
      {
        "command": "annotated.openAnnotationAtCursor",
        "key": "ctrl+alt+o",
        "mac": "cmd+alt+o",
        "when": "editorTextFocus"
      },
      {
        "command": "annotated.sidebar.focus",
        "key": "ctrl+alt+l",
        "mac": "cmd+alt+l"
      }
    ],
```

- [ ] **Step 2: Sanity-check JSON + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')" && npm run compile`
Expected: `json ok`, compile clean.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(keybindings): create annotation without selection; ctrl/cmd+alt+l focuses the Annotations view (TODO #2, #6)"
```

---

### Task 6: Reword the author-name prompt (§A part)

**Files:**
- Modify: `src/web/authorSources.ts`

- [ ] **Step 1: Edit the prompt.** In `src/web/authorSources.ts` (`promptForName`, ~line 87), change:

```ts
      prompt: 'Your name for annotations',
```

to:

```ts
      prompt: 'User name for annotations',
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/web/authorSources.ts
git commit -m "fix(identity): clearer author-name prompt wording (TODO #1)"
```

---

### Task 7: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** §B → Task 5 (when clause); §C → Tasks 1–3 (`formatLineRange` + both views, full-path copy preserved, basename prefix in range-edit mode); §E → Task 5 (sidebar.focus binding); §F → Task 4 (command + registration + test); §A prompt text → Task 6. ✓
- **Type consistency:** `formatLineRange(range: LineRange): string`; both Svelte files import it as a value from `'../../shared/model'`; `fileName` already exists in `src/shared/path.ts`. ✓
- **Exact-text assertions:** single-line tests use `.textContent` equality (substring-safe). ✓
- **No placeholders:** every code step shows full content. ✓
- **7d note:** the existing `'does not autofocus when manually editing…'` test is intentionally untouched here — 7d (§L) reverses that behavior. ✓
