# vscode-annotated — Phase 1c: Sidebar (group cards on the real protocol) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 "hello" webview with a real sidebar: load annotation groups via `GroupStore`, render them as cards (title, author, count, colored tag chips), highlight the selected one, emit a `selectGroup` intent to the host, and live-reload via a `FileSystemWatcher` so creating an annotation updates the sidebar immediately.

**Architecture:** A typed `postMessage` protocol connects host and webview. Host→webview `setState` carries the groups + tag palette; webview→host `ready`/`selectGroup`. A **pure** state reducer (`src/core/sidebarState.ts`) is unit-tested in isolation; the webview wraps it in a `svelte/store` `writable`. Components are split: prop-driven `GroupCard` (component-tested) under a store-driven `App`. The `SidebarViewProvider` loads groups via `GroupStore`/`VscodeFileSystem`, pushes state, and refreshes on watcher events.

**Tech Stack:** TypeScript + Svelte 5 (webview), `svelte/store`. Builds on Phase 1a/1b (`GroupStore`, `model`, `tagPalette`). Vitest component + unit tests; `@vscode/test-web` integration; Playwright e2e (seeded group). No new runtime deps.

> **Conventions for the executor:**
> - Work on the **`phase-1`** branch (already checked out).
> - **Node:** prefix node/npm/npx commands with `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"` (verify `node -v` → v25.x).
> - Commit trailer (after a blank line):
>   ```
>   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
>   ```
> - `test:integration` / `test:e2e` download/serve a VSCode web build — run with the Bash tool's `dangerouslyDisableSandbox: true` and `timeout: 600000`; `pkill -f vscode-test-web 2>/dev/null` first if a port is held.

---

## Context: what exists

- `src/shared/protocol.ts` — Phase 0 placeholder message types + `parseMessage` (only its own test imports it; safe to evolve).
- `src/shared/protocol.unit.test.ts` — tests `parseMessage` (will be rewritten).
- `src/webview/sidebar/App.svelte` — hello component with a `name` prop; `App.svelte.test.ts` tests it; `main.ts` mounts it.
- `src/web/sidebarViewProvider.ts` — renders the hello webview; `getNonce()` uses `Math.random()`.
- `src/web/extension.ts` — registers the sidebar provider, `annotated.ping`, and `annotated.createAnnotation`.
- `src/core/groupStore.ts` (`GroupStore`), `src/web/vscodeFileSystem.ts` (`VscodeFileSystem`), `src/web/tagPalette.ts` (`readTagPalette`), `src/core/tags.ts` (`Tag`), `src/shared/model.ts` (`AnnotationGroup`).
- `package.json` `serve:web` = `vscode-test-web --browserType=none --extensionDevelopmentPath=. --port=3000` (no folder); `test:integration` already passes `test-workspace`.
- `e2e/hello.spec.ts` — asserts "Annotated is alive" (will be replaced).

---

## File Structure (created/modified in 1c)

```
src/shared/protocol.ts                      (modify) # real messages + parseWebviewMessage + TagColor
src/shared/protocol.unit.test.ts            (modify) # rewrite for parseWebviewMessage
src/core/sidebarState.ts                    (new)    # pure: SidebarState, initialSidebarState, applyHostMessage, tagColor
src/core/sidebarState.unit.test.ts          (new)
src/webview/vscode.d.ts                     (new)    # ambient acquireVsCodeApi declaration
src/webview/sidebar/vscodeApi.ts            (new)    # lazy acquireVsCodeApi + postToHost
src/webview/sidebar/state.ts                (new)    # writable store + handleHostMessage/setSelected
src/webview/sidebar/GroupCard.svelte        (new)    # one group card (prop-driven)
src/webview/sidebar/GroupCard.svelte.test.ts(new)
src/webview/sidebar/App.svelte              (modify) # store-driven list of cards (drops `name`)
src/webview/sidebar/App.svelte.test.ts      (modify) # store-driven rendering tests
src/webview/sidebar/main.ts                 (modify) # wire acquireVsCodeApi messages → store, post ready
src/web/sidebarViewProvider.ts              (modify) # load groups+palette, crypto nonce, push setState, handle messages, refresh()
src/web/extension.ts                        (modify) # FileSystemWatcher on .annotations → provider.refresh()
package.json                                (modify) # serve:web opens test-workspace
test-workspace/.annotations/groups/seed.json(new)    # committed seed group for e2e
e2e/sidebar.spec.ts                         (new)    # asserts the seed card renders
e2e/hello.spec.ts                           (delete)
```

