# UX Feedback Round 5 — Design

**Date:** 2026-07-21
**Status:** Approved (design decisions locked with the user below)

## Summary

Two defects surfaced by desktop testing of the 0.4.0 release. Both are
**correctness** fixes, not new features:

1. **Git ref never works** — suggestions don't show and the current ref isn't
   auto-captured on group creation, on *every* host (web **and** desktop).
2. **Annotating a diff view (e.g. a GitLens diff) flags "lines changed"** — a
   freshly created annotation is immediately reported stale.

Item 1 was mis-diagnosed in round 4 (recorded as "desktop-only but works on
desktop"). That was never verified on real desktop — only under `vscode-test-web`
(pure web, *no git extension at all*), where it returned empty for an unrelated
reason. This spec corrects that and re-implements Git ref on a foundation that
actually works.

## Decisions locked with the user

- **Git ref source:** *read `.git` directly via `vscode.workspace.fs`.* Keeps the
  extension **web-only** (no `main`/dual-host build), works on desktop + remote,
  and is unit-testable. It does **not** work where there is no real `.git` (e.g.
  github.dev / vscode.dev) — same coverage as before, by design.
- **Diff-view annotation:** *anchor the content hash to the working-tree file,*
  not the editor document. Annotating the working-tree side of a diff then "just
  works"; only when there is **no readable on-disk workspace file** do we warn and
  abort. (Not "block all diffs" — that would punish the common, useful case.)

---

## 1. Git ref — read `.git` via `vscode.workspace.fs`

### Root cause (architectural)

`package.json` declares only `"browser": "./dist/web/extension.js"` and **no
`"main"`** — a web-only extension. Per the VS Code docs, *"VS Code running on the
desktop supports running a web extension host along with the regular Node.js
extension host"*: a browser-only extension runs in the **web extension host even
on desktop**. The built-in **`vscode.git`** extension is a Node/`workspace`
extension running in the **Node.js host**. Extension API *exports* do not cross
that host boundary, so `vscode.extensions.getExtension('vscode.git').exports` is
effectively `undefined` for us. `readGitRefInfo()` therefore returns empty on
every host — the feature never worked.

Sources: [Web Extensions guide](https://code.visualstudio.com/api/extension-guides/web-extensions),
[microsoft/vscode#138550](https://github.com/microsoft/vscode/issues/138550).

Consistent (not intermittent) failure on both hosts rules out a timing/race
explanation and confirms the structural cause.

### Fix

Drop the `vscode.git` dependency entirely. Read the repository's `.git`
directory through the existing `FileSystem` abstraction (`vscode.workspace.fs`
under the hood), which is host-agnostic. The pure ref-file parsing is separated
from the file I/O so it can be unit-tested with `MemoryFileSystem`.

Data derived from `.git`:

| Source file | Yields |
| --- | --- |
| `.git/HEAD` | current branch (`ref: refs/heads/<b>`) or detached SHA |
| `.git/refs/heads/**` + `packed-refs` | local branches |
| `.git/refs/remotes/**` + `packed-refs` | remote branches |
| `.git/refs/tags/**` + `packed-refs` | tags |
| `.git/logs/HEAD` | recent commits (reflog — approximate) |

### Modules

**Pure parsers — `src/core/gitRefParse.ts`** (no `vscode`, no I/O):

- `parseHead(content: string): { branch?: string; sha?: string }` — a
  `ref: refs/heads/<name>` line → `{ branch }` (supports nested names like
  `feature/x`); a 40-hex line → `{ sha }` (detached HEAD).
- `parsePackedRefs(content: string): { ref: string; sha: string }[]` — one entry
  per `"<sha> <fullref>"` line; skips the `# pack-refs` header and `^<peeled>`
  lines.
- `classifyRef(fullRef: string): { kind: 'branch' | 'remote' | 'tag' | 'other'; name: string }`
  — strips `refs/heads/`, `refs/remotes/`, `refs/tags/`.
- `parseReflog(content: string, max: number): { sha: string; summary: string }[]`
  — newest first (reflog is appended, so read from the end), keep only
  commit-ish entries (message begins `commit`/`commit (amend)`/`commit (initial)`/
  `merge`/`rebase`/`cherry-pick`/`pull`), short SHA, summary = text after the
  first `": "`, de-duped by SHA, capped at `max`.

**FS assembler — `readGitRefInfoFromFs(fs: FileSystem): Promise<GitRefInfo>`**
(in `src/core/gitRefs.ts`; core already depends on `FileSystem`):

- Read `.git/HEAD`. If that read throws (no `.git`, or `.git` is a *file* — a
  worktree/submodule `gitdir:` pointer), return the empty `GitRefInfo`.
- Union packed refs (`parsePackedRefs('.git/packed-refs')`, tolerate missing)
  with loose refs found by recursively walking `.git/refs/{heads,remotes,tags}`.
  A loose-ref leaf whose content starts with `ref:` is **symbolic** (e.g.
  `refs/remotes/origin/HEAD`) → skip it.
- `headBranch` = parsed branch; `headSha` = parsed detached SHA, else the SHA of
  the current branch (loose `refs/heads/<branch>` or packed).
- `commits` = `parseReflog('.git/logs/HEAD', 20)` (tolerate missing).
- Every sub-read is individually guarded so one failure degrades to `[]`, never a
  throw — matching today's "empty ⇒ free-text fallback" contract.

**`FileSystem` typed listing** — the recursive ref walk needs to distinguish
files from subdirectories, but `FileSystem.readDirectory` returns **files only**
(and hides subdirs). Add one method:

- `list(path: string): Promise<{ name: string; isDirectory: boolean }[]>` to the
  `FileSystem` interface (`src/core/fileSystem.ts`), `MemoryFileSystem`
  (`src/core/memoryFileSystem.ts`), and `VscodeFileSystem`
  (`src/web/vscodeFileSystem.ts`, mapping `vscode.FileType`). Missing dir → `[]`.
- The walker lives in the assembler and is bounded (max depth / max entries) as a
  cheap guard against pathological `.git` trees.

**Web layer — `src/web/gitRefsSource.ts`** shrinks to a thin wire-up:

```ts
import { type GitRefInfo, readGitRefInfoFromFs } from '../core/gitRefs';
import { VscodeFileSystem } from './vscodeFileSystem';

export async function readGitRefInfo(): Promise<GitRefInfo> {
  try {
    return await readGitRefInfoFromFs(VscodeFileSystem.forWorkspace());
  } catch {
    return { branches: [], tags: [] };
  }
}
```

All the `vscode.git` `GitApi`/`GitRepository`/`GitExtensionExports` interfaces and
`getExtension('vscode.git')` logic are **deleted**.

### Unchanged

`GitRefInfo`, `currentRef`, and `gitRefSuggestions` in `src/core/gitRefs.ts` keep
their shapes and behavior — only the *producer* changes. Callers
(`createAnnotationCommand.ts` auto-capture, `extension.ts` suggestion QuickPicks)
are untouched: same `readGitRefInfo()` signature, richer data on desktop.

### Edge cases

- **Detached HEAD** → `currentRef` = short SHA (existing behavior).
- **Unborn branch** (HEAD points at a not-yet-created ref) → `headBranch` set,
  `headSha` undefined; `currentRef` still returns the branch name.
- **`.git` is a file** (worktrees/submodules) → graceful empty (deferred; below).
- **Workspace root ≠ repo root** (a subfolder is opened) → `.git` reads fail →
  empty. Acceptable.
- **`refs/remotes/*/HEAD`** symbolic pointer → skipped (not a real branch).

### Testing

- `gitRefParse.unit.test.ts` — `parseHead` (symref incl. nested / detached SHA /
  garbage); `parsePackedRefs` (header + peeled lines skipped); `classifyRef`;
  `parseReflog` (newest-first, commit filter, dedup, cap).
- `gitRefs.unit.test.ts` — `readGitRefInfoFromFs` against a `MemoryFileSystem`
  seeded with a fake `.git` (loose + packed refs, remote HEAD symref, detached
  HEAD, missing `.git` ⇒ empty, missing `packed-refs`/`logs`).
- `fileSystem`/`memoryFileSystem` — `list` returns names + `isDirectory`; missing
  dir ⇒ `[]`.
- Web host / vscode-test-web (no `.git`) already returns empty → the existing
  integration tier stays green with no changes.

### Non-goals

- **Dual-host / `main` build** — explicitly not chosen; stays web-only.
- **Worktrees & submodules** (`.git` as a `gitdir:` file) — return empty for now.
- **github.dev / vscode.dev** — no real `.git`; unchanged (free-text fallback).
- **True commit-graph log** — reflog approximation is sufficient for suggestions;
  no zlib/object parsing.

---

## 2. Diff-view annotation flagged "lines changed"

### Root cause

`createAnnotationCommand.ts#getSelection` uses `editor.document.getText()` as the
anchor text, and the flow hashes **that** (`createAnnotationFlow.ts:52`). On a
GitLens diff the active document is a **virtual revision** (a `gitlens:`/`git:`
snapshot), not the working-tree file. Staleness (`staleness.ts` → `drift.ts`)
later reads the **working-tree file from disk** and re-hashes, so the stored hash
(from the snapshot) can't match → "lines changed." The two ends hash *different
sources*. (The location resolves to the real file only because round 4's
absolute-path normalization maps the diff URI's embedded path back to it.)

The same asymmetry also mis-flags a **normal file with unsaved edits** (document
text ≠ saved-on-disk text) — a latent bug this fix also closes.

### Fix

Make create-time hashing use the **same source** as staleness: the working-tree
file read via `fs`.

**`src/core/createAnnotationFlow.ts`**

- `SelectionInfo` drops `fileText` (no longer needed).
- `CreateAnnotationDeps` gains
  `readWorkingText(file: string): Promise<string | null>` — the on-disk
  working-tree text for the (workspace-relative) path, or `null` if unreadable.
- Flow: after resolving `selection`, `const text = await deps.readWorkingText(selection.file)`.
  - `text === null` → `deps.showWarning('Annotated: open the file itself to annotate it — this view has no file on disk.')` and return `undefined` (nothing saved).
  - otherwise `contentHash = await deps.hashContent(anchorText(text, selection.range))`.

**`src/web/createAnnotationCommand.ts`**

- `getSelection` resolves the editor URI to a **canonical workspace-relative**
  path via `toWorkspaceRelativeSegments(asRelativePath(uri, false), folder.uri.path)`
  (join the segments; on `null` keep the raw path — `readWorkingText` will then
  fail and the flow warns). Stops storing accidental absolute paths for diff URIs.
- `getSelection` no longer returns `fileText`.
- Provide the dep from the same rooted filesystem the store uses:
  `readWorkingText: async (file) => { try { return dec.decode(await fs.readFile(file)); } catch { return null; } }`.

### Resulting behavior

| Scenario | Result |
| --- | --- |
| Normal file, saved | hash(disk) == staleness(disk) → **not stale** ✓ |
| Normal file, unsaved edits | hashes disk (saved) content, symmetric → **not stale** (fixes latent bug) |
| Diff, working-tree side | reads real file → **not stale** ✓ (the reported bug) |
| Diff, historical side w/ shifted lines | reads real file; if working lines differ → **stale = correct info**, not a false positive |
| Virtual doc / out-of-workspace, no file on disk | `readWorkingText` → `null` → **warn + abort**, nothing saved |

### Testing

- `createAnnotationFlow.unit.test.ts` — a stub `readWorkingText` returning text
  drives `contentHash` (assert it hashes the *working* text at the range, not any
  document text); returning `null` calls `showWarning` and saves **nothing**
  (returns `undefined`). Existing tests updated for the dropped `fileText` and the
  new dep.
- Line-anchoring across diff revisions is **not** remapped — an inherent property
  of line-based anchors; the stale flag communicates genuine mismatch (non-goal).

---

## Non-goals (both items)

- Multi-root workspaces (first folder only — pre-existing deferral).
- Remapping diff line numbers to the working tree.
- Making Git ref work where there is no real `.git` (github.dev/vscode.dev,
  worktrees/submodules).

## Packaging & execution

- One branch `ux-feedback-round-5`, executed **subagent-driven** (fresh
  implementer + code-quality/spec review per task), merged to `main` locally when
  green. **No push, no release** unless the user asks.
- The two items touch **disjoint files** and have no logical dependency, so
  Item 2's implementation may overlap Item 1's review (per the repo's pipelining
  rule). Suggested order: **Item 1** (git ref — larger, foundational) then
  **Item 2** (diff hash — small).
- Local gate: `npm run check-types` + `npm run test:unit`; run
  `npm run test:integration` when the network/port is free.

## File change summary

**Changed (code):**
- `src/core/gitRefParse.ts` — **new**: `parseHead`, `parsePackedRefs`,
  `classifyRef`, `parseReflog`
- `src/core/gitRefs.ts` — add `readGitRefInfoFromFs(fs)` assembler (+ bounded ref
  walker); model/`currentRef`/`gitRefSuggestions` unchanged
- `src/core/fileSystem.ts`, `src/core/memoryFileSystem.ts`,
  `src/web/vscodeFileSystem.ts` — add `list(path)`
- `src/web/gitRefsSource.ts` — rewrite to `readGitRefInfoFromFs` over
  `VscodeFileSystem`; delete all `vscode.git` code
- `src/core/createAnnotationFlow.ts` — `readWorkingText` dep; hash working-tree
  text; drop `SelectionInfo.fileText`
- `src/web/createAnnotationCommand.ts` — provide `readWorkingText`; normalize the
  selection path; drop `fileText`

**Tests:** `gitRefParse.unit.test.ts` (new), `gitRefs.unit.test.ts`,
`memoryFileSystem`/`fileSystem` list coverage, `createAnnotationFlow.unit.test.ts`.
