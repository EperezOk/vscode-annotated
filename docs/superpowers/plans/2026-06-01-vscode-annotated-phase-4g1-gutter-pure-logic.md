# Phase 4g1 — Gutter Indicators: Pure Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, `vscode`-free core for in-editor gutter indicators (TODO #4): which lines of a file carry annotation bars and in what colors, the composed multi-bar SVG, the annotations covering a given line (for click-to-open), and the hover-link markdown. The VSCode wiring that renders these lands in 4g2.

**Architecture:** One new pure module `src/core/gutterIndicators.ts` with four functions, fully unit-tested. It reuses `tagColor` (`core/sidebarState`) and `svgDataUri` (`shared/svgIcon`, from 4a). No `vscode` import.

**Tech Stack:** TypeScript, Vitest (unit project).

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

---

## File Structure

- **Create** `src/core/gutterIndicators.ts` — `gutterBarsByLine`, `buildGutterSvg`, `annotationsAtLine`, `hoverMarkdown`, `MAX_BARS`.
- **Create** `src/core/gutterIndicators.unit.test.ts` — tests for all of the above.

These functions are consumed by `src/web/gutterDecorations.ts` in sub-plan 4g2 (not part of this plan).

---

### Task 1: `gutterBarsByLine` — lines → bar colors

**Files:**
- Create: `src/core/gutterIndicators.ts`
- Test: `src/core/gutterIndicators.unit.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/gutterIndicators.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gutterBarsByLine } from './gutterIndicators';
import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';

const palette: TagColor[] = [{ name: 'security', color: '#aa0000' }, { name: 'perf', color: '#00aa00' }];

function group(over: Partial<AnnotationGroup> & { id: string }): AnnotationGroup {
  return {
    id: over.id, title: over.title ?? 'G', author: 'A', tags: over.tags ?? [], gitRef: null,
    status: over.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: over.annotations ?? [],
  };
}

describe('gutterBarsByLine', () => {
  it('marks every line in an annotation range with the group first-tag color', () => {
    const g = group({ id: 'g1', tags: ['security'], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 2, endLine: 4 }, content: '', contentHash: 'h' },
    ] });
    const map = gutterBarsByLine([g], 'a.ts', palette);
    expect(map.get(2)).toEqual(['#aa0000']);
    expect(map.get(3)).toEqual(['#aa0000']);
    expect(map.get(4)).toEqual(['#aa0000']);
    expect(map.has(1)).toBe(false);
    expect(map.has(5)).toBe(false);
  });

  it('ignores annotations in other files', () => {
    const g = group({ id: 'g1', tags: ['security'], annotations: [
      { id: 'a1', file: 'other.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g], 'a.ts', palette).size).toBe(0);
  });

  it('excludes resolved groups', () => {
    const g = group({ id: 'g1', tags: ['security'], status: 'resolved', annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g], 'a.ts', palette).size).toBe(0);
  });

  it('stacks one color per annotation covering the same line, in group then annotation order', () => {
    const g1 = group({ id: 'g1', tags: ['security'], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 5, endLine: 5 }, content: '', contentHash: 'h' },
    ] });
    const g2 = group({ id: 'g2', tags: ['perf'], annotations: [
      { id: 'a2', file: 'a.ts', range: { startLine: 5, endLine: 5 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g1, g2], 'a.ts', palette).get(5)).toEqual(['#aa0000', '#00aa00']);
  });

  it('uses a neutral default color for a group with no tags', () => {
    const g = group({ id: 'g1', tags: [], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
    ] });
    expect(gutterBarsByLine([g], 'a.ts', palette).get(1)).toEqual(['#888888']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: FAIL — cannot resolve `./gutterIndicators`.

- [ ] **Step 3: Implement** — create `src/core/gutterIndicators.ts`:

```ts
import { type AnnotationGroup, type Annotation } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import { tagColor } from './sidebarState';
import { svgDataUri } from '../shared/svgIcon';

const DEFAULT_BAR_COLOR = '#888888';

/** Max bars drawn in one line's gutter icon; extra annotations still appear in the hover. */
export const MAX_BARS = 4;

