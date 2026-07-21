# UX Feedback Round 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Git ref work on desktop by reading `.git` through `vscode.workspace.fs`, and stop diff-view annotations from being falsely flagged "lines changed" by anchoring the content hash to the working-tree file.

**Architecture:** Item 1 replaces the (never-working) `vscode.git` extension dependency with pure ref-file parsers (`gitRefParse.ts`) plus a `FileSystem`-driven assembler (`readGitRefInfoFromFs`), keeping the extension web-only. Item 2 moves create-time hashing to read the working-tree file — the same source staleness uses — so create/check are symmetric.

**Tech Stack:** TypeScript, Vitest (unit), the repo's `FileSystem` abstraction (`vscode.workspace.fs`), esbuild. No `vscode` import in `src/core` / `src/shared`.

## Global Constraints

- **Web-compatible:** no Node built-ins (`fs`/`path`/etc.) anywhere in `src/`. Pure logic lives in `src/shared` + `src/core` (no `vscode` import); the thin VS Code layer is in `src/web`.
- **Local gate:** `npm run check-types` + `npm run test:unit` must pass. Run `npm run test:integration` when the network/port is free (use a free `--port`, not 3000).
- **Degradation contract:** when git data is unavailable (no `.git`, web host), `readGitRefInfo()` returns `{ branches: [], tags: [] }` — never throws — so QuickPicks fall back to free-text.
- **TDD:** failing test first, minimal implementation, green, commit. One branch: `ux-feedback-round-5`.

---

### Task 1: Add `list()` to the `FileSystem` abstraction

`FileSystem.readDirectory` returns **files only** and hides subdirectories, so it can't drive a recursive ref walk. Add a typed listing that reports subdirectories too.

**Files:**
- Modify: `src/core/fileSystem.ts` (interface)
- Modify: `src/core/memoryFileSystem.ts` (in-memory impl)
- Modify: `src/web/vscodeFileSystem.ts` (vscode impl)
- Test: `src/core/memoryFileSystem.unit.test.ts` (create)

**Interfaces:**
- Produces: `FileSystem.list(path: string): Promise<{ name: string; isDirectory: boolean }[]>` — entries directly under `path` (files + subdirectories); `[]` if the directory is missing.

- [ ] **Step 1: Write the failing test** — create `src/core/memoryFileSystem.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = new TextEncoder();

describe('MemoryFileSystem.list', () => {
  it('reports files and subdirectories directly under a path', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('.git/HEAD', enc.encode('ref: refs/heads/main\n'));
    await fs.writeFile('.git/refs/heads/main', enc.encode('a'.repeat(40)));
    await fs.writeFile('.git/refs/heads/feature/x', enc.encode('b'.repeat(40)));

    const top = await fs.list('.git');
    expect(top).toContainEqual({ name: 'HEAD', isDirectory: false });
    expect(top).toContainEqual({ name: 'refs', isDirectory: true });

    const heads = await fs.list('.git/refs/heads');
    expect(heads).toContainEqual({ name: 'main', isDirectory: false });
    expect(heads).toContainEqual({ name: 'feature', isDirectory: true });
  });

  it('returns [] for a missing directory', async () => {
    const fs = new MemoryFileSystem();
    expect(await fs.list('.git/nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/memoryFileSystem.unit.test.ts`
Expected: FAIL — `fs.list is not a function`.

- [ ] **Step 3: Add the interface method** — in `src/core/fileSystem.ts`, inside `interface FileSystem`, after `readDirectory`:

```ts
  /** Entries directly under `path` (files + subdirectories). Returns [] if the directory does not exist. */
  list(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
```

- [ ] **Step 4: Implement in `MemoryFileSystem`** — in `src/core/memoryFileSystem.ts`, add a method (e.g. after `readDirectory`):

