# Phase 7c — Git Identity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make git-config author-name/email loading reliable on desktop (round-3 TODO #1, spec §A): the `vscode.git` extension API starts in `state: 'uninitialized'` with an empty `repositories` array until async repo discovery finishes, so `resolveAuthor` fell through to the prompt even when `git config user.name` was set.

**Architecture:** A pure, unit-tested `waitForGitInit(api, timeoutMs)` helper in a new `src/core/gitInit.ts` (takes a minimal `{state, onDidChangeState}` interface — no `vscode` import). `web/authorSources.ts` extends its local git-API typing with `state`/`onDidChangeState`, dedupes the two identical repo-acquisition blocks into one `gitRepo()` helper that awaits initialization, and keeps the existing local→global config fallback.

**Tech Stack:** TypeScript, VSCode git extension API v1 (`APIState`), Vitest (fake timers).

**Test commands** (always prefix node commands):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

### Testing reality
`waitForGitInit` is fully unit-tested (immediate, state-change, timeout, listener disposal). The `authorSources` wiring is `vscode`-glue — type-check + manual (desktop). **Hard gate:** `npm run check-types` + `npm run test:unit`.

---

## File Structure

- **Create** `src/core/gitInit.ts` (+ `gitInit.unit.test.ts`) — `GitInitApi` interface + `waitForGitInit`.
- **Modify** `src/web/authorSources.ts` — extended `GitApi` typing; `gitRepo()` dedup; await init.

---

### Task 1: `waitForGitInit` pure helper (§A)

**Files:**
- Create: `src/core/gitInit.ts`
- Test: `src/core/gitInit.unit.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/gitInit.unit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForGitInit, type GitInitApi } from './gitInit';

type Listener = (state: 'uninitialized' | 'initialized') => void;

function fakeApi(initial: 'uninitialized' | 'initialized'): GitInitApi & {
  fire(state: 'uninitialized' | 'initialized'): void;
  listenerCount(): number;
} {
  const listeners = new Set<Listener>();
  return {
    state: initial,
    onDidChangeState(listener: Listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire(state) {
      for (const l of [...listeners]) l(state);
    },
    listenerCount: () => listeners.size,
  };
}

describe('waitForGitInit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves immediately when the API is already initialized', async () => {
    const api = fakeApi('initialized');
    await expect(waitForGitInit(api)).resolves.toBeUndefined();
    expect(api.listenerCount()).toBe(0); // never subscribed
  });

  it('resolves when the state changes to initialized, and disposes the listener', async () => {
    const api = fakeApi('uninitialized');
    const promise = waitForGitInit(api);
    api.fire('initialized');
    await expect(promise).resolves.toBeUndefined();
    expect(api.listenerCount()).toBe(0);
  });

  it('ignores non-initialized state changes', async () => {
    const api = fakeApi('uninitialized');
    const promise = waitForGitInit(api, 1000);
    api.fire('uninitialized');
    expect(api.listenerCount()).toBe(1); // still waiting
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves after the timeout when initialization never happens, disposing the listener', async () => {
    const api = fakeApi('uninitialized');
    const promise = waitForGitInit(api, 2000);
    vi.advanceTimersByTime(2000);
    await expect(promise).resolves.toBeUndefined();
    expect(api.listenerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gitInit.unit.test.ts`
Expected: FAIL — cannot resolve `./gitInit`.

- [ ] **Step 3: Implement** — create `src/core/gitInit.ts`:

