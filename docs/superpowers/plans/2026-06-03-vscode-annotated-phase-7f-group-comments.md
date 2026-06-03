# Phase 7f — Group Comments + Comment Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comments on groups (shown in the group detailed view, reusing the annotation comment UI) plus comment-count indicators — a message icon + count on each sidebar group card (annotation comments + group comments) and on each annotation row in the group view (round-3 TODO #10, spec §J).

**Architecture:** `Comment` targets **exactly one** of `annotationId`/`groupId` (parse-enforced; existing files unchanged on disk). Edit/delete reuse the existing commentId-keyed messages; only one new message (`addGroupComment`) and one new `setState` field (`commentCounts`, host-computed by a pure helper) are added. A shared `CommentBadge.svelte` renders the icon+count in both webviews (no inline styles — the sidebar CSP has no `'unsafe-inline'`).

**Tech Stack:** TypeScript, Svelte 5, Vitest (unit + component).

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

> **Shared-checkout caution:** another session may have files staged in this repo. Always commit with an explicit pathspec — `git add <files> && git commit -m "…" -- <files>` (the `git add` is needed for NEW files; pathspec commit alone works for tracked ones).

### Testing reality
Model parsing, count helpers, protocol parsing, and sidebar-state handling are unit-tested; all UI (badge, cards, rows, group thread) is component-tested. Host glue (`SidebarViewProvider` counts, `onAddGroupComment`, provider routing) is type-check + manual. **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Modify** `src/shared/model.ts` (+ `model.unit.test.ts`) — one-of `Comment` target; `src/web/extension.ts` (one line — widened detail filter, needed for compilation).
- **Modify** `src/core/comments.ts` (+ `.unit.test.ts`) — `groupCommentsOf`, `commentCountsByGroup`.
- **Modify** `src/shared/protocol.ts` (+ `.unit.test.ts`) — `setState.commentCounts?`, `addGroupComment`.
- **Modify** `src/core/sidebarState.ts` (+ `.unit.test.ts`) — `commentCounts` in state.
- **Modify** `src/web/sidebarViewProvider.ts` — send counts.
- **Modify** `src/web/detailPanelProvider.ts`, `src/web/extension.ts` — `addGroupComment` routing + handler.
- **Create** `src/webview/shared/CommentBadge.svelte` (+ `.svelte.test.ts`).
- **Modify** `src/webview/sidebar/GroupCard.svelte` (+ test), `src/webview/sidebar/App.svelte` (+ test).
- **Modify** `src/webview/detail/AnnotationRow.svelte` (+ test), `src/webview/detail/GroupView.svelte` (+ test), `src/webview/detail/DetailApp.svelte`, `src/webview/detail/state.ts`.

---

### Task 1: `Comment` targets an annotation OR a group (§J1)

**Files:**
- Modify: `src/shared/model.ts`
- Test: `src/shared/model.unit.test.ts`
- Modify: `src/web/extension.ts` (one line — keeps the codebase compiling)

- [ ] **Step 1: Write the failing tests** — append at the end of `src/shared/model.unit.test.ts` (add `parseCommentFile` to the import from `./model` if not present):

```ts
describe('parseCommentFile comment targets', () => {
  const base = { author: 'A', email: 'a@x' };
  it('parses an annotation comment (existing shape)', () => {
    const file = parseCommentFile({ ...base, comments: [{ id: 'c1', annotationId: 'a1', content: 'x', timestamp: 1 }] });
    expect(file.comments[0]).toEqual({ id: 'c1', annotationId: 'a1', content: 'x', timestamp: 1 });
  });
  it('parses a group comment', () => {
    const file = parseCommentFile({ ...base, comments: [{ id: 'c1', groupId: 'g1', content: 'x', timestamp: 1 }] });
    expect(file.comments[0]).toEqual({ id: 'c1', groupId: 'g1', content: 'x', timestamp: 1 });
  });
  it('rejects a comment with both targets', () => {
    expect(() =>
      parseCommentFile({ ...base, comments: [{ id: 'c1', annotationId: 'a1', groupId: 'g1', content: 'x', timestamp: 1 }] }),
    ).toThrow(/exactly one/);
  });
  it('rejects a comment with neither target', () => {
    expect(() => parseCommentFile({ ...base, comments: [{ id: 'c1', content: 'x', timestamp: 1 }] })).toThrow(/exactly one/);
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/model.unit.test.ts`
Expected: FAIL — group comment rejected ("annotationId must be a string"), both-targets accepted.