```ts
  async list(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const dir = normalizePath(path);
    const prefix = dir === '' ? '' : `${dir}/`;
    const files = new Set<string>();
    const subdirs = new Set<string>();
    for (const key of this.files.keys()) {
      if (prefix !== '' && !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === '') continue;
      const slash = rest.indexOf('/');
      if (slash < 0) files.add(rest);
      else subdirs.add(rest.slice(0, slash));
    }
    for (const key of this.dirs) {
      if (prefix !== '' && !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === '') continue;
      const slash = rest.indexOf('/');
      subdirs.add(slash < 0 ? rest : rest.slice(0, slash));
    }
    const out: { name: string; isDirectory: boolean }[] = [];
    for (const name of subdirs) out.push({ name, isDirectory: true });
    for (const name of files) if (!subdirs.has(name)) out.push({ name, isDirectory: false });
    return out;
  }
```

- [ ] **Step 5: Implement in `VscodeFileSystem`** — in `src/web/vscodeFileSystem.ts`, add after `readDirectory`:

```ts
  async list(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.uri(path));
      return entries.map(([name, type]) => ({ name, isDirectory: type === vscode.FileType.Directory }));
    } catch (e) {
      if (isCode(e, 'FileNotFound')) {
        return [];
      }
      throw e;
    }
  }
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run src/core/memoryFileSystem.unit.test.ts && npm run check-types`
Expected: PASS; type-check clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/fileSystem.ts src/core/memoryFileSystem.ts src/web/vscodeFileSystem.ts src/core/memoryFileSystem.unit.test.ts
git commit -m "feat(fs): add FileSystem.list (files + subdirectories)"
```

---

### Task 2: Pure `.git` ref-file parsers

**Files:**
- Create: `src/core/gitRefParse.ts`
- Test: `src/core/gitRefParse.unit.test.ts`

**Interfaces:**
- Produces:
  - `parseHead(content: string): { branch?: string; sha?: string }`
  - `parsePackedRefs(content: string): { ref: string; sha: string }[]`
  - `classifyRef(fullRef: string): { kind: 'branch' | 'remote' | 'tag' | 'other'; name: string }`
  - `parseReflog(content: string, max: number): { sha: string; summary: string }[]`

- [ ] **Step 1: Write the failing test** — create `src/core/gitRefParse.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHead, parsePackedRefs, classifyRef, parseReflog } from './gitRefParse';

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

describe('parseHead', () => {
  it('reads a symbolic ref to a branch (including nested names)', () => {
    expect(parseHead('ref: refs/heads/main\n')).toEqual({ branch: 'main' });
    expect(parseHead('ref: refs/heads/feature/x\n')).toEqual({ branch: 'feature/x' });
  });
  it('reads a detached HEAD sha', () => {
    expect(parseHead(`${SHA}\n`)).toEqual({ sha: SHA });
  });
  it('returns {} for anything else', () => {
    expect(parseHead('ref: refs/tags/v1\n')).toEqual({});
    expect(parseHead('garbage')).toEqual({});
  });
});

describe('parsePackedRefs', () => {
  it('parses ref lines and skips the header and peeled lines', () => {
    const content = `# pack-refs with: peeled fully-peeled sorted \n${SHA} refs/heads/main\n${SHA2} refs/tags/v1.0\n^${SHA}\n`;
    expect(parsePackedRefs(content)).toEqual([
      { ref: 'refs/heads/main', sha: SHA },
      { ref: 'refs/tags/v1.0', sha: SHA2 },
    ]);
  });
  it('ignores malformed lines', () => {
    expect(parsePackedRefs('nope\n\n')).toEqual([]);
  });
});

describe('classifyRef', () => {
  it('classifies and strips the prefix', () => {
    expect(classifyRef('refs/heads/feature/x')).toEqual({ kind: 'branch', name: 'feature/x' });
    expect(classifyRef('refs/remotes/origin/main')).toEqual({ kind: 'remote', name: 'origin/main' });
    expect(classifyRef('refs/tags/v1.0')).toEqual({ kind: 'tag', name: 'v1.0' });
    expect(classifyRef('refs/stash')).toEqual({ kind: 'other', name: 'refs/stash' });
  });
});