```ts
// Waiting for the built-in git extension's API to finish repository discovery.
// Pure logic against a minimal structural interface; no vscode import.

/** The slice of the git extension API (v1) needed to await initialization. */
export interface GitInitApi {
  readonly state: 'uninitialized' | 'initialized';
  onDidChangeState(listener: (state: 'uninitialized' | 'initialized') => void): { dispose(): void };
}

/**
 * Resolve once `api.state` is 'initialized' (repositories discovered), or after
 * `timeoutMs` — whichever comes first. Right after activation the git API reports
 * 'uninitialized' with an empty `repositories` array, so reading it immediately
 * loses the race (the round-3 #1 bug: git config user.name never loaded).
 */
export function waitForGitInit(api: GitInitApi, timeoutMs = 2000): Promise<void> {
  if (api.state === 'initialized') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let listener: { dispose(): void } | undefined;
    const timer = setTimeout(() => {
      listener?.dispose();
      resolve();
    }, timeoutMs);
    listener = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        clearTimeout(timer);
        listener?.dispose();
        resolve();
      }
    });
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/gitInit.unit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/gitInit.ts src/core/gitInit.unit.test.ts
git commit -m "feat(identity): waitForGitInit awaits git extension repo discovery (TODO #1)"
```

---

### Task 2: `authorSources` awaits initialization + dedupes repo acquisition (§A)

**Files:**
- Modify: `src/web/authorSources.ts`

> `vscode`-glue — type-check + manual desktop verification. Keeps behavior identical except for the added bounded wait.

- [ ] **Step 1: Implement.** In `src/web/authorSources.ts`:

(a) Add the import after the existing `../core/authorIdentity` import:

```ts
import { waitForGitInit, type GitInitApi } from '../core/gitInit';
```

(b) Extend the `GitApi` interface so it structurally satisfies `GitInitApi`:

```ts
interface GitApi extends GitInitApi {
  repositories: GitApiRepository[];
}
```

(c) Replace the two near-identical `gitUserName`/`gitUserEmail` method bodies with a shared private helper + thin readers — the class becomes:

```ts
/** AuthorNameSources backed by VSCode APIs. git is desktop-only; the rest work on web. */
export class VscodeAuthorNameSources implements AuthorNameSources, AuthorEmailSources {
  /**
   * The first git repository, awaiting the git API's async repo discovery first
   * (right after activation `repositories` is empty until state is 'initialized').
   */
  private async gitRepo(): Promise<GitApiRepository | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) {
      return undefined; // git extension is unavailable in the web host
    }
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      const api = ext.exports.getAPI(1);
      await waitForGitInit(api);
      return api.repositories[0];
    } catch {
      return undefined;
    }
  }

  /** Local-then-global `git config` lookup; undefined when unset/unavailable. */
  private async gitConfig(key: string): Promise<string | undefined> {
    const repo = await this.gitRepo();
    if (!repo) {
      return undefined;
    }
    const local = await repo.getConfig(key).catch(() => undefined);
    if (local) {
      return local;
    }
    return repo.getGlobalConfig(key).catch(() => undefined);
  }

  async gitUserName(): Promise<string | undefined> {
    return this.gitConfig('user.name');
  }

  async gitUserEmail(): Promise<string | undefined> {
    return this.gitConfig('user.email');
  }
```

(the rest of the class — `settingAuthorName`, `settingAuthorEmail`, `githubAccountEmail`, `githubAccountLabel`, `promptForName`, `persistName` — is unchanged).

- [ ] **Step 2: Type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: clean + all PASS (authorIdentity tests use fake sources; unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/web/authorSources.ts
git commit -m "fix(identity): await git extension init before reading user.name/email (TODO #1)"
```

---

### Task 3: Full gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest tests PASS.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage (§A):** bounded wait on `state`/`onDidChangeState` → Task 1; `gitUserName`/`gitUserEmail` await it → Task 2; helper takes a minimal interface and lives in `core/` (pure, Vitest-driven) → Task 1; prompt reword already shipped in 7a. Web-host fallback is an explicit non-goal. ✓
- **Type consistency:** `GitApi extends GitInitApi` structurally matches the real git API v1 (`state: APIState`, `onDidChangeState: Event<APIState>` — an `Event<T>` IS a function `(listener) => Disposable`, so the interface method form is call-compatible). `waitForGitInit(api: GitInitApi, timeoutMs = 2000): Promise<void>`. ✓
- **Behavior preserved:** local→global config fallback order unchanged; all failure paths still return `undefined` (chain falls through as before); timeout means worst-case +2s on first identity resolution only when git never initializes (then cached by `currentIdentity`). ✓
- **No placeholders.** ✓
