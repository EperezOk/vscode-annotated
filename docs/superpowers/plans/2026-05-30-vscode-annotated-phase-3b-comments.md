# vscode-annotated — Phase 3b: Comment Threads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add **comment threads** to annotations. Each comment is stored in a **per-author file** (`.annotations/comments/<slug-of-name>.json`); a thread is every comment across all author files whose `annotationId` matches, merged and sorted by timestamp. In the annotation view, each comment shows author + relative time + rendered Markdown; the current user may **edit/delete only the comments in their own author file**; a collapsed **Reply** affordance expands into the Markdown editor.

**Architecture:** Comments live in separate files (the group model is untouched). A pure layer (`Comment`/`CommentFile`/`ThreadComment` types + parse/serialize, `flattenComments`, `slugifyAuthor`, `relativeTime`, `resolveAuthorEmail`) is unit-tested with no I/O. A `CommentStore` mirrors `GroupStore` over `.annotations/comments/`. The thread rides along in the existing `setGroup` message (single refresh path: `showGroupWithStale` loads + filters the group's comments and the current author, re-posts). Edit/delete are scoped host-side to the current user's own file. Native HTML5 — no new deps.

**Tech Stack:** TypeScript + Svelte 5 (reuses `MarkdownEditor`/`MarkdownPreview`). Builds on Phase 1 + 2 + 3a. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-3` (already checked out); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + Bash `timeout: 600000` and `pkill -f vscode-test-web || true` first.

---

## Context (exact current shapes)

- `src/shared/model.ts` — parse helpers throw on bad input via `isObject(x)` + `fail(field, detail): never`. `Annotation`/`AnnotationGroup` unchanged in 3b.
- `src/shared/ids.ts` — `newId(): string` = `crypto.randomUUID()`.
- `src/core/fileSystem.ts` — `interface FileSystem { readFile, writeFile, readDirectory(returns [] if missing), createDirectory, delete, exists }`.
- `src/core/groupStore.ts` — `class GroupStore { constructor(fs, dir='.annotations/groups'); path(id); listGroups() (readDirectory → parse each, skip invalid); getGroup; saveGroup (createDirectory + writeFile); deleteGroup; … }`. `dec`/`enc` = TextDecoder/TextEncoder module-level.
- `src/core/authorIdentity.ts` — `interface AuthorNameSources { gitUserName, settingAuthorName, githubAccountLabel, promptForName, persistName }`; `resolveAuthor(sources)` tries each in order, returns `'Unknown'` if none; a private `clean(x)` trims + returns undefined-if-empty.
- `src/web/authorSources.ts` — `class VscodeAuthorNameSources implements AuthorNameSources` (git via `vscode.git` ext repo `getConfig('user.name')`, setting `annotated.authorName`, GitHub session `account.label`, `showInputBox`, persist to setting).
- `src/web/createAnnotationCommand.ts` — resolves author via `resolveAuthor(new VscodeAuthorNameSources())`.
- `src/webview/detail/MarkdownEditor.svelte` — `{ doc?: string; onChange?: (v: string) => void }`; multiple instances are fine. `__mocks__/MarkdownEditorStub.svelte` is a `<textarea data-testid="md-editor" value={doc} oninput={onChange}>`; tests mock via `vi.mock('./MarkdownEditor.svelte', async () => ({ default: (await import('./__mocks__/MarkdownEditorStub.svelte')).default }))`.
- `src/webview/detail/MarkdownPreview.svelte` — `{ source: string }` → sanitized HTML (`data-testid="md-preview"`).
- `src/webview/detail/AnnotationView.svelte` — props include `annotation, stale?, onback?, onsave?, oncopy?, oncopyloc?, onsaverange?, onprev?, onnext?, position?`. Renders `.bar` → `.nav` → stale banner → `.toolbar` → `{#if editing}<MarkdownEditor/>{:else}<MarkdownPreview/>{/if}`. The content editor only mounts when `editing` (auto-true for empty content). **An existing test asserts `queryByTestId('md-editor')` is null for a non-empty annotation — the comment Reply editor must stay collapsed by default so this holds.**
- `src/shared/protocol.ts` — `HostToDetail = { type:'setGroup'; group; palette; staleIds? }`; `DetailToHost` union ends `| { type:'updateGroupStatus'; status: GroupStatus }`; `parseDetailMessage` switch.
- `src/core/detailState.ts` — `DetailState { group, palette, selectedAnnotationId, mode, staleIds }`; `applyDetailMessage` `setGroup` branch builds the new state (keeps selection if the annotation still exists); helpers `openAnnotation`/`backToGroup`/`isStale`/`oneLine`/nav helpers.
- `src/webview/detail/state.ts` — `detail` store + `handleHostMessage` + senders.
- `src/webview/detail/DetailApp.svelte` — `current = $derived(...find selectedAnnotationId)`; renders AnnotationView inside `{#key $detail.selectedAnnotationId}` with all its props; `openRow(id)`.
- `src/web/detailPanelProvider.ts` — fields `group/palette/staleIds`; hooks incl. `onUpdateGroupStatus`; `showGroup(group, palette, staleIds=[])` stores + `post()` (sends setGroup); `onDidReceiveMessage` `if/else if` chain.
- `src/web/extension.ts` — `now = () => Math.floor(Date.now()/1000)`; `showGroupWithStale(groupId)` (loads group, computes staleIds, `detailProvider.showGroup(...)`); hook assignments; `readTagPalette()`.
- Seeds: `seed-group.json` (open, 1 annotation id — READ it for the exact annotation id), `seed-resolved.json` (resolved, 3 annotations). Playwright web suite is serial (`fullyParallel: false`).

---

## Design notes (decisions — sensible defaults, flagged for the user)

- **Identity:** comment files are named by `slugifyAuthor(name)`; the file stores both `author` (name) and `email` (best-effort). **Edit/delete-own is enforced by author-file ownership** (the host only mutates the current user's file) — so reliable email is NOT on the critical path. The webview shows edit/delete on a comment iff `comment.author === currentAuthor`. Same-name collision (two users, one file) is accepted per the spec ("filename slug may collide").
- **Thread rides in `setGroup`.** `showGroupWithStale` loads all comment files, flattens+sorts, filters to the current group's annotation ids, resolves the current author, and passes both to `showGroup`. One refresh path; group+comments always in sync.
- **Reply is collapsed by default** (a "💬 Add a comment" trigger) and expands into a `MarkdownEditor`. This keeps the headline UX clean AND preserves AnnotationView's "no `md-editor` when not editing content" test.
- **Author resolution is memoized** in the host (resolve once per session) to avoid repeated git/GitHub calls on every refresh.
- **Deterministic e2e identity:** add `test-workspace/.vscode/settings.json` with `annotated.authorName`/`annotated.authorEmail` so headless author resolution never falls through to `showInputBox` (which would hang the e2e). The comment e2e is a **light smoke** (asserts the thread + reply affordance render) — it does NOT persist a comment, to avoid polluting the shared workspace. Add/edit/delete are covered by unit + component + integration.

---

## File Structure (3b)

```
src/shared/model.ts                               (modify) # + Comment/CommentFile/ThreadComment + parseComment/parseCommentFile/serializeCommentFile
src/shared/model.unit.test.ts                     (modify) # (or wherever model parse is tested)
src/core/comments.ts                              (new)    # slugifyAuthor, flattenComments, relativeTime  (pure)
src/core/comments.unit.test.ts                    (new)
src/core/authorIdentity.ts                        (modify) # + AuthorEmailSources + resolveAuthorEmail
src/core/authorIdentity.unit.test.ts              (modify)
src/core/commentStore.ts                          (new)    # CommentStore over .annotations/comments/
src/core/commentStore.unit.test.ts               (new)
src/shared/protocol.ts                            (modify) # setGroup += comments?/currentAuthor?; DetailToHost += addComment/editComment/deleteComment
src/shared/protocol.unit.test.ts                  (modify)
src/core/detailState.ts                           (modify) # DetailState += comments/currentAuthor; commentsFor selector
src/core/detailState.unit.test.ts                 (modify)
src/webview/detail/CommentThread.svelte           (new)
src/webview/detail/CommentThread.svelte.test.ts   (new)
src/webview/detail/AnnotationView.svelte          (modify) # render CommentThread; comment props
src/webview/detail/AnnotationView.svelte.test.ts  (modify)
src/webview/detail/DetailApp.svelte               (modify) # wire comments + senders
src/webview/detail/state.ts                       (modify) # addComment/editComment/deleteComment senders
src/web/authorSources.ts                          (modify) # email sources on VscodeAuthorNameSources
src/web/detailPanelProvider.ts                    (modify) # comments/currentAuthor in showGroup+post; comment hooks + handler branches
src/web/extension.ts                              (modify) # load+filter comments, memoized author, comment CRUD hooks
src/web/test/suite/commentStore.integration.test.ts (new)
src/web/test/suite/index.ts                       (modify)
test-workspace/.vscode/settings.json              (new)    # annotated.authorName/authorEmail for deterministic e2e
package.json                                      (modify) # annotated.authorEmail config
e2e/comments.spec.ts                              (new)    # light smoke: thread + reply affordance render
```

---

## Task 1: Pure comment layer (types, parse, helpers, email resolver)

**Files:** Modify `src/shared/model.ts`(+its test file), `src/core/authorIdentity.ts`(+test); Create `src/core/comments.ts`(+test)

- [ ] **Step 1: Write/append tests.**

Create `src/core/comments.unit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { slugifyAuthor, flattenComments, relativeTime } from './comments';
import { type CommentFile } from '../shared/model';

describe('slugifyAuthor', () => {
  it('lowercases and dash-joins non-alphanumerics', () => {
    expect(slugifyAuthor('Alice Doe')).toBe('alice-doe');
    expect(slugifyAuthor('  J@ne  Q. Public ')).toBe('j-ne-q-public');
  });
  it('falls back to "anon" for empty/symbol-only names', () => {
    expect(slugifyAuthor('')).toBe('anon');
    expect(slugifyAuthor('@@@')).toBe('anon');
  });
});

describe('flattenComments', () => {
  const files: CommentFile[] = [
    { author: 'Bob', email: 'b@x', comments: [
      { id: 'c2', annotationId: 'a1', content: 'second', timestamp: 200 },
    ] },
    { author: 'Ana', email: 'a@x', comments: [
      { id: 'c1', annotationId: 'a1', content: 'first', timestamp: 100 },
      { id: 'c3', annotationId: 'a2', content: 'other', timestamp: 300 },
    ] },
  ];
  it('merges across files, attaches author, sorts by timestamp', () => {
    expect(flattenComments(files).map((c) => [c.id, c.author])).toEqual([
      ['c1', 'Ana'], ['c2', 'Bob'], ['c3', 'Ana'],
    ]);
  });
});

describe('relativeTime', () => {
  it('formats common buckets', () => {
    expect(relativeTime(1000, 1000)).toBe('just now');
    expect(relativeTime(1000, 1000 + 5 * 60)).toBe('5m ago');
    expect(relativeTime(1000, 1000 + 3 * 3600)).toBe('3h ago');
    expect(relativeTime(1000, 1000 + 2 * 86400)).toBe('2d ago');
  });
  it('clamps future timestamps to "just now"', () => {
    expect(relativeTime(2000, 1000)).toBe('just now');
  });
});
```

Append to `src/core/authorIdentity.unit.test.ts` (add `resolveAuthorEmail` to the existing import from `./authorIdentity`):
```ts
describe('resolveAuthorEmail', () => {
  const sources = (over: Partial<Record<'git' | 'setting' | 'github', string | undefined>>) => ({
    gitUserEmail: async () => over.git,
    settingAuthorEmail: () => over.setting,
    githubAccountEmail: async () => over.github,
  });
  it('prefers git, then setting, then github', async () => {
    expect(await resolveAuthorEmail(sources({ git: 'g@x', setting: 's@x', github: 'h@x' }))).toBe('g@x');
    expect(await resolveAuthorEmail(sources({ setting: 's@x', github: 'h@x' }))).toBe('s@x');
    expect(await resolveAuthorEmail(sources({ github: 'h@x' }))).toBe('h@x');
  });
  it('returns empty string when no source provides one', async () => {
    expect(await resolveAuthorEmail(sources({}))).toBe('');
  });
});
```

Append to the model parse test file (find where `parseGroup`/`parseAnnotation` are tested — likely `src/shared/model.unit.test.ts`; if model parsing has no dedicated test file, create `src/shared/model.comments.unit.test.ts`). Import `parseCommentFile`, `serializeCommentFile`:
```ts
describe('parseCommentFile', () => {
  it('parses a valid comment file', () => {
    const raw = { author: 'Ana', email: 'a@x', comments: [
      { id: 'c1', annotationId: 'a1', content: 'hi', timestamp: 100 },
    ] };
    expect(parseCommentFile(raw)).toEqual(raw);
  });
  it('throws on a malformed comment', () => {
    expect(() => parseCommentFile({ author: 'Ana', email: 'a@x', comments: [{ id: 1 }] })).toThrow();
  });
  it('round-trips through serializeCommentFile', () => {
    const file = { author: 'Ana', email: 'a@x', comments: [{ id: 'c1', annotationId: 'a1', content: 'hi', timestamp: 100 }] };
    expect(parseCommentFile(JSON.parse(serializeCommentFile(file)))).toEqual(file);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/comments.unit.test.ts src/core/authorIdentity.unit.test.ts && npx vitest run src/shared`
Expected: FAIL (modules/exports missing). Report output.

- [ ] **Step 3: Add comment types + parse/serialize to `src/shared/model.ts`** (reuse the existing `isObject`/`fail` helpers):
```ts
/** One comment in a per-author comment file. */
export interface Comment {
  id: string;
  annotationId: string;
  content: string;
  timestamp: number; // epoch seconds
}

/** A per-author comment file (.annotations/comments/<slug>.json). */
export interface CommentFile {
  author: string;
  email: string;
  comments: Comment[];
}

/** A comment flattened into a thread, with its file's author attached. */
export interface ThreadComment extends Comment {
  author: string;
}

function parseComment(raw: unknown): Comment {
  if (!isObject(raw)) fail('comment', 'is not an object');
  const { id, annotationId, content, timestamp } = raw;
  if (typeof id !== 'string') fail('comment.id', 'must be a string');
  if (typeof annotationId !== 'string') fail('comment.annotationId', 'must be a string');
  if (typeof content !== 'string') fail('comment.content', 'must be a string');
  if (typeof timestamp !== 'number') fail('comment.timestamp', 'must be a number');
  return { id, annotationId, content, timestamp };
}

/** Validate an untrusted value as a CommentFile. Throws on any problem. */
export function parseCommentFile(raw: unknown): CommentFile {
  if (!isObject(raw)) fail('commentFile', 'is not an object');
  const { author, email, comments } = raw;
  if (typeof author !== 'string') fail('commentFile.author', 'must be a string');
  if (typeof email !== 'string') fail('commentFile.email', 'must be a string');
  if (!Array.isArray(comments)) fail('commentFile.comments', 'must be an array');
  return { author, email, comments: comments.map(parseComment) };
}

export function serializeCommentFile(file: CommentFile): string {
  return JSON.stringify(file, null, 2);
}
```
(If `isObject`/`fail` are not exported, they're in-module — these new functions are in the same file so they can use them directly.)

- [ ] **Step 4: Create `src/core/comments.ts`** (pure):
```ts
import { type CommentFile, type ThreadComment } from '../shared/model';

/** A filesystem-safe slug of an author display name (collisions are tolerated). */
export function slugifyAuthor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'anon';
}

/** Merge every comment across all files (author attached), sorted ascending by timestamp. */
export function flattenComments(files: CommentFile[]): ThreadComment[] {
  return files
    .flatMap((file) => file.comments.map((c) => ({ ...c, author: file.author })))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Coarse "x ago" label. `now` and `ts` are epoch seconds. */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
```

- [ ] **Step 5: Add email resolution to `src/core/authorIdentity.ts`:**
```ts
export interface AuthorEmailSources {
  gitUserEmail(): Promise<string | undefined>;
  settingAuthorEmail(): string | undefined;
  githubAccountEmail(): Promise<string | undefined>;
}

/** Resolve the author email by trying each source; '' if none. */
export async function resolveAuthorEmail(sources: AuthorEmailSources): Promise<string> {
  const git = clean(await sources.gitUserEmail());
  if (git) return git;
  const setting = clean(sources.settingAuthorEmail());
  if (setting) return setting;
  const github = clean(await sources.githubAccountEmail());
  if (github) return github;
  return '';
}
```
(Reuse the existing private `clean` helper in this module.)

- [ ] **Step 6: Run pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/comments.unit.test.ts src/core/authorIdentity.unit.test.ts src/shared && npm run check-types && npm run test:unit`
Expected: PASS; check-types 0; all unit green.

- [ ] **Step 7: Commit**
```bash
git add src/shared/model.ts src/core/comments.ts src/core/comments.unit.test.ts src/core/authorIdentity.ts src/core/authorIdentity.unit.test.ts src/shared/model.unit.test.ts src/shared/model.comments.unit.test.ts
git commit -m "feat: pure comment layer (types/parse, flatten/slug/relativeTime, resolveAuthorEmail)"
```
(Only `git add` the test files you actually created/modified.)

---

## Task 2: CommentStore

**Files:** Create `src/core/commentStore.ts`(+test)

- [ ] **Step 1: Write `src/core/commentStore.unit.test.ts`** (mirror `groupStore.unit.test.ts`'s `MemoryFileSystem` setup — READ it for the exact import + `beforeEach`):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CommentStore } from './commentStore';
import { MemoryFileSystem } from './memoryFileSystem'; // use the SAME helper groupStore tests use
import { type Comment } from '../shared/model';

function comment(id: string, annotationId: string, ts: number): Comment {
  return { id, annotationId, content: `c-${id}`, timestamp: ts };
}

describe('CommentStore', () => {
  let store: CommentStore;
  beforeEach(() => {
    store = new CommentStore(new MemoryFileSystem());
  });

  it('listCommentFiles returns [] when the dir does not exist', async () => {
    expect(await store.listCommentFiles()).toEqual([]);
  });

  it('addComment creates the author file then appends', async () => {
    await store.addComment('ana', 'Ana', 'a@x', comment('c1', 'a1', 100));
    await store.addComment('ana', 'Ana', 'a@x', comment('c2', 'a1', 200));
    const files = await store.listCommentFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ author: 'Ana', email: 'a@x' });
    expect(files[0].comments.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('updateComment edits only within the given file and returns false when missing', async () => {
    await store.addComment('ana', 'Ana', 'a@x', comment('c1', 'a1', 100));
    expect(await store.updateComment('ana', 'c1', 'edited')).toBe(true);
    expect(await store.updateComment('ana', 'nope', 'x')).toBe(false);
    expect(await store.updateComment('bob', 'c1', 'x')).toBe(false); // not Bob's file
    const file = await store.getCommentFile('ana');
    expect(file?.comments[0].content).toBe('edited');
    expect(file?.comments[0].timestamp).toBe(100); // editing keeps order
  });

  it('deleteComment removes only within the given file and returns false when missing', async () => {
    await store.addComment('ana', 'Ana', 'a@x', comment('c1', 'a1', 100));
    await store.addComment('ana', 'Ana', 'a@x', comment('c2', 'a1', 200));
    expect(await store.deleteComment('ana', 'c1')).toBe(true);
    expect(await store.deleteComment('ana', 'c1')).toBe(false);
    const file = await store.getCommentFile('ana');
    expect(file?.comments.map((c) => c.id)).toEqual(['c2']);
  });
});
```
> If the groupStore tests use a different in-memory FS helper name/path, use THAT exact one. If there is no shared `MemoryFileSystem`, READ how `groupStore.unit.test.ts` fakes the FS and mirror it precisely.

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/commentStore.unit.test.ts`
Expected: FAIL — `./commentStore` unresolved.

- [ ] **Step 3: Create `src/core/commentStore.ts`** (mirror GroupStore's idioms — `dec`/`enc`, `readDirectory` tolerance, `createDirectory` on save):
```ts
import { type FileSystem } from './fileSystem';
import { type Comment, type CommentFile, parseCommentFile, serializeCommentFile } from '../shared/model';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** Per-author comment files under `.annotations/comments/<slug>.json`. */
export class CommentStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly dir = '.annotations/comments',
  ) {}

  private path(slug: string): string {
    return `${this.dir}/${slug}.json`;
  }

  /** All valid comment files (invalid ones are skipped). [] if the dir is absent. */
  async listCommentFiles(): Promise<CommentFile[]> {
    const names = await this.fs.readDirectory(this.dir);
    const files: CommentFile[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      try {
        files.push(parseCommentFile(JSON.parse(dec.decode(await this.fs.readFile(`${this.dir}/${name}`)))));
      } catch (e) {
        console.warn(`[annotated] skipping invalid comment file ${name}: ${String(e)}`);
      }
    }
    return files;
  }

  async getCommentFile(slug: string): Promise<CommentFile | null> {
    try {
      return parseCommentFile(JSON.parse(dec.decode(await this.fs.readFile(this.path(slug)))));
    } catch {
      return null;
    }
  }

  async saveCommentFile(slug: string, file: CommentFile): Promise<void> {
    await this.fs.createDirectory(this.dir);
    await this.fs.writeFile(this.path(slug), enc.encode(serializeCommentFile(file)));
  }

  /** Append a comment to the author's file, creating it (with author/email) if needed. */
  async addComment(slug: string, author: string, email: string, comment: Comment): Promise<void> {
    const existing = await this.getCommentFile(slug);
    const comments = [...(existing?.comments ?? []), comment];
    await this.saveCommentFile(slug, { author, email, comments });
  }

  /** Edit a comment's content within the author's own file. False if file/comment missing. */
  async updateComment(slug: string, commentId: string, content: string): Promise<boolean> {
    const file = await this.getCommentFile(slug);
    if (!file) {
      return false;
    }
    const index = file.comments.findIndex((c) => c.id === commentId);
    if (index < 0) {
      return false;
    }
    const comments = file.comments.map((c, i) => (i === index ? { ...c, content } : c));
    await this.saveCommentFile(slug, { ...file, comments });
    return true;
  }

  /** Delete a comment within the author's own file. False if file/comment missing. */
  async deleteComment(slug: string, commentId: string): Promise<boolean> {
    const file = await this.getCommentFile(slug);
    if (!file) {
      return false;
    }
    const comments = file.comments.filter((c) => c.id !== commentId);
    if (comments.length === file.comments.length) {
      return false;
    }
    await this.saveCommentFile(slug, { ...file, comments });
    return true;
  }
}
```

- [ ] **Step 4: Run pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/commentStore.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types 0; all green.

- [ ] **Step 5: Commit**
```bash
git add src/core/commentStore.ts src/core/commentStore.unit.test.ts
git commit -m "feat: CommentStore (per-author comment files CRUD)"
```

---

## Task 3: Protocol + detail state + senders

**Files:** Modify `src/shared/protocol.ts`(+test), `src/core/detailState.ts`(+test), `src/webview/detail/state.ts`

- [ ] **Step 1: Append tests.**

In `src/shared/protocol.unit.test.ts` (inside the `parseDetailMessage` describe):
```ts
  it('accepts addComment / editComment / deleteComment', () => {
    expect(parseDetailMessage({ type: 'addComment', annotationId: 'a1', content: 'hi' })).toEqual({
      type: 'addComment', annotationId: 'a1', content: 'hi',
    });
    expect(parseDetailMessage({ type: 'editComment', commentId: 'c1', content: 'x' })).toEqual({
      type: 'editComment', commentId: 'c1', content: 'x',
    });
    expect(parseDetailMessage({ type: 'deleteComment', commentId: 'c1' })).toEqual({
      type: 'deleteComment', commentId: 'c1',
    });
  });
  it('rejects malformed comment messages', () => {
    expect(parseDetailMessage({ type: 'addComment', annotationId: 'a1' })).toBeNull();
    expect(parseDetailMessage({ type: 'editComment', commentId: 1, content: 'x' })).toBeNull();
    expect(parseDetailMessage({ type: 'deleteComment' })).toBeNull();
  });
```

In `src/core/detailState.unit.test.ts` (add `commentsFor` to the import from `./detailState`):
```ts
describe('comments in detail state', () => {
  const thread = [
    { id: 'c1', annotationId: 'a1', author: 'Ana', content: 'one', timestamp: 100 },
    { id: 'c2', annotationId: 'a2', author: 'Bob', content: 'two', timestamp: 200 },
  ];
  it('initial state has empty comments + currentAuthor', () => {
    const s = initialDetailState();
    expect(s.comments).toEqual([]);
    expect(s.currentAuthor).toBe('');
  });
  it('setGroup stores comments + currentAuthor (defaulting)', () => {
    const next = applyDetailMessage(initialDetailState(), {
      type: 'setGroup', group: null, palette: [], comments: thread, currentAuthor: 'Ana',
    });
    expect(next.comments).toEqual(thread);
    expect(next.currentAuthor).toBe('Ana');
  });
  it('commentsFor filters by annotation id', () => {
    const s = { ...initialDetailState(), comments: thread };
    expect(commentsFor(s, 'a1').map((c) => c.id)).toEqual(['c1']);
    expect(commentsFor(s, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `src/shared/protocol.ts`.** Import `ThreadComment` from `./model` (merge into the existing model import line). Extend `HostToDetail`:
```ts
export type HostToDetail = {
  type: 'setGroup';
  group: AnnotationGroup | null;
  palette: TagColor[];
  staleIds?: string[];
  comments?: ThreadComment[];
  currentAuthor?: string;
};
```
Add to `DetailToHost`:
```ts
  | { type: 'addComment'; annotationId: string; content: string }
  | { type: 'editComment'; commentId: string; content: string }
  | { type: 'deleteComment'; commentId: string }
```
Add to `parseDetailMessage`'s switch (before `default`):
```ts
    case 'addComment':
      return typeof raw.annotationId === 'string' && typeof raw.content === 'string'
        ? { type: 'addComment', annotationId: raw.annotationId, content: raw.content }
        : null;
    case 'editComment':
      return typeof raw.commentId === 'string' && typeof raw.content === 'string'
        ? { type: 'editComment', commentId: raw.commentId, content: raw.content }
        : null;
    case 'deleteComment':
      return typeof raw.commentId === 'string'
        ? { type: 'deleteComment', commentId: raw.commentId }
        : null;
```

- [ ] **Step 4: Extend `src/core/detailState.ts`.** Import `ThreadComment` from `../shared/model`. Add to `DetailState`:
```ts
  comments: ThreadComment[];
  currentAuthor: string;
```
`initialDetailState` adds `comments: [], currentAuthor: ''`. In the `setGroup` branch of `applyDetailMessage`, add to the returned object:
```ts
        comments: message.comments ?? [],
        currentAuthor: message.currentAuthor ?? '',
```
Add a selector:
```ts
/** Comments belonging to one annotation (already timestamp-sorted by the host). */
export function commentsFor(state: DetailState, annotationId: string): ThreadComment[] {
  return state.comments.filter((c) => c.annotationId === annotationId);
}
```
(If any other `DetailState` literal in non-test code breaks check-types, add the two new fields — but `initialDetailState()` is the only factory.)

- [ ] **Step 5: Add senders to `src/webview/detail/state.ts`:**
```ts
/** Add a comment to the given annotation (host attributes + persists). */
export function addComment(annotationId: string, content: string): void {
  postToHost({ type: 'addComment', annotationId, content });
}

/** Edit one of the current user's own comments. */
export function editComment(commentId: string, content: string): void {
  postToHost({ type: 'editComment', commentId, content });
}

/** Delete one of the current user's own comments. */
export function deleteComment(commentId: string): void {
  postToHost({ type: 'deleteComment', commentId });
}
```

- [ ] **Step 6: Run pass + check-types + full unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts src/core/detailState.unit.test.ts && npm run check-types && npm run test:unit`
Expected: PASS; check-types 0; all green. (If `applyDetailMessage` setGroup test literals elsewhere break, they default via `?? []`/`?? ''` — only `initialDetailState` literal assertions might need the two new fields; update those.)

- [ ] **Step 7: Commit**
```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts src/core/detailState.ts src/core/detailState.unit.test.ts src/webview/detail/state.ts
git commit -m "feat: comment protocol messages + thread in detail state + senders"
```

---

## Task 4: CommentThread component + AnnotationView integration

**Files:** Create `src/webview/detail/CommentThread.svelte`(+test); Modify `src/webview/detail/AnnotationView.svelte`(+test), `src/webview/detail/DetailApp.svelte`

- [ ] **Step 1: Write `src/webview/detail/CommentThread.svelte.test.ts`** (mock MarkdownEditor like AnnotationView's test):
```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CommentThread from './CommentThread.svelte';
import { type ThreadComment } from '../../shared/model';

vi.mock('./MarkdownEditor.svelte', async () => ({
  default: (await import('./__mocks__/MarkdownEditorStub.svelte')).default,
}));

const thread: ThreadComment[] = [
  { id: 'c1', annotationId: 'a1', author: 'Ana', content: 'first note', timestamp: 100 },
  { id: 'c2', annotationId: 'a1', author: 'Me', content: 'my note', timestamp: 200 },
];

describe('CommentThread', () => {
  it('renders each comment with author + body', () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    const rows = screen.getAllByTestId('comment');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ana');
  });
  it('shows edit/delete only on the current user\'s own comments', () => {
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200 });
    expect(screen.getAllByTestId('comment-delete-btn')).toHaveLength(1); // only "Me"
  });
  it('expands the reply editor and adds a comment', async () => {
    const onadd = vi.fn();
    render(CommentThread, { comments: [], currentAuthor: 'Me', now: 200, onadd });
    expect(screen.queryByTestId('md-editor')).toBeNull(); // collapsed by default
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    await userEvent.type(screen.getByTestId('md-editor'), 'Hello');
    await userEvent.click(screen.getByTestId('comment-add-btn'));
    expect(onadd).toHaveBeenCalledWith('Hello');
  });
  it('deletes an own comment', async () => {
    const ondelete = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, ondelete });
    await userEvent.click(screen.getByTestId('comment-delete-btn'));
    expect(ondelete).toHaveBeenCalledWith('c2');
  });
  it('edits an own comment', async () => {
    const onedit = vi.fn();
    render(CommentThread, { comments: thread, currentAuthor: 'Me', now: 200, onedit });
    await userEvent.click(screen.getByTestId('comment-edit-btn'));
    const editor = screen.getByTestId('md-editor');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'edited');
    await userEvent.click(screen.getByTestId('comment-save-btn'));
    expect(onedit).toHaveBeenCalledWith('c2', 'edited');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/CommentThread.svelte.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 3: Create `src/webview/detail/CommentThread.svelte`:**
```svelte
<script lang="ts">
  import { type ThreadComment } from '../../shared/model';
  import { relativeTime } from '../../core/comments';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';

  let {
    comments,
    currentAuthor,
    now = Math.floor(Date.now() / 1000),
    onadd,
    onedit,
    ondelete,
  }: {
    comments: ThreadComment[];
    currentAuthor: string;
    now?: number;
    onadd?: (content: string) => void;
    onedit?: (commentId: string, content: string) => void;
    ondelete?: (commentId: string) => void;
  } = $props();

  let replying = $state(false);
  let replyDraft = $state('');
  let editingId = $state<string | null>(null);
  let editDraft = $state('');

  function startReply(): void { replyDraft = ''; replying = true; }
  function addReply(): void {
    const text = replyDraft.trim();
    if (!text) return;
    onadd?.(text);
    replyDraft = '';
    replying = false;
  }
  function startEdit(c: ThreadComment): void { editingId = c.id; editDraft = c.content; }
  function saveEdit(id: string): void {
    onedit?.(id, editDraft);
    editingId = null;
  }
</script>

<section class="comments" data-testid="comment-thread">
  <h4 class="ctitle">Comments</h4>
  {#each comments as c (c.id)}
    <div class="comment" data-testid="comment">
      <div class="chead">
        <span class="cauthor">{c.author}</span>
        <span class="ctime">{relativeTime(c.timestamp, now)}</span>
        {#if c.author === currentAuthor}
          <span class="cactions">
            <button type="button" class="link" data-testid="comment-edit-btn" onclick={() => startEdit(c)}>edit</button>
            <button type="button" class="link" data-testid="comment-delete-btn" onclick={() => ondelete?.(c.id)}>delete</button>
          </span>
        {/if}
      </div>
      {#if editingId === c.id}
        <MarkdownEditor doc={editDraft} onChange={(v) => (editDraft = v)} />
        <div class="crow">
          <button type="button" class="btn" data-testid="comment-save-btn" onclick={() => saveEdit(c.id)}>Save</button>
          <button type="button" class="link" onclick={() => (editingId = null)}>cancel</button>
        </div>
      {:else}
        <MarkdownPreview source={c.content} />
      {/if}
    </div>
  {/each}

  {#if replying}
    <div class="reply">
      <MarkdownEditor doc={replyDraft} onChange={(v) => (replyDraft = v)} />
      <div class="crow">
        <button type="button" class="btn" data-testid="comment-add-btn" disabled={!replyDraft.trim()} onclick={addReply}>Add comment</button>
        <button type="button" class="link" onclick={() => (replying = false)}>cancel</button>
      </div>
    </div>
  {:else}
    <button type="button" class="reply-trigger" data-testid="comment-reply-trigger" onclick={startReply}>💬 Add a comment…</button>
  {/if}
</section>

<style>
  .comments { margin-top: 14px; border-top: 1px solid var(--vscode-sideBar-border, #333); padding-top: 10px; }
  .ctitle { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .comment { margin-bottom: 10px; }
  .chead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .cauthor { font-weight: 600; font-size: 12px; }
  .ctime { font-size: 10.5px; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .cactions { margin-left: auto; display: flex; gap: 6px; }
  .crow { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11px; padding: 0; }
  .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 3px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .reply-trigger { background: none; border: 1px dashed var(--vscode-input-border, #555); color: var(--vscode-descriptionForeground, #9a9a9a); border-radius: 4px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; width: 100%; text-align: left; }
</style>
```

- [ ] **Step 4: Run to verify the CommentThread tests pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/CommentThread.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Integrate into `AnnotationView.svelte`.** Import `CommentThread` + `ThreadComment`. Add props (destructure + type): `comments?: ThreadComment[]`, `currentAuthor?: string`, `onaddcomment?: (annotationId: string, content: string) => void`, `oneditcomment?: (commentId: string, content: string) => void`, `ondeletecomment?: (commentId: string) => void`. After the editor/preview block (before `</section>`), add:
```svelte
  <CommentThread
    comments={comments ?? []}
    currentAuthor={currentAuthor ?? ''}
    onadd={(content) => onaddcomment?.(annotation.id, content)}
    onedit={(id, content) => oneditcomment?.(id, content)}
    ondelete={(id) => ondeletecomment?.(id)}
  />
```
Append to `AnnotationView.svelte.test.ts` (the existing `md-editor`-null test still passes because the reply box is collapsed):
```ts
  it('renders the comment thread', () => {
    render(AnnotationView, { annotation: annotation('# Note'), comments: [], currentAuthor: 'Me' });
    expect(screen.getByTestId('comment-thread')).toBeInTheDocument();
    expect(screen.getByTestId('comment-reply-trigger')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Wire `DetailApp.svelte`.** Add `commentsFor` to the `../../core/detailState` import; add `addComment, editComment, deleteComment` to the `./state` import. Pass to `<AnnotationView>` inside the `{#key}` block (keep all existing props):
```svelte
        comments={commentsFor($detail, current.id)}
        currentAuthor={$detail.currentAuthor}
        onaddcomment={(id, content) => addComment(id, content)}
        oneditcomment={(id, content) => editComment(id, content)}
        ondeletecomment={(id) => deleteComment(id)}
```

- [ ] **Step 7: Run component + unit + check-types + compile**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit && npm run check-types && npm run compile`
Expected: all green; bundle builds. (Confirm the existing AnnotationView "no md-editor for non-empty" test still passes — the collapsed reply box ensures it does.)

- [ ] **Step 8: Commit**
```bash
git add src/webview/detail/CommentThread.svelte src/webview/detail/CommentThread.svelte.test.ts src/webview/detail/AnnotationView.svelte src/webview/detail/AnnotationView.svelte.test.ts src/webview/detail/DetailApp.svelte
git commit -m "feat: comment thread UI in the annotation view (reply/edit/delete-own)"
```

---

## Task 5: Host wiring + email sources + integration + e2e + full suite

**Files:** Modify `src/web/authorSources.ts`, `src/web/detailPanelProvider.ts`, `src/web/extension.ts`, `src/web/test/suite/index.ts`, `package.json`; Create `src/web/test/suite/commentStore.integration.test.ts`, `test-workspace/.vscode/settings.json`, `e2e/comments.spec.ts`

- [ ] **Step 1: Email sources in `src/web/authorSources.ts`.** Make `VscodeAuthorNameSources` also implement `AuthorEmailSources` (import it). Add:
```ts
  async gitUserEmail(): Promise<string | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) return undefined;
    try {
      if (!ext.isActive) await ext.activate();
      const repo = ext.exports.getAPI(1).repositories[0];
      if (!repo) return undefined;
      const local = await repo.getConfig('user.email').catch(() => undefined);
      if (local) return local;
      return await repo.getGlobalConfig('user.email').catch(() => undefined);
    } catch {
      return undefined;
    }
  }
  settingAuthorEmail(): string | undefined {
    return vscode.workspace.getConfiguration('annotated').get<string>('authorEmail');
  }
  async githubAccountEmail(): Promise<string | undefined> {
    // VS Code's GitHub session doesn't reliably expose email; best-effort undefined.
    return undefined;
  }
```
(Change the class declaration to `implements AuthorNameSources, AuthorEmailSources`. Mirror the exact `gitUserName` idiom for `gitUserEmail`.)

- [ ] **Step 2: `package.json` — add the setting.** In `contributes.configuration.properties`, add alongside `annotated.authorName`:
```json
        "annotated.authorEmail": {
          "type": "string",
          "default": "",
          "description": "Email used to attribute your annotation comments (canonical identity)."
        }
```

- [ ] **Step 3: `detailPanelProvider.ts` — thread the comments + add hooks.** Import `ThreadComment` from `../shared/model`. Add private fields `private comments: ThreadComment[] = [];` and `private currentAuthor = '';`. Change `showGroup` to:
```ts
  showGroup(
    group: AnnotationGroup | null,
    palette: TagColor[],
    staleIds: string[] = [],
    comments: ThreadComment[] = [],
    currentAuthor = '',
  ): void {
    this.group = group;
    this.palette = palette;
    this.staleIds = staleIds;
    this.comments = comments;
    this.currentAuthor = currentAuthor;
    this.post();
  }
```
Include them in `post()`'s message: `{ type: 'setGroup', group: this.group, palette: this.palette, staleIds: this.staleIds, comments: this.comments, currentAuthor: this.currentAuthor }`. Add hooks:
```ts
  public onAddComment?: (groupId: string, annotationId: string, content: string) => void;
  public onEditComment?: (groupId: string, commentId: string, content: string) => void;
  public onDeleteComment?: (groupId: string, commentId: string) => void;
```
In `onDidReceiveMessage`, after the `updateGroupStatus` branch:
```ts
      } else if (message.type === 'addComment') {
        if (this.group) {
          this.onAddComment?.(this.group.id, message.annotationId, message.content);
        }
      } else if (message.type === 'editComment') {
        if (this.group) {
          this.onEditComment?.(this.group.id, message.commentId, message.content);
        }
      } else if (message.type === 'deleteComment') {
        if (this.group) {
          this.onDeleteComment?.(this.group.id, message.commentId);
        }
```

- [ ] **Step 4: `extension.ts` — load comments in the refresh path + memoized author + CRUD hooks.** Add imports: `CommentStore` (`../core/commentStore`), `flattenComments`/`slugifyAuthor` (`../core/comments`), `resolveAuthor`/`resolveAuthorEmail` (`../core/authorIdentity`), `VscodeAuthorNameSources` (`./authorSources`), `newId` (`../shared/ids`). Add a memoized identity resolver:
```ts
  let cachedAuthor: string | undefined;
  let cachedEmail: string | undefined;
  const currentIdentity = async (): Promise<{ author: string; email: string }> => {
    if (cachedAuthor === undefined) {
      const sources = new VscodeAuthorNameSources();
      cachedAuthor = await resolveAuthor(sources);
      cachedEmail = await resolveAuthorEmail(sources);
    }
    return { author: cachedAuthor, email: cachedEmail ?? '' };
  };
```
Change `showGroupWithStale` to also load comments + author:
```ts
  const showGroupWithStale = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const group = await new GroupStore(fs).getGroup(groupId);
    const staleIds = group ? await computeStaleIds(fs, group) : [];
    const ids = new Set(group?.annotations.map((a) => a.id) ?? []);
    const comments = flattenComments(await new CommentStore(fs).listCommentFiles()).filter((c) => ids.has(c.annotationId));
    const { author } = await currentIdentity();
    detailProvider.showGroup(group, readTagPalette(), staleIds, comments, author);
  };
```
Wire the comment hooks (near the other `detailProvider.on…` assignments):
```ts
  detailProvider.onAddComment = async (groupId, annotationId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const { author, email } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).addComment(slugifyAuthor(author), author, email, {
      id: newId(), annotationId, content, timestamp: now(),
    });
    await showGroupWithStale(groupId);
  };
  detailProvider.onEditComment = async (groupId, commentId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const { author } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).updateComment(slugifyAuthor(author), commentId, content);
    await showGroupWithStale(groupId);
  };
  detailProvider.onDeleteComment = async (groupId, commentId): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const { author } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).deleteComment(slugifyAuthor(author), commentId);
    await showGroupWithStale(groupId);
  };