/** A group's bar color: its first tag's palette color, or a neutral default if untagged. */
function groupBarColor(group: AnnotationGroup, palette: TagColor[]): string {
  return group.tags.length > 0 ? tagColor(palette, group.tags[0]) : DEFAULT_BAR_COLOR;
}

/**
 * Map of 1-based line number → ordered bar colors for `file`: one bar per annotation (in a
 * non-resolved group) whose range covers that line. Order follows group, then annotation,
 * then line order, so colors are stable across renders.
 */
export function gutterBarsByLine(
  groups: AnnotationGroup[],
  file: string,
  palette: TagColor[],
): Map<number, string[]> {
  const byLine = new Map<number, string[]>();
  for (const group of groups) {
    if (group.status === 'resolved') {
      continue;
    }
    const color = groupBarColor(group, palette);
    for (const annotation of group.annotations) {
      if (annotation.file !== file) {
        continue;
      }
      for (let line = annotation.range.startLine; line <= annotation.range.endLine; line++) {
        const bars = byLine.get(line);
        if (bars) {
          bars.push(color);
        } else {
          byLine.set(line, [color]);
        }
      }
    }
  }
  return byLine;
}

/**
 * A `data:` SVG of thin vertical bars (one per color, capped at MAX_BARS) for use as a
 * gutter icon. Colors beyond the cap are dropped (the sidebar/hover still surface them).
 */
export function buildGutterSvg(colors: string[]): string {
  const shown = colors.slice(0, MAX_BARS);
  const unit = 4; // 3px bar + 1px gap
  const width = Math.max(unit, shown.length * unit);
  const rects = shown
    .map((color, i) => `<rect x="${i * unit}" y="0" width="3" height="16" fill="${color}"/>`)
    .join('');
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16">${rects}</svg>`,
  );
}

/** Non-resolved annotations whose range covers `line` in `file`, each with its group. */
export function annotationsAtLine(
  groups: AnnotationGroup[],
  file: string,
  line: number,
): { group: AnnotationGroup; annotation: Annotation }[] {
  const out: { group: AnnotationGroup; annotation: Annotation }[] = [];
  for (const group of groups) {
    if (group.status === 'resolved') {
      continue;
    }
    for (const annotation of group.annotations) {
      if (annotation.file === file && annotation.range.startLine <= line && line <= annotation.range.endLine) {
        out.push({ group, annotation });
      }
    }
  }
  return out;
}

/**
 * A trusted-MarkdownString body: one `command:` link per annotation covering a line,
 * each invoking `annotated.openAnnotation` with its `{ groupId, annotationId }` args.
 */