describe('parseReflog', () => {
  it('returns commit-ish entries newest first, deduped, capped', () => {
    const line = (newSha: string, msg: string) =>
      `${SHA} ${newSha} Dev <d@e.f> 1700000000 -0300\t${msg}`;
    const content = [
      line('1'.repeat(40), 'commit: first'),
      line('2'.repeat(40), 'checkout: moving from a to b'), // dropped (not commit-ish)
      line('3'.repeat(40), 'commit: second'),
      line('3'.repeat(40), 'commit (amend): second again'), // dedup by short sha
    ].join('\n');
    expect(parseReflog(content, 10)).toEqual([
      { sha: '3'.repeat(7), summary: 'second' },
      { sha: '1'.repeat(7), summary: 'first' },
    ]);
  });
  it('respects the max cap', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      `${SHA} ${String(i).repeat(40)} Dev <d@e.f> 1 -0300\tcommit: c${i}`).join('\n');
    expect(parseReflog(many, 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/gitRefParse.unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/core/gitRefParse.ts`:

```ts
const SHA_RE = /^[0-9a-f]{40}$/i;
const COMMIT_MSG = /^(commit|merge|rebase|cherry-pick|pull|am|revert)\b/i;

/** Parse `.git/HEAD`: a `ref: refs/heads/<name>` symref, or a detached 40-hex SHA. */
export function parseHead(content: string): { branch?: string; sha?: string } {
  const line = content.trim();
  const m = /^ref:\s+refs\/heads\/(.+)$/.exec(line);
  if (m) {
    return { branch: m[1] };
  }
  if (SHA_RE.test(line)) {
    return { sha: line };
  }
  return {};
}

/** Parse `.git/packed-refs`: `<sha> <fullref>` lines; skip the `#` header and `^peeled` lines. */
export function parsePackedRefs(content: string): { ref: string; sha: string }[] {
  const out: { ref: string; sha: string }[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('^')) {
      continue;
    }
    const sp = line.indexOf(' ');
    if (sp < 0) {
      continue;
    }
    const sha = line.slice(0, sp);
    const ref = line.slice(sp + 1).trim();
    if (SHA_RE.test(sha) && ref.startsWith('refs/')) {
      out.push({ ref, sha });
    }
  }
  return out;
}

/** Classify a full ref name into a kind + display name (prefix stripped). */
export function classifyRef(fullRef: string): { kind: 'branch' | 'remote' | 'tag' | 'other'; name: string } {
  if (fullRef.startsWith('refs/heads/')) {
    return { kind: 'branch', name: fullRef.slice('refs/heads/'.length) };
  }
  if (fullRef.startsWith('refs/remotes/')) {
    return { kind: 'remote', name: fullRef.slice('refs/remotes/'.length) };
  }
  if (fullRef.startsWith('refs/tags/')) {
    return { kind: 'tag', name: fullRef.slice('refs/tags/'.length) };
  }
  return { kind: 'other', name: fullRef };
}

/** Parse `.git/logs/HEAD` (reflog) into recent commit-ish entries, newest first, deduped by short SHA. */
export function parseReflog(content: string, max: number): { sha: string; summary: string }[] {
  const out: { sha: string; summary: string }[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const tab = lines[i].indexOf('\t');
    if (tab < 0) {
      continue;
    }
    const message = lines[i].slice(tab + 1);
    if (!COMMIT_MSG.test(message)) {
      continue;
    }
    const newSha = lines[i].slice(0, tab).split(' ')[1];
    if (!newSha || !SHA_RE.test(newSha)) {
      continue;
    }
    const sha = newSha.slice(0, 7);
    if (seen.has(sha)) {
      continue;
    }
    seen.add(sha);
    const colon = message.indexOf(': ');
    const summary = (colon >= 0 ? message.slice(colon + 2) : message).trim();
    out.push({ sha, summary });
  }
  return out;
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run src/core/gitRefParse.unit.test.ts && npm run check-types`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/gitRefParse.ts src/core/gitRefParse.unit.test.ts
git commit -m "feat(gitref): pure .git ref-file parsers"
```

---

### Task 3: `readGitRefInfoFromFs` assembler

**Files:**
- Modify: `src/core/gitRefs.ts` (add the assembler + a bounded loose-ref walker)
- Test: `src/core/gitRefs.unit.test.ts` (add a describe block; keep existing tests)

**Interfaces:**
- Consumes: Task 1 `FileSystem.list`; Task 2 `parseHead` / `parsePackedRefs` / `classifyRef` / `parseReflog`; existing `GitRefInfo`.
- Produces: `readGitRefInfoFromFs(fs: FileSystem): Promise<GitRefInfo>`.

- [ ] **Step 1: Write the failing test** — append to `src/core/gitRefs.unit.test.ts`:

```ts
import { readGitRefInfoFromFs } from './gitRefs';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = new TextEncoder();
const HEXA = 'a'.repeat(40);
const HEXB = 'b'.repeat(40);
const HEXC = 'c'.repeat(40);

async function seedGit(files: Record<string, string>): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    await fs.writeFile(path, enc.encode(content));
  }
  return fs;
}

describe('readGitRefInfoFromFs', () => {
  it('returns empty info when there is no .git/HEAD', async () => {
    expect(await readGitRefInfoFromFs(new MemoryFileSystem())).toEqual({ branches: [], tags: [] });
  });

  it('reads HEAD branch, loose + packed refs, and reflog commits', async () => {
    const fs = await seedGit({
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/refs/heads/main': `${HEXA}\n`,
      '.git/refs/heads/feature/x': `${HEXB}\n`,
      '.git/refs/remotes/origin/main': `${HEXA}\n`,
      '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/main\n',
      '.git/refs/tags/v1.0': `${HEXC}\n`,
      '.git/packed-refs': `# pack-refs with: peeled fully-peeled sorted \n${HEXC} refs/tags/v0.9\n`,
      '.git/logs/HEAD': `${'0'.repeat(40)} ${HEXA} Dev <d@e.f> 1 -0300\tcommit: hello world\n`,
    });
    const info = await readGitRefInfoFromFs(fs);
    expect(info.headBranch).toBe('main');
    expect(info.headSha).toBe(HEXA);
    expect(info.branches.sort()).toEqual(['feature/x', 'main']);
    expect(info.remoteBranches).toEqual(['origin/main']); // remote HEAD symref excluded
    expect((info.tags ?? []).sort()).toEqual(['v0.9', 'v1.0']); // packed + loose merged
    expect(info.commits).toEqual([{ sha: 'a'.repeat(7), summary: 'hello world' }]);
  });

  it('handles a detached HEAD (sha, no branch)', async () => {
    const info = await readGitRefInfoFromFs(await seedGit({ '.git/HEAD': `${HEXA}\n` }));
    expect(info.headBranch).toBeUndefined();
    expect(info.headSha).toBe(HEXA);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/gitRefs.unit.test.ts`
Expected: FAIL — `readGitRefInfoFromFs` is not exported.

- [ ] **Step 3: Implement** — in `src/core/gitRefs.ts`, add imports at the top and the assembler at the bottom (leave `currentRef` / `gitRefSuggestions` / `GitRefInfo` untouched):

```ts
import { type FileSystem } from './fileSystem';
import { parseHead, parsePackedRefs, classifyRef, parseReflog } from './gitRefParse';

const dec = new TextDecoder();
const SHA_RE = /^[0-9a-f]{40}$/i;

async function readGitText(fs: FileSystem, path: string): Promise<string | null> {
  try {
    return dec.decode(await fs.readFile(path));
  } catch {
    return null;
  }
}

/** Loose-ref leaves under a `.git/refs/...` base: `{ ref: '<.git-relative path>', content }`. Bounded. */
async function walkLooseRefs(fs: FileSystem, base: string): Promise<{ ref: string; content: string }[]> {
  const out: { ref: string; content: string }[] = [];
  const MAX_ENTRIES = 5000;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || out.length >= MAX_ENTRIES) {
      return;
    }
    let entries: { name: string; isDirectory: boolean }[];
    try {
      entries = await fs.list(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_ENTRIES) {
        return;
      }
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path, depth + 1);
      } else {
        const content = await readGitText(fs, path);
        if (content !== null) {
          out.push({ ref: path, content });
        }
      }
    }
  };
  await walk(base, 0);
  return out;
}