```
(Edit/delete are inherently own-file-scoped: they only touch `slugifyAuthor(currentAuthor).json`.)

- [ ] **Step 5: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 6: Integration test** — create `src/web/test/suite/commentStore.integration.test.ts` (mirror an existing integration test's structure):
```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { CommentStore } from '../../../core/commentStore';

suite('CommentStore (vscode.workspace.fs)', () => {
  test('add → update → delete round-trips through the per-author file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new CommentStore(new VscodeFileSystem(folder.uri));
    const slug = 'itest-author';
    try {
      await store.addComment(slug, 'Itest Author', 'i@x', { id: 'ic1', annotationId: 'a1', content: 'hi', timestamp: 5 });
      let file = await store.getCommentFile(slug);
      if (file?.comments[0]?.content !== 'hi') {
        throw new Error(`add failed: ${JSON.stringify(file)}`);
      }
      if (!(await store.updateComment(slug, 'ic1', 'edited'))) {
        throw new Error('update returned false');
      }
      file = await store.getCommentFile(slug);
      if (file?.comments[0]?.content !== 'edited') {
        throw new Error(`update not persisted: ${JSON.stringify(file)}`);
      }
      if (!(await store.deleteComment(slug, 'ic1'))) {
        throw new Error('delete returned false');
      }
      file = await store.getCommentFile(slug);
      if ((file?.comments.length ?? 0) !== 0) {
        throw new Error(`delete not persisted: ${JSON.stringify(file)}`);
      }
    } finally {
      // Remove the author file so the workspace stays clean.
      await new VscodeFileSystem(folder.uri).delete(`.annotations/comments/${slug}.json`);
    }
  });
});
```
Register it in `src/web/test/suite/index.ts` (add `import('./commentStore.integration.test')` to the `Promise.all([...])`).

- [ ] **Step 7: Deterministic identity for the headless e2e.** Create `test-workspace/.vscode/settings.json`:
```json
{
  "annotated.authorName": "Tester",
  "annotated.authorEmail": "tester@example.com"
}
```
This makes `resolveAuthor`/`resolveAuthorEmail` return deterministically (no `showInputBox` prompt that would hang the headless run). REQUIRED — `showGroupWithStale` now resolves the author on every detail open, so without this the prompt could hang ALL detail e2e specs.

- [ ] **Step 8: Light comment e2e** — create `e2e/comments.spec.ts` (copy the open-an-annotation drill from `e2e/annotation.spec.ts` or `drift.spec.ts`; do NOT persist a comment — just assert the thread + reply affordance render):
```ts
import { test, expect } from '@playwright/test';