---

## Task 1: Evolve the message protocol

**Files:** Modify `src/shared/protocol.ts`, `src/shared/protocol.unit.test.ts`

- [ ] **Step 1: Replace `src/shared/protocol.unit.test.ts`** with tests for the new validator

```ts
import { describe, it, expect } from 'vitest';
import { parseWebviewMessage } from './protocol';

describe('parseWebviewMessage', () => {
  it('accepts a ready message', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts a selectGroup message with a string groupId', () => {
    expect(parseWebviewMessage({ type: 'selectGroup', groupId: 'g1' })).toEqual({ type: 'selectGroup', groupId: 'g1' });
  });

  it('rejects selectGroup without a string groupId', () => {
    expect(parseWebviewMessage({ type: 'selectGroup' })).toBeNull();
    expect(parseWebviewMessage({ type: 'selectGroup', groupId: 5 })).toBeNull();
  });

  it('rejects unknown types and non-objects', () => {
    expect(parseWebviewMessage({ type: 'nope' })).toBeNull();
    expect(parseWebviewMessage(null)).toBeNull();
    expect(parseWebviewMessage('ready')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts`
Expected: FAIL — `parseWebviewMessage` is not exported.

- [ ] **Step 3: Replace `src/shared/protocol.ts`** with the real messages

```ts
// Typed message contract between the extension host and webviews.
import { type AnnotationGroup } from './model';

/** A tag's display info sent to the webview (structurally matches core `Tag`). */
export interface TagColor {
  name: string;
  color: string;
}

/** Host → webview messages. */
export type HostToWebview = {
  type: 'setState';
  groups: AnnotationGroup[];
  palette: TagColor[];
};

/** Webview → host messages. */
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'selectGroup'; groupId: string };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Validate an untrusted webview→host message; returns it narrowed, or null. */
export function parseWebviewMessage(raw: unknown): WebviewToHost | null {
  if (!isObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'selectGroup':
      return typeof raw.groupId === 'string' ? { type: 'selectGroup', groupId: raw.groupId } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/protocol.unit.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Verify type-check** (nothing else imports the old `parseMessage`)

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0. (If it errors about a missing `parseMessage` import somewhere, that import must be updated — but only the test referenced it.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "feat: real host/webview message protocol (setState, selectGroup)"
```

---

## Task 2: Pure sidebar state reducer

**Files:** Create `src/core/sidebarState.ts`, `src/core/sidebarState.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/sidebarState.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { initialSidebarState, applyHostMessage, tagColor } from './sidebarState';
import { type AnnotationGroup } from '../shared/model';

function group(id: string): AnnotationGroup {
  return { id, title: id, author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('initialSidebarState', () => {
  it('is empty with no selection', () => {
    expect(initialSidebarState()).toEqual({ groups: [], palette: [], selectedId: null });
  });
});

describe('applyHostMessage', () => {
  it('setState replaces groups and palette', () => {
    const next = applyHostMessage(initialSidebarState(), {
      type: 'setState',
      groups: [group('g1')],
      palette: [{ name: 'security', color: '#c0392b' }],
    });
    expect(next.groups.map((g) => g.id)).toEqual(['g1']);
    expect(next.palette).toEqual([{ name: 'security', color: '#c0392b' }]);
  });

  it('preserves the selection when the selected group still exists', () => {
    const state = { ...initialSidebarState(), selectedId: 'g1' };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g1'), group('g2')], palette: [] });
    expect(next.selectedId).toBe('g1');
  });

  it('clears the selection when the selected group is gone', () => {
    const state = { ...initialSidebarState(), selectedId: 'g1' };
    const next = applyHostMessage(state, { type: 'setState', groups: [group('g2')], palette: [] });
    expect(next.selectedId).toBeNull();
  });
});

describe('tagColor', () => {
  it('resolves a known tag color', () => {
    expect(tagColor([{ name: 'todo', color: '#f39c12' }], 'todo')).toBe('#f39c12');
  });

  it('falls back to a neutral default for unknown tags', () => {
    expect(tagColor([], 'unknown')).toBe('#888888');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/sidebarState.unit.test.ts`