export function hoverMarkdown(
  items: { label: string; groupId: string; annotationId: string }[],
): string {
  return items
    .map((it) => {
      const args = encodeURIComponent(JSON.stringify({ groupId: it.groupId, annotationId: it.annotationId }));
      return `[📝 ${it.label}](command:annotated.openAnnotation?${args})`;
    })
    .join('\n\n');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: PASS (the `gutterBarsByLine` tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/gutterIndicators.ts src/core/gutterIndicators.unit.test.ts
git commit -m "feat(gutter): gutterBarsByLine pure logic (TODO #4)"
```

---

### Task 2: `buildGutterSvg` tests

**Files:**
- Test: `src/core/gutterIndicators.unit.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/core/gutterIndicators.unit.test.ts` (add `buildGutterSvg, MAX_BARS` to the import on line 2):

```ts
describe('buildGutterSvg', () => {
  const PREFIX = 'data:image/svg+xml;base64,';
  const decode = (uri: string) => atob(uri.slice(PREFIX.length));

  it('draws one rect per color with the given fill', () => {
    const svg = decode(buildGutterSvg(['#aa0000', '#00aa00']));
    expect(svg).toContain('<svg');
    expect((svg.match(/<rect /g) ?? [])).toHaveLength(2);
    expect(svg).toContain('fill="#aa0000"');
    expect(svg).toContain('fill="#00aa00"');
  });

  it('caps the number of bars at MAX_BARS', () => {
    const many = Array.from({ length: MAX_BARS + 3 }, (_, i) => `#0000${i}0`);
    const svg = decode(buildGutterSvg(many));
    expect((svg.match(/<rect /g) ?? [])).toHaveLength(MAX_BARS);
  });
});
```

- [ ] **Step 2: Run to verify it fails (or passes if impl already covers it)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: PASS — `buildGutterSvg` was implemented in Task 1, so these tests lock its behavior. (If anything fails, fix `buildGutterSvg` to match.)

- [ ] **Step 3: Commit**

```bash
git add src/core/gutterIndicators.unit.test.ts
git commit -m "test(gutter): buildGutterSvg rect count + fill + cap (TODO #4)"
```

---

### Task 3: `annotationsAtLine` + `hoverMarkdown` tests

**Files:**
- Test: `src/core/gutterIndicators.unit.test.ts`

- [ ] **Step 1: Add the tests** — append to `src/core/gutterIndicators.unit.test.ts` (add `annotationsAtLine, hoverMarkdown` to the import):

```ts
describe('annotationsAtLine', () => {
  it('returns non-resolved annotations whose range covers the line', () => {
    const g1 = group({ id: 'g1', tags: ['security'], annotations: [
      { id: 'a1', file: 'a.ts', range: { startLine: 2, endLine: 4 }, content: '', contentHash: 'h' },
    ] });
    const g2 = group({ id: 'g2', status: 'resolved', annotations: [
      { id: 'a2', file: 'a.ts', range: { startLine: 3, endLine: 3 }, content: '', contentHash: 'h' },
    ] });
    const at3 = annotationsAtLine([g1, g2], 'a.ts', 3);
    expect(at3).toHaveLength(1);
    expect(at3[0].group.id).toBe('g1');
    expect(at3[0].annotation.id).toBe('a1');
    expect(annotationsAtLine([g1, g2], 'a.ts', 1)).toHaveLength(0);
    expect(annotationsAtLine([g1, g2], 'other.ts', 3)).toHaveLength(0);
  });
});

describe('hoverMarkdown', () => {
  it('builds one openAnnotation command link per item with encoded args', () => {
    const md = hoverMarkdown([
      { label: 'Login · a.ts:2–4', groupId: 'g1', annotationId: 'a1' },
      { label: 'Perf · a.ts:2', groupId: 'g2', annotationId: 'a2' },
    ]);
    const lines = md.split('\n\n');
    expect(lines).toHaveLength(2);
    expect(md).toContain('command:annotated.openAnnotation?');
    expect(md).toContain(encodeURIComponent(JSON.stringify({ groupId: 'g1', annotationId: 'a1' })));
    expect(md).toContain('📝 Login · a.ts:2–4');
  });

  it('returns an empty string for no items', () => {
    expect(hoverMarkdown([])).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: PASS (all gutterIndicators tests).

- [ ] **Step 3: Commit**

```bash
git add src/core/gutterIndicators.unit.test.ts
git commit -m "test(gutter): annotationsAtLine + hoverMarkdown (TODO #4)"
```

---

### Task 4: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage (pure half of TODO #4):** lines→colors (`gutterBarsByLine`, all-non-resolved scope, first-tag color, default for untagged, stacking) → Task 1; composed multi-bar SVG with cap (`buildGutterSvg`, reuses `svgDataUri`) → Tasks 1–2; click-to-open backing (`annotationsAtLine`) + hover links (`hoverMarkdown` → `annotated.openAnnotation` with encoded args) → Tasks 1,3. The VSCode rendering/commands/triggers are sub-plan 4g2. ✓
- **Type consistency:** `gutterBarsByLine(groups, file, palette): Map<number, string[]>`; `buildGutterSvg(colors): string` (+ `MAX_BARS`); `annotationsAtLine(...): { group, annotation }[]` (uses `Annotation` from model); `hoverMarkdown(items: {label, groupId, annotationId}[]): string`. Reuses `tagColor` and `svgDataUri`. ✓
- **No placeholders:** every step shows full content. ✓
- **`verbatimModuleSyntax`:** `AnnotationGroup`/`Annotation`/`TagColor` imported as types; `tagColor`/`svgDataUri` as values. No `vscode` import (pure core). ✓
