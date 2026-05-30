# vscode-annotated — Phase 2a: Editable Group Metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a group's **title**, **tags**, and **Git ref** editable from the group view. Title is edited inline in the webview; tags and Git ref are edited via native QuickPicks driven by the host (tags from the configured palette; Git ref suggesting the current HEAD short SHA + branches + tags on desktop, free-text on web). Edits persist to the group JSON and the panel + sidebar refresh.

**Architecture:** A new `GroupStore.updateGroup(groupId, patch, now)` (immutable partial update). New `DetailToHost` messages: `setGroupTitle` (from the inline webview edit), `editTags` and `editGitRef` (the webview asks the host to run a native picker). The host pickers use a pure `gitRefSuggestions(...)` helper (unit-tested) fed by a thin Git-extension adapter. Title editing lives in a small webview affordance; everything else is host glue.

**Tech Stack:** TypeScript + Svelte 5. Builds on Phase 1. The Git extension (`vscode.git`) is **desktop-only** (undefined on web/`@vscode/test-web`) — so Git-ref suggestions appear on desktop; on web the user types the ref. Vitest unit/component + `@vscode/test-web` integration + Playwright e2e.

> **Conventions:** branch `phase-2` (already checked out); Node via `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; integration/e2e need `dangerouslyDisableSandbox: true` + `timeout: 600000` (`pkill -f vscode-test-web` first).

---

## Context (Phase 1)

- `src/core/groupStore.ts` — `GroupStore` (`listGroups`/`getGroup`/`saveGroup`/`deleteGroup`/`updateAnnotation`). `groupStore.unit.test.ts` uses a `group(id, title?)` helper + `MemoryFileSystem`.
- `src/shared/protocol.ts` — `DetailToHost = ready | selectAnnotation | updateAnnotation | copyText`; `parseDetailMessage` (module-level `isObject`).
- `src/webview/detail/DetailApp.svelte` — group view renders header (title/author/status, tag chips, gitRef) + `AnnotationRow` list; annotation view via `{#key}`. Uses store actions from `state.ts`.
- `src/webview/detail/state.ts` — `detail` writable; `handleHostMessage`; `openAnnotationView`/`showGroupView`/`saveAnnotationContent`/`copyToClipboard` (all `postToHost`).
- `src/web/detailPanelProvider.ts` — `DetailPanelProvider`: holds `this.group`/`this.palette`; `showGroup`; `onSelectAnnotation`/`onUpdateAnnotation` hooks; `onDidReceiveMessage` → `parseDetailMessage`.
- `src/web/extension.ts` — wires `provider.onSelectGroup` (load+showGroup+focus), `detailProvider.onSelectAnnotation` (navigate), `detailProvider.onUpdateAnnotation` (updateAnnotation+reload+re-post). `GroupStore`/`VscodeFileSystem`/`readTagPalette` imported.
- `src/web/tagPalette.ts` — `readTagPalette(): Tag[]`. `src/core/tags.ts` — `Tag { name; color }`.

---

## File Structure (2a)

```
src/core/groupStore.ts                        (modify) # + updateGroup(groupId, patch, now)
src/core/groupStore.unit.test.ts              (modify) # + updateGroup tests
src/core/gitRefs.ts                           (new)    # pure: gitRefSuggestions(info) → picker items
src/core/gitRefs.unit.test.ts                 (new)
src/shared/protocol.ts                        (modify) # DetailToHost += setGroupTitle, editTags, editGitRef
src/shared/protocol.unit.test.ts              (modify) # tests
src/webview/detail/GroupView.svelte           (new)    # extracted group view + inline title edit + edit buttons
src/webview/detail/GroupView.svelte.test.ts   (new)
src/webview/detail/DetailApp.svelte           (modify) # group-mode renders <GroupView> (extracts existing markup)
src/webview/detail/DetailApp.svelte.test.ts   (modify) # still asserts detail-title + rows in group mode
src/webview/detail/state.ts                   (modify) # + setGroupTitle / editTags / editGitRef senders
src/web/gitRefsSource.ts                      (new)    # Git-extension adapter → GitRefInfo (desktop; empty on web)
src/web/detailPanelProvider.ts                (modify) # handle setGroupTitle/editTags/editGitRef hooks
src/web/extension.ts                          (modify) # wire the three edit hooks (QuickPick/InputBox + updateGroup + re-post)
src/web/test/suite/updateGroup.integration.test.ts (new)
src/web/test/suite/index.ts                   (modify) # import the new integration test
e2e/group-edit.spec.ts                        (new)    # inline-edit the title → persists/reflects
```

---

## Task 1: GroupStore.updateGroup

**Files:** Modify `src/core/groupStore.ts`, `src/core/groupStore.unit.test.ts`

- [ ] **Step 1: Add failing tests** — in `src/core/groupStore.unit.test.ts`, inside the `describe('GroupStore', …)` block:

```ts
  it('updateGroup applies a partial patch, bumps updatedAt, and persists', async () => {
    await store.saveGroup(group('g1', 'Old'));
    const ok = await store.updateGroup('g1', { title: 'New', tags: ['security'], gitRef: 'main' }, 555);
    expect(ok).toBe(true);
    const g = await store.getGroup('g1');
    expect(g?.title).toBe('New');
    expect(g?.tags).toEqual(['security']);
    expect(g?.gitRef).toBe('main');
    expect(g?.updatedAt).toBe(555);
  });

  it('updateGroup leaves unspecified fields unchanged', async () => {
    await store.saveGroup({ ...group('g1', 'Keep'), tags: ['a'], gitRef: 'dev' });
    await store.updateGroup('g1', { title: 'Renamed' }, 1);
    const g = await store.getGroup('g1');
    expect(g?.title).toBe('Renamed');
    expect(g?.tags).toEqual(['a']);
    expect(g?.gitRef).toBe('dev');
  });

  it('updateGroup can set gitRef to null', async () => {
    await store.saveGroup({ ...group('g1'), gitRef: 'x' });
    await store.updateGroup('g1', { gitRef: null }, 1);
    expect((await store.getGroup('g1'))?.gitRef).toBeNull();
  });

  it('updateGroup returns false for a missing group', async () => {
    expect(await store.updateGroup('nope', { title: 'x' }, 1)).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts`
Expected: FAIL — `updateGroup` is not a method.

- [ ] **Step 3: Add `updateGroup` to `src/core/groupStore.ts`** (after `updateAnnotation`)

```ts
  /**
   * Apply a partial patch to a group's metadata (title/tags/gitRef), bump
   * updatedAt, and persist. Returns false if the group does not exist.
   */
  async updateGroup(
    groupId: string,
    patch: Partial<Pick<AnnotationGroup, 'title' | 'tags' | 'gitRef'>>,
    now: number,
  ): Promise<boolean> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return false;
    }
    const next: AnnotationGroup = {
      ...group,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      ...(patch.gitRef !== undefined ? { gitRef: patch.gitRef } : {}),
      updatedAt: now,
    };
    await this.saveGroup(next);
    return true;
  }
```

(`AnnotationGroup` is already imported in `groupStore.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/groupStore.ts src/core/groupStore.unit.test.ts
git commit -m "feat: GroupStore.updateGroup (partial metadata patch)"
```

---

## Task 2: Git-ref suggestions (pure)

**Files:** Create `src/core/gitRefs.ts`, `src/core/gitRefs.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/gitRefs.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { gitRefSuggestions } from './gitRefs';

describe('gitRefSuggestions', () => {
  it('lists the HEAD short SHA first, then branches, then tags', () => {
    const out = gitRefSuggestions({ headSha: 'abcdef1234567890', branches: ['main', 'dev'], tags: ['v1.0'] });
    expect(out).toEqual([
      { ref: 'abcdef1', label: 'abcdef1', description: 'current commit (HEAD)' },
      { ref: 'main', label: 'main', description: 'branch' },
      { ref: 'dev', label: 'dev', description: 'branch' },
      { ref: 'v1.0', label: 'v1.0', description: 'tag' },
    ]);
  });

  it('omits HEAD when there is no headSha', () => {
    expect(gitRefSuggestions({ branches: ['main'], tags: [] })).toEqual([
      { ref: 'main', label: 'main', description: 'branch' },
    ]);
  });

  it('returns [] when there is no git info', () => {
    expect(gitRefSuggestions({ branches: [], tags: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/gitRefs.unit.test.ts`
Expected: FAIL — cannot resolve `./gitRefs`.

- [ ] **Step 3: Implement `src/core/gitRefs.ts`**

```ts
export interface GitRefInfo {
  /** Full HEAD commit SHA, if a repo/commit is available. */
  headSha?: string;
  branches: string[];
  tags: string[];
}

export interface RefSuggestion {
  /** The value to store as the group's gitRef. */
  ref: string;
  /** Display label. */
  label: string;
  /** Display description (kind). */
  description: string;
}

/** Build Git-ref picker suggestions: HEAD short SHA first, then branches, then tags. */
export function gitRefSuggestions(info: GitRefInfo): RefSuggestion[] {
  const suggestions: RefSuggestion[] = [];
  if (info.headSha) {
    const short = info.headSha.slice(0, 7);
    suggestions.push({ ref: short, label: short, description: 'current commit (HEAD)' });
  }
  for (const branch of info.branches) {
    suggestions.push({ ref: branch, label: branch, description: 'branch' });
  }
  for (const tag of info.tags) {
    suggestions.push({ ref: tag, label: tag, description: 'tag' });
  }
  return suggestions;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/gitRefs.unit.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/gitRefs.ts src/core/gitRefs.unit.test.ts
git commit -m "feat: pure gitRefSuggestions helper (HEAD/branches/tags)"
```

---

## Task 3: Protocol messages for group edits

**Files:** Modify `src/shared/protocol.ts`, `src/shared/protocol.unit.test.ts`

- [ ] **Step 1: Append tests** — inside `describe('parseDetailMessage', …)` in `src/shared/protocol.unit.test.ts`:

```ts
  it('accepts setGroupTitle with a string title', () => {
    expect(parseDetailMessage({ type: 'setGroupTitle', title: 'T' })).toEqual({ type: 'setGroupTitle', title: 'T' });
  });
  it('rejects setGroupTitle without a string title', () => {
    expect(parseDetailMessage({ type: 'setGroupTitle', title: 5 })).toBeNull();
  });
  it('accepts editTags and editGitRef', () => {
    expect(parseDetailMessage({ type: 'editTags' })).toEqual({ type: 'editTags' });
    expect(parseDetailMessage({ type: 'editGitRef' })).toEqual({ type: 'editGitRef' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts`
Expected: FAIL — these message types are not handled.

- [ ] **Step 3: Extend `DetailToHost` in `src/shared/protocol.ts`** (add 3 variants):

```ts
export type DetailToHost =
  | { type: 'ready' }
  | { type: 'selectAnnotation'; annotationId: string }
  | { type: 'updateAnnotation'; annotationId: string; content: string }
  | { type: 'copyText'; text: string }
  | { type: 'setGroupTitle'; title: string }
  | { type: 'editTags' }
  | { type: 'editGitRef' };
```

Add these cases to `parseDetailMessage` (before `default`):

```ts
    case 'setGroupTitle':
      return typeof raw.title === 'string' ? { type: 'setGroupTitle', title: raw.title } : null;
    case 'editTags':
      return { type: 'editTags' };
    case 'editGitRef':
      return { type: 'editGitRef' };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat: protocol messages for group edits (setGroupTitle/editTags/editGitRef)"
```

---

## Task 4: GroupView component (extract + inline title edit + edit buttons)

**Files:** Create `src/webview/detail/GroupView.svelte`, `src/webview/detail/GroupView.svelte.test.ts`; Modify `src/webview/detail/state.ts`, `src/webview/detail/DetailApp.svelte`, `src/webview/detail/DetailApp.svelte.test.ts`

- [ ] **Step 1: Add store senders to `src/webview/detail/state.ts`** (append; `postToHost` is already imported):

```ts
/** Rename the active group. */
export function renameGroup(title: string): void {
  postToHost({ type: 'setGroupTitle', title });
}

/** Ask the host to edit the active group's tags (native picker). */
export function requestEditTags(): void {
  postToHost({ type: 'editTags' });
}

/** Ask the host to edit the active group's Git ref (native picker). */
export function requestEditGitRef(): void {
  postToHost({ type: 'editGitRef' });
}
```

- [ ] **Step 2: Write the failing test** — `src/webview/detail/GroupView.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import GroupView from './GroupView.svelte';
import { type AnnotationGroup } from '../../shared/model';
import { type TagColor } from '../../shared/protocol';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'Login review', author: 'Ezequiel', tags: ['security'], gitRef: 'main', status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [{ id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' }],
  };
}
const palette: TagColor[] = [{ name: 'security', color: '#c0392b' }];

describe('GroupView', () => {
  it('renders title, author/status, tag chips, gitRef, and annotation rows', () => {
    render(GroupView, { group: group(), palette });
    expect(screen.getByTestId('detail-title')).toHaveTextContent('Login review');
    expect(screen.getByTestId('group-view')).toHaveTextContent('Ezequiel');
    expect(screen.getByTestId('group-view')).toHaveTextContent('security');
    expect(screen.getByTestId('group-view')).toHaveTextContent('main');
    expect(screen.getAllByTestId('annotation-row')).toHaveLength(1);
  });

  it('edits the title inline and calls onrename on commit', async () => {
    const onrename = vi.fn();
    render(GroupView, { group: group(), palette, onrename });
    await userEvent.click(screen.getByTestId('title-edit-btn'));
    const input = screen.getByTestId('title-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');
    expect(onrename).toHaveBeenCalledWith('Renamed');
  });

  it('calls oneditgitref / onedittags when those buttons are clicked', async () => {
    const oneditgitref = vi.fn();
    const onedittags = vi.fn();
    render(GroupView, { group: group(), palette, oneditgitref, onedittags });
    await userEvent.click(screen.getByTestId('edit-gitref-btn'));
    await userEvent.click(screen.getByTestId('edit-tags-btn'));
    expect(oneditgitref).toHaveBeenCalled();
    expect(onedittags).toHaveBeenCalled();
  });

  it('calls onselectrow when an annotation row is clicked', async () => {
    const onselectrow = vi.fn();
    render(GroupView, { group: group(), palette, onselectrow });
    await userEvent.click(screen.getByTestId('annotation-row'));
    expect(onselectrow).toHaveBeenCalledWith('a1');
  });
});
```

- [ ] **Step 3: Implement `src/webview/detail/GroupView.svelte`**

```svelte
<script lang="ts">
  import { type AnnotationGroup } from '../../shared/model';
  import { type TagColor } from '../../shared/protocol';
  import { tagColor } from '../../core/sidebarState';
  import AnnotationRow from './AnnotationRow.svelte';

  let {
    group,
    palette,
    onrename,
    onedittags,
    oneditgitref,
    onselectrow,
  }: {
    group: AnnotationGroup;
    palette: TagColor[];
    onrename?: (title: string) => void;
    onedittags?: () => void;
    oneditgitref?: () => void;
    onselectrow?: (id: string) => void;
  } = $props();

  let editingTitle = $state(false);
  let titleDraft = $state('');

  function startTitleEdit(): void {
    titleDraft = group.title;
    editingTitle = true;
  }
  function commitTitle(): void {
    const trimmed = titleDraft.trim();
    editingTitle = false;
    if (trimmed && trimmed !== group.title) {
      onrename?.(trimmed);
    }
  }
  function onTitleKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      commitTitle();
    } else if (event.key === 'Escape') {
      editingTitle = false;
    }
  }
</script>

<section class="group-view" data-testid="group-view">
  <header class="head">
    {#if editingTitle}
      <input
        class="title-input"
        data-testid="title-input"
        bind:value={titleDraft}
        onkeydown={onTitleKey}
        onblur={commitTitle}
      />
    {:else}
      <div class="title-row">
        <span class="title" data-testid="detail-title">{group.title}</span>
        <button type="button" class="icon" data-testid="title-edit-btn" title="Rename" onclick={startTitleEdit}>✎</button>
      </div>
    {/if}
    <div class="meta">{group.author} · {group.status}</div>

    <div class="tags-row">
      {#each group.tags as tag (tag)}
        <span class="chip" style="background:{tagColor(palette, tag)}">{tag}</span>
      {/each}
      <button type="button" class="link" data-testid="edit-tags-btn" onclick={() => onedittags?.()}>＋ edit tags</button>
    </div>

    <div class="gitref-row">
      Git ref: {#if group.gitRef}<code>{group.gitRef}</code>{:else}<span class="none">none</span>{/if}
      <button type="button" class="link" data-testid="edit-gitref-btn" onclick={() => oneditgitref?.()}>edit</button>
    </div>
  </header>

  <div class="rows">
    {#each group.annotations as annotation (annotation.id)}
      <AnnotationRow {annotation} selected={false} onselect={(id) => onselectrow?.(id)} />
    {/each}
  </div>
</section>

<style>
  .group-view { padding: 8px; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); }
  .head { padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c); margin-bottom: 6px; }
  .title-row { display: flex; align-items: center; gap: 6px; }
  .title { font-size: 15px; font-weight: 600; color: var(--vscode-foreground, #eee); }
  .title-input { width: 100%; box-sizing: border-box; font-size: 15px; padding: 2px 4px; background: var(--vscode-input-background, #2a2a2a); color: var(--vscode-input-foreground, #ddd); border: 1px solid var(--vscode-focusBorder, #3794ff); border-radius: 3px; }
  .icon { background: none; border: none; color: var(--vscode-descriptionForeground, #9a9a9a); cursor: pointer; font-size: 12px; padding: 0; }
  .meta { color: var(--vscode-descriptionForeground, #9a9a9a); font-size: 11.5px; margin-top: 3px; }
  .tags-row { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
  .chip { font-size: 10.5px; padding: 1px 8px; border-radius: 9px; color: #fff; }
  .gitref-row { font-size: 11.5px; color: #bbb; margin-top: 8px; }
  .gitref-row code { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 6px; border-radius: 3px; }
  .none { color: var(--vscode-descriptionForeground, #9a9a9a); }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11px; padding: 0; }
</style>
```

- [ ] **Step 4: Run the GroupView test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/GroupView.svelte.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Use `GroupView` in `src/webview/detail/DetailApp.svelte`.** Replace the group-mode `{:else}` branch's inline header+rows markup with `<GroupView>`. Add the import and update the `<script>` to import the new senders; replace the final `{:else}` branch:

In `<script>`, add:
```ts
  import GroupView from './GroupView.svelte';
  import {
    detail, openAnnotationView, showGroupView, saveAnnotationContent, copyToClipboard,
    renameGroup, requestEditTags, requestEditGitRef,
  } from './state';
```
(Replace the existing `import { detail, … } from './state';` line with the expanded one above; keep `postToHost`/`tagColor`/`AnnotationRow`/`AnnotationView` imports — note `AnnotationRow` and `tagColor` are now used only by `GroupView`, so you may remove their imports from `DetailApp.svelte` if unused there.)

Replace the group-mode branch (the `{:else}` with the inline `<header>`/`<div class="rows">`) with:

```svelte
  {:else}
    <GroupView
      group={$detail.group}
      palette={$detail.palette}
      onrename={(title) => renameGroup(title)}
      onedittags={requestEditTags}
      oneditgitref={requestEditGitRef}
      onselectrow={openRow}
    />
  {/if}
```

(Keep the empty-state and annotation-mode branches. `openRow(id)` already calls `openAnnotationView(id)` + posts `selectAnnotation` — keep it. Remove the now-unused `tagColor` import and group-view `<style>` rules from DetailApp if they're no longer referenced.)

- [ ] **Step 6: Update `src/webview/detail/DetailApp.svelte.test.ts`** — the group-mode test still asserts `detail-title` + `annotation-row` (now rendered by `GroupView`, same testids). No change needed IF the testids match; run it to confirm. If the group-mode test fails because the markup moved, the testids (`detail-title`, `annotation-row`) are preserved by `GroupView`, so it should pass. (Leave the empty + annotation-mode tests unchanged.)

- [ ] **Step 7: Run component tests + full unit suite + build**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/detail/DetailApp.svelte.test.ts src/webview/detail/GroupView.svelte.test.ts && npm run check-types && npm run test:unit && npm run compile`
Expected: all green; bundle builds.

- [ ] **Step 8: Commit**

```bash
git add src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts src/webview/detail/DetailApp.svelte src/webview/detail/DetailApp.svelte.test.ts src/webview/detail/state.ts
git commit -m "feat: GroupView with inline title edit + edit-tags/git-ref affordances"
```

---

## Task 5: Host wiring (title/tags/git-ref edits)

**Files:** Create `src/web/gitRefsSource.ts`; Modify `src/web/detailPanelProvider.ts`, `src/web/extension.ts`

- [ ] **Step 1: Create `src/web/gitRefsSource.ts`** (Git-extension adapter; empty on web)

```ts
import * as vscode from 'vscode';
import { type GitRefInfo } from '../core/gitRefs';

interface GitRef {
  readonly type: number; // 0 Head, 1 RemoteHead, 2 Tag
  readonly name?: string;
  readonly commit?: string;
}
interface GitRepository {
  readonly state: { readonly HEAD?: { readonly commit?: string }; readonly refs: readonly GitRef[] };
}
interface GitApi {
  readonly repositories: readonly GitRepository[];
}
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/** Read HEAD/branches/tags from the built-in git extension. Returns empty info on the web host (no git extension). */
export async function readGitRefInfo(): Promise<GitRefInfo> {
  const empty: GitRefInfo = { branches: [], tags: [] };
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) {
    return empty;
  }
  try {
    if (!ext.isActive) {
      await ext.activate();
    }
    const repo = ext.exports.getAPI(1).repositories[0];
    if (!repo) {
      return empty;
    }
    const branches: string[] = [];
    const tags: string[] = [];
    for (const ref of repo.state.refs) {
      if (ref.type === 0 && ref.name) {
        branches.push(ref.name);
      } else if (ref.type === 2 && ref.name) {
        tags.push(ref.name);
      }
    }
    return { headSha: repo.state.HEAD?.commit, branches, tags };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 2: Add hooks + message handling to `src/web/detailPanelProvider.ts`.** Add three public hooks (next to `onUpdateAnnotation`):

```ts
  /** Set by the extension: rename the active group. */
  public onSetGroupTitle?: (groupId: string, title: string) => void;
  /** Set by the extension: edit the active group's tags (native picker). */
  public onEditTags?: (groupId: string) => void;
  /** Set by the extension: edit the active group's Git ref (native picker). */
  public onEditGitRef?: (groupId: string) => void;
```

In `onDidReceiveMessage`, after the `copyText` branch, add:

```ts
      } else if (message.type === 'setGroupTitle') {
        if (this.group) {
          this.onSetGroupTitle?.(this.group.id, message.title);
        }
      } else if (message.type === 'editTags') {
        if (this.group) {
          this.onEditTags?.(this.group.id);
        }
      } else if (message.type === 'editGitRef') {
        if (this.group) {
          this.onEditGitRef?.(this.group.id);
        }
```

- [ ] **Step 3: Wire the hooks in `src/web/extension.ts`.** Add imports (only the missing ones — `GroupStore`/`VscodeFileSystem`/`readTagPalette` already imported):

```ts
import { readGitRefInfo } from './gitRefsSource';
import { gitRefSuggestions } from '../core/gitRefs';
```

After the existing `detailProvider.onUpdateAnnotation = …` block, add a shared helper + the three hooks:

```ts
  const now = (): number => Math.floor(Date.now() / 1000);
  const reloadDetail = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const updated = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    detailProvider.showGroup(updated, readTagPalette());
  };
  const patchGroup = async (
    groupId: string,
    patch: { title?: string; tags?: string[]; gitRef?: string | null },
  ): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const ok = await new GroupStore(new VscodeFileSystem(folder.uri)).updateGroup(groupId, patch, now());
    if (ok) {
      await reloadDetail(groupId);
    }
  };

  detailProvider.onSetGroupTitle = (groupId, title): void => {
    void patchGroup(groupId, { title });
  };

  detailProvider.onEditTags = async (groupId): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const group = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    if (!group) {
      return;
    }
    const palette = readTagPalette();
    const picked = await vscode.window.showQuickPick(
      palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name) })),
      { canPickMany: true, placeHolder: 'Select tags for this group' },
    );
    if (picked === undefined) {
      return; // cancelled
    }
    await patchGroup(groupId, { tags: picked.map((p) => p.label) });
  };

  detailProvider.onEditGitRef = async (groupId): Promise<void> => {
    const info = await readGitRefInfo();
    const suggestions = gitRefSuggestions(info);
    let ref: string | undefined;
    if (suggestions.length > 0) {
      const CUSTOM = '$(edit) Custom…';
      const CLEAR = '$(close) Clear';
      const picked = await vscode.window.showQuickPick(
        [{ label: CLEAR }, { label: CUSTOM }, ...suggestions.map((s) => ({ label: s.label, description: s.description }))],
        { placeHolder: 'Set the group’s Git ref' },
      );
      if (!picked) {
        return;
      }
      if (picked.label === CLEAR) {
        await patchGroup(groupId, { gitRef: null });
        return;
      }
      ref = picked.label === CUSTOM ? await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA)' }) : picked.label;
    } else {
      ref = await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA), or empty to clear' });
    }
    if (ref === undefined) {
      return; // cancelled
    }
    await patchGroup(groupId, { gitRef: ref.trim() === '' ? null : ref.trim() });
  };
```

- [ ] **Step 4: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; all green.

- [ ] **Step 5: Commit**

```bash
git add src/web/gitRefsSource.ts src/web/detailPanelProvider.ts src/web/extension.ts
git commit -m "feat: host wiring for group title/tags/git-ref edits"
```

---

## Task 6: Integration + e2e + full suite

**Files:** Create `src/web/test/suite/updateGroup.integration.test.ts`, `e2e/group-edit.spec.ts`; Modify `src/web/test/suite/index.ts`

- [ ] **Step 1: Write the integration test** — `src/web/test/suite/updateGroup.integration.test.ts`

```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateGroup (vscode.workspace.fs)', () => {
  test('persists a metadata patch', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'grp-itest', title: 'Before', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1, annotations: [],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.updateGroup('grp-itest', { title: 'After', tags: ['x'], gitRef: 'main' }, 42);
      if (!ok) {
        throw new Error('updateGroup returned false');
      }
      const reloaded = await store.getGroup('grp-itest');
      if (reloaded?.title !== 'After' || reloaded?.gitRef !== 'main' || reloaded?.tags[0] !== 'x' || reloaded?.updatedAt !== 42) {
        throw new Error(`patch not persisted: ${JSON.stringify(reloaded)}`);
      }
    } finally {
      await store.deleteGroup('grp-itest');
    }
  });
});
```

- [ ] **Step 2: Import it in `src/web/test/suite/index.ts`** — add `import('./updateGroup.integration.test')` to the `Promise.all([...])`.

- [ ] **Step 3: Create `e2e/group-edit.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('inline-editing the group title persists and reflects', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  await detail.getByTestId('title-edit-btn').click();
  const input = detail.getByTestId('title-input');
  await input.fill('Renamed Seed');
  await input.press('Enter');

  // After save → host updateGroup → re-post setGroup → the title reflects the new value.
  await expect(detail.getByTestId('detail-title')).toHaveText('Renamed Seed', { timeout: 30_000 });
});
```

- [ ] **Step 4: Run the e2e (verify it passes)**

Run (`dangerouslyDisableSandbox: true`, Bash `timeout: 600000`; `pkill -f vscode-test-web` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:e2e`
Expected: 5 passed — the 4 existing + `group-edit.spec`.

> Note: the e2e writes the renamed title into the in-memory `test-workspace` mount (not the committed `seed-group.json` on disk), so it doesn't corrupt the fixture. If a prior run left the seed renamed in a persisted mount, that won't happen — `@vscode/test-web` mounts are per-run in memory.

- [ ] **Step 5: Run the full suite (Definition of Done)**

Run (same settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (**7 passing**) → `test:e2e` (**5 passed**) all green.

- [ ] **Step 6: Commit**

```bash
git add src/web/test/suite/updateGroup.integration.test.ts src/web/test/suite/index.ts e2e/group-edit.spec.ts
git commit -m "test: updateGroup integration + group-title-edit e2e"
```

---

## Phase 2a Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (updateGroup, gitRefSuggestions, GroupView + earlier suites).
- [ ] `npm run test:integration` passes — **7 passing** (incl. updateGroup round-trip).
- [ ] `npm run test:e2e` passes — **5 passed** (incl. group title edit).
- [ ] All work committed on the `phase-2` branch.
- [ ] Manual sanity (optional): open a group → rename the title inline → it persists; click "edit tags" → pick from the palette → chips update; click git-ref "edit" → (desktop) pick HEAD/branch/tag or Custom, (web) type a ref → it shows.

Next in Phase 2: **2b** — drift detection (recompute the content hash vs the current file → stale dot in the list + banner in the annotation view) + editable annotation line range. Then **2c** (sidebar filters + show-resolved) and **2d** (drag-reorder + Next/Previous nav).

## Phase 2b carry-over (from Phase 2a final review)

- **Drift logic stays pure:** `Annotation.contentHash` (SHA-256 of anchored lines at creation) already exists. Add a pure `isStale(fileText, range, contentHash): Promise<boolean>` (or sync over `string[]` lines) in `src/core/` reusing `anchorText` + `sha256Hex` — testable without VSCode. The "when to check" (on group load / on file change) is host glue.
- **Editable line range:** add a `DetailToHost` message (e.g. `editLineRange{annotationId}`) + a `GroupStore.updateAnnotationRange(groupId, annotationId, range, now)` mirroring `updateAnnotation` (and recompute `contentHash` from the new range's current file lines on save). Add a `mode`-preservation unit test for the range-edit scenario.
- **Extract a `GroupPatch` type** to `src/shared/model.ts` (`Partial<Pick<AnnotationGroup,'title'|'tags'|'gitRef'>>`) — currently duplicated between `groupStore.ts` and the inline type in `extension.ts`. Do before adding more editable fields (e.g. `status` in Phase 3).
- **Minor (optional):** git-ref QuickPick uses display labels as sentinels (`Clear`/`Custom…`) — switch to an `id` field on picker items to avoid a degenerate collision with a branch literally named that. And `onSetGroupTitle` is fire-and-forget (`void patchGroup`) vs the awaited tag/git-ref handlers — harmless, but unify if touching that code.
```