Expected: FAIL — cannot resolve `./sidebarState`.

- [ ] **Step 3: Implement `src/core/sidebarState.ts`**

```ts
import { type AnnotationGroup } from '../shared/model';
import { type HostToWebview, type TagColor } from '../shared/protocol';

const DEFAULT_COLOR = '#888888';

export interface SidebarState {
  groups: AnnotationGroup[];
  palette: TagColor[];
  selectedId: string | null;
}

export function initialSidebarState(): SidebarState {
  return { groups: [], palette: [], selectedId: null };
}

/** Apply a host→webview message, returning a new state. */
export function applyHostMessage(state: SidebarState, message: HostToWebview): SidebarState {
  switch (message.type) {
    case 'setState': {
      const stillExists = state.selectedId !== null && message.groups.some((g) => g.id === state.selectedId);
      return {
        groups: message.groups,
        palette: message.palette,
        selectedId: stillExists ? state.selectedId : null,
      };
    }
    default:
      return state;
  }
}

/** Resolve a tag name to its palette color, or a neutral default. */
export function tagColor(palette: TagColor[], name: string): string {
  return palette.find((t) => t.name === name)?.color ?? DEFAULT_COLOR;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/sidebarState.unit.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/sidebarState.ts src/core/sidebarState.unit.test.ts
git commit -m "feat: pure sidebar state reducer + tag color resolution"
```

---

## Task 3: GroupCard component

**Files:** Create `src/webview/sidebar/GroupCard.svelte`, `src/webview/sidebar/GroupCard.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — `src/webview/sidebar/GroupCard.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import GroupCard from './GroupCard.svelte';
import { type AnnotationGroup } from '../../shared/model';

