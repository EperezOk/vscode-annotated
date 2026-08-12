# UX Feedback Round 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support annotations (and in-body local links) that target a whole file instead of a line range, left-align lists/quotes in the Markdown preview, and stop hostile snippet text from breaking gutter-hover command links.

**Architecture:** `Annotation.range` becomes `LineRange | null`, where `null` means "the whole file". The type change is nullable (not optional) so `strict` type-checking enumerates every consumer; each consumer then gets its intended whole-file behavior: no gutter bar / hover, no line hash (so no "lines changed" staleness), open-without-highlight navigation, and a location label with no `:lines` suffix. Creation gets a second command (`annotated.createFileAnnotation`, palette + Explorer context menu) that reuses the existing `runCreateAnnotation` flow with `range: null`. The two rendering fixes are local: CSS rules in `MarkdownPreview.svelte`, and Markdown escaping in `hoverMarkdown`.

**Tech Stack:** TypeScript (strict), Svelte 5 (runes), Vitest (unit + component), `@vscode/test-web` + Mocha (integration), esbuild, markdown-it + DOMPurify.

Spec: `docs/superpowers/specs/2026-08-05-ux-feedback-round-6-design.md`

## Global Constraints

- **Web-compatible extension:** no Node built-ins (`fs`, `path`, …) anywhere in `src/`. Use `vscode.workspace.fs` / `vscode.Uri.joinPath`. Pure logic in `src/shared` + `src/core` (no `vscode` import); thin VSCode layer in `src/web`; Svelte webviews in `src/webview`.
- **Local gate after every task:** `npm run check-types && npm run test:unit`. `npm run test:integration` needs network + a free port (use `--port` other than 3000 if `npm start` is running).
- **Vitest does NOT type-check** — a green `test:unit` does not imply a green `check-types`. Run both.
- **TDD:** failing test first, minimal implementation, green, commit. Frequent small commits.
- **Whole-file annotation on disk:** `"range": null` and `"contentHash": ""`. Readers accept a missing `range` as `null` too.
- **Agent-facing docs stay in lockstep:** `skills/annotated/SKILL.md`, `skills/annotated/references/data-contract.md`, `skills/annotated/references/operations.md` (guarded by `src/shared/skillContract.unit.test.ts`).
- **Branch:** `ux-feedback-round-6` (already created, holds the spec commit). Never `git push` — the user decides when to push.
- **Version:** leave `package.json` at `0.4.1`; the release cut (0.5.0) happens after the plan, on the user's call.

---

### Task 1: Core model — nullable `range` + `formatAnnotationLocation`

Widen the model and give every **pure** consumer (`src/shared`, `src/core`, plus the vscode-free `src/web/staleness.ts`) its whole-file behavior.

> **Expected mid-task state:** after this task, `npm run check-types` still reports errors — but ONLY in `src/web/navigateToCode.ts`, `src/web/extension.ts`, `src/core/groupStore.ts`, `src/webview/detail/AnnotationRow.svelte`, `src/webview/detail/AnnotationView.svelte`. Task 2 fixes exactly those. Do not paper over them with `!` or `as` here. `npm run test:unit` MUST be green.

**Files:**
- Modify: `src/shared/model.ts` (`Annotation.range`, `parseAnnotation`, new `formatAnnotationLocation`)
- Modify: `src/core/annotationFactory.ts:26-40` (`makeAnnotation` input type)
- Modify: `src/core/createAnnotationFlow.ts:5-10,52-63` (`SelectionInfo.range`, skip hashing)
- Modify: `src/core/gutterIndicators.ts:31-45,74-80` (skip range-less annotations)
- Modify: `src/web/staleness.ts` (skip hashing for range-less annotations)
- Test: `src/shared/model.unit.test.ts`, `src/core/createAnnotationFlow.unit.test.ts`, `src/core/gutterIndicators.unit.test.ts`
- Create test: `src/web/staleness.unit.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `Annotation.range: LineRange | null`
  - `formatAnnotationLocation(a: Pick<Annotation, 'file' | 'range'>): string` — `src/foo.ts:12–18` (en dash, via `formatLineRange`) or `src/foo.ts` when `range === null`
  - `makeAnnotation(input: { id: string; file: string; range: LineRange | null; content?: string; contentHash: string }): Annotation`
  - `SelectionInfo = { file: string; range: LineRange | null }`
  - `computeStaleIds(fs: FileSystem, group: AnnotationGroup): Promise<string[]>` (signature unchanged)

- [ ] **Step 1: Write the failing model tests**

Append to `src/shared/model.unit.test.ts` (import `formatAnnotationLocation` alongside the existing imports):

```ts
describe('whole-file annotations', () => {
  const base = {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open',
    createdAt: 1, updatedAt: 1,
  };

  it('parses an explicit null range as null', () => {
    const group = parseGroup({
      ...base,
      annotations: [{ id: 'a1', file: 'src/foo.ts', range: null, content: 'x', contentHash: '' }],
    });
    expect(group.annotations[0].range).toBeNull();
  });

  it('parses a missing range as null', () => {
    const group = parseGroup({
      ...base,
      annotations: [{ id: 'a1', file: 'src/foo.ts', content: 'x', contentHash: '' }],
    });
    expect(group.annotations[0].range).toBeNull();
  });

  it('still rejects a malformed range', () => {
    expect(() =>
      parseGroup({
        ...base,
        annotations: [{ id: 'a1', file: 'src/foo.ts', range: { startLine: 0, endLine: 3 }, content: '', contentHash: '' }],
      }),
    ).toThrow(/range.startLine/);
  });

  it('serializes a whole-file annotation with an explicit null range', () => {
    const group = parseGroup({
      ...base,
      annotations: [{ id: 'a1', file: 'src/foo.ts', range: null, content: 'x', contentHash: '' }],
    });
    expect(serializeGroup(group)).toContain('"range": null');
  });
});