/**
 * Build GitRefInfo by reading `.git` through `fs` (host-agnostic). Returns empty info when there is
 * no readable `.git/HEAD` (missing repo, worktree/submodule `.git` file, or a non-git workspace).
 */
export async function readGitRefInfoFromFs(fs: FileSystem): Promise<GitRefInfo> {
  const empty: GitRefInfo = { branches: [], tags: [] };
  const head = await readGitText(fs, '.git/HEAD');
  if (head === null) {
    return empty;
  }
  const { branch, sha: detachedSha } = parseHead(head);

  const refShas = new Map<string, string>();
  const branches: string[] = [];
  const remoteBranches: string[] = [];
  const tags: string[] = [];

  const addRef = (fullRef: string, sha: string | null): void => {
    if (sha) {
      refShas.set(fullRef, sha);
    }
    const { kind, name } = classifyRef(fullRef);
    if (name === '' || name.endsWith('/HEAD')) {
      return; // skip symbolic remote HEAD pointers
    }
    if (kind === 'branch') {
      branches.push(name);
    } else if (kind === 'remote') {
      remoteBranches.push(name);
    } else if (kind === 'tag') {
      tags.push(name);
    }
  };

  const packed = await readGitText(fs, '.git/packed-refs');
  if (packed !== null) {
    for (const { ref, sha } of parsePackedRefs(packed)) {
      addRef(ref, sha);
    }
  }

  for (const base of ['refs/heads', 'refs/remotes', 'refs/tags']) {
    for (const { ref, content } of await walkLooseRefs(fs, `.git/${base}`)) {
      const line = content.trim();
      if (line.startsWith('ref:')) {
        continue; // symbolic ref (e.g. refs/remotes/*/HEAD)
      }
      addRef(ref.slice('.git/'.length), SHA_RE.test(line) ? line : null);
    }
  }

  let headSha = detachedSha;
  if (!headSha && branch) {
    headSha = refShas.get(`refs/heads/${branch}`);
  }

  const reflog = await readGitText(fs, '.git/logs/HEAD');
  const commits = reflog !== null ? parseReflog(reflog, 20) : [];

  const uniq = (a: string[]): string[] => [...new Set(a)];
  return {
    headSha,
    headBranch: branch,
    branches: uniq(branches),
    remoteBranches: uniq(remoteBranches),
    tags: uniq(tags),
    commits,
  };
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run src/core/gitRefs.unit.test.ts && npm run check-types`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/gitRefs.ts src/core/gitRefs.unit.test.ts
git commit -m "feat(gitref): assemble GitRefInfo from .git via FileSystem"
```

---

### Task 4: Rewrite `gitRefsSource.ts` to drop `vscode.git`

**Files:**
- Modify (replace whole file): `src/web/gitRefsSource.ts`

**Interfaces:**
- Consumes: Task 3 `readGitRefInfoFromFs`; existing `VscodeFileSystem.forWorkspace()`.
- Produces: `readGitRefInfo(): Promise<GitRefInfo>` (unchanged signature — callers in `extension.ts` and `createAnnotationCommand.ts` are untouched).

- [ ] **Step 1: Replace the file** — overwrite `src/web/gitRefsSource.ts` with:

```ts
import { type GitRefInfo, readGitRefInfoFromFs } from '../core/gitRefs';
import { VscodeFileSystem } from './vscodeFileSystem';

/**
 * Read HEAD/branches/tags/commits by parsing `.git` through `vscode.workspace.fs`.
 * Host-agnostic: works on desktop and remote where a real `.git` exists; returns empty info
 * on the web host or any workspace without a readable `.git` (⇒ free-text ref entry).
 */
export async function readGitRefInfo(): Promise<GitRefInfo> {
  try {
    return await readGitRefInfoFromFs(VscodeFileSystem.forWorkspace());
  } catch {
    return { branches: [], tags: [] };
  }
}
```

- [ ] **Step 2: Type-check + full unit suite**

Run: `npm run check-types && npm run test:unit`
Expected: PASS — the old `vscode.git` interfaces are gone and nothing references them.

- [ ] **Step 3: Build + integration (when a free port is available)**

Run: `npm run compile && npx @vscode/test-web --browserType=chromium --extensionDevelopmentPath=. --extensionTestsPath=dist/web/test/suite/index.js --headless --quality=stable --port=3199 test-workspace`
Expected: PASS — vscode-test-web has no `.git`, so `readGitRefInfo()` returns empty and existing behavior is unchanged. (Skip if the network/port is unavailable; the unit gate + type-check are the required local gate.)

- [ ] **Step 4: Commit**

```bash
git add src/web/gitRefsSource.ts
git commit -m "refactor(gitref): read .git via workspace.fs; drop vscode.git dependency"
```

---

### Task 5: Anchor create-time hash to the working-tree file

**Files:**
- Modify: `src/core/createAnnotationFlow.ts`
- Test: `src/core/createAnnotationFlow.unit.test.ts` (replace the affected cases)

**Interfaces:**
- Produces (change to `CreateAnnotationDeps`): add `readWorkingText(file: string): Promise<string | null>`; `SelectionInfo` **drops** `fileText`.
- Consumed by: Task 6 (`createAnnotationCommand.ts` supplies `readWorkingText` and a `fileText`-free selection).

- [ ] **Step 1: Update the test** — replace `src/core/createAnnotationFlow.unit.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runCreateAnnotation, type CreateAnnotationDeps } from './createAnnotationFlow';
import { createGroup } from './annotationFactory';
import { type AnnotationGroup } from '../shared/model';

function deps(overrides: Partial<CreateAnnotationDeps>): CreateAnnotationDeps {
  return {
    getSelection: () => ({ file: 'src/x.ts', range: { startLine: 1, endLine: 2 } }),
    readWorkingText: async () => 'a\nb\nc',
    resolveAuthor: async () => 'Author',
    listGroups: async () => [],
    pickGroup: async () => ({ kind: 'new' }),
    promptGroupTitle: async () => 'New Group',
    pickTags: async () => [],
    saveGroup: vi.fn(async () => {}),
    newId: () => 'id-1',
    now: () => 1000,
    hashContent: async () => 'HASH',
    getGitRef: async () => null,
    showInfo: vi.fn(),
    showWarning: vi.fn(),
    ...overrides,
  };
}

describe('runCreateAnnotation', () => {
  it('warns and aborts when there is no selection', async () => {
    const showWarning = vi.fn();
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ getSelection: () => undefined, showWarning, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalled();
  });

  it('warns and aborts when the working-tree file cannot be read (e.g. a diff/virtual view)', async () => {
    const showWarning = vi.fn();
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ readWorkingText: async () => null, showWarning, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalled();
  });

  it('creates a new group with the annotation and saves it', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    let nextId = 0;
    const result = await runCreateAnnotation(
      deps({ saveGroup, newId: () => `id-${++nextId}`, pickTags: async () => [{ name: 'security', color: '#888888' }] }),
    );
    expect(saveGroup).toHaveBeenCalledTimes(1);
    const saved = saveGroup.mock.calls[0][0] as AnnotationGroup;
    expect(saved.title).toBe('New Group');
    expect(saved.author).toBe('Author');
    expect(saved.tags).toEqual([{ name: 'security', color: '#888888' }]);
    expect(saved.annotations).toHaveLength(1);
    expect(saved.annotations[0]).toMatchObject({ file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'HASH' });
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(result?.group.id).toBe(saved.id);
    expect(result?.annotationId).toBe(saved.annotations[0].id);
  });

  it('hashes the anchored working-tree lines (not the whole file)', async () => {
    const hashContent = vi.fn(async () => 'HASH');
    await runCreateAnnotation(
      deps({
        hashContent,
        getSelection: () => ({ file: 'f', range: { startLine: 2, endLine: 3 } }),
        readWorkingText: async () => 'l1\nl2\nl3\nl4',
      }),
    );
    expect(hashContent).toHaveBeenCalledWith('l2\nl3');
  });

  it('appends to an existing group when one is picked', async () => {
    const existing = createGroup({ id: 'g1', title: 'Existing', author: 'A', tags: [], now: 1 });
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    await runCreateAnnotation(
      deps({ listGroups: async () => [existing], pickGroup: async () => ({ kind: 'existing', id: 'g1' }), saveGroup }),
    );
    const saved = saveGroup.mock.calls[0][0] as AnnotationGroup;
    expect(saved.id).toBe('g1');
    expect(saved.annotations).toHaveLength(1);
    expect(saved.updatedAt).toBe(1000);
  });

  it('aborts without saving when the group pick is cancelled', async () => {
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ pickGroup: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('aborts without saving when the new-group title is cancelled', async () => {
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ promptGroupTitle: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('aborts without saving when tag selection is cancelled', async () => {
    const saveGroup = vi.fn(async () => {});
    const result = await runCreateAnnotation(deps({ pickTags: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('does not offer resolved groups when picking a target group', async () => {
    const open = createGroup({ id: 'g1', title: 'Open', author: 'A', tags: [], now: 1 });
    const resolved: AnnotationGroup = {
      ...createGroup({ id: 'g2', title: 'Done', author: 'A', tags: [], now: 1 }),
      status: 'resolved',
    };
    const pickGroup = vi.fn<(groups: AnnotationGroup[]) => Promise<{ kind: 'new' }>>(async () => ({ kind: 'new' }));
    await runCreateAnnotation(deps({ listGroups: async () => [open, resolved], pickGroup }));
    expect(pickGroup).toHaveBeenCalledTimes(1);
    expect(pickGroup.mock.calls[0][0].map((g) => g.id)).toEqual(['g1']);
  });

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: FAIL — `readWorkingText` not in `CreateAnnotationDeps`; `SelectionInfo` still requires `fileText`.

- [ ] **Step 3: Implement** — in `src/core/createAnnotationFlow.ts`:

Remove `fileText` from `SelectionInfo`:

```ts
/** The current editor selection to annotate. */
export interface SelectionInfo {
  /** Workspace-relative POSIX path. */
  file: string;
  range: LineRange;
}
```

Add the dep to `CreateAnnotationDeps` (place it next to `hashContent`):

```ts
  /** Working-tree text of the (workspace-relative) file, or null if it has no readable on-disk file. */
  readWorkingText(file: string): Promise<string | null>;
  hashContent(text: string): Promise<string>;
```

Replace the hashing block near the top of `runCreateAnnotation` (currently
`const contentHash = await deps.hashContent(anchorText(selection.fileText, selection.range));`
and the `makeAnnotation` that follows) with:

```ts
  const text = await deps.readWorkingText(selection.file);
  if (text === null) {
    deps.showWarning('Annotated: open the file itself to annotate it — this view has no file on disk.');
    return undefined;
  }
  const contentHash = await deps.hashContent(anchorText(text, selection.range));
  const annotation = makeAnnotation({
    id: deps.newId(),
    file: selection.file,
    range: selection.range,
    contentHash,
  });
```

(`anchorText` is already imported.)

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run src/core/createAnnotationFlow.unit.test.ts && npm run check-types`
Expected: PASS. Note: `check-types` will now flag `src/web/createAnnotationCommand.ts` (missing `readWorkingText`, stale `fileText`) — that is fixed in Task 6. If running the whole gate, expect that single file to error until Task 6 lands.

- [ ] **Step 5: Commit**

```bash
git add src/core/createAnnotationFlow.ts src/core/createAnnotationFlow.unit.test.ts
git commit -m "fix(annotate): anchor create-time hash to working-tree text"
```

---

### Task 6: Wire `readWorkingText` + path normalization in the command

**Files:**
- Modify: `src/web/createAnnotationCommand.ts`

**Interfaces:**
- Consumes: Task 5 (`readWorkingText` dep; `SelectionInfo` without `fileText`); existing `toWorkspaceRelativeSegments` from `src/shared/path`; existing `VscodeFileSystem`.

- [ ] **Step 1: Add the import** — in `src/web/createAnnotationCommand.ts`, add near the other `../shared` imports:

```ts
import { toWorkspaceRelativeSegments } from '../shared/path';
```

- [ ] **Step 2: Share one filesystem + supply the dep** — in `registerCreateAnnotationCommand`, replace the store construction and the deps object so a single `VscodeFileSystem` is reused and `getSelection`/`readWorkingText` are wired:

```ts
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const editor = vscode.window.activeTextEditor;
    const dec = new TextDecoder();

    const deps: CreateAnnotationDeps = {
      getSelection: () => getSelection(editor, folder.uri.path),
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
```

- [ ] **Step 3: Normalize the selection path; drop `fileText`** — replace `getSelection` with:

```ts
function getSelection(editor: vscode.TextEditor | undefined, workspaceRootPath?: string): SelectionInfo | undefined {
  if (!editor) {
    return undefined;
  }
  const sel = editor.selection;
  // VSCode lines are 0-based; the model uses 1-based inclusive lines.
  const startLine = sel.start.line + 1;
  // If the selection ends at column 0 of a later line, that line is not really included.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  const raw = vscode.workspace.asRelativePath(editor.document.uri, false);
  const segments = toWorkspaceRelativeSegments(raw, workspaceRootPath);
  return {
    file: segments ? segments.join('/') : raw,
    range: { startLine, endLine },
  };
}
```

- [ ] **Step 4: Type-check + full unit gate**

Run: `npm run check-types && npm run test:unit`
Expected: PASS — no dangling `fileText`; `createAnnotationCommand.ts` satisfies the new deps.

- [ ] **Step 5: Build + integration (when a free port is available)**

Run: `npm run compile && npx @vscode/test-web --browserType=chromium --extensionDevelopmentPath=. --extensionTestsPath=dist/web/test/suite/index.js --headless --quality=stable --port=3199 test-workspace`
Expected: PASS. (Skip if network/port unavailable.)

- [ ] **Step 6: Commit**

```bash
git add src/web/createAnnotationCommand.ts
git commit -m "fix(annotate): read working-tree text + normalize selection path"
```

---

## Self-Review notes

- **Spec coverage:** Item 1 → Tasks 1–4 (`FileSystem.list`, parsers, assembler, source rewrite). Item 2 → Tasks 5–6 (flow hashing, command wiring + path normalization). Degradation contract preserved in Task 4. Both "Testing" blocks map to Task 1/2/3/5 unit tests.
- **Type consistency:** `list` shape `{ name; isDirectory }` is identical across Tasks 1 & 3. `readGitRefInfoFromFs(fs)` produced in Task 3, consumed verbatim in Task 4. `readWorkingText(file): Promise<string | null>` and the `fileText`-free `SelectionInfo` are defined in Task 5 and consumed in Task 6. `GitRefInfo` / `currentRef` / `gitRefSuggestions` are unchanged, so `extension.ts` and its QuickPicks need no edits.
- **Execution:** Item 2 (Tasks 5–6) touches files disjoint from Item 1 (Tasks 1–4) with no logical dependency, so its implementation may overlap Item 1's review (repo pipelining rule). Within each item, stay sequential (Task 3 depends on 1+2; 4 on 3; 6 on 5).
- **Non-test verification:** the diff-view fix's real-world payoff (annotating a GitLens diff no longer shows stale) is exercised via the flow unit tests (`readWorkingText` null vs text); a manual smoke over a real GitLens diff is a nice-to-have for the user, not a gate.