test('the comment thread renders in the annotation view', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').first().click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  await detail.getByTestId('annotation-row').first().click();
  await expect(detail.getByTestId('comment-thread')).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByTestId('comment-reply-trigger')).toBeVisible();
});
```
(Match the exact iframe drill of the existing annotation-open spec you copy from.)

- [ ] **Step 9: Run the e2e** (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm run test:e2e`
Expected: 10 passed (9 prior + `comments.spec`). CRITICAL: confirm the existing detail specs (drift/navigate/resolve/group-edit/annotation/detail) still pass — the new author resolution in `showGroupWithStale` must NOT prompt (the `.vscode/settings.json` ensures this). If any detail spec hangs/times out, the author setting isn't being picked up — verify the settings file path + that `settingAuthorName` reads `annotated.authorName`.

- [ ] **Step 10: Full suite (Definition of Done)** (`dangerouslyDisableSandbox: true`, `timeout: 600000`; `pkill -f vscode-test-web || true` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && pkill -f vscode-test-web || true; npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**10 passing** — 9 prior + commentStore) → `test:e2e` (**10 passed**). All green. Report ACTUAL counts. Then run `git status --short test-workspace/` — the only NEW tracked file should be `.vscode/settings.json` (intended); NO stray `.annotations/comments/*.json` (the integration test cleans up; the e2e doesn't persist). If a stray comment file exists, delete it + investigate.

- [ ] **Step 11: Commit**
```bash
git add src/web/authorSources.ts src/web/detailPanelProvider.ts src/web/extension.ts src/web/test/suite/commentStore.integration.test.ts src/web/test/suite/index.ts package.json test-workspace/.vscode/settings.json e2e/comments.spec.ts
git commit -m "feat: host wiring for comments (CommentStore + identity) + integration + thread e2e"
```

---

## Phase 3b Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (comment types/parse, flatten/slug/relativeTime, resolveAuthorEmail, CommentStore, protocol/state, CommentThread + earlier suites).
- [ ] `npm run test:integration` passes — **10 passing**.
- [ ] `npm run test:e2e` passes — **10 passed** (incl. comment-thread render; no detail spec regressions).
- [ ] No stray comment files left in `test-workspace/.annotations/comments/`.
- [ ] All work committed on the `phase-3` branch.
- [ ] Manual sanity (optional): add a comment → appears with author + "just now"; edit/delete shown only on your own; a second author's comments merge in by timestamp and are read-only.

Next in Phase 3: **3c** — inline ＋New tag creation (Create-Annotation flow + edit-tags QuickPick → prompt name+color → write `annotated.tags`). Then **3d** — bulk-select mode (Select toggle, per-card checkboxes, sticky action bar: tags / git ref / resolve-restore / delete). After 3d, Phase 3 is complete → final review → merge `phase-3` → `main`.

## Backlog
- Reliable comment `email` via the GitHub session (currently best-effort `undefined`); `githubAccountEmail` could use the GitHub API if a token scope is available.