describe('formatAnnotationLocation', () => {
  it('appends a single line', () => {
    expect(formatAnnotationLocation({ file: 'src/foo.ts', range: { startLine: 12, endLine: 12 } })).toBe('src/foo.ts:12');
  });

  it('appends an en-dash range', () => {
    expect(formatAnnotationLocation({ file: 'src/foo.ts', range: { startLine: 12, endLine: 18 } })).toBe('src/foo.ts:12–18');
  });

  it('is just the path for a whole-file annotation', () => {
    expect(formatAnnotationLocation({ file: 'src/foo.ts', range: null })).toBe('src/foo.ts');
  });
});
```

- [ ] **Step 2: Run the model tests to verify they fail**

Run: `npx vitest run --project unit src/shared/model.unit.test.ts`
Expected: FAIL — `formatAnnotationLocation` is not exported, and the null/missing-range cases throw `Invalid group: range is not an object`.

- [ ] **Step 3: Implement the model change**

In `src/shared/model.ts`, change the `Annotation` interface and `parseAnnotation`, and add the helper:

```ts
export interface Annotation {
  id: string;
  /** Workspace-relative POSIX path. */
  file: string;
  /** 1-based inclusive line range, or null for a whole-file annotation. */
  range: LineRange | null;
  /** Markdown body. */
  content: string;
  /** SHA-256 hex of the anchored lines at creation (for drift detection); '' when range is null. */
  contentHash: string;
}
```

```ts
function parseAnnotation(raw: unknown): Annotation {
  if (!isObject(raw)) fail('annotation', 'is not an object');
  const { id, file, range, content, contentHash } = raw;
  if (typeof id !== 'string') fail('annotation.id', 'must be a string');
  if (typeof file !== 'string') fail('annotation.file', 'must be a string');
  if (typeof content !== 'string') fail('annotation.content', 'must be a string');
  if (typeof contentHash !== 'string') fail('annotation.contentHash', 'must be a string');
  // A missing or null range means "the whole file" — no line anchor, no content hash.
  const parsedRange = range === undefined || range === null ? null : parseRange(range);
  return { id, file, range: parsedRange, content, contentHash };
}
```

Add next to `formatLineRange`:

```ts
/** `src/foo.ts:12–18` / `src/foo.ts:12`, or just `src/foo.ts` for a whole-file annotation. */
export function formatAnnotationLocation(a: Pick<Annotation, 'file' | 'range'>): string {
  return a.range === null ? a.file : `${a.file}:${formatLineRange(a.range)}`;
}
```

- [ ] **Step 4: Run the model tests to verify they pass**

Run: `npx vitest run --project unit src/shared/model.unit.test.ts`
Expected: PASS (all pre-existing tests in the file included).

- [ ] **Step 5: Write the failing gutter-indicator tests**

Append to `src/core/gutterIndicators.unit.test.ts` (reuse the file's existing group/annotation helpers if present; otherwise use literals as below):

```ts
describe('whole-file annotations are not line indicators', () => {
  const group: AnnotationGroup = {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [
      { id: 'file-level', file: 'src/foo.ts', range: null, content: 'about the file', contentHash: '' },
      { id: 'lines', file: 'src/foo.ts', range: { startLine: 2, endLine: 2 }, content: 'about line 2', contentHash: 'h' },
    ],
  };

  it('draws no gutter bar for a range-less annotation', () => {
    const bars = gutterBarsByLine([group], 'src/foo.ts', []);
    expect([...bars.keys()]).toEqual([2]);
  });

  it('never surfaces a range-less annotation in the line hover', () => {
    expect(annotationsAtLine([group], 'src/foo.ts', 2).map((m) => m.annotation.id)).toEqual(['lines']);
    expect(annotationsAtLine([group], 'src/foo.ts', 1)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the gutter tests to verify they fail**

Run: `npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: FAIL — TypeError reading `startLine` of null (the loops dereference `annotation.range`).

- [ ] **Step 7: Implement the gutter-indicator guards**

In `src/core/gutterIndicators.ts`, inside `gutterBarsByLine`'s annotation loop:

```ts
    for (const annotation of group.annotations) {
      // A whole-file annotation has no line to point at — no bar, no hover (spec: nothing in the editor).
      if (annotation.range === null || annotation.file !== file) {
        continue;
      }
      for (let line = annotation.range.startLine; line <= annotation.range.endLine; line++) {
```

and in `annotationsAtLine`:

```ts
    for (const annotation of group.annotations) {
      if (
        annotation.range !== null &&
        annotation.file === file &&
        annotation.range.startLine <= line &&
        line <= annotation.range.endLine
      ) {
        out.push({ group, annotation });
      }
    }
```

- [ ] **Step 8: Run the gutter tests to verify they pass**

Run: `npx vitest run --project unit src/core/gutterIndicators.unit.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing create-flow test**

Append to `src/core/createAnnotationFlow.unit.test.ts`. Mirror the file's existing `makeDeps`/stub-deps helper — the test below assumes a helper that returns a full `CreateAnnotationDeps` with spies; adapt names to what the file already uses:

```ts
it('creates a whole-file annotation with no range and an empty content hash', async () => {
  const deps = makeDeps({
    getSelection: () => ({ file: 'src/foo.ts', range: null }),
    pickGroup: async () => ({ kind: 'new' as const }),
  });
  const result = await runCreateAnnotation(deps);
  const annotation = result?.group.annotations[0];
  expect(annotation?.range).toBeNull();
  expect(annotation?.contentHash).toBe('');
  expect(deps.hashContent).not.toHaveBeenCalled();
});

it('still refuses a whole-file annotation on a document with no file on disk', async () => {
  const deps = makeDeps({
    getSelection: () => ({ file: 'src/foo.ts', range: null }),
    readWorkingText: async () => null,
  });
  expect(await runCreateAnnotation(deps)).toBeUndefined();
  expect(deps.showWarning).toHaveBeenCalled();
});
```

- [ ] **Step 10: Run the create-flow tests to verify they fail**

Run: `npx vitest run --project unit src/core/createAnnotationFlow.unit.test.ts`
Expected: FAIL — the flow hashes unconditionally, so `hashContent` is called and `contentHash` is the stub hash.

- [ ] **Step 11: Implement the create-flow change**

In `src/core/createAnnotationFlow.ts`, widen `SelectionInfo` and branch the hash:

```ts
/** The current editor selection (or whole file) to annotate. */
export interface SelectionInfo {
  /** Workspace-relative POSIX path. */
  file: string;
  /** Lines to anchor to, or null for a whole-file annotation. */
  range: LineRange | null;
}
```

```ts
  const text = await deps.readWorkingText(selection.file);
  if (text === null) {
    deps.showWarning('Annotated: open the file itself to annotate it — this view has no file on disk.');
    return undefined;
  }
  // A whole-file annotation has no anchored lines, so there is nothing to hash (and it can
  // never go "lines changed" stale). The read above still guards diff/virtual documents.
  const contentHash = selection.range === null ? '' : await deps.hashContent(anchorText(text, selection.range));
```

Also widen `makeAnnotation`'s input in `src/core/annotationFactory.ts`:

```ts
export function makeAnnotation(input: {
  id: string;
  file: string;
  /** null for a whole-file annotation. */
  range: LineRange | null;
  content?: string;
  contentHash: string;
}): Annotation {
```

Update the warning copy in `runCreateAnnotation`'s "nothing to annotate" branch to cover both commands:

```ts
  if (!selection) {
    deps.showWarning('Annotated: open a file (and select lines) to annotate.');
    return undefined;
  }
```

If an existing test asserts the old string `'Select one or more lines to annotate.'`, update that assertion to the new copy.

- [ ] **Step 12: Run the create-flow tests to verify they pass**

Run: `npx vitest run --project unit src/core/createAnnotationFlow.unit.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing staleness test**

Create `src/web/staleness.unit.test.ts` (`staleness.ts` imports no `vscode`, so it is unit-testable):

```ts
import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../core/memoryFileSystem';
import { computeStaleIds } from './staleness';
import { sha256Hex, anchorText } from '../shared/hash';
import { type AnnotationGroup } from '../shared/model';

const enc = new TextEncoder();

async function group(annotations: AnnotationGroup['annotations']): Promise<AnnotationGroup> {
  return {
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open',
    createdAt: 1, updatedAt: 1, annotations,
  };
}

describe('computeStaleIds with whole-file annotations', () => {
  it('never marks a readable whole-file annotation stale, even after edits', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('src/foo.ts', enc.encode('totally different content\n'));
    const g = await group([{ id: 'a1', file: 'src/foo.ts', range: null, content: '', contentHash: '' }]);
    expect(await computeStaleIds(fs, g)).toEqual([]);
  });

  it('marks a whole-file annotation stale when its file is gone', async () => {
    const fs = new MemoryFileSystem();
    const g = await group([{ id: 'a1', file: 'src/gone.ts', range: null, content: '', contentHash: '' }]);
    expect(await computeStaleIds(fs, g)).toEqual(['a1']);
  });

  it('still hash-checks line annotations', async () => {
    const fs = new MemoryFileSystem();
    const text = 'one\ntwo\nthree\n';
    await fs.writeFile('src/foo.ts', enc.encode(text));
    const fresh = await sha256Hex(anchorText(text, { startLine: 2, endLine: 2 }));
    const g = await group([
      { id: 'ok', file: 'src/foo.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: fresh },
      { id: 'drifted', file: 'src/foo.ts', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'stale' },
    ]);
    expect(await computeStaleIds(fs, g)).toEqual(['drifted']);
  });
});
```

- [ ] **Step 14: Run the staleness test to verify it fails**

Run: `npx vitest run --project unit src/web/staleness.unit.test.ts`
Expected: FAIL on the first case — `isAnnotationStale` is called with a null range and hashes the wrong thing (or throws).

- [ ] **Step 15: Implement the staleness branch**

Replace the loop body in `src/web/staleness.ts`:

```ts
/** Ids of annotations whose anchored lines no longer match their stored hash (or whose file is gone). */
export async function computeStaleIds(fs: FileSystem, group: AnnotationGroup): Promise<string[]> {
  const stale: string[] = [];
  for (const annotation of group.annotations) {
    try {
      const fileText = dec.decode(await fs.readFile(annotation.file));
      // Whole-file annotations have no anchored lines: readable file → never "lines changed".
      if (annotation.range !== null && (await isAnnotationStale(fileText, annotation.range, annotation.contentHash))) {
        stale.push(annotation.id);
      }
    } catch {
      stale.push(annotation.id); // file missing/unreadable → treat as stale
    }
  }
  return stale;
}
```

- [ ] **Step 16: Run the staleness test to verify it passes**

Run: `npx vitest run --project unit src/web/staleness.unit.test.ts`
Expected: PASS.

- [ ] **Step 17: Run the whole unit tier and confirm the expected type errors**

Run: `npm run test:unit`
Expected: PASS (all projects).

Run: `npm run check-types`
Expected: FAIL with errors ONLY in `src/core/groupStore.ts`, `src/web/navigateToCode.ts`, `src/web/extension.ts`, `src/webview/detail/AnnotationRow.svelte`, `src/webview/detail/AnnotationView.svelte`. If any OTHER file errors, fix it here before committing.

- [ ] **Step 18: Commit**

```bash
git add src/shared/model.ts src/shared/model.unit.test.ts src/core/annotationFactory.ts \
  src/core/createAnnotationFlow.ts src/core/createAnnotationFlow.unit.test.ts \
  src/core/gutterIndicators.ts src/core/gutterIndicators.unit.test.ts \
  src/web/staleness.ts src/web/staleness.unit.test.ts
git commit -m "feat(model): allow a null annotation range (whole-file annotations)

Core half: nullable range + formatAnnotationLocation, no hashing/staleness and
no gutter bar or hover for range-less annotations."
```

---

### Task 2: VSCode + webview display for range-less annotations

Fix the remaining type errors with their intended behavior: open-without-highlight navigation, `:lines`-free labels, and a file-specific stale banner.

**Files:**
- Modify: `src/core/groupStore.ts:167-185` (`updateAnnotationRange` accepts `LineRange | null`)
- Modify: `src/web/navigateToCode.ts:95-122` (`revealAnnotation` branch)
- Modify: `src/web/extension.ts:528` (QuickPick description via `formatAnnotationLocation`)
- Modify: `src/webview/detail/AnnotationRow.svelte:20-36`
- Modify: `src/webview/detail/AnnotationView.svelte:47-60,109-126`
- Test: `src/core/groupStore.unit.test.ts`, `src/webview/detail/AnnotationRow.svelte.test.ts`, `src/webview/detail/AnnotationView.svelte.test.ts`

**Interfaces:**
- Consumes: `formatAnnotationLocation`, `Annotation.range: LineRange | null` (Task 1).
- Produces:
  - `GroupStore.updateAnnotationRange(groupId: string, annotationId: string, range: LineRange | null, contentHash: string, now: number): Promise<boolean>`
  - `revealAnnotation(folderUri: vscode.Uri, annotation: Annotation): Promise<void>` — opens without selection/highlight when `range === null`
  - `AnnotationView` renders `data-testid="stale-banner"` with file-specific copy for range-less annotations

- [ ] **Step 1: Write the failing component tests**

Append to `src/webview/detail/AnnotationRow.svelte.test.ts` (match the file's existing `render` helper style):

```ts
it('shows just the file name for a whole-file annotation', () => {
  render(AnnotationRow, {
    annotation: { id: 'a1', file: 'src/deep/foo.ts', range: null, content: 'note', contentHash: '' },
  });
  const loc = screen.getByTestId('annotation-loc');
  expect(loc.textContent).toBe('foo.ts');
  expect(loc.getAttribute('title')).toBe('src/deep/foo.ts');
});
```

Append to `src/webview/detail/AnnotationView.svelte.test.ts`:

```ts
const fileLevel = { id: 'a1', file: 'src/deep/foo.ts', range: null, content: 'note', contentHash: '' };

it('shows a lines-free location for a whole-file annotation', () => {
  render(AnnotationView, { annotation: fileLevel });
  expect(screen.getByTestId('annotation-loc').textContent).toBe('foo.ts');
});

it('copies the bare path for a whole-file annotation', async () => {
  const oncopyloc = vi.fn();
  render(AnnotationView, { annotation: fileLevel, oncopyloc });
  await userEvent.click(screen.getByTestId('annotation-loc'));
  expect(oncopyloc).toHaveBeenCalledWith('src/deep/foo.ts');
});

it('uses file-specific stale copy for a whole-file annotation', () => {
  render(AnnotationView, { annotation: fileLevel, stale: true });
  expect(screen.getByTestId('stale-banner').textContent).toContain('File not found');
});

it('keeps lines-changed stale copy for a line annotation', () => {
  render(AnnotationView, {
    annotation: { id: 'a2', file: 'src/foo.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' },
    stale: true,
  });
  expect(screen.getByTestId('stale-banner').textContent).toContain('Lines changed');
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run: `npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — `formatLineRange(null)` throws / renders `foo.ts:undefined`, and the banner text is unconditional.

- [ ] **Step 3: Implement the webview display changes**

`src/webview/detail/AnnotationRow.svelte` — replace the three derived values:

```ts
  import { formatAnnotationLocation, type Annotation } from '../../shared/model';
  import { oneLine } from '../../core/detailState';
  import { fileName } from '../../shared/path';
```

```ts
  const summary = $derived(oneLine(annotation.content) || '(empty)');
  const fullLoc = $derived(formatAnnotationLocation(annotation));
  const shortLoc = $derived(formatAnnotationLocation({ file: fileName(annotation.file), range: annotation.range }));
```

and make the stale-dot tooltip range-aware:

```svelte
  {#if stale}<span class="stale-dot" data-testid="stale-dot" title={annotation.range === null ? 'File not found' : 'Lines changed since this was written'}>●</span>{/if}
```

`src/webview/detail/AnnotationView.svelte` — imports and derived location:

```ts
  import { formatAnnotationLocation, type Annotation, type LineRange, type ThreadComment } from '../../shared/model';
```

```ts
  // Full path (+ range when line-anchored) — the "copy path" payload and hover tooltip.
  const location = $derived(formatAnnotationLocation(annotation));
  const shortLocation = $derived(formatAnnotationLocation({ file: fileName(annotation.file), range: annotation.range }));
```

Seed the range inputs safely (a whole-file annotation edits from `1`):

```ts
  let editingRange = $state(false);
  let rangeStart = $state(untrack(() => annotation.range?.startLine ?? 1));
  let rangeEnd = $state(untrack(() => annotation.range?.endLine ?? 1));
  function startRangeEdit(): void {
    rangeStart = annotation.range?.startLine ?? 1;
    rangeEnd = annotation.range?.endLine ?? 1;
    editingRange = true;
  }
```

Split the stale banner copy:

```svelte
  {#if stale}
    <div class="stale-banner" data-testid="stale-banner">
      {annotation.range === null
        ? '⚠ File not found — it may have been moved or deleted.'
        : '⚠ Lines changed since this was written — content may no longer match.'}
    </div>
  {/if}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store + navigation coverage**

Append to `src/core/groupStore.unit.test.ts` (use the file's existing store/fs helpers):

```ts
it('updateAnnotationRange can convert an annotation to whole-file', async () => {
  const fs = new MemoryFileSystem();
  const store = new GroupStore(fs);
  await store.saveGroup({
    id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
    annotations: [{ id: 'a1', file: 'src/foo.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' }],
  });
  expect(await store.updateAnnotationRange('g1', 'a1', null, '', 9)).toBe(true);
  const saved = await store.getGroup('g1');
  expect(saved?.annotations[0].range).toBeNull();
  expect(saved?.annotations[0].contentHash).toBe('');
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run --project unit src/core/groupStore.unit.test.ts`
Expected: FAIL — `null` is not assignable to the `range: LineRange` parameter (test file type error) / the value is rejected.

- [ ] **Step 7: Implement the host-side changes**

`src/core/groupStore.ts` — widen the parameter only (body unchanged):

```ts
  async updateAnnotationRange(
    groupId: string,
    annotationId: string,
    /** null converts the annotation to whole-file (caller passes contentHash ''). */
    range: LineRange | null,
    contentHash: string,
    now: number,
  ): Promise<boolean> {
```

`src/web/navigateToCode.ts` — in `revealAnnotation`, after resolving `uri` and clearing highlights:

```ts
  clearHighlight();
  clearLinkHighlight(); // re-anchoring on the annotation drops any stale link-target highlight

  // A whole-file annotation has no lines to reveal: just open the file (no selection, no highlight).
  if (annotation.range === null) {
    try {
      await vscode.window.showTextDocument(uri, { preserveFocus: true });
    } catch {
      void vscode.window.showWarningMessage(`Annotated: cannot open "${annotation.file}".`);
    }
    return;
  }

  const range = new vscode.Range(
    annotation.range.startLine - 1,
    0,
    annotation.range.endLine - 1,
    Number.MAX_SAFE_INTEGER,
  );
```

(Move the existing `const range = …` construction below the guard as shown, since it dereferences `annotation.range`.)

`src/web/extension.ts:528` — in the `openAnnotationAtCursor` QuickPick items, replace the description with `formatAnnotationLocation(m.annotation)` and update the import from `formatLineRange` to `formatAnnotationLocation` (drop `formatLineRange` if it becomes unused).

- [ ] **Step 8: Verify the gate is fully green**

Run: `npm run check-types`
Expected: PASS with no errors.

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/groupStore.ts src/core/groupStore.unit.test.ts src/web/navigateToCode.ts \
  src/web/extension.ts src/webview/detail/AnnotationRow.svelte src/webview/detail/AnnotationView.svelte \
  src/webview/detail/AnnotationRow.svelte.test.ts src/webview/detail/AnnotationView.svelte.test.ts
git commit -m "feat(ui): display + navigate whole-file annotations

Lines-free location labels, file-specific stale copy, open-without-highlight
navigation, and a nullable range in GroupStore.updateAnnotationRange."
```

---

### Task 3: `annotated.createFileAnnotation` command

A second entry point that annotates a whole file: command palette (active editor) and Explorer context menu (right-clicked resource). No `editor/context` entry, no keybinding (user decision).

**Files:**
- Modify: `src/web/createAnnotationCommand.ts` (extract shared deps; add the file-scope registration)
- Modify: `src/web/extension.ts` (register the new command next to `annotated.createAnnotation`)
- Modify: `package.json` (`contributes.commands`, `contributes.menus.explorer/context`)
- Create test: `src/web/test/suite/createFileAnnotation.integration.test.ts`

**Interfaces:**
- Consumes: `runCreateAnnotation` + `SelectionInfo.range: LineRange | null` (Task 1); `registerCreateAnnotationCommand(onCreated?)` (existing).
- Produces:
  - `registerCreateFileAnnotationCommand(onCreated?: (groupId: string, annotationId: string) => void | Promise<void>): vscode.Disposable` — registers `annotated.createFileAnnotation`, accepting an optional `vscode.Uri` argument (Explorer) and falling back to the active editor.

- [ ] **Step 1: Write the failing integration test**

Create `src/web/test/suite/createFileAnnotation.integration.test.ts` (follow the existing suite style — plain `suite`/`test`, throw on failure, clean up after):

```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';

suite('annotated.createFileAnnotation', () => {
  test('is registered and writes a range-less annotation for the active file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.createFileAnnotation')) {
      throw new Error('annotated.createFileAnnotation is not registered');
    }

    // Drive the flow's persistence directly: the QuickPick cannot be answered headlessly, so this
    // asserts the store round-trips what the command produces (range: null, contentHash: '').
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const id = 'file-anno-itest';
    try {
      await store.saveGroup({
        id, title: 'File level', author: 'T', tags: [], gitRef: null, status: 'open',
        createdAt: 1, updatedAt: 1,
        annotations: [{ id: 'a1', file: 'README.md', range: null, content: 'about the file', contentHash: '' }],
      });
      const saved = await store.getGroup(id);
      if (saved?.annotations[0]?.range !== null || saved?.annotations[0]?.contentHash !== '') {
        throw new Error(`whole-file annotation not persisted: ${JSON.stringify(saved?.annotations[0])}`);
      }
    } finally {
      await store.deleteGroup(id);
    }
  });
});
```

- [ ] **Step 2: Run the integration tier to verify it fails**

Run: `npm run test:integration -- --port 3123` (needs network; if the port is busy pick another)
Expected: FAIL — `annotated.createFileAnnotation is not registered`.

- [ ] **Step 3: Implement the command**

In `src/web/createAnnotationCommand.ts`, factor the dependency wiring out of `registerCreateAnnotationCommand` so both commands share it, then add the new registration. Concretely, add:

```ts
/** Build the flow deps for one invocation. `getSelection` decides selection- vs file-scope. */
function buildDeps(
  fs: VscodeFileSystem,
  store: GroupStore,
  getSelection: () => SelectionInfo | undefined,
): CreateAnnotationDeps {
  const dec = new TextDecoder();
  return {
    getSelection,
    readWorkingText: async (file) => {
      try {
        return dec.decode(await fs.readFile(file));
      } catch {
        return null;
      }
    },
    resolveAuthor: () => resolveAuthor(new VscodeAuthorNameSources()),
    listGroups: () => store.listGroups(),
    pickGroup: (groups) => pickGroup(groups),
    promptGroupTitle: () => promptGroupTitle(),
    pickTags: async () =>
      pickTagsWithNewOption(displayPalette(await store.listGroups()), {
        placeHolder: 'Select tags (optional)',
      }),
    saveGroup: (group) => store.saveGroup(group),
    newId,
    now: () => Math.floor(Date.now() / 1000),
    hashContent: (text) => sha256Hex(text),
    getGitRef: async () => currentRef(await readGitRefInfo()),
    showInfo: (message) => void vscode.window.showInformationMessage(message),
    showWarning: (message) => void vscode.window.showWarningMessage(message),
  };
}
```

Rewrite `registerCreateAnnotationCommand`'s body to use it:

```ts
export function registerCreateAnnotationCommand(
  onCreated?: (groupId: string, annotationId: string) => void | Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.createAnnotation', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage('Annotated: open a folder to create annotations.');
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const editor = vscode.window.activeTextEditor;
    const deps = buildDeps(fs, store, () => getSelection(editor, folder.uri.path));
    const result = await runCreateAnnotation(deps);
    if (result && onCreated) {
      await onCreated(result.group.id, result.annotationId);
    }
  });
}

/**
 * Register `annotated.createFileAnnotation`: annotate a whole file (no line range). The target is
 * the Explorer-provided `Uri` when invoked from the context menu, else the active editor's file.
 */
export function registerCreateFileAnnotationCommand(
  onCreated?: (groupId: string, annotationId: string) => void | Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.createFileAnnotation', async (resource?: vscode.Uri) => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage('Annotated: open a folder to create annotations.');
      return;
    }
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showWarningMessage('Annotated: open a file (or pick one in the Explorer) to annotate it.');
      return;
    }
    // Folders (and anything unreadable) are not annotatable targets.
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        void vscode.window.showWarningMessage('Annotated: pick a file, not a folder.');
        return;
      }
    } catch {
      void vscode.window.showWarningMessage(`Annotated: cannot read "${uri.path}".`);
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const raw = vscode.workspace.asRelativePath(uri, false);
    const segments = toWorkspaceRelativeSegments(raw, folder.uri.path);
    const deps = buildDeps(fs, store, () => ({
      file: segments ? segments.join('/') : raw,
      range: null,
    }));
    const result = await runCreateAnnotation(deps);
    if (result && onCreated) {
      await onCreated(result.group.id, result.annotationId);
    }
  });
}
```

In `src/web/extension.ts`, import `registerCreateFileAnnotationCommand` and push it into `context.subscriptions` with the same `onCreated` callback the existing create command uses (find `registerCreateAnnotationCommand(` and mirror the call).

In `package.json`, add to `contributes.commands`:

```json
{
  "command": "annotated.createFileAnnotation",
  "title": "Annotated: Create File Annotation"
}
```

and add a new `explorer/context` menu block (keep the existing `editor/context` block untouched):

```json
"explorer/context": [
  {
    "command": "annotated.createFileAnnotation",
    "when": "!explorerResourceIsFolder",
    "group": "7_modification"
  }
]
```

- [ ] **Step 4: Run the gate and the integration tier**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

Run: `npm run test:integration -- --port 3123`
Expected: PASS (the new suite included).

- [ ] **Step 5: Manually smoke-test both entry points**

Run `npm start` (rebuild first if `dist/` is stale — a stale `dist/` silently serves old code), then in the web VSCode window: right-click a file in the Explorer → "Annotated: Create File Annotation" → pick/create a group; confirm the detail panel shows the path with no `:lines`, that clicking it opens the file with no line highlight, and that the file shows no gutter bar for it. Repeat via the command palette with a file open.

- [ ] **Step 6: Commit**

```bash
git add src/web/createAnnotationCommand.ts src/web/extension.ts package.json \
  src/web/test/suite/createFileAnnotation.integration.test.ts
git commit -m "feat(command): add annotated.createFileAnnotation (palette + Explorer)"
```

---

### Task 4: Convert between whole-file and line range in the detail panel

**Files:**
- Modify: `src/shared/protocol.ts:50,110-115` (nullable `updateAnnotationRange`)
- Modify: `src/webview/detail/state.ts:51-53` (`saveAnnotationRange`)
- Modify: `src/webview/detail/DetailApp.svelte:37` (pass-through types)
- Modify: `src/webview/detail/AnnotationView.svelte` (whole-file checkbox)
- Modify: `src/web/detailPanelProvider.ts:37,87` (nullable callback)
- Modify: `src/web/extension.ts:376-400` (handler branch)
- Test: `src/shared/protocol.unit.test.ts`, `src/webview/detail/AnnotationView.svelte.test.ts`
- Create test: `src/web/test/suite/wholeFileRange.integration.test.ts`

**Interfaces:**
- Consumes: `GroupStore.updateAnnotationRange(…, range: LineRange | null, …)` (Task 2).
- Produces:
  - `DetailToHost` variant `{ type: 'updateAnnotationRange'; annotationId: string; startLine: number | null; endLine: number | null }` — both null = whole file; mixed null/number is invalid
  - `saveAnnotationRange(annotationId: string, startLine: number | null, endLine: number | null): void`
  - `AnnotationView` prop `onsaverange?: (id: string, startLine: number | null, endLine: number | null) => void`
  - `DetailPanelProvider.onUpdateAnnotationRange?: (groupId, annotationId, startLine: number | null, endLine: number | null) => void`
  - New test id: `data-testid="whole-file-toggle"` (checkbox inside the range editor)

- [ ] **Step 1: Write the failing protocol tests**

Append to `src/shared/protocol.unit.test.ts`:

```ts
describe('updateAnnotationRange with nulls', () => {
  it('accepts both lines null (whole file)', () => {
    expect(parseDetailMessage({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: null, endLine: null }))
      .toEqual({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: null, endLine: null });
  });

  it('still accepts numeric lines', () => {
    expect(parseDetailMessage({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: 2, endLine: 4 }))
      .toEqual({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: 2, endLine: 4 });
  });

  it('rejects a mixed null/number pair', () => {
    expect(parseDetailMessage({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: null, endLine: 4 })).toBeNull();
    expect(parseDetailMessage({ type: 'updateAnnotationRange', annotationId: 'a1', startLine: 2, endLine: null })).toBeNull();
  });

  it('rejects a missing annotationId', () => {
    expect(parseDetailMessage({ type: 'updateAnnotationRange', startLine: null, endLine: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: FAIL — the null pair is rejected (`typeof null !== 'number'`).

- [ ] **Step 3: Implement the protocol change**

`src/shared/protocol.ts` — the variant:

```ts
  | { type: 'updateAnnotationRange'; annotationId: string; startLine: number | null; endLine: number | null }
```

and the parse case:

```ts
    case 'updateAnnotationRange': {
      // Both null = whole file; both numbers = line range. A mixed pair is malformed.
      const bothNull = raw.startLine === null && raw.endLine === null;
      const bothNumbers = typeof raw.startLine === 'number' && typeof raw.endLine === 'number';
      return typeof raw.annotationId === 'string' && (bothNull || bothNumbers)
        ? {
            type: 'updateAnnotationRange',
            annotationId: raw.annotationId,
            startLine: raw.startLine as number | null,
            endLine: raw.endLine as number | null,
          }
        : null;
    }
```

- [ ] **Step 4: Run to verify the protocol tests pass**

Run: `npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing AnnotationView tests**

Append to `src/webview/detail/AnnotationView.svelte.test.ts`:

```ts
it('sends a null range when "whole file" is checked', async () => {
  const onsaverange = vi.fn();
  render(AnnotationView, {
    annotation: { id: 'a1', file: 'src/foo.ts', range: { startLine: 3, endLine: 5 }, content: 'x', contentHash: 'h' },
    onsaverange,
  });
  await userEvent.click(screen.getByTestId('edit-range-btn'));
  await userEvent.click(screen.getByTestId('whole-file-toggle'));
  await userEvent.click(screen.getByTestId('save-range-btn'));
  expect(onsaverange).toHaveBeenCalledWith('a1', null, null);
});

it('starts a whole-file annotation with the toggle checked and can convert it back to lines', async () => {
  const onsaverange = vi.fn();
  render(AnnotationView, {
    annotation: { id: 'a1', file: 'src/foo.ts', range: null, content: 'x', contentHash: '' },
    onsaverange,
  });
  await userEvent.click(screen.getByTestId('edit-range-btn'));
  const toggle = screen.getByTestId('whole-file-toggle') as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  await userEvent.click(toggle);
  await userEvent.clear(screen.getByTestId('range-start'));
  await userEvent.type(screen.getByTestId('range-start'), '4');
  await userEvent.clear(screen.getByTestId('range-end'));
  await userEvent.type(screen.getByTestId('range-end'), '6');
  await userEvent.click(screen.getByTestId('save-range-btn'));
  expect(onsaverange).toHaveBeenCalledWith('a1', 4, 6);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: FAIL — no element with test id `whole-file-toggle`.

- [ ] **Step 7: Implement the toggle**

`src/webview/detail/AnnotationView.svelte` — prop type, state and save:

```ts
    onsaverange?: (id: string, startLine: number | null, endLine: number | null) => void;
```

```ts
  let editingRange = $state(false);
  let wholeFile = $state(untrack(() => annotation.range === null));
  let rangeStart = $state(untrack(() => annotation.range?.startLine ?? 1));
  let rangeEnd = $state(untrack(() => annotation.range?.endLine ?? 1));
  function startRangeEdit(): void {
    wholeFile = annotation.range === null;
    rangeStart = annotation.range?.startLine ?? 1;
    rangeEnd = annotation.range?.endLine ?? 1;
    editingRange = true;
  }
  function saveRange(): void {
    editingRange = false;
    if (wholeFile) {
      onsaverange?.(annotation.id, null, null);
      return;
    }
    const s = Math.max(1, Math.floor(Number(rangeStart) || 1));
    const e = Math.max(s, Math.floor(Number(rangeEnd) || s));
    onsaverange?.(annotation.id, s, e);
  }
```

and the editor markup (replacing the `{#if editingRange}` branch):

```svelte
    {#if editingRange}
      <span class="loc">{fileName(annotation.file)}:
        <input class="num" data-testid="range-start" type="number" min="1" bind:value={rangeStart} disabled={wholeFile} />–<input class="num" data-testid="range-end" type="number" min="1" bind:value={rangeEnd} disabled={wholeFile} />
      </span>
      <label class="whole-file" title="Annotate the whole file (no line range)">
        <input type="checkbox" data-testid="whole-file-toggle" bind:checked={wholeFile} /> whole file
      </label>
      <button type="button" class="link" data-testid="save-range-btn" onclick={saveRange}>save</button>
    {:else}
```

Add the style next to `.num`:

```css
  .whole-file { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); }
```

- [ ] **Step 8: Run to verify the component tests pass**

Run: `npx vitest run --project component src/webview/detail/AnnotationView.svelte.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the message through the host**

`src/webview/detail/state.ts`:

```ts
/** Persist a new line range, or null/null to make the annotation whole-file. */
export function saveAnnotationRange(annotationId: string, startLine: number | null, endLine: number | null): void {
  postToHost({ type: 'updateAnnotationRange', annotationId, startLine, endLine });
}
```

`src/webview/detail/DetailApp.svelte:37` — the existing `onsaverange={(id, s, e) => saveAnnotationRange(id, s, e)}` needs no edit once the types widen; confirm `check-types` agrees.

`src/web/detailPanelProvider.ts`:

```ts
  public onUpdateAnnotationRange?: (
    groupId: string,
    annotationId: string,
    startLine: number | null,
    endLine: number | null,
  ) => void;
```

(the `message.startLine` / `message.endLine` forwarding at line ~87 stays as-is)

`src/web/extension.ts` — the handler:

```ts
  detailProvider.onUpdateAnnotationRange = async (groupId, annotationId, startLine, endLine): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const group = await store.getGroup(groupId);
    const annotation = group?.annotations.find((a) => a.id === annotationId);
    if (!annotation) {
      return;
    }
    // Whole file: no anchored lines, so no hash to keep.
    if (startLine === null || endLine === null) {
      if (await store.updateAnnotationRange(groupId, annotationId, null, '', now())) {
        await showGroupWithStale(groupId);
      }
      return;
    }
    const range = { startLine, endLine };
    let contentHash = annotation.contentHash;
    try {
      const fileText = new TextDecoder().decode(await fs.readFile(annotation.file));
      contentHash = await sha256Hex(anchorText(fileText, range));
    } catch {
      // file unreadable — keep the old hash (the row will show stale)
    }
    const ok = await store.updateAnnotationRange(groupId, annotationId, range, contentHash, now());
    if (ok) {
      await showGroupWithStale(groupId);
    }
  };
```

Note: converting a whole-file annotation **to** lines re-hashes through the numeric branch, so no extra code is needed for that direction.

- [ ] **Step 10: Write the failing integration test**

Create `src/web/test/suite/wholeFileRange.integration.test.ts`:

```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateAnnotationRange — whole file (vscode.workspace.fs)', () => {
  test('converts a line annotation to whole-file and back', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'wf-itest', title: 'WF', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'README.md', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'old' }],
    };
    try {
      await store.saveGroup(g);
      if (!(await store.updateAnnotationRange('wf-itest', 'a1', null, '', 9))) {
        throw new Error('conversion to whole-file returned false');
      }
      let saved = await store.getGroup('wf-itest');
      if (saved?.annotations[0]?.range !== null || saved?.annotations[0]?.contentHash !== '') {
        throw new Error(`not whole-file: ${JSON.stringify(saved?.annotations[0])}`);
      }
      if (!(await store.updateAnnotationRange('wf-itest', 'a1', { startLine: 2, endLine: 3 }, 'h2', 10))) {
        throw new Error('conversion back to lines returned false');
      }
      saved = await store.getGroup('wf-itest');
      if (saved?.annotations[0]?.range?.endLine !== 3 || saved?.annotations[0]?.contentHash !== 'h2') {
        throw new Error(`not line-anchored: ${JSON.stringify(saved?.annotations[0])}`);
      }
    } finally {
      await store.deleteGroup('wf-itest');
    }
  });
});
```

- [ ] **Step 11: Run the gate + integration tier**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

Run: `npm run test:integration -- --port 3123`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts src/webview/detail/state.ts \
  src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts \
  src/web/detailPanelProvider.ts src/web/extension.ts src/web/test/suite/wholeFileRange.integration.test.ts
git commit -m "feat(detail): toggle an annotation between whole-file and a line range"
```

---

### Task 5: File-only local links

`[label](src/foo.ts)` (no `#L…`) becomes a click-to-open code link, gated so prose links are not hijacked.

**Files:**
- Modify: `src/shared/locationLink.ts`
- Modify: `src/webview/detail/MarkdownPreview.svelte:26-76` (nullable range in title + callback)
- Modify: `src/webview/detail/AnnotationView.svelte`, `src/webview/detail/CommentThread.svelte`, `src/webview/detail/GroupView.svelte`, `src/webview/detail/DetailApp.svelte` (`onlocallink` signature)
- Modify: `src/webview/detail/state.ts:86-88` (`openLocalLink`)
- Modify: `src/shared/protocol.ts` (`openLocalLink` nullable lines)
- Modify: `src/web/detailPanelProvider.ts:27,89-90`
- Modify: `src/web/extension.ts:224-227`
- Modify: `src/web/navigateToCode.ts:69-88` (`revealLocation` nullable range)
- Test: `src/shared/locationLink.unit.test.ts`, `src/shared/protocol.unit.test.ts`, `src/webview/detail/MarkdownPreview.svelte.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 3–4 (independent of them).
- Produces:
  - `parseLocationLink(href: string): { file: string; range: LineRange | null } | null`
  - `formatLocationLink(file: string, range: LineRange | null): string`
  - `onlocallink?: (file: string, range: LineRange | null) => void` (all three preview consumers)
  - `openLocalLink(file: string, range: LineRange | null): void` (webview state)
  - `DetailToHost` variant `{ type: 'openLocalLink'; file: string; startLine: number | null; endLine: number | null }`
  - `revealLocation(folderUri: vscode.Uri, file: string, range: LineRange | null): Promise<void>`

- [ ] **Step 1: Write the failing locationLink tests**

Append to `src/shared/locationLink.unit.test.ts`:

```ts
describe('file-only local links', () => {
  it('parses a path with no fragment as a whole-file target', () => {
    expect(parseLocationLink('src/core/foo.ts')).toEqual({ file: 'src/core/foo.ts', range: null });
  });

  it('parses a bare filename with an extension', () => {
    expect(parseLocationLink('README.md')).toEqual({ file: 'README.md', range: null });
  });

  it('normalizes backslashes', () => {
    expect(parseLocationLink('src\\core\\foo.ts')).toEqual({ file: 'src/core/foo.ts', range: null });
  });

  it('ignores prose targets that do not look like paths', () => {
    expect(parseLocationLink('whatever')).toBeNull();
    expect(parseLocationLink('')).toBeNull();
  });

  it('still ignores URLs and non-line fragments', () => {
    expect(parseLocationLink('https://example.com/a/b.ts')).toBeNull();
    expect(parseLocationLink('docs/adr.md#heading')).toBeNull();
  });

  it('still parses line fragments', () => {
    expect(parseLocationLink('src/foo.ts#L4-L9')).toEqual({ file: 'src/foo.ts', range: { startLine: 4, endLine: 9 } });
  });

  it('formats a null range as the bare path', () => {
    expect(formatLocationLink('src/foo.ts', null)).toBe('src/foo.ts');
  });

  it('treats a bare path as a location link for the paste guard', () => {
    expect(isLocationLink(' src/foo.ts ')).toBe(true);
    expect(isLocationLink('just words')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit src/shared/locationLink.unit.test.ts`
Expected: FAIL — hash-less targets return null.

- [ ] **Step 3: Implement the parse/format widening**

Rewrite `src/shared/locationLink.ts`:

```ts
// Pure parse/format for "local link" targets: workspace-relative path, optionally with a #L line
// fragment. GitHub-style. No vscode/I-O dependency. Single source of truth for the syntax.
import { type LineRange } from './model';

/** `path#L10-L20` / `path#L42`, or just `path` when `range` is null (whole-file target). */
export function formatLocationLink(file: string, range: LineRange | null): string {
  if (range === null) {
    return file;
  }
  return range.startLine === range.endLine
    ? `${file}#L${range.startLine}`
    : `${file}#L${range.startLine}-L${range.endLine}`;
}

/** A target with no fragment counts as a local link only if it looks like a path. */
function looksLikePath(file: string): boolean {
  return file.includes('/') || /\.[A-Za-z0-9]+$/.test(file);
}

/**
 * Parse `path#L10-L20` / `path#L42` → a line range, or `path` → `range: null` (whole file).
 * Returns null when `href` is not a local link. Rejects anything with a URL scheme (`http://`,
 * `mailto:`, a Windows drive `C:` …) — the check is self-contained here so `shared` does not
 * depend upward on `core`'s `isUrl`. A fragment that is not a valid `#L…` spec is NOT a local
 * link (e.g. `docs/adr.md#heading` stays an ordinary link).
 */
export function parseLocationLink(href: string): { file: string; range: LineRange | null } | null {
  if (typeof href !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }
  const hash = href.lastIndexOf('#');
  if (hash < 0) {
    const file = href.replace(/\\/g, '/');
    return file.length > 0 && looksLikePath(file) ? { file, range: null } : null;
  }
  const file = href.slice(0, hash).replace(/\\/g, '/');
  if (file.length === 0) {
    return null;
  }
  const match = /^L(\d+)(?:-L(\d+))?$/.exec(href.slice(hash + 1));
  if (!match) {
    return null;
  }
  const startLine = Number(match[1]);
  const endLine = match[2] !== undefined ? Number(match[2]) : startLine;
  if (!Number.isSafeInteger(startLine) || startLine < 1) {
    return null;
  }
  if (!Number.isSafeInteger(endLine) || endLine < startLine) {
    return null;
  }
  return { file, range: { startLine, endLine } };
}

/** True when `text` (trimmed) parses as a local link — convenience for the paste guard. */
export function isLocationLink(text: string): boolean {
  return parseLocationLink(text.trim()) !== null;
}
```

- [ ] **Step 4: Run to verify the locationLink tests pass**

Run: `npx vitest run --project unit src/shared/locationLink.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing preview + protocol tests**

Append to `src/webview/detail/MarkdownPreview.svelte.test.ts`:

```ts
it('fires onlocallink with a null range for a file-only link', async () => {
  const onlocallink = vi.fn();
  render(MarkdownPreview, { source: 'see [the module](src/core/foo.ts).', onlocallink });
  await userEvent.click(screen.getByText('the module'));
  expect(onlocallink).toHaveBeenCalledWith('src/core/foo.ts', null);
});

it('titles a file-only local link with the bare path', async () => {
  const { container } = render(MarkdownPreview, { source: '[mod](src/core/foo.ts)', onlocallink: () => {} });
  await tick();
  expect(container.querySelector('a.local-link')?.getAttribute('title')).toBe('src/core/foo.ts');
});

it('leaves prose links alone', async () => {
  const onlocallink = vi.fn();
  const { container } = render(MarkdownPreview, { source: '[see above](whatever)', onlocallink });
  await tick();
  expect(container.querySelector('a.local-link')).toBeNull();
  await userEvent.click(screen.getByText('see above'));
  expect(onlocallink).not.toHaveBeenCalled();
});
```

Append to `src/shared/protocol.unit.test.ts`:

```ts
describe('openLocalLink with nulls', () => {
  it('accepts a whole-file target', () => {
    expect(parseDetailMessage({ type: 'openLocalLink', file: 'src/foo.ts', startLine: null, endLine: null }))
      .toEqual({ type: 'openLocalLink', file: 'src/foo.ts', startLine: null, endLine: null });
  });

  it('rejects a mixed pair', () => {
    expect(parseDetailMessage({ type: 'openLocalLink', file: 'src/foo.ts', startLine: null, endLine: 3 })).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run --project component src/webview/detail/MarkdownPreview.svelte.test.ts && npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: FAIL — the preview passes `loc.range` (now nullable) but the title formatting throws / the message parse rejects nulls.

- [ ] **Step 7: Implement the webview + host plumbing**

`src/webview/detail/MarkdownPreview.svelte`:

```ts
  import { parseLocationLink } from '../../shared/locationLink';
  import { formatAnnotationLocation, type LineRange } from '../../shared/model';

  let { source, onlocallink }: { source: string; onlocallink?: (file: string, range: LineRange | null) => void } = $props();
```

```ts
  function localLinkFor(a: HTMLAnchorElement): { file: string; range: LineRange | null } | null {
    return parseLocationLink(a.getAttribute('href') ?? '');
  }
```

and the title in the marking effect (reuses the same `path:lines` formatting rule as annotations):

```ts
        a.title = formatAnnotationLocation(loc);
```

`src/webview/detail/state.ts`:

```ts
/** Open a local-link target: a line range, or the whole file when `range` is null. */
export function openLocalLink(file: string, range: LineRange | null): void {
  postToHost({
    type: 'openLocalLink',
    file,
    startLine: range?.startLine ?? null,
    endLine: range?.endLine ?? null,
  });
}
```

`src/shared/protocol.ts` — variant and parse case:

```ts
  | { type: 'openLocalLink'; file: string; startLine: number | null; endLine: number | null }
```

```ts
    case 'openLocalLink': {
      const bothNull = raw.startLine === null && raw.endLine === null;
      const bothNumbers = typeof raw.startLine === 'number' && typeof raw.endLine === 'number';
      return typeof raw.file === 'string' && (bothNull || bothNumbers)
        ? {
            type: 'openLocalLink',
            file: raw.file,
            startLine: raw.startLine as number | null,
            endLine: raw.endLine as number | null,
          }
        : null;
    }
```

`src/web/detailPanelProvider.ts`:

```ts
  /** Set by the extension: open a local-link target in the editor (no annotation-view change). */
  public onOpenLocalLink?: (file: string, startLine: number | null, endLine: number | null) => void;
```

`src/web/extension.ts`:

```ts
  detailProvider.onOpenLocalLink = (file, startLine, endLine): void => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      void revealLocation(folder.uri, file, startLine === null || endLine === null ? null : { startLine, endLine });
    }
  };
```

`src/web/navigateToCode.ts` — `revealLocation` gains the whole-file branch:

```ts
export async function revealLocation(folderUri: vscode.Uri, file: string, range: LineRange | null): Promise<void> {
  const segments = toWorkspaceRelativeSegments(file, folderUri.path);
  if (!segments) {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}" (outside the workspace).`);
    return;
  }
  const uri = vscode.Uri.joinPath(folderUri, ...segments);
  clearLinkHighlight();
  // A file-only link has no lines to select or highlight — just open it.
  if (range === null) {
    try {
      await vscode.window.showTextDocument(uri, { preserveFocus: true });
    } catch {
      void vscode.window.showWarningMessage(`Annotated: cannot open "${file}".`);
    }
    return;
  }
  const vsRange = new vscode.Range(range.startLine - 1, 0, range.endLine - 1, Number.MAX_SAFE_INTEGER);
  let editor: vscode.TextEditor;
  try {
    editor = await vscode.window.showTextDocument(uri, { selection: vsRange, preserveFocus: true });
  } catch {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}".`);
    return;
  }
  editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(linkDecorationType(), [vsRange]);
  lastLinkEditor = editor;
}
```

Then widen the `onlocallink` prop type to `(file: string, range: LineRange | null) => void` in `AnnotationView.svelte`, `CommentThread.svelte`, and `GroupView.svelte`; `DetailApp.svelte`'s `onlocallink={(file, range) => openLocalLink(file, range)}` needs no change once the types line up.

- [ ] **Step 8: Run to verify all the new tests pass**

Run: `npx vitest run --project component src/webview/detail/MarkdownPreview.svelte.test.ts && npx vitest run --project unit src/shared/protocol.unit.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared/locationLink.ts src/shared/locationLink.unit.test.ts src/shared/protocol.ts \
  src/shared/protocol.unit.test.ts src/webview/detail/MarkdownPreview.svelte \
  src/webview/detail/MarkdownPreview.svelte.test.ts src/webview/detail/state.ts \
  src/webview/detail/AnnotationView.svelte src/webview/detail/CommentThread.svelte \
  src/webview/detail/GroupView.svelte src/web/detailPanelProvider.ts src/web/extension.ts \
  src/web/navigateToCode.ts
git commit -m "feat(links): support file-only local links ([label](src/foo.ts))"
```

---

### Task 6: Left-align lists and blockquotes in the Markdown preview

**Files:**
- Modify: `src/webview/detail/MarkdownPreview.svelte:81-91` (`<style>` block)
- Test: `src/webview/detail/MarkdownPreview.svelte.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no API change (CSS only).

- [ ] **Step 1: Write the failing style test**

Append to `src/webview/detail/MarkdownPreview.svelte.test.ts`. Svelte's compiled component CSS is injected into the document by vite-plugin-svelte in this setup, so assert the emitted rules (this is robust in jsdom, unlike `getComputedStyle` on scoped selectors):

```ts
it('styles top-level lists and quotes flush-left', () => {
  render(MarkdownPreview, { source: '- one\n  - nested\n\n> quoted' });
  const css = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n')
    .replace(/\s+/g, ' ');
  // Lists indent by one small step per nesting level instead of the UA's 40px.
  expect(css).toMatch(/ul[^{]*{[^}]*padding-left: 1\.4em/);
  expect(css).toMatch(/ol[^{]*{[^}]*padding-left: 1\.4em/);
  // Quotes use a left border, not a 40px side margin.
  expect(css).toMatch(/blockquote[^{]*{[^}]*margin: 0\.5em 0/);
  expect(css).toMatch(/blockquote[^{]*{[^}]*border-left: 3px solid/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project component src/webview/detail/MarkdownPreview.svelte.test.ts`
Expected: FAIL — no `ul`/`ol`/`blockquote` rules exist.

If the assertion cannot see any component CSS at all (empty `css` string), that is an environment limit rather than a missing rule: replace the assertion with one that reads the raw component source (`readFileSync` is not allowed in `src/`, but it is fine inside a test) and asserts the same four rules are present in the `<style>` block. Keep the test — do not drop coverage.

- [ ] **Step 3: Implement the styles**

Add to the `<style>` block in `src/webview/detail/MarkdownPreview.svelte` (after the `pre` rule):

```css
  /* UA defaults indent lists 40px and quotes 40px on both sides; annotations read better
     flush-left, with nesting adding exactly one step and quotes marked by a left border. */
  .md-preview :global(ul), .md-preview :global(ol) { margin: 0.4em 0; padding-left: 1.4em; }
  .md-preview :global(li) { margin: 0.15em 0; }
  .md-preview :global(blockquote) {
    margin: 0.5em 0;
    padding: 0 0 0 8px;
    border-left: 3px solid var(--vscode-textBlockQuote-border, #454545);
    background: var(--vscode-textBlockQuote-background, transparent);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project component src/webview/detail/MarkdownPreview.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify visually**

Run `npm start`, open an annotation whose body has a top-level bullet list (with one nested item) and a blockquote. Confirm the first-level bullets and the quote start at the same left edge as body text, the nested item is indented one step, and comment bodies + the group description look the same.

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/MarkdownPreview.svelte src/webview/detail/MarkdownPreview.svelte.test.ts
git commit -m "fix(preview): left-align top-level lists and blockquotes"
```

---

### Task 7: Escape hover link labels

A snippet containing `]`, ending in `\`, or containing a backtick code span with `](` currently breaks the `command:` link so the raw Markdown shows in the hover.

**Files:**
- Modify: `src/core/gutterIndicators.ts:118-131` (`hoverMarkdown`)
- Test: `src/core/gutterIndicators.unit.test.ts`

**Interfaces:**
- Consumes: `hoverItems` (existing, unchanged).
- Produces: `hoverMarkdown(items)` output where every label is Markdown-escaped (`\`, `` ` ``, `[`, `]`).

- [ ] **Step 1: Write the failing tests**

Append to `src/core/gutterIndicators.unit.test.ts`. Render with markdown-it (already a dependency) to prove the link survives:

```ts
import MarkdownIt from 'markdown-it';

describe('hoverMarkdown label escaping', () => {
  const md = new MarkdownIt();
  const item = (label: string) => ({ label, groupId: 'g1', annotationId: 'a1' });

  function anchors(markdown: string): { href: string | null; text: string }[] {
    const html = md.render(markdown);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), text: a.textContent ?? '' }));
  }

  it('renders a plain label as one command link', () => {
    const [a, ...rest] = anchors(hoverMarkdown([item('Group · a note')]));
    expect(rest).toEqual([]);
    expect(a.href).toContain('command:annotated.openAnnotation?');
    expect(a.text).toBe('📝 Group · a note');
  });

  it('survives a stray closing bracket', () => {
    const [a] = anchors(hoverMarkdown([item('Group · items[0] and x]')]));
    expect(a.href).toContain('command:annotated.openAnnotation?');
    expect(a.text).toBe('📝 Group · items[0] and x]');
  });

  it('survives a label ending in a backslash', () => {
    const [a] = anchors(hoverMarkdown([item('Group · path C:\\\\tmp\\\\')]));
    expect(a.href).toContain('command:annotated.openAnnotation?');
  });

  it('survives a code span containing a link-ish sequence', () => {
    const [a] = anchors(hoverMarkdown([item('Group · see `x](y)` here')]));
    expect(a.href).toContain('command:annotated.openAnnotation?');
    expect(a.text).toBe('📝 Group · see `x](y)` here');
  });

  it('keeps each item a separate link', () => {
    const links = anchors(hoverMarkdown([item('One · a]'), item('Two · `b')]));
    expect(links.length).toBe(2);
  });
});
```

Note: `DOMParser` needs the jsdom environment. `gutterIndicators.unit.test.ts` runs in the `unit` (node) project, so add `// @vitest-environment jsdom` as the first line of the file **only if** the file has no other environment-sensitive assumptions; otherwise put these five tests in a new `src/core/hoverMarkdown.svelte.test.ts`-style component-project file. Prefer the simpler route: create `src/core/gutterHover.svelte.test.ts` (the `component` project already runs in jsdom) containing exactly these tests, importing `hoverMarkdown` from `./gutterIndicators`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project component src/core/gutterHover.svelte.test.ts`
Expected: FAIL — the bracket/backslash/code-span cases produce zero anchors (the whole construct renders as literal text).