- [ ] **Step 3: Implement.** In `src/shared/model.ts`:

(a) Replace the `Comment` interface:

```ts
/** One comment in a per-author comment file — targets EITHER an annotation or a group. */
export interface Comment {
  id: string;
  /** Exactly one of `annotationId` / `groupId` is set. */
  annotationId?: string;
  groupId?: string;
  content: string;
  timestamp: number; // epoch seconds
}
```

(b) Replace `parseComment`:

```ts
function parseComment(raw: unknown): Comment {
  if (!isObject(raw)) fail('comment', 'is not an object');
  const { id, annotationId, groupId, content, timestamp } = raw;
  if (typeof id !== 'string') fail('comment.id', 'must be a string');
  if (typeof content !== 'string') fail('comment.content', 'must be a string');
  if (typeof timestamp !== 'number') fail('comment.timestamp', 'must be a number');
  if (annotationId !== undefined && typeof annotationId !== 'string') fail('comment.annotationId', 'must be a string');
  if (groupId !== undefined && typeof groupId !== 'string') fail('comment.groupId', 'must be a string');
  if ((annotationId === undefined) === (groupId === undefined)) {
    fail('comment', 'must target exactly one of annotationId / groupId');
  }
  if (typeof annotationId === 'string') {
    return { id, annotationId, content, timestamp };
  }
  return { id, groupId: groupId as string, content, timestamp };
}
```

(c) In `src/web/extension.ts`, inside `showGroupWithStale`, replace the comment-filter line:

```ts
    const comments = flattenComments(await new CommentStore(fs).listCommentFiles()).filter((c) => ids.has(c.annotationId));
```

