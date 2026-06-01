# Phase 4g2 — Gutter Indicators: VSCode Wiring + Click-to-Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the gutter indicators in the editor (stacked colored bars + overview-ruler marks for all non-resolved annotations), refresh them on the right events, and wire click-to-open via hover command links and a cursor command with QuickPick (TODO #4, including the E6 follow-up). The pure logic landed in 4g1.

**Architecture:** A `GutterDecorationManager` (`src/web/gutterDecorations.ts`) caches one `TextEditorDecorationType` per color signature (composed multi-bar SVG gutter icon + overview-ruler color) and applies per-line `DecorationOptions` carrying a trusted hover `MarkdownString`. `extension.ts` owns a `refreshDecorations()` driven by editor/visibility/file-watcher/config/manual-refresh events, plus two commands: `annotated.openAnnotation` (code-registered, invoked by hover links) and `annotated.openAnnotationAtCursor` (palette + keybinding, QuickPick when multiple). One more pure helper (`decorationGroups`) is added to `gutterIndicators.ts` and unit-tested.

**Tech Stack:** TypeScript, VSCode extension API (`TextEditorDecorationType`, `gutterIconPath`, `OverviewRulerLane`, `MarkdownString`, `QuickPick`, editor/visibility/config events), Vitest.

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality

`decorationGroups` (Task 1) is unit-tested. Everything else is `vscode`-coupled (decoration rendering, commands, event wiring) — VSCode exposes no read-back for applied decorations, so it is verified by `npm run check-types` + the unit suite staying green, and the rendered result (bars stack, ruler marks, hover links open, cursor-command QuickPick) is **verified manually**. **Hard gate:** `npm run check-types` + `npm run test:unit`. (Refresh is invoked on editor/file/config/manual events — never per keystroke — so the O(lines) cost in `gutterBarsByLine` is fine.)

---

## File Structure

- **Modify** `src/core/gutterIndicators.ts` (+ `.unit.test.ts`) — add pure `decorationGroups`.
- **Create** `src/web/gutterDecorations.ts` — `GutterDecorationManager`.
- **Modify** `src/web/extension.ts` — instantiate the manager, `refreshDecorations()`, event triggers, extract `openAnnotationInPanel`, register the two commands.
- **Modify** `src/web/sidebarViewProvider.ts` — `onRefreshRequested` hook fired on the manual `refresh` message.
- **Modify** `package.json` — contribute `annotated.openAnnotationAtCursor` + a keybinding.

---

### Task 1: `decorationGroups` pure helper

Groups a file's per-line bars by color signature so the manager can create one decoration type per signature and apply it to all lines that share it.

**Files:**
- Modify: `src/core/gutterIndicators.ts`
- Test: `src/core/gutterIndicators.unit.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/core/gutterIndicators.unit.test.ts` (add `decorationGroups` to the import):

```ts
describe('decorationGroups', () => {
  it('groups lines by color signature, with sorted lines', () => {
    const byLine = new Map<number, string[]>([
      [3, ['#aa0000']],
      [1, ['#aa0000']],
      [2, ['#aa0000', '#00aa00']],
      [5, ['#aa0000', '#00aa00']],
    ]);
    const groups = decorationGroups(byLine);
    const single = groups.find((g) => g.signature === '#aa0000');
    const stacked = groups.find((g) => g.signature === '#aa0000|#00aa00');
    expect(single?.colors).toEqual(['#aa0000']);
    expect(single?.lines).toEqual([1, 3]);
    expect(stacked?.colors).toEqual(['#aa0000', '#00aa00']);
    expect(stacked?.lines).toEqual([2, 5]);
  });

  it('returns an empty array for an empty map', () => {
    expect(decorationGroups(new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: FAIL — `decorationGroups` not exported.

- [ ] **Step 3: Implement** — append to `src/core/gutterIndicators.ts`:

```ts
/**
 * Group a file's per-line bars by color signature: each distinct signature (the colors
 * joined by `|`) maps to those colors plus the sorted lines that have exactly that
 * signature. The VSCode layer creates one decoration type per signature.
 */