- [ ] **Step 3: Implement the escaping**

In `src/core/gutterIndicators.ts`:

```ts
/**
 * Backslash-escape the characters that can break a Markdown link label: `\` (escapes the
 * closing bracket when trailing), `[`/`]` (end the label early), and backticks (a code span
 * outranks link parsing and can swallow the `](…)`). Emphasis markers cannot break bracket or
 * destination parsing, so `*`/`_` are left alone and still render.
 */
function escapeLinkLabel(text: string): string {
  return text.replace(/([\\`[\]])/g, '\\$1');
}
```

and use it in `hoverMarkdown`:

```ts
      return `[📝 ${escapeLinkLabel(it.label)}](command:annotated.openAnnotation?${args})`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project component src/core/gutterHover.svelte.test.ts`
Expected: PASS. Note the escaped backticks now render literally instead of as inline code — that is the intended trade for a link that always works.

- [ ] **Step 5: Run the gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/gutterIndicators.ts src/core/gutterHover.svelte.test.ts
git commit -m "fix(hover): escape Markdown in gutter-hover link labels"
```

---

### Task 8: Agent skill docs + CHANGELOG

The three agent-facing docs must describe whole-file annotations and file-only local links, and stay in lockstep (`skillContract.unit.test.ts` asserts the docs match the code).

