# Annotation line-highlight + resolved-group QuickPick filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable generic-color whole-line highlight for annotated lines, and stop offering resolved groups in the create-annotation group picker.

**Architecture:** Pure line-selection logic lives in `src/core/gutterIndicators.ts` (unit-tested); the `vscode` decoration application + toggle command/`globalState`/context-key wiring lives in `src/web` (type-checked, no unit tests, matching the existing pattern). The create-flow filter is a one-line change in the already-tested `src/core/createAnnotationFlow.ts`.

**Tech Stack:** TypeScript, VSCode extension API (web extension), Vitest.

## Global Constraints

- Tests need **Node ≥20.19**. Prefix every node/npm/npx command with: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`
- **Web-compatible** extension: no Node built-ins (`fs`/`path`/etc.) in `src/`. Pure logic in `src/core` + `src/shared` (no `vscode` import); the thin `vscode` layer in `src/web`.
- Local verification gate: `npm run check-types` + `npm run test:unit` (integration/e2e need network — not run locally).
- Branch: `annotation-visibility` (already created). Commit after each task. **Never push** — the user pushes.
- The highlight on/off state is **user-wide**, stored in `globalState` under the key `annotated.highlightAnnotatedLines` (default `true`). There is intentionally **no Settings checkbox**. The toolbar context key is `annotated.lineHighlightEnabled`.

---

### Task 1: `highlightableLines` core helper

Pure helper that turns the existing per-line bar map into the sorted list of lines eligible for the generic highlight. Factored out so line selection is unit-testable without `vscode`.

**Files:**
- Modify: `src/core/gutterIndicators.ts` (add one exported function)
- Test: `src/core/gutterIndicators.unit.test.ts` (add one `describe` block + extend the import)

**Interfaces:**
- Consumes: `gutterBarsByLine(...)` output shape `Map<number, string[]>` (1-based line → bar colors; resolved groups already excluded).
- Produces: `export function highlightableLines(barsByLine: Map<number, string[]>): number[]` — sorted ascending 1-based line numbers.

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `src/core/gutterIndicators.unit.test.ts` (e.g. right after the `decorationGroups` block):

```ts
describe('highlightableLines', () => {
  it('returns the lines that have bars, sorted ascending', () => {
    const byLine = new Map<number, string[]>([
      [5, ['#aa0000']],
      [2, ['#aa0000', '#00aa00']],
      [3, ['#00aa00']],
    ]);
    expect(highlightableLines(byLine)).toEqual([2, 3, 5]);
  });

  it('returns an empty array for an empty map', () => {
    expect(highlightableLines(new Map())).toEqual([]);
  });
});
```

And extend the existing import on line 2 to include `highlightableLines`:

```ts
import { gutterBarsByLine, buildGutterSvg, MAX_BARS, annotationsAtLine, hoverMarkdown, decorationGroups, hoverItems, highlightableLines } from './gutterIndicators';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/gutterIndicators.unit.test.ts`
Expected: FAIL — `highlightableLines is not a function` (or a type error / import error).

- [ ] **Step 3: Write minimal implementation**

Add to `src/core/gutterIndicators.ts` (e.g. immediately after `decorationGroups`):

```ts
/**
 * The 1-based line numbers eligible for the generic whole-line highlight: every line that
 * has at least one gutter bar, sorted ascending. Resolved groups are already excluded by
 * `gutterBarsByLine`, so they never appear here.
 */