export function decorationGroups(
  barsByLine: Map<number, string[]>,
): { signature: string; colors: string[]; lines: number[] }[] {
  const bySignature = new Map<string, { colors: string[]; lines: number[] }>();
  for (const [line, colors] of barsByLine) {
    const signature = colors.join('|');
    const entry = bySignature.get(signature);
    if (entry) {
      entry.lines.push(line);
    } else {
      bySignature.set(signature, { colors, lines: [line] });
    }
  }
  return [...bySignature.entries()].map(([signature, { colors, lines }]) => ({
    signature,
    colors,
    lines: lines.sort((a, b) => a - b),
  }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: PASS (all gutterIndicators tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/gutterIndicators.ts src/core/gutterIndicators.unit.test.ts
git commit -m "feat(gutter): decorationGroups — group lines by color signature (TODO #4)"
```

---

### Task 2: `GutterDecorationManager`

**Files:**
- Create: `src/web/gutterDecorations.ts`

- [ ] **Step 1: Create `src/web/gutterDecorations.ts`:**

```ts
import * as vscode from 'vscode';
import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import {
  gutterBarsByLine,
  buildGutterSvg,
  decorationGroups,
  annotationsAtLine,
  hoverMarkdown,
} from '../core/gutterIndicators';

/**
 * Renders in-editor gutter indicators for all non-resolved annotations. One decoration
 * type is cached per color signature (its gutter icon is a composed multi-bar SVG + an
 * overview-ruler color); each decorated line carries a trusted hover with command links
 * to open the covering annotation(s). Palette colors are trusted extension settings and
 * must be valid CSS color strings (they are interpolated into the SVG / ruler color).
 */
export class GutterDecorationManager {
  private types = new Map<string, vscode.TextEditorDecorationType>();

  /** Recompute and apply gutter decorations for the given (visible) editors. */
  refresh(editors: readonly vscode.TextEditor[], groups: AnnotationGroup[], palette: TagColor[]): void {
    const used = new Set<string>();

    for (const editor of editors) {
      const file = vscode.workspace.asRelativePath(editor.document.uri, false);
      const byLine = gutterBarsByLine(groups, file, palette);
      const optionsByType = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();

      for (const { signature, colors, lines } of decorationGroups(byLine)) {
        used.add(signature);
        const type = this.typeFor(signature, colors);
        optionsByType.set(
          type,
          lines
            .filter((line) => line >= 1 && line <= editor.document.lineCount)
            .map((line) => ({
              range: editor.document.lineAt(line - 1).range,
              hoverMessage: this.hoverFor(groups, file, line),
            })),
        );
      }

      // Apply each known type's options for this editor, clearing types not used here.
      for (const type of this.types.values()) {
        editor.setDecorations(type, optionsByType.get(type) ?? []);
      }
    }

    // Dispose signatures no longer present anywhere (keeps the cache bounded).
    for (const [signature, type] of this.types) {
      if (!used.has(signature)) {
        type.dispose();
        this.types.delete(signature);
      }
    }
  }

  private typeFor(signature: string, colors: string[]): vscode.TextEditorDecorationType {
    let type = this.types.get(signature);
    if (!type) {
      type = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.parse(buildGutterSvg(colors)),
        gutterIconSize: 'contain',
        overviewRulerColor: colors[0],
        overviewRulerLane: vscode.OverviewRulerLane.Center,
      });
      this.types.set(signature, type);
    }
    return type;
  }

  private hoverFor(groups: AnnotationGroup[], file: string, line: number): vscode.MarkdownString {
    const items = annotationsAtLine(groups, file, line).map(({ group, annotation }) => ({
      label: `${group.title} · ${annotation.file}:${annotation.range.startLine}–${annotation.range.endLine}`,
      groupId: group.id,
      annotationId: annotation.id,
    }));
    const md = new vscode.MarkdownString(hoverMarkdown(items));
    md.isTrusted = true;
    return md;
  }

  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.types.clear();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/web/gutterDecorations.ts
git commit -m "feat(gutter): GutterDecorationManager — composed-SVG gutter icons + ruler + hover (TODO #4)"
```

---

### Task 3: Open commands (`openAnnotation` + `openAnnotationAtCursor`)

**Files:**
- Modify: `src/web/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Extract `openAnnotationInPanel` and register the commands in `extension.ts`.**

(a) Add `annotationsAtLine` to imports near the top of `extension.ts`:

```ts
import { annotationsAtLine } from '../core/gutterIndicators';
```

(b) The create-flow callback added in 4c is currently `const onAnnotationCreated = async (groupId, annotationId) => { ... }`. **Rename it to `openAnnotationInPanel`** (its body is exactly the open-in-panel behavior we want to reuse). Keep its body unchanged; change only the name and update the create-command registration to use the new name:

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
  context.subscriptions.push(registerCreateAnnotationCommand(openAnnotationInPanel));
```

(c) Register the two open commands (add near the other `context.subscriptions.push(vscode.commands.registerCommand(...))` calls):

```ts
  // Invoked by gutter-hover command links (not contributed to the palette — needs args).
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'annotated.openAnnotation',
      async (args?: { groupId?: string; annotationId?: string }) => {
        if (args && typeof args.groupId === 'string' && typeof args.annotationId === 'string') {
          await openAnnotationInPanel(args.groupId, args.annotationId);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.openAnnotationAtCursor', async () => {
      const editor = vscode.window.activeTextEditor;
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!editor || !folder) {
        return;
      }
      const file = vscode.workspace.asRelativePath(editor.document.uri, false);
      const line = editor.selection.active.line + 1; // model lines are 1-based
      const groups = await new GroupStore(new VscodeFileSystem(folder.uri)).listGroups();
      const matches = annotationsAtLine(groups, file, line);
      if (matches.length === 0) {
        void vscode.window.showInformationMessage('No annotation on this line.');
        return;
      }
      if (matches.length === 1) {
        await openAnnotationInPanel(matches[0].group.id, matches[0].annotation.id);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        matches.map((m) => ({
          label: m.group.title,
          description: `${m.annotation.file}:${m.annotation.range.startLine}–${m.annotation.range.endLine}`,
          groupId: m.group.id,
          annotationId: m.annotation.id,
        })),
        { placeHolder: 'Open annotation…' },
      );
      if (picked) {
        await openAnnotationInPanel(picked.groupId, picked.annotationId);
      }
    }),
  );
```

- [ ] **Step 2: Contribute the cursor command + keybinding in `package.json`.**

(a) In `contributes.commands`, add (after the existing `annotated.createAnnotation` entry):

```json
      { "command": "annotated.openAnnotationAtCursor", "title": "Annotated: Open Annotation at Cursor" }
```

(b) In `contributes.keybindings`, add a second binding (after the existing `createAnnotation` one):

```json
      {
        "command": "annotated.openAnnotationAtCursor",
        "key": "ctrl+alt+o",
        "mac": "cmd+alt+o",
        "when": "editorTextFocus"
      }
```

(`annotated.openAnnotation` is intentionally NOT contributed — it is invoked only via trusted hover command links and requires args, so it should stay out of the Command Palette.)

- [ ] **Step 3: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/extension.ts package.json
git commit -m "feat(gutter): openAnnotation + openAnnotationAtCursor commands (TODO #4 click-to-open)"
```

---

### Task 4: Instantiate the manager + wire refresh triggers

**Files:**
- Modify: `src/web/extension.ts`
- Modify: `src/web/sidebarViewProvider.ts`

- [ ] **Step 1: Add an `onRefreshRequested` hook to `SidebarViewProvider`.**

(a) Add a public field alongside the other callbacks:

```ts
  /** Set by the extension: also fired when the user clicks the manual refresh button. */
  public onRefreshRequested?: () => void;
```

(b) In the `refresh` message branch (added in 4f), fire it after reloading:

```ts
      } else if (message.type === 'refresh') {
        await this.refresh();
        this.onRefreshRequested?.();
```

- [ ] **Step 2: Instantiate the manager + `refreshDecorations` in `extension.ts`.**

(a) Add the import near the top:

```ts
import { GutterDecorationManager } from './gutterDecorations';
```

(b) Inside `activate(...)`, after `detailProvider` is created, add:

```ts
  const gutter = new GutterDecorationManager();
  context.subscriptions.push({ dispose: () => gutter.dispose() });

  const refreshDecorations = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const groups = folder
      ? await new GroupStore(new VscodeFileSystem(folder.uri)).listGroups()
      : [];
    gutter.refresh(vscode.window.visibleTextEditors, groups, readTagPalette());
  };
```

- [ ] **Step 3: Drive `refreshDecorations` from the right events.**

(a) The file watcher currently refreshes only the sidebar. Replace the `refreshSidebar` definition + its three watcher hookups:

```ts
  const refreshSidebar = (): void => {
    void provider.refresh();
  };
  watcher.onDidCreate(refreshSidebar);
  watcher.onDidChange(refreshSidebar);
  watcher.onDidDelete(refreshSidebar);
```

with a combined handler that also refreshes decorations:

```ts
  const onAnnotationsChanged = (): void => {
    void provider.refresh();
    void refreshDecorations();
  };
  watcher.onDidCreate(onAnnotationsChanged);
  watcher.onDidChange(onAnnotationsChanged);
  watcher.onDidDelete(onAnnotationsChanged);
```

(b) Add editor/visibility/config triggers, the manual-refresh hook, and an initial paint (place after `refreshDecorations` is defined / after the provider callbacks are set):

```ts
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void refreshDecorations()),
    vscode.window.onDidChangeVisibleTextEditors(() => void refreshDecorations()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('annotated.tags')) {
        void refreshDecorations();
      }
    }),
  );
  provider.onRefreshRequested = (): void => void refreshDecorations();
  void refreshDecorations(); // initial paint for already-open editors
```

- [ ] **Step 4: Type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/web/extension.ts src/web/sidebarViewProvider.ts
git commit -m "feat(gutter): wire decoration refresh to editor/file/config/manual events (TODO #4)"
```

---

### Task 5: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

- [ ] **Step 2: Confirm the open command is registered with the matching arg shape**

Run: `grep -n "annotated.openAnnotation" src/web/extension.ts src/core/gutterIndicators.ts`
Expected: `gutterIndicators.ts` builds `command:annotated.openAnnotation?<{groupId,annotationId}>` and `extension.ts` registers `annotated.openAnnotation` reading `args.groupId` / `args.annotationId` — same shape.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** stacked gutter bars via composed SVG + overview-ruler marks (`GutterDecorationManager`, Task 2, using 4g1's `buildGutterSvg`/`gutterBarsByLine`/`decorationGroups`); refresh on active-editor / visible-editors / file-watcher / config / manual-refresh + initial paint (Task 4); click-to-open via hover command links (`annotated.openAnnotation`, code-registered) and `annotated.openAnnotationAtCursor` with QuickPick-for-multiple (Task 3). ✓
- **Type consistency:** manager consumes 4g1's `gutterBarsByLine`/`decorationGroups`/`buildGutterSvg`/`annotationsAtLine`/`hoverMarkdown`; `annotated.openAnnotation` reads `{ groupId, annotationId }` — the exact shape `hoverMarkdown` encodes; `openAnnotationInPanel(groupId, annotationId)` is the shared open path reused by create (4c) + both commands. `overviewRulerColor` accepts the hex string; `OverviewRulerLane.Center` keeps it off the navigation-highlight lane (4d uses `.Full`). ✓
- **Safety:** out-of-range lines filtered before `lineAt` (annotations can point past a shrunk file); decoration-type cache disposes unused signatures each refresh (bounded); refresh fires on discrete events, not per keystroke. ✓
- **Palette-color contract:** documented in the manager JSDoc (palette colors are trusted extension settings, must be valid CSS colors) — the 4g1 review's low-severity SVG-injection note. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** `AnnotationGroup`/`TagColor` imported as types; functions/classes as values. ✓
- **Testing honesty:** only `decorationGroups` is unit-tested; the rest is `vscode`-glue (no decoration read-back) verified by type-check + manual. Stated up front. ✓