**Files:**
- Modify: `skills/annotated/references/data-contract.md` (annotation shape, local-link rules)
- Modify: `skills/annotated/references/operations.md` (create-an-annotation operation)
- Modify: `skills/annotated/SKILL.md` (short mention where the annotation shape / links are summarized)
- Modify: `src/shared/skillContract.unit.test.ts` (assert the new documented shape)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the on-disk contract from Tasks 1–5 (`"range": null`, `"contentHash": ""`, file-only links).
- Produces: no code API.

- [ ] **Step 1: Write the failing contract test**

Append to `src/shared/skillContract.unit.test.ts` (it already reads the docs via `readFileSync` and has `CONTRACT_DOC` / `OPERATIONS_DOC` / `SKILL_DOC` constants):

```ts
describe('whole-file annotations are documented', () => {
  it('the data contract documents a null range + empty content hash', () => {
    const doc = readFileSync(CONTRACT_DOC, 'utf8');
    expect(doc).toContain('"range": null');
    expect(doc).toMatch(/whole-file annotation/i);
  });

  it('a whole-file annotation as documented round-trips through parseGroup', () => {
    const group = parseGroup({
      id: 'g', title: 'T', author: 'A', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a', file: 'src/foo.ts', range: null, content: 'note', contentHash: '' }],
    });
    expect(serializeGroup(group)).toContain('"range": null');
  });

  it('operations + SKILL mention whole-file annotations', () => {
    expect(readFileSync(OPERATIONS_DOC, 'utf8')).toMatch(/whole-file annotation/i);
    expect(readFileSync(SKILL_DOC, 'utf8')).toMatch(/whole-file/i);
  });

  it('the data contract documents file-only local links', () => {
    expect(readFileSync(CONTRACT_DOC, 'utf8')).toMatch(/\[[^\]]+\]\(src\/[^)#]+\.ts\)/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit src/shared/skillContract.unit.test.ts`
