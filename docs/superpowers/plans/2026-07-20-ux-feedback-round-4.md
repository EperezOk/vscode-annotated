# UX Feedback Round 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five feedback fixes — reliable Cmd+Z in the editors, a git-ref sidebar filter with auto-capture + better suggestions + Select All, text wrapping in the detail panel, absolute-path normalization, and skill docs for internal links.

**Architecture:** Each change extends an existing pattern. Pure logic lives in `src/shared` + `src/core` (no `vscode` import) and is unit-tested with Vitest; the thin VSCode layer is in `src/web`; Svelte webviews in `src/webview`. Component behavior is tested with `@testing-library/svelte`.

**Tech Stack:** TypeScript, Svelte 5 (runes), CodeMirror 6, Vitest, `@testing-library/svelte`, `@vscode/test-web` (integration), esbuild.

## Global Constraints

- **Web-compatible extension:** no Node built-ins (`fs`/`path`/etc.) in `src/`. Build paths with `vscode.Uri.joinPath` + manual string ops; do file I/O via the `FileSystem` abstraction / `vscode.workspace.fs`. (The `skillContract.unit.test.ts` file is a test and may use `node:*` — it already does.)
- **Local verification gate:** `npm run check-types` + `npm run test:unit` must pass. `npm run test:integration` / `test:e2e` download/serve a VSCode web build (network) — run when available; never block a commit on them locally.
- **Author identity for commits:** end each commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** all tasks land on `ux-feedback-round-4`. Do **not** push (the user pushes).
- **Pure layers stay pure:** files under `src/shared` / `src/core` must not `import * as vscode`.
- **JSON on disk:** unchanged — 2-space indent, no trailing newline, epoch-second timestamps.

---

## Task ordering & dependencies

Recommended order (each block is independently reviewable):