function group(): AnnotationGroup {
  return {
    id: 'g1',
    title: 'Login review',
    author: 'Ezequiel',
    tags: ['security'],
    gitRef: null,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    annotations: [
      { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' },
    ],
  };
}

describe('GroupCard', () => {
  it('renders title, author, annotation count, and tag chips', () => {
    render(GroupCard, { group: group(), palette: [{ name: 'security', color: '#c0392b' }] });
    const card = screen.getByTestId('group-card');
    expect(card).toHaveTextContent('Login review');
    expect(card).toHaveTextContent('Ezequiel');
    expect(card).toHaveTextContent('1 annotation');
    expect(card).toHaveTextContent('security');
  });

  it('calls onselect with the group id when clicked', async () => {
    const onselect = vi.fn();
    render(GroupCard, { group: group(), palette: [], onselect });
    await userEvent.click(screen.getByTestId('group-card'));
    expect(onselect).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/GroupCard.svelte.test.ts`
Expected: FAIL — cannot resolve `./GroupCard.svelte`.

- [ ] **Step 3: Implement `src/webview/sidebar/GroupCard.svelte`**

```svelte
<script lang="ts">
  import { type AnnotationGroup } from '../../shared/model';
  import { type TagColor } from '../../shared/protocol';
  import { tagColor } from '../../core/sidebarState';

  let {
    group,
    palette,
    selected = false,
    onselect,
  }: {
    group: AnnotationGroup;
    palette: TagColor[];
    selected?: boolean;
    onselect?: (id: string) => void;
  } = $props();
</script>

<button
  type="button"
  class="card"
  class:selected
  data-testid="group-card"
  onclick={() => onselect?.(group.id)}
>
  <div class="title">{group.title}</div>
  <div class="meta">{group.author} · {group.annotations.length} annotation{group.annotations.length === 1 ? '' : 's'}</div>
  {#if group.tags.length > 0}
    <div class="chips">
      {#each group.tags as tag (tag)}
        <span class="chip" style="background:{tagColor(palette, tag)}">{tag}</span>
      {/each}
    </div>
  {/if}
</button>

<style>
  .card {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-foreground, #ccc);
    border: 1px solid var(--vscode-widget-border, #3c3c3c);
    border-left: 3px solid var(--vscode-focusBorder, #3794ff);
    border-radius: 4px;
    padding: 8px 10px;
    margin-bottom: 8px;
    cursor: pointer;
    font-family: var(--vscode-font-family, sans-serif);
  }
  .card.selected {
    outline: 1px solid var(--vscode-focusBorder, #3794ff);
  }
  .title {
    font-weight: 600;
    font-size: 12.5px;
  }
  .meta {
    color: var(--vscode-descriptionForeground, #9a9a9a);
    font-size: 11px;
    margin-top: 2px;
  }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 9px;
    color: #fff;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/GroupCard.svelte.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/webview/sidebar/GroupCard.svelte src/webview/sidebar/GroupCard.svelte.test.ts
git commit -m "feat: GroupCard webview component"
```

---

## Task 4: Webview wiring — store, App, message bridge

**Files:** Create `src/webview/vscode.d.ts`, `src/webview/sidebar/vscodeApi.ts`, `src/webview/sidebar/state.ts`; Modify `src/webview/sidebar/App.svelte`, `src/webview/sidebar/App.svelte.test.ts`, `src/webview/sidebar/main.ts`

- [ ] **Step 1: Create the ambient declaration `src/webview/vscode.d.ts`**

```ts
/** The webview-host bridge injected by VSCode into every webview. */
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
```

- [ ] **Step 2: Create `src/webview/sidebar/vscodeApi.ts`** (lazy — never calls `acquireVsCodeApi` at import time)

```ts
import { type WebviewToHost } from '../../shared/protocol';

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

/** Post a typed message to the extension host. */
export function postToHost(message: WebviewToHost): void {
  getApi().postMessage(message);
}
```

- [ ] **Step 3: Create `src/webview/sidebar/state.ts`** (writable store over the pure reducer)

```ts
import { writable } from 'svelte/store';
import { initialSidebarState, applyHostMessage, type SidebarState } from '../../core/sidebarState';
import { type HostToWebview } from '../../shared/protocol';

export const sidebar = writable<SidebarState>(initialSidebarState());

/** Apply a host message to the store. */
export function handleHostMessage(message: HostToWebview): void {
  sidebar.update((state) => applyHostMessage(state, message));
}

/** Record the locally-selected group. */
export function setSelected(id: string): void {
  sidebar.update((state) => ({ ...state, selectedId: id }));
}
```

- [ ] **Step 4: Replace `src/webview/sidebar/App.svelte.test.ts`** with store-driven tests

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import App from './App.svelte';
import { sidebar } from './state';
import { initialSidebarState } from '../../core/sidebarState';
import { type AnnotationGroup } from '../../shared/model';

function group(id: string, title: string): AnnotationGroup {
  return { id, title, author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1, annotations: [] };
}

describe('App.svelte', () => {
  beforeEach(() => {
    sidebar.set(initialSidebarState());
  });

  it('shows an empty-state message when there are no groups', () => {
    render(App);
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });

  it('renders a card per group from the store', () => {
    sidebar.set({ groups: [group('g1', 'First'), group('g2', 'Second')], palette: [], selectedId: null });
    render(App);
    const cards = screen.getAllByTestId('group-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('First');
    expect(cards[1]).toHaveTextContent('Second');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL — the current `App.svelte` has no empty-state / cards (renders the old hello content), so `getByTestId('empty')` / `getAllByTestId('group-card')` fail.

- [ ] **Step 6: Replace `src/webview/sidebar/App.svelte`**

```svelte
<script lang="ts">
  import { sidebar, setSelected } from './state';
  import { postToHost } from './vscodeApi';
  import GroupCard from './GroupCard.svelte';

  function onselect(id: string): void {
    setSelected(id);
    postToHost({ type: 'selectGroup', groupId: id });
  }
</script>

<main data-testid="sidebar">
  {#if $sidebar.groups.length === 0}
    <p class="empty" data-testid="empty">
      No annotations yet. Select code and run “Annotated: Create Annotation”.
    </p>
  {:else}
    {#each $sidebar.groups as group (group.id)}
      <GroupCard
        {group}
        palette={$sidebar.palette}
        selected={$sidebar.selectedId === group.id}
        {onselect}
      />
    {/each}
  {/if}
</main>

<style>
  main {
    padding: 8px;
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground, #ccc);
  }
  .empty {
    color: var(--vscode-descriptionForeground, #9a9a9a);
    font-size: 12px;
    padding: 8px 2px;
  }
</style>
```

- [ ] **Step 7: Run the component test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/webview/sidebar/App.svelte.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 8: Replace `src/webview/sidebar/main.ts`** (wire host messages → store, post `ready`)

```ts
import { mount } from 'svelte';
import App from './App.svelte';
import { handleHostMessage } from './state';
import { postToHost } from './vscodeApi';

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message && typeof message === 'object' && message.type === 'setState') {
    handleHostMessage(message);
  }
});

const app = mount(App, { target: document.body });

// Ask the host for the initial state.
postToHost({ type: 'ready' });

export default app;
```

- [ ] **Step 9: Verify type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: exit 0; all unit/component tests pass (protocol, sidebarState, GroupCard, App, + Phase 1a/1b/0).

- [ ] **Step 10: Commit**

```bash
git add src/webview/vscode.d.ts src/webview/sidebar/vscodeApi.ts src/webview/sidebar/state.ts src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts src/webview/sidebar/main.ts
git commit -m "feat: store-driven sidebar App + host message bridge"
```

---

## Task 5: SidebarViewProvider + FileSystemWatcher

**Files:** Modify `src/web/sidebarViewProvider.ts`, `src/web/extension.ts`

- [ ] **Step 1: Replace `src/web/sidebarViewProvider.ts`**

```ts
import * as vscode from 'vscode';
import { GroupStore } from '../core/groupStore';
import { parseWebviewMessage, type HostToWebview } from '../shared/protocol';
import { VscodeFileSystem } from './vscodeFileSystem';
import { readTagPalette } from './tagPalette';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'annotated.sidebar';
  private view?: vscode.WebviewView;

  /** Set by the extension to handle group selection (wired to the detail panel in a later phase). */
  public onSelectGroup?: (groupId: string) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (raw) => {
      const message = parseWebviewMessage(raw);
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        await this.refresh();
      } else if (message.type === 'selectGroup') {
        this.onSelectGroup?.(message.groupId);
      }
    });
  }

  /** Reload groups from disk and push fresh state to the webview. */
  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const groups = folder ? await new GroupStore(new VscodeFileSystem(folder.uri)).listGroups() : [];
    const message: HostToWebview = { type: 'setState', groups, palette: readTagPalette() };
    void this.view.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
    const nonce = getNonce();
    const csp =
      `default-src 'none'; ` +
      `style-src ${webview.cspSource}; ` +
      `script-src 'nonce-${nonce}'; ` +
      `font-src ${webview.cspSource}; ` +
      `img-src ${webview.cspSource} https: data:;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Annotations</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Cryptographically-strong nonce via Web Crypto (available in the web extension host). */
function getNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

> NOTE on the CSS `<link>`: the webview bundle always emits `sidebar/main.css` (the components have `<style>` blocks), so the unconditional `<link>` is safe here. (The Phase 0 carry-over about conditional CSS only matters if an entry component had no styles, which is not the case.)

- [ ] **Step 2: Add the FileSystemWatcher in `src/web/extension.ts`**

Find the existing sidebar provider registration in `activate` (it currently looks like):

```ts
  const provider = new SidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, provider),
  );
```

Immediately AFTER that block, add a watcher that refreshes the sidebar when annotation files change:

```ts
  const watcher = vscode.workspace.createFileSystemWatcher('**/.annotations/**/*.json');
  const refreshSidebar = (): void => {
    void provider.refresh();
  };
  watcher.onDidCreate(refreshSidebar);
  watcher.onDidChange(refreshSidebar);
  watcher.onDidDelete(refreshSidebar);
  context.subscriptions.push(watcher);
```

(Leave the `annotated.ping` and `annotated.createAnnotation` registrations unchanged.)

- [ ] **Step 3: Build + type-check + unit**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile && npm run test:unit`
Expected: exit 0; bundles emitted (`dist/webview/sidebar/main.js` + `main.css`); all unit/component tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/web/sidebarViewProvider.ts src/web/extension.ts
git commit -m "feat: sidebar loads groups, crypto nonce, live reload via FileSystemWatcher"
```

---

## Task 6: Seed + e2e + full suite

**Files:** Create `test-workspace/.annotations/groups/seed.json`, `e2e/sidebar.spec.ts`; Modify `package.json`; Delete `e2e/hello.spec.ts`

- [ ] **Step 1: Create the committed seed group** — `test-workspace/.annotations/groups/seed.json`

```json
{
  "id": "seed-group",
  "title": "Seed Group",
  "author": "Seeder",
  "tags": ["security"],
  "gitRef": null,
  "status": "open",
  "createdAt": 1730000000,
  "updatedAt": 1730000000,
  "annotations": [
    {
      "id": "seed-anno",
      "file": "README.md",
      "range": { "startLine": 1, "endLine": 1 },
      "content": "Seed annotation",
      "contentHash": "seed"
    }
  ]
}
```

- [ ] **Step 2: Open the workspace folder in `serve:web`** — modify `package.json`, appending the positional `test-workspace` so the e2e workbench has a workspace folder (and the seed group):

```json
    "serve:web": "vscode-test-web --browserType=none --extensionDevelopmentPath=. --port=3000 test-workspace",
```

- [ ] **Step 3: Delete the old e2e** — remove `e2e/hello.spec.ts`:

```bash
git rm e2e/hello.spec.ts
```

- [ ] **Step 4: Create `e2e/sidebar.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('sidebar renders a group card from the workspace', async ({ page }) => {
  await page.goto('/');

  // Wait for the workbench to boot.
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open the Annotated activity-bar container.
  await page
    .locator('.activitybar')
    .getByRole('tab', { name: /Annotated/i })
    .click();

  // Drill into the nested webview iframes and assert the seeded group card renders.
  const frame = page
    .locator('iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();

  await expect(frame.getByTestId('group-card')).toContainText('Seed Group', { timeout: 30_000 });
});
```

- [ ] **Step 5: Run the e2e (verify it passes)**

Run (with `dangerouslyDisableSandbox: true` and Bash `timeout: 600000`; `pkill -f vscode-test-web 2>/dev/null` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:e2e`
Expected: `1 passed` — the sidebar shows the "Seed Group" card.

> If the card doesn't appear: the sidebar requests state via `ready` on mount; the provider's `refresh()` reads `workspaceFolders[0]` (the mounted `test-workspace`) and lists groups, finding `seed.json`. If it's empty, confirm `serve:web` got the `test-workspace` arg and the seed file is valid JSON.

- [ ] **Step 6: Run the full suite (Definition of Done)**

Run (same sandbox/timeout settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (4 passing) → `test:e2e` (1 passed) all green.

> The integration `GroupStore` round-trip test lists groups in `test-workspace` and now also sees `seed.json`; it only asserts its OWN group (`itest-group-1`) is present and cleans up only that, so the seed does not affect it.

- [ ] **Step 7: Commit**

```bash
git add test-workspace/.annotations/groups/seed.json e2e/sidebar.spec.ts package.json
git commit -m "test: e2e seed group + sidebar card assertion; serve workspace"
```

---

## Phase 1c Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (protocol, sidebarState, GroupCard, App + Phase 1a/1b/0).
- [ ] `npm run test:integration` passes — 4 passing.
- [ ] `npm run test:e2e` passes — the seeded "Seed Group" card renders.
- [ ] All work committed on the `phase-1` branch.
- [ ] Manual sanity (optional): `npm start` (opens `test-workspace`), open the Annotated view, see the Seed Group card; in a real folder, create an annotation and watch the sidebar update live.

Next: **1d** — detail panel in the Secondary Side Bar (group view: title/author/tags/annotation list), wired to the sidebar's `selectGroup` via `provider.onSelectGroup`; selecting an annotation navigates to code with a decoration. Then **1e** — annotation view + CodeMirror editor.
```