Expected: FAIL — the docs say nothing about whole-file annotations.

- [ ] **Step 3: Update the docs**

`skills/annotated/references/data-contract.md` — in the group JSON example, add a second annotation entry and a note:

```jsonc
    {
      "id": "9f1c0e2a-3b4d-4c5e-8f70-1a2b3c4d5e6f",
      "file": "src/auth/session.ts",              // workspace-relative POSIX path
      "range": null,                               // null (or omitted) = whole-file annotation
      "content": "This module owns session lifetime…",
      "contentHash": ""                            // no anchored lines → no hash
    }
```

> **Whole-file annotations** target a file as a whole rather than specific lines: write
> `"range": null` and `"contentHash": ""` (the content-hash recipe below does not apply). They
> open the file when clicked, never go "lines changed" stale, and draw no gutter indicator.
> A missing `range` key is read as `null`, but write the explicit `null`.

In the "Local links" section, add the file-only form and its rule:

- `[the session module](src/auth/session.ts)` — no `#L` fragment: opens the file.

> A target with no `#L` fragment is a local link only when it looks like a path (contains `/`
> or ends in a `.ext`); `[see above](whatever)` stays an ordinary link. A non-line fragment
> (`docs/adr.md#heading`) is also an ordinary link.

`skills/annotated/references/operations.md` — in the create-an-annotation operation, add:

> **Whole-file annotation:** when the note is about the file as a whole (its role, its
> invariants) rather than specific lines, set `"range": null` and `"contentHash": ""` and skip
> the hash recipe. Prefer a line range whenever the note is about specific code.

`skills/annotated/SKILL.md` — in the section that summarizes the annotation shape, add one line:

> An annotation anchors to a line range, or to the **whole file** (`"range": null`,
> `"contentHash": ""`).

- [ ] **Step 4: Run to verify the contract test passes**

Run: `npx vitest run --project unit src/shared/skillContract.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the CHANGELOG entry**

At the top of `CHANGELOG.md`, following the file's existing heading style, add an unreleased section:

```markdown
## Unreleased

### Added
- Annotations can target a **whole file** instead of a line range: new command
  "Annotated: Create File Annotation" (command palette + Explorer context menu), a
  "whole file" toggle in the annotation's range editor, and `"range": null` on disk.
  Whole-file annotations open the file when clicked, never go "lines changed" stale, and
  draw no gutter indicator.
- Local links in annotation and comment bodies may omit the line fragment —
  `[the session module](src/auth/session.ts)` opens the file.

### Fixed
- Top-level lists and blockquotes in the detail panel are no longer indented (nesting still
  indents one step per level).
- Gutter-hover entries whose snippet contained `]`, a trailing `\`, or a backtick code span
  showed raw Markdown instead of a clickable link.
```

- [ ] **Step 6: Run the full gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/annotated/SKILL.md skills/annotated/references/data-contract.md \
  skills/annotated/references/operations.md src/shared/skillContract.unit.test.ts CHANGELOG.md
git commit -m "docs(skill): document whole-file annotations and file-only local links"
```

---

## Final verification

- [ ] `npm run check-types` — PASS
- [ ] `npm run test:unit` — PASS
- [ ] `npm run test:integration -- --port 3123` — PASS (needs network; skip with a note if unavailable)
- [ ] Manual smoke in `npm start` (rebuild first so `dist/` is fresh): create a file annotation from the Explorer and from the palette; convert a line annotation to whole-file and back; click a file-only local link; check a body with lists/quotes; hover a gutter bar whose snippet contains `]`.
- [ ] Merge `ux-feedback-round-6` into `main` (fast-forward or merge commit), leave the push to the user, and report the recommended `0.5.0` release cut.