export function highlightableLines(barsByLine: Map<number, string[]>): number[] {
  return [...barsByLine.keys()].sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/gutterIndicators.unit.test.ts`
Expected: PASS (all blocks, including the two new cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/gutterIndicators.ts src/core/gutterIndicators.unit.test.ts
git commit -m "feat(editor): add highlightableLines helper for annotated lines"
```

---

### Task 2: Render the whole-line highlight (default on)

Apply a single generic-color whole-line decoration to every annotated line, gated by a `highlightLines` flag threaded from a `globalState`-backed accessor (default on). Contribute the theme color so the tint is visible + theme-adaptive.

**Files:**
- Modify: `src/web/gutterDecorations.ts` (import helper; add highlight decoration type; add `highlightLines` param to `refresh`; dispose it)
- Modify: `src/web/extension.ts` (add `HIGHLIGHT_KEY` + `highlightOn()`; pass to `refresh`; set the initial context key)
- Modify: `package.json` (add `contributes.colors`)

**Interfaces:**
- Consumes: `highlightableLines(byLine)` from Task 1.
- Produces: `GutterDecorationManager.refresh(editors, groups, palette, highlightLines: boolean)` — the 4th param is **required**; the lone caller (`extension.ts`) is updated in this same task so the build stays green. Also produces module-local `HIGHLIGHT_KEY = 'annotated.highlightAnnotatedLines'` and `highlightOn(): boolean` in `extension.ts`, reused by Task 3.

- [ ] **Step 1: Update `gutterDecorations.ts` — import the helper**

Replace the import block (lines 4–11) so it also imports `highlightableLines`:

```ts
import {
  gutterBarsByLine,
  buildGutterSvg,
  decorationGroups,
  annotationsAtLine,
  hoverMarkdown,
  hoverItems,
  highlightableLines,
} from '../core/gutterIndicators';
```

- [ ] **Step 2: Add the cached highlight decoration type**

In `class GutterDecorationManager`, add a field next to `private types = ...` and a lazy getter (place the getter next to `typeFor`):

```ts
  private highlight: vscode.TextEditorDecorationType | undefined;
```

```ts
  /** The single, lazily-created generic whole-line highlight decoration (theme-adaptive color). */
  private highlightType(): vscode.TextEditorDecorationType {
    if (!this.highlight) {
      this.highlight = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('annotated.lineHighlightBackground'),
      });
    }
    return this.highlight;
  }
```

- [ ] **Step 3: Thread the `highlightLines` flag through `refresh`**

Change the `refresh` signature and apply the highlight per editor. Replace the method header and add the highlight application right after the bar-types `setDecorations` loop (i.e. after the `for (const type of this.types.values())` block, still inside the `for (const editor ...)` loop):

Signature becomes:

```ts
  refresh(
    editors: readonly vscode.TextEditor[],
    groups: AnnotationGroup[],
    palette: TagColor[],
    highlightLines: boolean,
  ): void {
```

Add inside the editor loop, immediately after the existing `for (const type of this.types.values()) { editor.setDecorations(type, ...); }` block:

```ts
      // Generic whole-line highlight over every annotated line (cleared when toggled off).
      const highlightRanges = highlightLines
        ? highlightableLines(byLine)
            .filter((line) => line >= 1 && line <= editor.document.lineCount)
            .map((line) => editor.document.lineAt(line - 1).range)
        : [];
      editor.setDecorations(this.highlightType(), highlightRanges);
```

- [ ] **Step 4: Dispose the highlight type**

Update `dispose()` to also dispose the highlight decoration:

```ts
  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.types.clear();
    this.highlight?.dispose();
    this.highlight = undefined;
  }
```

- [ ] **Step 5: Add the `globalState` accessor + pass it through (extension.ts)**

In `src/web/extension.ts`, just after the gutter manager is created (the `const gutter = new GutterDecorationManager();` / `context.subscriptions.push({ dispose: () => gutter.dispose() });` lines) and **before** `refreshDecorations`, add:

```ts
  const HIGHLIGHT_KEY = 'annotated.highlightAnnotatedLines';
  const highlightOn = (): boolean => context.globalState.get<boolean>(HIGHLIGHT_KEY, true);
```

Then update the `refreshDecorations` body's final line to pass the flag:

```ts
    gutter.refresh(vscode.window.visibleTextEditors, groups, displayPalette(groups), highlightOn());
```

- [ ] **Step 6: Set the initial toolbar context key**

At the end of `activate`, next to the existing `void reconcile();` / `void refreshDecorations();` lines, add:

```ts
  void vscode.commands.executeCommand('setContext', 'annotated.lineHighlightEnabled', highlightOn());
```

- [ ] **Step 7: Contribute the theme color (package.json)**

Add a `colors` array inside `contributes` (e.g. right after the `configuration` block — mind the trailing comma on the preceding sibling):

```json
    "colors": [
      {
        "id": "annotated.lineHighlightBackground",
        "description": "Background highlight for lines covered by an annotation.",
        "defaults": {
          "dark": "editor.rangeHighlightBackground",
          "light": "editor.rangeHighlightBackground",
          "highContrast": "editor.rangeHighlightBackground",
          "highContrastLight": "editor.rangeHighlightBackground"
        }
      }
    ]
```

- [ ] **Step 8: Verify it type-checks**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: both PASS (no new unit tests here; the `refresh` signature change must compile against its lone caller).

- [ ] **Step 9: Commit**

```bash
git add src/web/gutterDecorations.ts src/web/extension.ts package.json
git commit -m "feat(editor): tint annotated lines with a generic whole-line highlight"
```

---

### Task 3: Toggle command, toolbar button, keybinding

Two complementary commands (`enable`/`disable`) so the toolbar shows a state-reflecting eye icon; both route through one `setHighlight` helper that updates `globalState`, flips the context key, and repaints. Wire the toolbar button, keybinding, and command-palette entries.

**Files:**
- Modify: `src/web/extension.ts` (add `setHighlight` + register the two commands)
- Modify: `package.json` (add the two commands, `view/title` menu entries, keybindings, command-palette gating)

**Interfaces:**
- Consumes: `HIGHLIGHT_KEY`, `highlightOn`, and `refreshDecorations` from Task 2.
- Produces: commands `annotated.enableLineHighlight` / `annotated.disableLineHighlight`; both maintain the `annotated.lineHighlightEnabled` context key in lock-step with `globalState`.

- [ ] **Step 1: Add `setHighlight` + register commands (extension.ts)**

Add near the other `vscode.commands.registerCommand(...)` registrations (e.g. just after the `annotated.manageTags` registration block):

```ts
  const setHighlight = async (enabled: boolean): Promise<void> => {
    await context.globalState.update(HIGHLIGHT_KEY, enabled);
    await vscode.commands.executeCommand('setContext', 'annotated.lineHighlightEnabled', enabled);
    await refreshDecorations();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.enableLineHighlight', () => setHighlight(true)),
    vscode.commands.registerCommand('annotated.disableLineHighlight', () => setHighlight(false)),
  );
```

- [ ] **Step 2: Contribute the two commands (package.json)**

Add to `contributes.commands` (note the convention: when the highlight is ON the toolbar shows the "hide" command with an open eye; when OFF it shows the "show" command with a closed eye):

```json
      { "command": "annotated.enableLineHighlight", "title": "Annotated: Show Annotation Line Highlight", "icon": "$(eye-closed)" },
      { "command": "annotated.disableLineHighlight", "title": "Annotated: Hide Annotation Line Highlight", "icon": "$(eye)" }
```

- [ ] **Step 3: Add the toolbar button (package.json `menus.view/title`)**

Add these two entries to the existing `view/title` array (alongside the `annotated.manageTags` entry):

```json
        {
          "command": "annotated.disableLineHighlight",
          "when": "view == annotated.sidebar && annotated.lineHighlightEnabled",
          "group": "navigation"
        },
        {
          "command": "annotated.enableLineHighlight",
          "when": "view == annotated.sidebar && !annotated.lineHighlightEnabled",
          "group": "navigation"
        }
```

- [ ] **Step 4: Add the keybinding (package.json `keybindings`)**

Add to the `keybindings` array — one chord bound to whichever command is currently applicable:

```json
      {
        "command": "annotated.disableLineHighlight",
        "key": "ctrl+alt+h",
        "mac": "cmd+alt+h",
        "when": "annotated.lineHighlightEnabled"
      },
      {
        "command": "annotated.enableLineHighlight",
        "key": "ctrl+alt+h",
        "mac": "cmd+alt+h",
        "when": "!annotated.lineHighlightEnabled"
      }
```

- [ ] **Step 5: Gate the command-palette entries (package.json `menus.commandPalette`)**

Add to the existing `commandPalette` array so only the contextually-correct entry shows:

```json
        { "command": "annotated.enableLineHighlight", "when": "!annotated.lineHighlightEnabled" },
        { "command": "annotated.disableLineHighlight", "when": "annotated.lineHighlightEnabled" }
```

- [ ] **Step 6: Verify it type-checks and the manifest is valid JSON**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: all PASS; prints `package.json OK`.

- [ ] **Step 7: Commit**

```bash
git add src/web/extension.ts package.json
git commit -m "feat(editor): toolbar + keybinding toggle for the annotation line highlight"
```

---

### Task 4: Hide resolved groups in the create-annotation picker

One-line filter in the core create-flow, with a unit test. **Independent of Tasks 1–3** (disjoint files) — its review may pipeline with the #1 work.

**Files:**
- Modify: `src/core/createAnnotationFlow.ts` (filter the list passed to `pickGroup`)
- Test: `src/core/createAnnotationFlow.unit.test.ts` (add one case)

**Interfaces:**
- Consumes: existing `runCreateAnnotation(deps)` and its `pickGroup(groups)` dep.
- Produces: no signature change — only resolved groups are now excluded from the array passed to `pickGroup`.

- [ ] **Step 1: Write the failing test**

Add to `src/core/createAnnotationFlow.unit.test.ts`, inside the `describe('runCreateAnnotation', ...)` block:

```ts
  it('does not offer resolved groups when picking a target group', async () => {
    const open = createGroup({ id: 'g1', title: 'Open', author: 'A', tags: [], now: 1 });
    const resolved: AnnotationGroup = {
      ...createGroup({ id: 'g2', title: 'Done', author: 'A', tags: [], now: 1 }),
      status: 'resolved',
    };
    const pickGroup = vi.fn(async () => ({ kind: 'new' as const }));
    await runCreateAnnotation(deps({ listGroups: async () => [open, resolved], pickGroup }));
    expect(pickGroup).toHaveBeenCalledTimes(1);
    expect(pickGroup.mock.calls[0][0].map((g) => g.id)).toEqual(['g1']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: FAIL — the offered ids are `['g1', 'g2']` (resolved group still listed), so `toEqual(['g1'])` fails.

- [ ] **Step 3: Apply the filter**

In `src/core/createAnnotationFlow.ts`, change the `pickGroup` call (currently `const choice = await deps.pickGroup(groups);`) to:

```ts
  // Resolved groups are closed work — don't offer them as annotation targets.
  const choice = await deps.pickGroup(groups.filter((g) => g.status !== 'resolved'));
```

(The full `groups` list is still used by the later find-by-id, so the chosen group always resolves.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: PASS (the new case plus all existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/createAnnotationFlow.ts src/core/createAnnotationFlow.unit.test.ts
git commit -m "feat(create): exclude resolved groups from the annotation group picker"
```

---

## Final verification (after all tasks)

Run the full local gate:

`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: both PASS.

Manual smoke (optional, `npm start` — note: rebuild needed if `dist/` is stale): open a file with annotations → annotated lines show a subtle tint; the Annotations sidebar title bar shows an eye button that toggles the tint and flips its icon; `cmd+alt+h` toggles too; resolved groups don't appear when adding an annotation to a group.