1. **Task 1** (undo) — independent.
2. **Task 2** (overflow CSS) — independent.
3. **Task 3** (`toWorkspaceRelativeSegments`) → **Task 4** (navigate wiring) — 4 depends on 3.
4. **Task 5** (git-ref pure logic) → **Task 6** (auto-capture) and **Task 7** (source + QuickPick) — 6 & 7 depend on 5; 6 and 7 touch disjoint files and may run in parallel.
5. **Task 8** (sidebar filter pure) → **Task 9** (filter UI) → **Task 10** (Select All) — 9 and 10 both edit `App.svelte` + `sidebar/state.ts`, so keep them **sequential**.
6. **Task 11** (skill docs) — last (references item-5's relative-path guidance).

---

## Task 1: Reliable Cmd+Z — contained history keymap

**Files:**
- Modify: `src/webview/detail/editorExtensions.ts`
- Modify: `src/webview/detail/MarkdownEditor.svelte:61-67`
- Test: `src/webview/detail/editorExtensions.unit.test.ts`

**Interfaces:**
- Produces: `export const containedHistoryKeymap: readonly KeyBinding[]` — the `@codemirror/commands` `historyKeymap` with `stopPropagation: true` added to every entry.

**Why:** `historyKeymap` sets only `preventDefault`, so in a VS Code webview Cmd+Z bubbles to the window-level keybinding forwarder and *also* fires the workbench Undo (double-dispatch). `markdownKeymap` already fixes this for Cmd+B/I/E with `stopPropagation: true`; do the same for undo/redo.

- [ ] **Step 1: Write the failing test**

Append to `src/webview/detail/editorExtensions.unit.test.ts`:

```ts
import { containedHistoryKeymap } from './editorExtensions';

describe('containedHistoryKeymap', () => {
  it('sets stopPropagation on every history binding (so Cmd+Z does not also fire workbench Undo)', () => {
    expect(containedHistoryKeymap.length).toBeGreaterThan(0);
    expect(containedHistoryKeymap.every((b) => b.stopPropagation === true)).toBe(true);
  });

  it('still binds the undo shortcut', () => {
    expect(containedHistoryKeymap.some((b) => b.key === 'Mod-z')).toBe(true);
  });
});
```

(If `editorExtensions.unit.test.ts` does not yet import `describe/it/expect`, add `import { describe, it, expect } from 'vitest';` at the top — match the existing header.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/webview/detail/editorExtensions.unit.test.ts`
Expected: FAIL — `containedHistoryKeymap` is not exported.

- [ ] **Step 3: Add the export**

In `src/webview/detail/editorExtensions.ts`, add the `historyKeymap` import and the new export near `markdownKeymap`:

```ts
import { historyKeymap } from '@codemirror/commands';
```

```ts
/**
 * historyKeymap (undo / redo / undoSelection / redoSelection) with `stopPropagation: true`
 * added to every binding — so Cmd+Z/Cmd+Shift+Z stay inside CodeMirror and do NOT bubble to
 * VS Code's window-level forwarder (which would ALSO fire the workbench "Undo"). Same fix as
 * `markdownKeymap` applies for Cmd+B/I/E; the upstream historyKeymap sets only preventDefault.
 */
export const containedHistoryKeymap: readonly KeyBinding[] = historyKeymap.map((b) => ({
  ...b,
  stopPropagation: true,
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/webview/detail/editorExtensions.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the editor**

In `src/webview/detail/MarkdownEditor.svelte`:
- Change the import on line 5 from `import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';` to `import { defaultKeymap, history } from '@codemirror/commands';`
- Add to the existing editorExtensions import on line 8: `containedHistoryKeymap` (e.g. `import { markdownKeymap, containedHistoryKeymap, urlPasteHandler, markdownHighlightStyle, fillHeightTheme } from './editorExtensions';`).
- In the keymap array (lines 61-67), replace `...historyKeymap,` with `...containedHistoryKeymap,`.

- [ ] **Step 6: Verify the whole unit suite + types**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/webview/detail/editorExtensions.ts src/webview/detail/editorExtensions.unit.test.ts src/webview/detail/MarkdownEditor.svelte
git commit -m "fix(editor): keep Cmd+Z inside CodeMirror (stopPropagation on history keymap)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wrap long unbroken tokens in the detail panel (CSS)

**Files:**
- Modify: `src/webview/detail/MarkdownPreview.svelte:82-91`
- Modify: `src/webview/sidebar/GroupCard.svelte:76-95`
- Modify: `src/webview/detail/GroupView.svelte:160-167`

**Why:** No content container sets `overflow-wrap`, so a long unbroken token (bare URL, long identifier, inline code, long title) overflows horizontally. Only `<pre>` scrolls, and it must keep doing so.

This task is **style-only** — there is no unit test. Verification is `npm run check-types` plus a manual smoke (below). State that honestly; do not claim a test tier.

- [ ] **Step 1: Wrap markdown-preview text**

In `src/webview/detail/MarkdownPreview.svelte`, update these style rules (leave the `pre` rule with its `overflow-x: auto` untouched):

```css
  .md-preview { font-size: 13px; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; }
```

```css
  .md-preview :global(code) { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 4px; border-radius: 3px; overflow-wrap: break-word; }
```

```css
  .md-preview :global(a) { color: var(--vscode-textLink-foreground, #3794ff); overflow-wrap: break-word; }
```

- [ ] **Step 2: Wrap sidebar card title/meta/chip**

In `src/webview/sidebar/GroupCard.svelte`, add `overflow-wrap: break-word;` to `.title`, `.meta`, and `.chip`:

```css
  .title {
    font-weight: 600;
    font-size: 12.5px;
    overflow-wrap: break-word;
  }
  .meta {
    color: var(--vscode-descriptionForeground, #9a9a9a);
    font-size: 11px;
    margin-top: 2px;
    overflow-wrap: break-word;
  }
  .chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 9px;
    overflow-wrap: break-word;
  }
```

- [ ] **Step 3: Wrap detail-panel group title + git-ref code**

In `src/webview/detail/GroupView.svelte`:

```css
  .title { font-size: 15px; font-weight: 600; color: var(--vscode-foreground, #eee); overflow-wrap: break-word; min-width: 0; }
```

```css
  .gitref-row code { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 6px; border-radius: 3px; overflow-wrap: break-word; word-break: break-word; }
```

(`min-width: 0` on `.title` lets it shrink inside the `display:flex` `.title-row` so wrapping actually engages.)

- [ ] **Step 4: Verify types + build**

Run: `npm run check-types && npm run test:unit`
Expected: PASS (no behavior change; confirms nothing broke).

- [ ] **Step 5: Manual smoke (record the result in the commit / report)**

Run the app (`/run` or `npm start`, opening the built `dist/`), then:
- Paste a long unbroken URL and a ~60-char no-space identifier into an annotation body → both **wrap** inside the panel; a fenced code block still **scrolls** horizontally.
- Create a group whose title is one long no-space string → the sidebar card title and the detail-panel header both wrap.

- [ ] **Step 6: Commit**

```bash
git add src/webview/detail/MarkdownPreview.svelte src/webview/sidebar/GroupCard.svelte src/webview/detail/GroupView.svelte
git commit -m "fix(webview): wrap long unbroken tokens in the detail panel and cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `toWorkspaceRelativeSegments` — accept absolute paths inside the workspace

**Files:**
- Modify: `src/shared/path.ts`
- Test: `src/shared/path.unit.test.ts`

**Interfaces:**
- Consumes: `safeRelativeSegments(path: string): string[] | null` (existing).
- Produces: `toWorkspaceRelativeSegments(input: string, workspaceRoot?: string): string[] | null` — an absolute path inside `workspaceRoot` → its relative segments; absolute-outside or no-root → `null`; a relative path → `safeRelativeSegments` behavior (rejects `..` escapes).

- [ ] **Step 1: Write the failing test**

Append to `src/shared/path.unit.test.ts`:

```ts
import { toWorkspaceRelativeSegments } from './path';

describe('toWorkspaceRelativeSegments', () => {
  it('splits a relative path just like safeRelativeSegments', () => {
    expect(toWorkspaceRelativeSegments('src/core/foo.ts', '/ws')).toEqual(['src', 'core', 'foo.ts']);
  });
  it('strips the workspace root from an absolute path inside it', () => {
    expect(toWorkspaceRelativeSegments('/ws/src/foo.ts', '/ws')).toEqual(['src', 'foo.ts']);
  });
  it('tolerates a trailing slash on the workspace root', () => {
    expect(toWorkspaceRelativeSegments('/ws/src/foo.ts', '/ws/')).toEqual(['src', 'foo.ts']);
  });
  it('normalizes backslashes before matching', () => {
    expect(toWorkspaceRelativeSegments('\\ws\\src\\foo.ts', '/ws')).toEqual(['src', 'foo.ts']);
  });
  it('returns null for an absolute path outside the workspace', () => {
    expect(toWorkspaceRelativeSegments('/other/foo.ts', '/ws')).toBeNull();
  });
  it('returns null for an absolute path when no workspace root is given', () => {
    expect(toWorkspaceRelativeSegments('/etc/passwd')).toBeNull();
  });
  it('returns null when an absolute path resolves to a "../" escape', () => {
    expect(toWorkspaceRelativeSegments('/ws/../etc/passwd', '/ws')).toBeNull();
  });
  it('returns null for a relative "../" escape', () => {
    expect(toWorkspaceRelativeSegments('../secrets.ts', '/ws')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/path.unit.test.ts`
Expected: FAIL — `toWorkspaceRelativeSegments` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/shared/path.ts`:

```ts
/**
 * Resolve `input` to safe workspace-relative segments for `vscode.Uri.joinPath`, accepting
 * ABSOLUTE paths that live inside `workspaceRoot` (normalized to relative). Returns null for an
 * absolute path with no root context or one that lies outside the root, and for any `..` escape.
 * A relative input falls through to `safeRelativeSegments` unchanged.
 */
export function toWorkspaceRelativeSegments(input: string, workspaceRoot?: string): string[] | null {
  const normalized = input.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized);
  if (!isAbsolute) {
    return safeRelativeSegments(normalized);
  }
  if (!workspaceRoot) {
    return null;
  }
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === root) {
    return [];
  }
  const prefix = `${root}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  // The remainder is relative; safeRelativeSegments still rejects any "../" escape.
  return safeRelativeSegments(normalized.slice(prefix.length));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/path.unit.test.ts`
Expected: PASS (existing `safeRelativeSegments` / `fileName` tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add src/shared/path.ts src/shared/path.unit.test.ts
git commit -m "feat(path): normalize absolute in-workspace paths to relative segments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Resolve absolute paths in navigation (annotations + local links)

**Files:**
- Modify: `src/web/navigateToCode.ts:69-88` (`revealLocation`), `:95-111` (`revealAnnotation`)
- Test: `src/shared/locationLink.unit.test.ts` (confirm POSIX-absolute parses)
- Test (integration tier, network): `src/web/test/suite/navigate.integration.test.ts`

**Interfaces:**
- Consumes: `toWorkspaceRelativeSegments(input, workspaceRoot)` from Task 3.

**Why:** `revealLocation` rejects any absolute path; `revealAnnotation` uses a raw `split('/')` that silently mis-joins an absolute annotation `file` under the workspace root. Route both through the Task-3 helper so an in-workspace absolute path resolves and an out-of-workspace one warns instead of misbehaving. `parseLocationLink` already accepts a leading-`/` POSIX absolute (no code change) — a confirming test locks that in; a Windows drive (`C:/…`) stays rejected (documented limitation).

- [ ] **Step 1: Confirm local-link parsing of absolute paths (characterization test)**

Add to `src/shared/locationLink.unit.test.ts`, inside the `describe('parseLocationLink', …)` block:

```ts
  it('accepts a leading-slash POSIX absolute path (normalized later at navigation)', () => {
    expect(parseLocationLink('/Users/me/repo/src/foo.ts#L5')).toEqual({
      file: '/Users/me/repo/src/foo.ts',
      range: { startLine: 5, endLine: 5 },
    });
  });
```

(The existing case at `locationLink.unit.test.ts:42-45` — `C:/foo.ts#L1` → null — stays as-is: Windows drive paths remain out of scope.)

- [ ] **Step 2: Run it to verify current behavior**

Run: `npx vitest run src/shared/locationLink.unit.test.ts`
Expected: PASS immediately — this documents existing behavior; no `locationLink.ts` change is needed.

- [ ] **Step 3: Route `revealLocation` through the helper**

In `src/web/navigateToCode.ts`, update the import on line 3 to:

```ts
import { toWorkspaceRelativeSegments } from '../shared/path';
```

In `revealLocation` (lines 69-74), replace the `safeRelativeSegments(file)` call:

```ts
export async function revealLocation(folderUri: vscode.Uri, file: string, range: LineRange): Promise<void> {
  const segments = toWorkspaceRelativeSegments(file, folderUri.path);
  if (!segments) {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${file}" (outside the workspace).`);
    return;
  }
```

(The rest of `revealLocation` is unchanged.)

- [ ] **Step 4: Route `revealAnnotation` through the helper (replace the raw split)**

In `revealAnnotation` (lines 95-111), replace the raw join with the safe helper + a warning on rejection:

```ts
export async function revealAnnotation(folderUri: vscode.Uri, annotation: Annotation): Promise<void> {
  const segments = toWorkspaceRelativeSegments(annotation.file, folderUri.path);
  if (!segments) {
    void vscode.window.showWarningMessage(`Annotated: cannot open "${annotation.file}" (outside the workspace).`);
    return;
  }
  const uri = vscode.Uri.joinPath(folderUri, ...segments);
  const range = new vscode.Range(
    annotation.range.startLine - 1,
    0,
    annotation.range.endLine - 1,
    Number.MAX_SAFE_INTEGER,
  );

  clearHighlight();
  clearLinkHighlight(); // re-anchoring on the annotation drops any stale link-target highlight

  const editor = await vscode.window.showTextDocument(uri, { selection: range, preserveFocus: true });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(decorationType(), [range]);
  lastEditor = editor;
}
```

- [ ] **Step 5: Add an integration case (integration tier)**

In `src/web/test/suite/navigate.integration.test.ts`, following the file's existing `revealLocation` / `revealAnnotation` setup (workspace folder fixture + `showTextDocument` assertions), add cases that:
- an annotation whose `file` is the **absolute** form of an in-workspace file (`folder.uri.path + '/' + relPath`) opens the **same** document as its relative form;
- an out-of-workspace absolute `file` (e.g. `/tmp/elsewhere.ts`) does **not** open a document and triggers a warning (spy/stub `vscode.window.showWarningMessage`).

Match the existing harness's helpers and assertion style in that file.

- [ ] **Step 6: Verify types + unit suite (local gate)**

Run: `npm run check-types && npm run test:unit`
Expected: PASS. (The integration case runs under `npm run test:integration` when network is available.)

- [ ] **Step 7: Commit**

```bash
git add src/web/navigateToCode.ts src/shared/locationLink.unit.test.ts src/web/test/suite/navigate.integration.test.ts
git commit -m "feat(navigate): resolve absolute in-workspace paths; warn on out-of-workspace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Git-ref pure logic — `currentRef` + richer suggestions

**Files:**
- Modify: `src/core/gitRefs.ts`
- Test: `src/core/gitRefs.unit.test.ts`

**Interfaces:**
- Produces:
  - `GitRefInfo` gains `headBranch?: string`, `remoteBranches?: string[]`, `commits?: { sha: string; summary: string }[]` (all optional; absent ⇒ empty).
  - `currentRef(info: GitRefInfo): string | null` — `headBranch` if set, else short (7-char) `headSha`, else `null`.
  - `gitRefSuggestions(info)` extended: HEAD short SHA → local branches → remote branches (`description: 'remote branch'`) → tags → recent commits (`{ ref: sha, label: '<sha> — <summary>', description: 'commit' }`).

- [ ] **Step 1: Write the failing tests**

Append to `src/core/gitRefs.unit.test.ts`:

```ts
import { currentRef } from './gitRefs';

describe('currentRef', () => {
  it('prefers the current branch name', () => {
    expect(currentRef({ headBranch: 'feature/x', headSha: 'abcdef1234', branches: [], tags: [] })).toBe('feature/x');
  });
  it('falls back to the short HEAD SHA when detached', () => {
    expect(currentRef({ headSha: 'abcdef1234567', branches: [], tags: [] })).toBe('abcdef1');
  });
  it('returns null when there is no ref info', () => {
    expect(currentRef({ branches: [], tags: [] })).toBeNull();
  });
});

describe('gitRefSuggestions — remote branches and recent commits', () => {
  it('lists HEAD, local branches, remote branches, tags, then recent commits', () => {
    const out = gitRefSuggestions({
      headSha: 'abcdef1234567890',
      branches: ['main'],
      remoteBranches: ['origin/main'],
      tags: ['v1.0'],
      commits: [{ sha: '1234567', summary: 'fix things' }],
    });
    expect(out).toEqual([
      { ref: 'abcdef1', label: 'abcdef1', description: 'current commit (HEAD)' },
      { ref: 'main', label: 'main', description: 'branch' },
      { ref: 'origin/main', label: 'origin/main', description: 'remote branch' },
      { ref: 'v1.0', label: 'v1.0', description: 'tag' },
      { ref: '1234567', label: '1234567 — fix things', description: 'commit' },
    ]);
  });

  it('still works when the new optional fields are absent', () => {
    expect(gitRefSuggestions({ branches: ['main'], tags: [] })).toEqual([
      { ref: 'main', label: 'main', description: 'branch' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/gitRefs.unit.test.ts`
Expected: FAIL — `currentRef` not exported; new fields not handled.

- [ ] **Step 3: Implement**

Replace the contents of `src/core/gitRefs.ts` with:

```ts
export interface GitRefInfo {
  /** Full HEAD commit SHA, if a repo/commit is available. */
  headSha?: string;
  /** Current branch name (undefined when detached / unavailable). */
  headBranch?: string;
  branches: string[];
  /** Remote-tracking branch names (e.g. "origin/main"); absent ⇒ none. */
  remoteBranches?: string[];
  tags: string[];
  /** Recent commits, newest first; absent ⇒ none. `sha` is already short. */
  commits?: { sha: string; summary: string }[];
}

export interface RefSuggestion {
  /** The value to store as the group's gitRef. */
  ref: string;
  /** Display label. */
  label: string;
  /** Display description (kind). */
  description: string;
}

/** The ref to auto-capture for a new group: current branch, else short HEAD SHA, else null. */
export function currentRef(info: GitRefInfo): string | null {
  if (info.headBranch) {
    return info.headBranch;
  }
  if (info.headSha) {
    return info.headSha.slice(0, 7);
  }
  return null;
}

/** Build Git-ref picker suggestions: HEAD, local branches, remote branches, tags, recent commits. */
export function gitRefSuggestions(info: GitRefInfo): RefSuggestion[] {
  const suggestions: RefSuggestion[] = [];
  if (info.headSha) {
    const short = info.headSha.slice(0, 7);
    suggestions.push({ ref: short, label: short, description: 'current commit (HEAD)' });
  }
  for (const branch of info.branches) {
    suggestions.push({ ref: branch, label: branch, description: 'branch' });
  }
  for (const branch of info.remoteBranches ?? []) {
    suggestions.push({ ref: branch, label: branch, description: 'remote branch' });
  }
  for (const tag of info.tags) {
    suggestions.push({ ref: tag, label: tag, description: 'tag' });
  }
  for (const c of info.commits ?? []) {
    suggestions.push({ ref: c.sha, label: `${c.sha} — ${c.summary}`, description: 'commit' });
  }
  return suggestions;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/gitRefs.unit.test.ts`
Expected: PASS (the pre-existing suggestion tests still pass — new fields are optional).

- [ ] **Step 5: Commit**

```bash
git add src/core/gitRefs.ts src/core/gitRefs.unit.test.ts
git commit -m "feat(git-refs): add currentRef + remote-branch/commit suggestions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Auto-capture the git ref when creating a group

**Files:**
- Modify: `src/core/createAnnotationFlow.ts`
- Modify: `src/web/createAnnotationCommand.ts`
- Test: `src/core/createAnnotationFlow.unit.test.ts`

**Interfaces:**
- Consumes: `currentRef` + `readGitRefInfo` (via the command wiring).
- Produces: `CreateAnnotationDeps` gains `getGitRef(): Promise<string | null>`; a **new** group is created with that ref. Appending to an existing group does not touch its ref.

**Note:** `createGroup` (`src/core/annotationFactory.ts`) already accepts an optional `gitRef` (defaults to `null`) — pass it through; no factory change needed.

- [ ] **Step 1: Write the failing tests**

In `src/core/createAnnotationFlow.unit.test.ts`, add `getGitRef` to the `deps()` factory defaults (inside the returned object, before `...overrides`):

```ts
    getGitRef: async () => null,
```

Then add tests inside `describe('runCreateAnnotation', …)`:

```ts
  it('captures the current git ref on a new group', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    await runCreateAnnotation(deps({ getGitRef: async () => 'feature/login', saveGroup }));
    expect((saveGroup.mock.calls[0][0] as AnnotationGroup).gitRef).toBe('feature/login');
  });

  it('leaves gitRef null on a new group when no ref is available', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    await runCreateAnnotation(deps({ getGitRef: async () => null, saveGroup }));
    expect((saveGroup.mock.calls[0][0] as AnnotationGroup).gitRef).toBeNull();
  });

  it('does not capture a ref when appending to an existing group', async () => {
    const existing = createGroup({ id: 'g1', title: 'Existing', author: 'A', tags: [], now: 1 });
    const getGitRef = vi.fn(async () => 'feature/login');
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    await runCreateAnnotation(
      deps({ listGroups: async () => [existing], pickGroup: async () => ({ kind: 'existing', id: 'g1' }), getGitRef, saveGroup }),
    );
    expect(getGitRef).not.toHaveBeenCalled();
    expect((saveGroup.mock.calls[0][0] as AnnotationGroup).gitRef).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: FAIL — `getGitRef` is not on `CreateAnnotationDeps` / not passed to `createGroup`.

- [ ] **Step 3: Thread the ref through the flow**

In `src/core/createAnnotationFlow.ts`:
- Add to the `CreateAnnotationDeps` interface (after `hashContent`):

```ts
  /** Git ref to record on a NEW group (branch/tag/SHA), or null. */
  getGitRef(): Promise<string | null>;
```

- In `runCreateAnnotation`, in the new-group branch (currently lines 85-88), fetch and pass the ref:

```ts
  const author = await deps.resolveAuthor();
  const gitRef = await deps.getGitRef();
  const now = deps.now();
  const base = createGroup({ id: deps.newId(), title, author, tags, now, gitRef });
  const group = addAnnotation(base, annotation, now);
```

(If TypeScript reports `gitRef` is not accepted by `createGroup`, add `gitRef?: string | null` to `CreateGroupInput` in `src/core/annotationFactory.ts` — it is already stored as `gitRef: input.gitRef ?? null`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the real ref source into the command**

In `src/web/createAnnotationCommand.ts`:
- Add imports:

```ts
import { readGitRefInfo } from './gitRefsSource';
import { currentRef } from '../core/gitRefs';
```

- Add to the `deps` object (after `hashContent`):

```ts
      getGitRef: async () => currentRef(await readGitRefInfo()),
```

- [ ] **Step 6: Verify types + unit suite**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/createAnnotationFlow.ts src/core/createAnnotationFlow.unit.test.ts src/web/createAnnotationCommand.ts src/core/annotationFactory.ts
git commit -m "feat(create): auto-capture the current git ref on new groups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Only `git add` `annotationFactory.ts` if you edited it in Step 3.)

---

## Task 7: Git-ref source + QuickPick — remote branches, recent commits, store the ref

**Files:**
- Modify: `src/web/gitRefsSource.ts`
- Modify: `src/web/extension.ts:170-203` (`onBulkEditGitRef`), `:272-298` (`onEditGitRef`)

**Interfaces:**
- Consumes: `GitRefInfo` (Task 5) with `headBranch`, `remoteBranches`, `commits`; `gitRefSuggestions` (Task 5) where a commit's `ref` (short sha) differs from its `label`.

**Why:** `readGitRefInfo` only reads local branches + tags + one HEAD SHA and never the branch name or recent commits; and the QuickPicks store `picked.label`, which is wrong for commits (label = `sha — summary`, ref = `sha`). This is VSCode-layer glue over the built-in `vscode.git` extension — verified by `check-types` (no unit tier; it reads a live extension).

- [ ] **Step 1: Extend the git-ref source**

In `src/web/gitRefsSource.ts`, widen the interfaces and read the extra data:

```ts
interface GitRepository {
  readonly state: {
    readonly HEAD?: { readonly commit?: string; readonly name?: string };
    readonly refs: readonly GitRef[];
  };
  log(options?: { readonly maxEntries?: number }): Promise<readonly { readonly hash: string; readonly message: string }[]>;
}
```

Replace the body of `readGitRefInfo`'s `try` block (the ref-collection loop and return) with:

```ts
    const repo = ext.exports.getAPI(1).repositories[0];
    if (!repo) {
      return empty;
    }
    const branches: string[] = [];
    const remoteBranches: string[] = [];
    const tags: string[] = [];
    for (const ref of repo.state.refs) {
      if (ref.type === 0 && ref.name) {
        branches.push(ref.name);
      } else if (ref.type === 1 && ref.name) {
        remoteBranches.push(ref.name);
      } else if (ref.type === 2 && ref.name) {
        tags.push(ref.name);
      }
    }
    let commits: { sha: string; summary: string }[] = [];
    try {
      const log = await repo.log({ maxEntries: 20 });
      commits = log.map((c) => ({ sha: c.hash.slice(0, 7), summary: c.message.split('\n')[0] }));
    } catch {
      commits = [];
    }
    return {
      headSha: repo.state.HEAD?.commit,
      headBranch: repo.state.HEAD?.name,
      branches,
      remoteBranches,
      tags,
      commits,
    };
```

Update the `empty` fallback so the shape stays consistent (optional fields may be omitted; keep it minimal):

```ts
  const empty: GitRefInfo = { branches: [], tags: [] };
```

(unchanged — `remoteBranches`/`commits`/`headBranch` are optional).

- [ ] **Step 2: Store the ref (not the label) in the QuickPicks**

In `src/web/extension.ts`, define a QuickPick item type that carries the ref. Add near the top of the file's other local interfaces (or just above the first handler that uses it):

```ts
interface GitRefQuickPickItem extends vscode.QuickPickItem {
  ref?: string;
}
```

In `onBulkEditGitRef` (lines 179-197), build items with `ref` and read it back:

```ts
    const picked = await vscode.window.showQuickPick<GitRefQuickPickItem>(
      [
        { label: CLEAR },
        { label: CUSTOM },
        ...suggestions.map((s) => ({ label: s.label, description: s.description, ref: s.ref })),
      ],
      { placeHolder: `Set the Git ref on ${groupIds.length} group(s)` },
    );
    if (!picked) {
      return;
    }
    let gitRef: string | null;
    if (picked.label === CLEAR) {
      gitRef = null;
    } else if (picked.label === CUSTOM) {
      const custom = await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA)' });
      if (custom === undefined) {
        return;
      }
      gitRef = custom.trim() === '' ? null : custom.trim();
    } else {
      gitRef = picked.ref ?? picked.label;
    }
```

In `onEditGitRef` (lines 279-290), do the same for the picked suggestion:

```ts
      const picked = await vscode.window.showQuickPick<GitRefQuickPickItem>(
        [
          { label: CLEAR },
          { label: CUSTOM },
          ...suggestions.map((s) => ({ label: s.label, description: s.description, ref: s.ref })),
        ],
        { placeHolder: 'Set the group’s Git ref' },
      );
      if (!picked) {
        return;
      }
      if (picked.label === CLEAR) {
        await patchGroup(groupId, { gitRef: null });
        return;
      }
      ref = picked.label === CUSTOM ? await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA)' }) : (picked.ref ?? picked.label);
```

- [ ] **Step 3: Verify types + unit suite**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/gitRefsSource.ts src/web/extension.ts
git commit -m "feat(git-refs): offer remote branches + recent commits; store ref not label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Sidebar git-ref filter — pure state logic

**Files:**
- Modify: `src/core/sidebarState.ts`
- Test: `src/core/sidebarState.unit.test.ts`

**Interfaces:**
- Produces:
  - `SidebarState` gains `selectedGitRefs: string[]`.
  - `availableGitRefs(groups: AnnotationGroup[]): string[]` — sorted, de-duped, non-null `gitRef`s.
  - `filterGroups` gains a git-ref clause (AND with the other facets; groups whose `gitRef` is not selected are dropped when any ref is selected).
  - `applyHostMessage` prunes `selectedGitRefs` to refs that still exist.

- [ ] **Step 1: Update the failing tests**

In `src/core/sidebarState.unit.test.ts`:
- Extend the `group()` helper signature to accept a `gitRef` option, and set it:

```ts
function group(
  id: string,
  opts: { author?: string; tags?: { name: string; color: string }[]; status?: 'open' | 'resolved'; gitRef?: string } = {},
): AnnotationGroup {
  return {
    id, title: id, author: opts.author ?? 'A', tags: opts.tags ?? [],
    gitRef: opts.gitRef ?? null, status: opts.status ?? 'open', createdAt: 1, updatedAt: 1, annotations: [],
  };
}
```

- Update the `initialSidebarState` assertion to include the new field:

```ts
    expect(initialSidebarState()).toEqual({
      groups: [], palette: [], selectedId: null,
      selectedTags: [], selectedAuthors: [], selectedGitRefs: [], showResolved: false,
      bulkMode: false, selectedGroupIds: [], commentCounts: {},
    });
```

- Add `availableGitRefs` to the import on line 2, and add tests:

```ts
describe('availableGitRefs', () => {
  it('returns sorted, de-duplicated non-null git refs', () => {
    const groups = [group('g1', { gitRef: 'main' }), group('g2', { gitRef: 'dev' }), group('g3', { gitRef: 'main' }), group('g4')];
    expect(availableGitRefs(groups)).toEqual(['dev', 'main']);
  });
});

describe('filterGroups by git ref', () => {
  const base = initialSidebarState();
  const groups = [group('on-main', { gitRef: 'main' }), group('on-dev', { gitRef: 'dev' }), group('no-ref')];
  it('keeps only groups whose gitRef is selected', () => {
    expect(filterGroups({ ...base, groups, selectedGitRefs: ['main'] }).map((g) => g.id)).toEqual(['on-main']);
  });
  it('ANDs the git-ref facet with authors', () => {
    const g2 = [group('a-main', { author: 'Ana', gitRef: 'main' }), group('z-main', { author: 'Zoe', gitRef: 'main' })];
    expect(filterGroups({ ...base, groups: g2, selectedGitRefs: ['main'], selectedAuthors: ['Ana'] }).map((g) => g.id)).toEqual(['a-main']);
  });
});

describe('applyHostMessage prunes git-ref filter', () => {
  it('drops selected git refs no longer present', () => {
    const state = { ...initialSidebarState(), selectedGitRefs: ['main', 'gone'] };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g1', { gitRef: 'main' })], palette: [] });
    expect(next.selectedGitRefs).toEqual(['main']);
  });
});
```

- Add `availableGitRefs` to the destructured import from `./sidebarState` on line 2.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/sidebarState.unit.test.ts`
Expected: FAIL — `selectedGitRefs` / `availableGitRefs` don't exist; `initialSidebarState` shape mismatch.

- [ ] **Step 3: Implement**

In `src/core/sidebarState.ts`:
- Add to the `SidebarState` interface (after `selectedAuthors`):

```ts
  selectedGitRefs: string[];
```

- Add to `initialSidebarState` (after `selectedAuthors: []`):

```ts
    selectedGitRefs: [],
```

so the returned object is:

```ts
  return { groups: [], palette: [], selectedId: null, selectedTags: [], selectedAuthors: [], selectedGitRefs: [], showResolved: false, bulkMode: false, selectedGroupIds: [], commentCounts: {} };
```

- In `applyHostMessage`'s `setState` case, compute the ref set and prune:

```ts
      const gitRefs = new Set(message.groups.map((g) => g.gitRef).filter((r): r is string => r !== null));
```

and add to the returned object (after `selectedAuthors: …`):

```ts
        selectedGitRefs: state.selectedGitRefs.filter((r) => gitRefs.has(r)),
```

- Add the helper (next to `availableAuthors`):

```ts
/** Sorted, de-duplicated non-null git refs across all groups (filter options). */
export function availableGitRefs(groups: AnnotationGroup[]): string[] {
  return [...new Set(groups.map((g) => g.gitRef).filter((r): r is string => r !== null))].sort();
}
```

- Add the clause to `filterGroups` (after the author clause, before `return true`):

```ts
    if (state.selectedGitRefs.length > 0 && (g.gitRef === null || !state.selectedGitRefs.includes(g.gitRef))) {
      return false;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/sidebarState.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sidebarState.ts src/core/sidebarState.unit.test.ts
git commit -m "feat(sidebar): add git-ref filter dimension to sidebar state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Sidebar git-ref filter — UI wiring

**Files:**
- Modify: `src/webview/sidebar/state.ts`
- Modify: `src/webview/sidebar/FilterBar.svelte`
- Modify: `src/webview/sidebar/App.svelte`
- Test: `src/webview/sidebar/FilterBar.svelte.test.ts`
- Test: `src/webview/sidebar/App.svelte.test.ts`

**Interfaces:**
- Consumes: `availableGitRefs`, `SidebarState.selectedGitRefs` (Task 8).
- Produces: `toggleGitRefFilter(ref: string)` store action; a "Git ref" `FilterPicker` in `FilterBar`.

- [ ] **Step 1: Write the failing FilterBar test**

In `src/webview/sidebar/FilterBar.svelte.test.ts`, extend `base` and add a test:

```ts
const base = {
  tags: [] as string[], authors: [] as string[], gitRefs: [] as string[],
  selectedTags: [] as string[], selectedAuthors: [] as string[], selectedGitRefs: [] as string[],
  showResolved: false, palette: [] as { name: string; color: string }[],
};
```

```ts
  it('toggles a git ref when chosen from the git ref picker', async () => {
    const ontogglegitref = vi.fn();
    render(FilterBar, { ...base, gitRefs: ['main'], ontogglegitref });
    await userEvent.click(screen.getByTestId('picker-input-Git ref'));
    await userEvent.click(screen.getByRole('option', { name: 'main' }));
    expect(ontogglegitref).toHaveBeenCalledWith('main');
  });
```

- [ ] **Step 2: Write the failing App test**

In `src/webview/sidebar/App.svelte.test.ts`, add:

```ts
  it('filters by git ref selected from the dropdown', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [
        { ...group('g1', 'On main'), gitRef: 'main' },
        { ...group('g2', 'On dev'), gitRef: 'dev' },
      ],
      palette: [],
    });
    render(App);
    await userEvent.click(screen.getByTestId('picker-input-Git ref'));
    await userEvent.click(screen.getByRole('option', { name: 'main' }));
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('On main');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/webview/sidebar/FilterBar.svelte.test.ts src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL — no "Git ref" picker rendered.

- [ ] **Step 4: Add the store action**

In `src/webview/sidebar/state.ts`, after `toggleAuthorFilter` (line 26):

```ts
/** Toggle a git ref in the active git-ref filter. */
export function toggleGitRefFilter(ref: string): void {
  sidebar.update((state) => ({ ...state, selectedGitRefs: toggleInList(state.selectedGitRefs, ref) }));
}
```

- [ ] **Step 5: Add the picker to FilterBar**

In `src/webview/sidebar/FilterBar.svelte`, add `gitRefs`, `selectedGitRefs`, `ontogglegitref` to the props block:

```ts
  let {
    tags,
    authors,
    gitRefs,
    selectedTags,
    selectedAuthors,
    selectedGitRefs,
    showResolved,
    palette = [],
    ontoggletag,
    ontoggleauthor,
    ontogglegitref,
    onshowresolved,
  }: {
    tags: string[];
    authors: string[];
    gitRefs: string[];
    selectedTags: string[];
    selectedAuthors: string[];
    selectedGitRefs: string[];
    showResolved: boolean;
    palette?: TagColor[];
    ontoggletag?: (tag: string) => void;
    ontoggleauthor?: (author: string) => void;
    ontogglegitref?: (ref: string) => void;
    onshowresolved?: (value: boolean) => void;
  } = $props();
```

Then add the picker after the Authors block (after line 48, before the `.resolved-toggle` label):

```svelte
  {#if gitRefs.length > 0}
    <FilterPicker
      label="Git ref"
      options={gitRefs}
      selected={selectedGitRefs}
      onToggle={ontogglegitref}
      placeholder="Filter by git ref…"
    />
  {/if}
```

- [ ] **Step 6: Wire it in App.svelte**

In `src/webview/sidebar/App.svelte`:
- Add `toggleGitRefFilter` to the `./state` import (line 3) and `availableGitRefs` to the `../../core/sidebarState` import (line 5).
- Add a derived list (after line 11):

```ts
  const gitRefs = $derived(availableGitRefs($sidebar.groups));
```

- Pass the new props to `<FilterBar>` (lines 52-62):

```svelte
      <FilterBar
        {tags}
        {authors}
        {gitRefs}
        selectedTags={$sidebar.selectedTags}
        selectedAuthors={$sidebar.selectedAuthors}
        selectedGitRefs={$sidebar.selectedGitRefs}
        showResolved={$sidebar.showResolved}
        palette={$sidebar.palette}
        ontoggletag={toggleTagFilter}
        ontoggleauthor={toggleAuthorFilter}
        ontogglegitref={toggleGitRefFilter}
        onshowresolved={setShowResolved}
      />
```

- [ ] **Step 7: Run tests + types**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/webview/sidebar/state.ts src/webview/sidebar/FilterBar.svelte src/webview/sidebar/App.svelte src/webview/sidebar/FilterBar.svelte.test.ts src/webview/sidebar/App.svelte.test.ts
git commit -m "feat(sidebar): git-ref filter picker in the filter bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: "Select All" in bulk-select mode

**Files:**
- Modify: `src/webview/sidebar/state.ts`
- Modify: `src/webview/sidebar/App.svelte`
- Test: `src/webview/sidebar/App.svelte.test.ts`

**Interfaces:**
- Produces: `selectAll(ids: string[])` and `clearSelection()` store actions; a `bulk-select-all` control in the bulk action bar that targets the **currently visible/filtered** groups.

- [ ] **Step 1: Write the failing tests**

In `src/webview/sidebar/App.svelte.test.ts`, add:

```ts
  it('selects all visible groups then clears the selection', async () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One'), group('g2', 'Two')], palette: [], bulkMode: true });
    render(App);
    const btn = screen.getByTestId('bulk-select-all');
    expect(btn).toHaveTextContent('Select all (2)');
    await userEvent.click(btn);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');
    expect(btn).toHaveTextContent('Clear');
    await userEvent.click(btn);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 selected');
  });

  it('select all targets only the visible (filtered) groups', async () => {
    sidebar.set({
      ...initialSidebarState(),
      groups: [group('g1', 'Open'), group('g2', 'Resolved', { status: 'resolved' })],
      palette: [], bulkMode: true, // showResolved stays false → the resolved group is hidden
    });
    render(App);
    expect(screen.getByTestId('bulk-select-all')).toHaveTextContent('Select all (1)');
    await userEvent.click(screen.getByTestId('bulk-select-all'));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL — no `bulk-select-all` element.

- [ ] **Step 3: Add the store actions**

In `src/webview/sidebar/state.ts`, after `toggleGroupSelection` (line 41):

```ts
/** Select exactly the given group ids (used by "Select all" over the visible set). */
export function selectAll(ids: string[]): void {
  sidebar.update((state) => ({ ...state, selectedGroupIds: ids }));
}

/** Clear the bulk selection without leaving bulk mode. */
export function clearSelection(): void {
  sidebar.update((state) => ({ ...state, selectedGroupIds: [] }));
}
```

- [ ] **Step 4: Add the control to the bulk bar**

In `src/webview/sidebar/App.svelte`:
- Add `selectAll, clearSelection` to the `./state` import (line 3).
- Add a derived flag (after the `gitRefs` derived from Task 9, or after line 11):

```ts
  const allVisibleSelected = $derived(visible.length > 0 && visible.every((g) => $sidebar.selectedGroupIds.includes(g.id)));
```

- In the bulk action bar, add the button immediately after the `bulk-count` span (line 45):

```svelte
        <button type="button" class="bbtn" data-testid="bulk-select-all" onclick={() => (allVisibleSelected ? clearSelection() : selectAll(visible.map((g) => g.id)))}>
          {allVisibleSelected ? 'Clear' : `Select all (${visible.length})`}
        </button>
```

- [ ] **Step 5: Run tests + types**

Run: `npm run check-types && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/sidebar/state.ts src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts
git commit -m "feat(sidebar): Select all / Clear in bulk-select mode (visible groups)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Teach the agent skill to author internal links

**Files:**
- Modify: `skills/annotated/references/data-contract.md`
- Modify: `skills/annotated/references/operations.md`
- Modify: `skills/annotated/SKILL.md`
- Test: `src/shared/skillContract.unit.test.ts`

**Why:** The local-link feature (`[label](path#L10-L20)`) is undocumented in the skill, so agents never use it. Document the syntax (keeping workspace-relative paths as the canonical, portable form) and guard the two references against drift.

- [ ] **Step 1: Write the failing drift-guard test**

In `src/shared/skillContract.unit.test.ts`, add a describe block (near the existing "doc covers group comments" block):

```ts
describe('annotated contract: docs cover local links', () => {
  it('data-contract.md documents the local-link line fragment', () => {
    const doc = readFileSync(CONTRACT_DOC, 'utf8');
    expect(doc).toMatch(/#L10-L20/);
  });
  it('operations.md documents authoring local links', () => {
    const ops = readFileSync(OPERATIONS_DOC, 'utf8');
    expect(ops).toMatch(/#L/);
    expect(ops.toLowerCase()).toMatch(/local link/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/skillContract.unit.test.ts`
Expected: FAIL — the docs don't mention local links yet.

- [ ] **Step 3: Document the syntax in data-contract.md**

In `skills/annotated/references/data-contract.md`, add this section after the Group schema block (after the `> "annotations": []` note, before the Comment-file section):

```markdown
## Local links in annotation content

An annotation's `content` (and comment bodies) may reference **other** code
locations with a Markdown link whose target is a workspace-relative path plus a
GitHub-style `#L` line fragment — the extension turns these into click-to-reveal
links in the detail panel:

- `[the retry helper](src/core/retry.ts#L42)` — single line (line 42).
- `[the login flow](src/auth/login.ts#L10-L20)` — range, 1-based inclusive.

Rules: the path is **workspace-relative POSIX** (write relative for portable,
shareable annotations); line numbers are 1-based inclusive. A target with an
`http(s)`/`scheme:` prefix or without an `#L` fragment is treated as a normal
link, not a local link.
```

- [ ] **Step 4: Document usage in operations.md**

In `skills/annotated/references/operations.md` §3 (create), add a bullet under composing annotation `content` (in step 1, or as a new note right after the step-1 paragraph):

```markdown
- **Reference other code with local links instead of extra annotations.** When a
  note needs to point at a *different* location (a call site, a related type,
  prior art), embed a local link `[label](path/to/file.ts#L10-L20)` in the
  `content` rather than creating a separate annotation just to point there. Keep
  the annotation's own `file`/`range` for the code the note is *about*. Paths are
  workspace-relative POSIX; line ranges are 1-based inclusive. See
  `data-contract.md` → "Local links in annotation content".
```

- [ ] **Step 5: Add a pointer in SKILL.md**

In `skills/annotated/SKILL.md`, under "How to work", add a line after item 2:

```markdown
3. When composing annotation `content`, use **local links**
   (`[label](path/to/file.ts#L10-L20)`) to reference other code locations instead
   of adding extra annotations — see `references/data-contract.md` → "Local links
   in annotation content".
```

- [ ] **Step 6: Run the test + full unit suite**

Run: `npx vitest run src/shared/skillContract.unit.test.ts && npm run test:unit`
Expected: PASS (the existing contract guards still pass — only additive doc content).

- [ ] **Step 7: Commit**

```bash
git add skills/annotated/references/data-contract.md skills/annotated/references/operations.md skills/annotated/SKILL.md src/shared/skillContract.unit.test.ts
git commit -m "docs(skill): document local links for agents (+ drift guard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full local gate: `npm run check-types && npm run test:unit` → all green.
- [ ] If network is available: `npm run test:integration` (covers the Task-4 navigation cases and the git-ref bulk update).
- [ ] Manual smoke for the style-only Task 2 (see its Step 5) and, ideally, a quick end-to-end check of the git-ref filter + Select All in the running app.
- [ ] Merge `ux-feedback-round-4` → `main` locally (fast-forward / merge). **Do not push** — leave that to the user.

## Self-review notes (traceability)

- Spec item 1 (undo) → Task 1. Item 2 (skill links) → Task 11. Item 3a (auto-capture) → Task 6. Item 3b (suggestions) → Tasks 5 + 7. Item 3c (filter) → Tasks 8 + 9. Item 3d (Select All) → Task 10. Item 4 (overflow) → Task 2. Item 5 (absolute paths) → Tasks 3 + 4.
- Type consistency: `GitRefInfo` optional fields (`headBranch`, `remoteBranches`, `commits`) defined in Task 5, consumed in Tasks 6 (`currentRef`) and 7 (`readGitRefInfo`/`gitRefSuggestions`). `selectedGitRefs` / `availableGitRefs` defined in Task 8, consumed in Task 9. `selectAll`/`clearSelection` defined + consumed in Task 10. `toWorkspaceRelativeSegments` defined in Task 3, consumed in Task 4.