with (this is also §J4's widened filter — group comments now reach the detail panel):

```ts
    const comments = flattenComments(await new CommentStore(fs).listCommentFiles()).filter(
      (c) => (c.annotationId !== undefined && ids.has(c.annotationId)) || c.groupId === groupId,
    );
```

- [ ] **Step 4: Verify**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean + ALL tests pass (existing comment fixtures use `annotationId` and still parse; `commentsFor` compares with `===` so optional is safe).

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(model): comments target an annotation OR a group (TODO #11)" -- src/shared/model.ts src/shared/model.unit.test.ts src/web/extension.ts
```

---

### Task 2: Pure helpers — `groupCommentsOf`, `commentCountsByGroup` (§J2)

**Files:**
- Modify: `src/core/comments.ts`
- Test: `src/core/comments.unit.test.ts`

- [ ] **Step 1: Write the failing tests** — append at the end of `src/core/comments.unit.test.ts` (extend the imports: `groupCommentsOf, commentCountsByGroup` from `./comments`; `type AnnotationGroup, type ThreadComment` from `../shared/model`):

```ts
describe('groupCommentsOf', () => {
  const comments: ThreadComment[] = [
    { id: 'c1', groupId: 'g1', author: 'A', content: 'x', timestamp: 1 },
    { id: 'c2', annotationId: 'a1', author: 'A', content: 'y', timestamp: 2 },
    { id: 'c3', groupId: 'g2', author: 'B', content: 'z', timestamp: 3 },
  ];
  it('keeps only comments targeting the group itself, in order', () => {
    expect(groupCommentsOf(comments, 'g1').map((c) => c.id)).toEqual(['c1']);
  });
});

describe('commentCountsByGroup', () => {
  const groups: AnnotationGroup[] = [
    {
      id: 'g1', title: 'T', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' }],
    },
    { id: 'g2', title: 'U', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] },
  ];
  it('sums annotation comments + group comments per group; orphans ignored', () => {
    const comments: ThreadComment[] = [
      { id: 'c1', annotationId: 'a1', author: 'A', content: 'x', timestamp: 1 },
      { id: 'c2', annotationId: 'a1', author: 'B', content: 'y', timestamp: 2 },
      { id: 'c3', groupId: 'g1', author: 'A', content: 'z', timestamp: 3 },
      { id: 'c4', groupId: 'g2', author: 'A', content: 'w', timestamp: 4 },
      { id: 'c5', annotationId: 'orphan', author: 'A', content: 'v', timestamp: 5 },
    ];
    expect(commentCountsByGroup(groups, comments)).toEqual({ g1: 3, g2: 1 });
  });
  it('returns zero entries for comment-less groups', () => {
    expect(commentCountsByGroup(groups, [])).toEqual({ g1: 0, g2: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/comments.unit.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — in `src/core/comments.ts`, add `type AnnotationGroup` to the model import, then append:

```ts
/** Comments attached to the group itself (not to its annotations); order preserved. */
export function groupCommentsOf(comments: ThreadComment[], groupId: string): ThreadComment[] {
  return comments.filter((c) => c.groupId === groupId);
}

/**
 * Per-group comment totals for the sidebar badges: comments on the group's
 * annotations plus comments on the group itself. Every group gets an entry
 * (0 when comment-less); comments on unknown targets are ignored.
 */
export function commentCountsByGroup(groups: AnnotationGroup[], comments: ThreadComment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const groupByAnnotation = new Map<string, string>();
  for (const g of groups) {
    counts[g.id] = 0;
    for (const a of g.annotations) {
      groupByAnnotation.set(a.id, g.id);
    }
  }
  for (const c of comments) {
    const gid = c.groupId ?? (c.annotationId !== undefined ? groupByAnnotation.get(c.annotationId) : undefined);
    if (gid !== undefined && gid in counts) {
      counts[gid] += 1;
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/comments.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(core): groupCommentsOf + commentCountsByGroup helpers (TODO #11)" -- src/core/comments.ts src/core/comments.unit.test.ts
```

---

### Task 3: Protocol + sidebar state + sidebar provider (§J3, part of §J4)

**Files:**
- Modify: `src/shared/protocol.ts`
- Test: `src/shared/protocol.unit.test.ts`
- Modify: `src/core/sidebarState.ts`
- Test: `src/core/sidebarState.unit.test.ts`
- Modify: `src/web/sidebarViewProvider.ts`

- [ ] **Step 1: Write the failing tests.**

(a) In `src/shared/protocol.unit.test.ts`, append inside `describe('parseDetailMessage', ...)`:

```ts
  it('accepts addGroupComment (content required)', () => {
    expect(parseDetailMessage({ type: 'addGroupComment', content: 'hi' })).toEqual({ type: 'addGroupComment', content: 'hi' });
    expect(parseDetailMessage({ type: 'addGroupComment' })).toBeNull();
  });
```

(b) In `src/core/sidebarState.unit.test.ts`, append inside its top-level describe:

```ts
  it('stores commentCounts from setState, defaulting to {}', () => {
    const withCounts = applyHostMessage(initialSidebarState(), {
      type: 'setState', groups: [], palette: [], commentCounts: { g1: 2 },
    });
    expect(withCounts.commentCounts).toEqual({ g1: 2 });
    const without = applyHostMessage(initialSidebarState(), { type: 'setState', groups: [], palette: [] });
    expect(without.commentCounts).toEqual({});
  });
```

(If the file asserts the full `initialSidebarState()` shape anywhere with `toEqual`, add `commentCounts: {}` to that expected object.)

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/protocol.unit.test.ts src/core/sidebarState.unit.test.ts`
Expected: FAIL (type errors for `commentCounts` / null parse for addGroupComment).

- [ ] **Step 3: Implement.**

(a) `src/shared/protocol.ts`:

- `HostToWebview` gains the optional field:

```ts
export type HostToWebview = {
  type: 'setState';
  groups: AnnotationGroup[];
  palette: TagColor[];
  /** Per-group comment totals (annotation + group comments) for the card badges. */
  commentCounts?: Record<string, number>;
};
```

- `DetailToHost` union gains (next to `addComment`):

```ts
  | { type: 'addGroupComment'; content: string }
```

- `parseDetailMessage` gains the case (next to `addComment`):

```ts
    case 'addGroupComment':
      return typeof raw.content === 'string' ? { type: 'addGroupComment', content: raw.content } : null;
```

(b) `src/core/sidebarState.ts`:

- `SidebarState` gains `commentCounts: Record<string, number>;`
- `initialSidebarState()` returns `commentCounts: {}` (add to the object literal).
- `applyHostMessage`'s `setState` branch gains `commentCounts: message.commentCounts ?? {},`.

(c) `src/web/sidebarViewProvider.ts`:

- Add imports:

```ts
import { CommentStore } from '../core/commentStore';
import { flattenComments, commentCountsByGroup } from '../core/comments';
```

- Replace the body of `refresh()`:

```ts
  /** Reload groups + comment counts from disk and push fresh state to the webview. */
  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const fs = folder ? new VscodeFileSystem(folder.uri) : null;
    const groups = fs ? await new GroupStore(fs).listGroups() : [];
    const comments = fs ? flattenComments(await new CommentStore(fs).listCommentFiles()) : [];
    const message: HostToWebview = {
      type: 'setState',
      groups,
      palette: displayPalette(groups),
      commentCounts: commentCountsByGroup(groups, comments),
    };
    void this.view.webview.postMessage(message);
  }
```

- [ ] **Step 4: Verify**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean + all PASS.

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(protocol): addGroupComment message + commentCounts in setState (TODO #11)" -- src/shared/protocol.ts src/shared/protocol.unit.test.ts src/core/sidebarState.ts src/core/sidebarState.unit.test.ts src/web/sidebarViewProvider.ts
```

---

### Task 4: Host routing + persistence for group comments (§J4)

**Files:**
- Modify: `src/web/detailPanelProvider.ts`
- Modify: `src/web/extension.ts`

- [ ] **Step 1: `DetailPanelProvider`.**

(a) Add the callback declaration next to `onAddComment`:

```ts
  /** Set by the extension: add a comment to the group itself. */
  public onAddGroupComment?: (groupId: string, content: string) => void;
```

(b) In `onDidReceiveMessage`, add the routing case after the `addComment` branch:

```ts
      } else if (message.type === 'addGroupComment') {
        if (this.group) {
          this.onAddGroupComment?.(this.group.id, message.content);
        }
```

- [ ] **Step 2: `extension.ts` handler.** Add after the `detailProvider.onAddComment` assignment:

```ts
  detailProvider.onAddGroupComment = async (groupId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const { author, email } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).addComment(slugifyAuthor(author), author, email, {
      id: newId(), groupId, content, timestamp: now(),
    });
    await showGroupWithStale(groupId);
  };
```

(Edit/delete of group comments need NO new code — `editComment`/`deleteComment` are commentId-keyed.)

- [ ] **Step 3: Verify**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: clean.

- [ ] **Step 4: Commit (pathspec form)**

```bash
git commit -m "feat(web): persist group comments via addGroupComment (TODO #11)" -- src/web/detailPanelProvider.ts src/web/extension.ts
```

---

### Task 5: Shared `CommentBadge` component (§J5)

**Files:**
- Create: `src/webview/shared/CommentBadge.svelte`
- Create: `src/webview/shared/CommentBadge.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/webview/shared/CommentBadge.svelte.test.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import CommentBadge from './CommentBadge.svelte';

describe('CommentBadge', () => {
  it('renders the count with a message icon', () => {
    render(CommentBadge, { count: 3 });
    const badge = screen.getByTestId('comment-badge');
    expect(badge).toHaveTextContent('3');
    expect(badge.querySelector('svg')).not.toBeNull();
  });
  it('renders nothing when the count is zero', () => {
    render(CommentBadge, { count: 0 });
    expect(screen.queryByTestId('comment-badge')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/shared/CommentBadge.svelte.test.ts`
Expected: FAIL — component missing. (If the component project's include glob doesn't cover `src/webview/shared/`, widen it in `vitest.config.ts` to `src/webview/**/*.svelte.test.ts` and report that as part of this task.)

- [ ] **Step 3: Implement** — create `src/webview/shared/CommentBadge.svelte`:

```svelte
<script lang="ts">
  // Message icon + count, shown only when there is at least one comment (round-3 #11).
  let { count = 0 }: { count?: number } = $props();
</script>

{#if count > 0}
  <span class="badge" data-testid="comment-badge" title="{count} comment{count === 1 ? '' : 's'}">
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3.5-3H14a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"
      />
    </svg>
    {count}
  </span>
{/if}

<style>
  /* No inline styles anywhere — the sidebar webview CSP has no 'unsafe-inline'. */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-descriptionForeground, #9a9a9a);
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/shared/CommentBadge.svelte.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (pathspec form — `git add` first, new files)**

```bash
git add src/webview/shared/CommentBadge.svelte src/webview/shared/CommentBadge.svelte.test.ts
git commit -m "feat(webview): shared CommentBadge icon+count component (TODO #11)" -- src/webview/shared/CommentBadge.svelte src/webview/shared/CommentBadge.svelte.test.ts
```

(If `vitest.config.ts` needed the glob widening in Step 2, include it in both the `git add` and the pathspec.)

---

### Task 6: Sidebar — badge on group cards (§J5)

**Files:**
- Modify: `src/webview/sidebar/GroupCard.svelte`
- Test: `src/webview/sidebar/GroupCard.svelte.test.ts`
- Modify: `src/webview/sidebar/App.svelte`
- Test: `src/webview/sidebar/App.svelte.test.ts`

- [ ] **Step 1: Write the failing tests.**

(a) Append inside `describe('GroupCard', ...)`:

```ts
  it('shows a comment badge when the group has comments', () => {
    render(GroupCard, { group: group(), palette: [], commentCount: 5 });
    expect(screen.getByTestId('comment-badge')).toHaveTextContent('5');
  });
  it('shows no comment badge at zero comments', () => {
    render(GroupCard, { group: group(), palette: [] });
    expect(screen.queryByTestId('comment-badge')).toBeNull();
  });
```

(b) Append inside `describe('App.svelte', ...)`:

```ts
  it('passes per-group comment counts to the cards', () => {
    sidebar.set({ ...initialSidebarState(), groups: [group('g1', 'One')], palette: [], commentCounts: { g1: 4 } });
    render(App);
    expect(screen.getByTestId('comment-badge')).toHaveTextContent('4');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/GroupCard.svelte.test.ts src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

(a) `src/webview/sidebar/GroupCard.svelte`:

- Add the import: `import CommentBadge from '../shared/CommentBadge.svelte';`
- Add `commentCount = 0` to the destructured props and `commentCount?: number;` to the props type.
- The meta line becomes:

```svelte
  <div class="meta">{group.author} · {group.annotations.length} annotation{group.annotations.length === 1 ? '' : 's'} <CommentBadge count={commentCount} /></div>
```

(b) `src/webview/sidebar/App.svelte` — the card instantiation gains one prop:

```svelte
        <GroupCard
          {group}
          palette={$sidebar.palette}
          commentCount={$sidebar.commentCounts[group.id] ?? 0}
          selected={$sidebar.selectedId === group.id}
          bulkMode={$sidebar.bulkMode}
          checked={$sidebar.selectedGroupIds.includes(group.id)}
          oncheck={toggleGroupSelection}
          {onselect}
        />
```

- [ ] **Step 4: Run to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/GroupCard.svelte.test.ts src/webview/sidebar/App.svelte.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(sidebar): comment-count badge on group cards (TODO #11)" -- src/webview/sidebar/GroupCard.svelte src/webview/sidebar/GroupCard.svelte.test.ts src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts
```

---

### Task 7: Detail panel — group thread + row badges (§J5)

**Files:**
- Modify: `src/webview/detail/AnnotationRow.svelte` (+ `.svelte.test.ts`)
- Modify: `src/webview/detail/GroupView.svelte` (+ `.svelte.test.ts`)
- Modify: `src/webview/detail/DetailApp.svelte`
- Modify: `src/webview/detail/state.ts`

- [ ] **Step 1: Write the failing tests.**

(a) Append inside `describe('AnnotationRow', ...)` (reuse the file's existing `annotation(...)` fixture helper):

```ts
  it('shows a comment badge when commentCount > 0', () => {
    render(AnnotationRow, { annotation: annotation('x'), commentCount: 2 });
    expect(screen.getByTestId('comment-badge')).toHaveTextContent('2');
  });
  it('shows no comment badge by default', () => {
    render(AnnotationRow, { annotation: annotation('x') });
    expect(screen.queryByTestId('comment-badge')).toBeNull();
  });
```

(b) In `src/webview/detail/GroupView.svelte.test.ts` — first add the MarkdownEditor mock at the top (after the other imports, exactly like CommentThread.svelte.test.ts has):

```ts
vi.mock('./MarkdownEditor.svelte', async () => ({
  default: (await import('./__mocks__/MarkdownEditorStub.svelte')).default,
}));
```

then append inside `describe('GroupView', ...)`:

```ts
  it('renders the group comment thread and routes add to onaddgroupcomment', async () => {
    const onaddgroupcomment = vi.fn();
    render(GroupView, {
      group: group(), palette, currentAuthor: 'Me', onaddgroupcomment,
      comments: [
        { id: 'c1', groupId: 'g1', author: 'Ana', content: 'group note', timestamp: 100 },
        { id: 'c2', annotationId: 'a1', author: 'Ana', content: 'row note', timestamp: 200 },
      ],
    });
    const thread = screen.getByTestId('comment-thread');
    expect(thread).toHaveTextContent('group note');
    expect(thread).not.toHaveTextContent('row note');
    await userEvent.click(screen.getByTestId('comment-reply-trigger'));
    await userEvent.type(screen.getByTestId('md-editor'), 'hi');
    await userEvent.click(screen.getByTestId('comment-add-btn'));
    expect(onaddgroupcomment).toHaveBeenCalledWith('hi');
  });

  it('shows per-annotation comment counts on rows', () => {
    render(GroupView, {
      group: group(), palette,
      comments: [
        { id: 'c1', annotationId: 'a1', author: 'Ana', content: 'x', timestamp: 1 },
        { id: 'c2', annotationId: 'a1', author: 'Bob', content: 'y', timestamp: 2 },
      ],
    });
    expect(screen.getByTestId('comment-badge')).toHaveTextContent('2');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/AnnotationRow.svelte.test.ts src/webview/detail/GroupView.svelte.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

(a) `src/webview/detail/AnnotationRow.svelte`:

- Import: `import CommentBadge from '../shared/CommentBadge.svelte';`
- Props gain `commentCount = 0` (type `commentCount?: number;`).
- Template — between the summary span and the loc span:

```svelte
  <span class="summary">{summary}</span>
  <CommentBadge count={commentCount} />
  <span class="loc" data-testid="annotation-loc" title={fullLoc}>{shortLoc}</span>
```

(b) `src/webview/detail/GroupView.svelte`:

- Imports: add `type ThreadComment` to the model import; add:

```ts
  import { groupCommentsOf } from '../../core/comments';
  import CommentThread from './CommentThread.svelte';
```

- Props: add `comments = []`, `currentAuthor = ''`, `onaddgroupcomment`, `oneditcomment`, `ondeletecomment` to the destructuring, and to the type:

```ts
    comments?: ThreadComment[];
    currentAuthor?: string;
    onaddgroupcomment?: (content: string) => void;
    oneditcomment?: (commentId: string, content: string) => void;
    ondeletecomment?: (commentId: string) => void;
```

- Derived (after `resolveLabel`): `const groupComments = $derived(groupCommentsOf(comments, group.id));`
- The `AnnotationRow` instantiation gains:

```svelte
        <AnnotationRow
          {annotation}
          selected={false}
          stale={staleIds.includes(annotation.id)}
          commentCount={comments.filter((c) => c.annotationId === annotation.id).length}
          onselect={(id) => onselectrow?.(id)}
        />
```

- After the closing `</div>` of `.rows`, add:

```svelte
  <CommentThread
    comments={groupComments}
    {currentAuthor}
    onadd={(content) => onaddgroupcomment?.(content)}
    onedit={(id, content) => oneditcomment?.(id, content)}
    ondelete={(id) => ondeletecomment?.(id)}
  />
```

(c) `src/webview/detail/state.ts` — append:

```ts
/** Add a comment to the current group itself (host attributes + persists). */
export function addGroupComment(content: string): void {
  postToHost({ type: 'addGroupComment', content });
}
```

(d) `src/webview/detail/DetailApp.svelte`:

- Add `addGroupComment` to the `./state` import list.
- The `GroupView` instantiation gains:

```svelte
    <GroupView
      group={$detail.group}
      palette={$detail.palette}
      staleIds={$detail.staleIds ?? []}
      comments={$detail.comments}
      currentAuthor={$detail.currentAuthor}
      onrename={(title) => renameGroup(title)}
      onedittags={requestEditTags}
      oneditgitref={requestEditGitRef}
      onselectrow={openRow}
      onreorder={(ids) => reorderAnnotations(ids)}
      onsetstatus={(s) => setGroupStatus(s)}
      onaddgroupcomment={(content) => addGroupComment(content)}
      oneditcomment={(id, content) => editComment(id, content)}
      ondeletecomment={(id) => deleteComment(id)}
    />
```

- If `DetailApp.svelte.test.ts` does not already mock MarkdownEditor, add the same `vi.mock('./MarkdownEditor.svelte', …)` block there (GroupView now transitively renders it).

- [ ] **Step 4: Run to verify everything passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail`
Expected: PASS (all detail component suites, including DetailApp).

- [ ] **Step 5: Commit (pathspec form)**

```bash
git commit -m "feat(detail): group comment thread + per-row comment badges (TODO #11)" -- src/webview/detail/AnnotationRow.svelte src/webview/detail/AnnotationRow.svelte.test.ts src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts src/webview/detail/DetailApp.svelte src/webview/detail/state.ts
```

(Include `src/webview/detail/DetailApp.svelte.test.ts` in the pathspec if it needed the mock.)

---

### Task 8: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage (§J):** J1 → Task 1 (one-of parse; disk format backward-compatible); J2 → Task 2; J3 → Task 3 (`commentCounts` optional — keeps old fixtures compiling; webview defaults `{}`); J4 → Task 1c (widened detail filter) + Task 3c (sidebar counts) + Task 4 (addGroupComment routing/persistence; edit/delete reuse commentId-keyed messages); J5 → Tasks 5–7 (badge component, cards, rows, group thread). Badges only render when count > 0 (per feedback). ✓
- **Type consistency:** `Comment.annotationId?/groupId?`; `commentsFor` (detailState) uses `===` so optional is safe; the ONLY `ids.has(c.annotationId)` call is fixed in Task 1c; `commentCountsByGroup(groups, comments): Record<string, number>` matches the `setState` field; `CommentBadge` prop `count?: number`. ✓
- **Compile-green between tasks:** Task 1 fixes extension.ts in the same commit (the only type break); Task 3 updates `sidebarViewProvider` in the same commit (setState construction)… `commentCounts` is optional so the provider would compile anyway, but it ships the real counts together with the field. ✓
- **CSP:** CommentBadge uses class-based styles only. ✓
- **Shared checkout:** every commit uses the pathspec form. ✓
