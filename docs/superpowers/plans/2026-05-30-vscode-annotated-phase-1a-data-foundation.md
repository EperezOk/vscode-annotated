# vscode-annotated — Phase 1a: Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested, UI-free data foundation for the annotation extension: the domain model, JSON (de)serialization, a `FileSystem` abstraction with an in-memory test impl and a `vscode.workspace.fs` adapter, a `GroupStore` for CRUD over `.annotations/groups/`, id/hash helpers, and pure author-identity resolution.

**Architecture:** A pure domain core (`src/shared`, `src/core`) with zero VSCode dependency carries the model, store logic, hashing, and author resolution — all unit-tested with Vitest against an in-memory `FileSystem`. A thin web adapter (`src/web/vscodeFileSystem.ts`) implements the same `FileSystem` interface over `vscode.workspace.fs`, verified by a `@vscode/test-web` integration round-trip against a writable `test-workspace` folder. No new user-facing UI in this sub-plan.

**Tech Stack:** TypeScript 5.9 (web extension host, no Node built-ins — use `vscode.workspace.fs`, `vscode.Uri.joinPath`, Web Crypto `crypto.randomUUID`/`crypto.subtle`). Vitest 4 unit tests; `@vscode/test-web` integration. Svelte/CodeMirror not involved here.

> **Conventions for the executor:**
> - Work on the **`phase-1`** branch (already checked out).
> - **Node:** the toolchain needs Node ≥20.19. The system default is 20.15.1 (too old). Prefix every node/npm/npx command with `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"` (verify `node -v` → v25.x).
> - Append this trailer to every commit message (after a blank line):
>   ```
>   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
>   ```
> - **Sandbox/network:** `npm run test:integration` downloads/serves a VSCode web build — run it with the Bash tool's `dangerouslyDisableSandbox: true` and a long timeout (`600000`). Unit tests need neither.

---

## Context: what already exists (Phase 0)

- `src/shared/protocol.ts` — message-type skeleton + `parseMessage` (don't touch in 1a).
- `src/web/extension.ts` — `activate` registers the sidebar webview provider + `annotated.ping`.
- `src/web/sidebarViewProvider.ts`, `src/webview/sidebar/*` — the hello webview (untouched in 1a).
- `src/web/test/suite/index.ts` — Mocha entry; dynamically imports `./extension.test` after `mocha.setup({ ui: 'tdd', reporter: 'spec' })`. **1a adds a second test import here.**
- `src/web/test/suite/extension.test.ts` — Phase 0 integration tests (untouched).
- `esbuild.mjs` — bundles extension + webview + `src/web/test/suite/index.js`. The test bundle picks up new imports automatically; **no esbuild change needed in 1a.**
- `vitest.config.ts` — `unit` (node, `*.unit.test.ts`) + `component` (jsdom, `*.svelte.test.ts`) projects.
- `package.json` `test:integration` = `npm run compile && vscode-test-web --browserType=chromium --extensionDevelopmentPath=. --extensionTestsPath=dist/web/test/suite/index.js --headless --quality=stable`.

---

## File Structure (created/modified in 1a)

```
src/shared/model.ts                         # domain types + parseGroup/serializeGroup (validation)
src/shared/model.unit.test.ts
src/shared/ids.ts                           # newId() via crypto.randomUUID
src/shared/ids.unit.test.ts
src/shared/hash.ts                          # sha256Hex() + anchorText()
src/shared/hash.unit.test.ts
src/core/fileSystem.ts                      # FileSystem interface (workspace-relative POSIX paths)
src/core/memoryFileSystem.ts                # in-memory FileSystem for tests
src/core/memoryFileSystem.unit.test.ts
src/core/groupStore.ts                      # GroupStore CRUD over a FileSystem
src/core/groupStore.unit.test.ts
src/core/authorIdentity.ts                  # resolveAuthor(sources) — pure
src/core/authorIdentity.unit.test.ts
src/web/vscodeFileSystem.ts                 # FileSystem impl over vscode.workspace.fs
src/web/test/suite/groupStore.integration.test.ts   # round-trip in @vscode/test-web
test-workspace/.gitkeep                     # writable workspace folder for the integration host
(modify) src/web/test/suite/index.ts        # also import the new integration test
(modify) package.json                       # test:integration adds positional `test-workspace`; engines.node
(modify) .vscodeignore                      # exclude test-workspace
(modify) .github/workflows/ci.yml           # bump CI Node 20 → 22
```

---

## Task 1: Domain model + (de)serialization

**Files:** Create `src/shared/model.ts`, `src/shared/model.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/shared/model.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseGroup, serializeGroup, type AnnotationGroup } from './model';

const validGroup: AnnotationGroup = {
  id: 'g1',
  title: 'Login review',
  author: 'Ezequiel',
  tags: ['security', 'question'],
  gitRef: 'feature/login',
  status: 'open',
  createdAt: 1730000000,
  updatedAt: 1730000001,
  annotations: [
    {
      id: 'a1',
      file: 'src/auth/login.ts',
      range: { startLine: 42, endLine: 47 },
      content: '## note',
      contentHash: 'abc123',
    },
  ],
};

describe('serializeGroup/parseGroup', () => {
  it('round-trips a valid group', () => {
    const text = serializeGroup(validGroup);
    expect(parseGroup(JSON.parse(text))).toEqual(validGroup);
  });

  it('serializes as pretty JSON (2-space indent)', () => {
    expect(serializeGroup(validGroup)).toContain('\n  "id": "g1"');
  });

  it('accepts gitRef: null', () => {
    const g = { ...validGroup, gitRef: null };
    expect(parseGroup(JSON.parse(serializeGroup(g))).gitRef).toBeNull();
  });

  it('throws on a non-object', () => {
    expect(() => parseGroup(null)).toThrow();
    expect(() => parseGroup('nope')).toThrow();
  });

  it('throws when a required field is missing', () => {
    const { title, ...noTitle } = validGroup;
    expect(() => parseGroup(noTitle)).toThrow(/title/);
  });

  it('throws when status is invalid', () => {
    expect(() => parseGroup({ ...validGroup, status: 'archived' })).toThrow(/status/);
  });

  it('throws when an annotation range is malformed', () => {
    const bad = { ...validGroup, annotations: [{ ...validGroup.annotations[0], range: { startLine: 5, endLine: 2 } }] };
    expect(() => parseGroup(bad)).toThrow(/range/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/model.unit.test.ts`
Expected: FAIL — cannot resolve `./model`.

- [ ] **Step 3: Implement `src/shared/model.ts`**

```ts
// Domain model for annotation groups and their annotations.
// Pure data + validation; no VSCode or I/O dependency.

export interface LineRange {
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

export interface Annotation {
  id: string;
  /** Workspace-relative POSIX path. */
  file: string;
  range: LineRange;
  /** Markdown body. */
  content: string;
  /** SHA-256 hex of the anchored lines at creation (for drift detection). */
  contentHash: string;
}

export type GroupStatus = 'open' | 'resolved';

export interface AnnotationGroup {
  id: string;
  title: string;
  author: string;
  /** Tag names (colors live in user config). */
  tags: string[];
  /** Branch / tag / SHA, or null. */
  gitRef: string | null;
  status: GroupStatus;
  /** Epoch seconds. */
  createdAt: number;
  updatedAt: number;
  annotations: Annotation[];
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function fail(field: string, detail: string): never {
  throw new Error(`Invalid group: ${field} ${detail}`);
}

function parseRange(raw: unknown): LineRange {
  if (!isObject(raw)) fail('range', 'is not an object');
  const { startLine, endLine } = raw as Record<string, unknown>;
  if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
    fail('range.startLine', 'must be an integer >= 1');
  }
  if (typeof endLine !== 'number' || !Number.isInteger(endLine) || endLine < startLine) {
    fail('range.endLine', 'must be an integer >= startLine');
  }
  return { startLine, endLine };
}

function parseAnnotation(raw: unknown): Annotation {
  if (!isObject(raw)) fail('annotation', 'is not an object');
  const { id, file, range, content, contentHash } = raw;
  if (typeof id !== 'string') fail('annotation.id', 'must be a string');
  if (typeof file !== 'string') fail('annotation.file', 'must be a string');
  if (typeof content !== 'string') fail('annotation.content', 'must be a string');
  if (typeof contentHash !== 'string') fail('annotation.contentHash', 'must be a string');
  return { id, file, range: parseRange(range), content, contentHash };
}

/** Validate an untrusted parsed value as an AnnotationGroup. Throws Error on any problem. */
export function parseGroup(raw: unknown): AnnotationGroup {
  if (!isObject(raw)) fail('root', 'is not an object');
  const { id, title, author, tags, gitRef, status, createdAt, updatedAt, annotations } = raw;
  if (typeof id !== 'string') fail('id', 'must be a string');
  if (typeof title !== 'string') fail('title', 'must be a string');
  if (typeof author !== 'string') fail('author', 'must be a string');
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) fail('tags', 'must be a string[]');
  if (gitRef !== null && typeof gitRef !== 'string') fail('gitRef', 'must be a string or null');
  if (status !== 'open' && status !== 'resolved') fail('status', "must be 'open' or 'resolved'");
  if (typeof createdAt !== 'number') fail('createdAt', 'must be a number');
  if (typeof updatedAt !== 'number') fail('updatedAt', 'must be a number');
  if (!Array.isArray(annotations)) fail('annotations', 'must be an array');
  return {
    id,
    title,
    author,
    tags: [...tags] as string[],
    gitRef,
    status,
    createdAt,
    updatedAt,
    annotations: annotations.map(parseAnnotation),
  };
}

/** Serialize a group as pretty (2-space) JSON. */
export function serializeGroup(group: AnnotationGroup): string {
  return JSON.stringify(group, null, 2);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/model.unit.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/model.ts src/shared/model.unit.test.ts
git commit -m "feat: annotation domain model + JSON (de)serialization"
```

---

## Task 2: id and hash helpers

**Files:** Create `src/shared/ids.ts`, `src/shared/ids.unit.test.ts`, `src/shared/hash.ts`, `src/shared/hash.unit.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/shared/ids.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('returns a v4-style UUID string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns a different value each call', () => {
    expect(newId()).not.toBe(newId());
  });
});
```

`src/shared/hash.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sha256Hex, anchorText } from './hash';

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is deterministic and content-sensitive', async () => {
    expect(await sha256Hex('hello')).toBe(await sha256Hex('hello'));
    expect(await sha256Hex('hello')).not.toBe(await sha256Hex('world'));
  });
});

describe('anchorText', () => {
  const file = 'l1\nl2\nl3\nl4\nl5';

  it('extracts an inclusive 1-based line range', () => {
    expect(anchorText(file, { startLine: 2, endLine: 4 })).toBe('l2\nl3\nl4');
  });

  it('extracts a single line', () => {
    expect(anchorText(file, { startLine: 3, endLine: 3 })).toBe('l3');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/ids.unit.test.ts src/shared/hash.unit.test.ts`
Expected: FAIL — cannot resolve `./ids` / `./hash`.

- [ ] **Step 3: Implement `src/shared/ids.ts`**

```ts
/** Generate a unique id (RFC 4122 v4 UUID). Web Crypto is available in the web host and Node ≥20.19. */
export function newId(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 4: Implement `src/shared/hash.ts`**

```ts
import type { LineRange } from './model';

/** SHA-256 of `text`, lowercase hex. Uses Web Crypto (available in web host + Node ≥20.19). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The exact text of the full lines in `range` (1-based, inclusive) from `fileText`. */
export function anchorText(fileText: string, range: LineRange): string {
  const lines = fileText.split('\n');
  return lines.slice(range.startLine - 1, range.endLine).join('\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/ids.unit.test.ts src/shared/hash.unit.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 6: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ids.ts src/shared/ids.unit.test.ts src/shared/hash.ts src/shared/hash.unit.test.ts
git commit -m "feat: id generation + SHA-256 hashing + anchor-text helpers"
```

---

## Task 3: FileSystem interface + in-memory implementation

**Files:** Create `src/core/fileSystem.ts`, `src/core/memoryFileSystem.ts`, `src/core/memoryFileSystem.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/memoryFileSystem.unit.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystem } from './memoryFileSystem';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('MemoryFileSystem', () => {
  let fs: MemoryFileSystem;
  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  it('writes then reads a file', async () => {
    await fs.writeFile('a/b.json', enc('hello'));
    expect(dec(await fs.readFile('a/b.json'))).toBe('hello');
  });

  it('readFile throws for a missing file', async () => {
    await expect(fs.readFile('nope.json')).rejects.toThrow();
  });

  it('readDirectory lists only files directly under the path', async () => {
    await fs.writeFile('d/one.json', enc('1'));
    await fs.writeFile('d/two.json', enc('2'));
    await fs.writeFile('d/sub/three.json', enc('3'));
    const names = (await fs.readDirectory('d')).sort();
    expect(names).toEqual(['one.json', 'two.json']);
  });

  it('readDirectory returns [] for a missing directory', async () => {
    expect(await fs.readDirectory('missing')).toEqual([]);
  });

  it('exists reflects writes and deletes', async () => {
    await fs.writeFile('x.json', enc('x'));
    expect(await fs.exists('x.json')).toBe(true);
    await fs.delete('x.json');
    expect(await fs.exists('x.json')).toBe(false);
  });

  it('normalizes leading/trailing/duplicate slashes', async () => {
    await fs.writeFile('/p//q.json/', enc('v'));
    expect(dec(await fs.readFile('p/q.json'))).toBe('v');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/memoryFileSystem.unit.test.ts`
Expected: FAIL — cannot resolve `./memoryFileSystem`.

- [ ] **Step 3: Implement `src/core/fileSystem.ts`**

```ts
/**
 * Minimal file-system abstraction over workspace-relative POSIX paths
 * ('/'-separated, no leading slash). Implemented in-memory for tests and
 * over `vscode.workspace.fs` for the running extension.
 */
export interface FileSystem {
  /** Read a file's bytes. Rejects if the file does not exist. */
  readFile(path: string): Promise<Uint8Array>;
  /** Write a file's bytes, creating ancestor directories as needed. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Names of files directly under `path`. Returns [] if the directory does not exist. */
  readDirectory(path: string): Promise<string[]>;
  /** Create `path` and any missing ancestors. Idempotent. */
  createDirectory(path: string): Promise<void>;
  /** Delete a file. No-op if it does not exist. */
  delete(path: string): Promise<void>;
  /** Whether a file or directory exists at `path`. */
  exists(path: string): Promise<boolean>;
}

/** Normalize a path: drop leading/trailing slashes, collapse duplicates. */
export function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Parent directory of a normalized path, or '' for a top-level path. */
export function parentOf(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
```

- [ ] **Step 4: Implement `src/core/memoryFileSystem.ts`**

```ts
import { type FileSystem, normalizePath } from './fileSystem';

/** In-memory FileSystem for unit tests. */
export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>();

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(normalizePath(path));
    if (!data) {
      throw new Error(`File not found: ${normalizePath(path)}`);
    }
    return data;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    this.files.set(p, data);
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (parent) {
      await this.createDirectory(parent);
    }
  }

  async readDirectory(path: string): Promise<string[]> {
    const dir = normalizePath(path);
    const prefix = dir === '' ? '' : `${dir}/`;
    const names: string[] = [];
    for (const key of this.files.keys()) {
      if (prefix === '' ? !key.includes('/') : key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (rest !== '' && !rest.includes('/')) {
          names.push(rest);
        }
      }
    }
    return names;
  }

  async createDirectory(path: string): Promise<void> {
    this.dirs.add(normalizePath(path));
  }

  async delete(path: string): Promise<void> {
    this.files.delete(normalizePath(path));
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return this.files.has(p) || this.dirs.has(p);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/memoryFileSystem.unit.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 6: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/fileSystem.ts src/core/memoryFileSystem.ts src/core/memoryFileSystem.unit.test.ts
git commit -m "feat: FileSystem abstraction + in-memory implementation"
```

---

## Task 4: GroupStore CRUD

**Files:** Create `src/core/groupStore.ts`, `src/core/groupStore.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/groupStore.unit.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GroupStore } from './groupStore';
import { MemoryFileSystem } from './memoryFileSystem';
import { serializeGroup, type AnnotationGroup } from '../shared/model';

function group(id: string, title = 'T'): AnnotationGroup {
  return {
    id,
    title,
    author: 'A',
    tags: [],
    gitRef: null,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    annotations: [],
  };
}

describe('GroupStore', () => {
  let fs: MemoryFileSystem;
  let store: GroupStore;
  beforeEach(() => {
    fs = new MemoryFileSystem();
    store = new GroupStore(fs);
  });

  it('saveGroup then getGroup round-trips', async () => {
    await store.saveGroup(group('g1', 'Hello'));
    const got = await store.getGroup('g1');
    expect(got?.title).toBe('Hello');
  });

  it('writes to .annotations/groups/<id>.json', async () => {
    await store.saveGroup(group('g1'));
    expect(await fs.exists('.annotations/groups/g1.json')).toBe(true);
  });

  it('getGroup returns null for a missing id', async () => {
    expect(await store.getGroup('missing')).toBeNull();
  });

  it('listGroups returns all saved groups', async () => {
    await store.saveGroup(group('g1'));
    await store.saveGroup(group('g2'));
    expect((await store.listGroups()).map((g) => g.id).sort()).toEqual(['g1', 'g2']);
  });

  it('listGroups returns [] when the directory does not exist', async () => {
    expect(await store.listGroups()).toEqual([]);
  });

  it('listGroups skips invalid JSON / invalid group files', async () => {
    await store.saveGroup(group('g1'));
    await fs.writeFile('.annotations/groups/broken.json', new TextEncoder().encode('{ not json'));
    await fs.writeFile(
      '.annotations/groups/wrong.json',
      new TextEncoder().encode(JSON.stringify({ id: 'x' })),
    );
    expect((await store.listGroups()).map((g) => g.id)).toEqual(['g1']);
  });

  it('ignores non-.json files in the directory', async () => {
    await store.saveGroup(group('g1'));
    await fs.writeFile('.annotations/groups/README.md', new TextEncoder().encode('# hi'));
    expect((await store.listGroups()).map((g) => g.id)).toEqual(['g1']);
  });

  it('deleteGroup removes the file', async () => {
    await store.saveGroup(group('g1'));
    await store.deleteGroup('g1');
    expect(await store.getGroup('g1')).toBeNull();
  });

  it('persists exactly the serialized form', async () => {
    const g = group('g1', 'Exact');
    await store.saveGroup(g);
    const bytes = await fs.readFile('.annotations/groups/g1.json');
    expect(new TextDecoder().decode(bytes)).toBe(serializeGroup(g));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts`
Expected: FAIL — cannot resolve `./groupStore`.

- [ ] **Step 3: Implement `src/core/groupStore.ts`**

```ts
import { type FileSystem } from './fileSystem';
import { type AnnotationGroup, parseGroup, serializeGroup } from '../shared/model';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** Persistence CRUD for annotation groups, one JSON file per group. */
export class GroupStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly dir = '.annotations/groups',
  ) {}

  private path(id: string): string {
    return `${this.dir}/${id}.json`;
  }

  /** Load all valid groups. Invalid/unparseable files are skipped (with a warning). */
  async listGroups(): Promise<AnnotationGroup[]> {
    const names = await this.fs.readDirectory(this.dir);
    const groups: AnnotationGroup[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      try {
        const bytes = await this.fs.readFile(`${this.dir}/${name}`);
        groups.push(parseGroup(JSON.parse(dec.decode(bytes))));
      } catch (e) {
        console.warn(`[annotated] skipping invalid group file ${name}: ${String(e)}`);
      }
    }
    return groups;
  }

  /** Load one group by id, or null if missing/invalid. */
  async getGroup(id: string): Promise<AnnotationGroup | null> {
    try {
      const bytes = await this.fs.readFile(this.path(id));
      return parseGroup(JSON.parse(dec.decode(bytes)));
    } catch {
      return null;
    }
  }

  /** Write a group (whole-file). Caller is responsible for timestamps. */
  async saveGroup(group: AnnotationGroup): Promise<void> {
    await this.fs.createDirectory(this.dir);
    await this.fs.writeFile(this.path(group.id), enc.encode(serializeGroup(group)));
  }

  /** Delete a group's file. No-op if absent. */
  async deleteGroup(id: string): Promise<void> {
    await this.fs.delete(this.path(id));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/groupStore.unit.test.ts`
Expected: PASS — 9 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/groupStore.ts src/core/groupStore.unit.test.ts
git commit -m "feat: GroupStore CRUD over the FileSystem abstraction"
```

---

## Task 5: Author identity resolution (pure)

The running extension resolves the annotation author from several sources. On the **web host** the built-in `vscode.git` extension is unavailable, so resolution must gracefully fall through. This task implements the pure resolution logic; the VSCode-backed sources are wired in sub-plan 1b where author is first used.

**Files:** Create `src/core/authorIdentity.ts`, `src/core/authorIdentity.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/authorIdentity.unit.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveAuthor, type AuthorNameSources } from './authorIdentity';

function sources(overrides: Partial<AuthorNameSources>): AuthorNameSources {
  return {
    gitUserName: async () => undefined,
    settingAuthorName: () => undefined,
    githubAccountLabel: async () => undefined,
    promptForName: async () => undefined,
    persistName: async () => {},
    ...overrides,
  };
}

describe('resolveAuthor', () => {
  it('prefers git user.name when present', async () => {
    expect(await resolveAuthor(sources({ gitUserName: async () => 'Git Name' }))).toBe('Git Name');
  });

  it('falls back to the configured setting', async () => {
    expect(await resolveAuthor(sources({ settingAuthorName: () => 'Setting Name' }))).toBe('Setting Name');
  });

  it('falls back to the GitHub account label', async () => {
    expect(await resolveAuthor(sources({ githubAccountLabel: async () => 'octocat' }))).toBe('octocat');
  });

  it('prompts and persists when nothing else is available', async () => {
    const persistName = vi.fn(async () => {});
    const result = await resolveAuthor(sources({ promptForName: async () => 'Typed Name', persistName }));
    expect(result).toBe('Typed Name');
    expect(persistName).toHaveBeenCalledWith('Typed Name');
  });

  it('returns "Unknown" when every source is empty', async () => {
    expect(await resolveAuthor(sources({}))).toBe('Unknown');
  });

  it('ignores whitespace-only values', async () => {
    expect(await resolveAuthor(sources({ gitUserName: async () => '   ', settingAuthorName: () => 'Real' }))).toBe('Real');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/authorIdentity.unit.test.ts`
Expected: FAIL — cannot resolve `./authorIdentity`.

- [ ] **Step 3: Implement `src/core/authorIdentity.ts`**

```ts
/**
 * Sources of an author display name, in priority order. Any source may return
 * undefined when unavailable. On the web host `gitUserName` is typically
 * undefined (the built-in git extension is desktop-only), so resolution falls
 * through to the configured setting, the GitHub session, then a prompt.
 */
export interface AuthorNameSources {
  /** git config user.name (desktop only; undefined on web). */
  gitUserName(): Promise<string | undefined>;
  /** The `annotated.authorName` setting. */
  settingAuthorName(): string | undefined;
  /** A signed-in GitHub session's account label (works on web). */
  githubAccountLabel(): Promise<string | undefined>;
  /** Prompt the user to type a name. */
  promptForName(): Promise<string | undefined>;
  /** Persist a chosen name to the `annotated.authorName` setting. */
  persistName(name: string): Promise<void>;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Resolve the author display name by trying each source in priority order. */
export async function resolveAuthor(sources: AuthorNameSources): Promise<string> {
  const git = clean(await sources.gitUserName());
  if (git) {
    return git;
  }
  const setting = clean(sources.settingAuthorName());
  if (setting) {
    return setting;
  }
  const github = clean(await sources.githubAccountLabel());
  if (github) {
    return github;
  }
  const prompted = clean(await sources.promptForName());
  if (prompted) {
    await sources.persistName(prompted);
    return prompted;
  }
  return 'Unknown';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/authorIdentity.unit.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/authorIdentity.ts src/core/authorIdentity.unit.test.ts
git commit -m "feat: pure author-identity resolution (git/setting/github/prompt)"
```

---

## Task 6: vscode.workspace.fs adapter + integration round-trip

**Files:** Create `src/web/vscodeFileSystem.ts`, `src/web/test/suite/groupStore.integration.test.ts`, `test-workspace/.gitkeep`; Modify `src/web/test/suite/index.ts`, `package.json`, `.vscodeignore`

- [ ] **Step 1: Implement `src/web/vscodeFileSystem.ts`**

```ts
import * as vscode from 'vscode';
import { type FileSystem, normalizePath, parentOf } from '../core/fileSystem';

function isCode(e: unknown, code: string): boolean {
  return e instanceof vscode.FileSystemError && e.code === code;
}

/** FileSystem implementation over `vscode.workspace.fs`, rooted at a workspace folder. */
export class VscodeFileSystem implements FileSystem {
  constructor(private readonly root: vscode.Uri) {}

  /** Build from the first open workspace folder. Throws if none is open. */
  static forWorkspace(): VscodeFileSystem {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder open');
    }
    return new VscodeFileSystem(folder.uri);
  }

  private uri(path: string): vscode.Uri {
    const segments = normalizePath(path).split('/').filter(Boolean);
    return vscode.Uri.joinPath(this.root, ...segments);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(this.uri(path));
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const parent = parentOf(path);
    if (parent) {
      await this.createDirectory(parent);
    }
    await vscode.workspace.fs.writeFile(this.uri(path), data);
  }

  async readDirectory(path: string): Promise<string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.uri(path));
      return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
    } catch (e) {
      if (isCode(e, 'FileNotFound')) {
        return [];
      }
      throw e;
    }
  }

  async createDirectory(path: string): Promise<void> {
    const segments = normalizePath(path).split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      try {
        await vscode.workspace.fs.createDirectory(this.uri(current));
      } catch (e) {
        if (!isCode(e, 'FileExists')) {
          throw e;
        }
      }
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uri(path), { recursive: false, useTrash: false });
    } catch (e) {
      if (!isCode(e, 'FileNotFound')) {
        throw e;
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.uri(path));
      return true;
    } catch (e) {
      if (isCode(e, 'FileNotFound')) {
        return false;
      }
      throw e;
    }
  }
}
```

- [ ] **Step 2: Create the writable test workspace** — `test-workspace/.gitkeep`

Create an empty file at `test-workspace/.gitkeep` (its only purpose is to make the directory exist on disk so `@vscode/test-web` can mount it as a writable in-memory workspace):

```
```
(empty file)

- [ ] **Step 3: Write the integration test** — `src/web/test/suite/groupStore.integration.test.ts`

```ts
import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore over vscode.workspace.fs', () => {
  test('saves, lists, gets, and deletes a group in the workspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder — @vscode/test-web must be passed the test-workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const group: AnnotationGroup = {
      id: 'itest-group-1',
      title: 'Integration',
      author: 'Tester',
      tags: ['security'],
      gitRef: null,
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
      annotations: [
        { id: 'a1', file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, content: '# hi', contentHash: 'x' },
      ],
    };

    try {
      await store.saveGroup(group);

      const listed = await store.listGroups();
      if (!listed.some((g) => g.id === 'itest-group-1')) {
        throw new Error('group not listed after save');
      }

      const got = await store.getGroup('itest-group-1');
      if (!got || got.title !== 'Integration') {
        throw new Error('getGroup did not round-trip the title');
      }
      if (got.annotations[0]?.range.endLine !== 2) {
        throw new Error('getGroup did not round-trip the annotation range');
      }
    } finally {
      await store.deleteGroup('itest-group-1');
    }

    if ((await store.getGroup('itest-group-1')) !== null) {
      throw new Error('group still present after delete');
    }
  });
});
```

- [ ] **Step 4: Wire the new test into the Mocha entry** — modify `src/web/test/suite/index.ts`

Replace the single dynamic import with imports of BOTH test modules. Change:

```ts
    // Register suites AFTER mocha.setup so the tdd globals (suite/test) exist.
    import('./extension.test')
      .then(() => {
```

to:

```ts
    // Register suites AFTER mocha.setup so the tdd globals (suite/test) exist.
    Promise.all([import('./extension.test'), import('./groupStore.integration.test')])
      .then(() => {
```

(Leave the rest of `run()` — the `mocha.run(...)` block and `.catch(reject)` — unchanged.)

- [ ] **Step 5: Pass the workspace folder to `@vscode/test-web`** — modify `package.json`

Change the `test:integration` script by appending the positional `test-workspace` folder argument:

```json
    "test:integration": "npm run compile && vscode-test-web --browserType=chromium --extensionDevelopmentPath=. --extensionTestsPath=dist/web/test/suite/index.js --headless --quality=stable test-workspace",
```

- [ ] **Step 6: Exclude the fixture from the package** — modify `.vscodeignore`

Add this line to `.vscodeignore`:

```
test-workspace/**
```

- [ ] **Step 7: Build, type-check, and run the integration suite**

Run (with `dangerouslyDisableSandbox: true` and Bash `timeout: 600000`):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:integration`
Expected: `check-types` exits 0; `@vscode/test-web` launches headless, opens the `test-workspace` folder, and Mocha reports **3 passing** (Phase 0's 2 + the new round-trip). Exit 0.

- [ ] **Step 8: Confirm unit tests still pass**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit`
Expected: PASS — all unit tests green (model, ids, hash, memoryFileSystem, groupStore, authorIdentity, plus the Phase 0 protocol + component tests).

- [ ] **Step 9: Commit**

```bash
git add src/web/vscodeFileSystem.ts src/web/test/suite/groupStore.integration.test.ts src/web/test/suite/index.ts test-workspace/.gitkeep package.json .vscodeignore
git commit -m "feat: vscode.workspace.fs adapter + GroupStore integration round-trip"
```

---

## Task 7: Declare Node engine + bump CI

**Files:** Modify `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Declare the Node engine** — modify `package.json`

Change the `engines` block to add `node`:

```json
  "engines": { "vscode": "^1.100.0", "node": ">=20.19" },
```

- [ ] **Step 2: Bump CI Node version** — modify `.github/workflows/ci.yml`

Change:

```yaml
        with:
          node-version: 20
          cache: npm
```

to:

```yaml
        with:
          node-version: 22
          cache: npm
```

- [ ] **Step 3: Verify the full suite is green end to end**

Run (with `dangerouslyDisableSandbox: true` and Bash `timeout: 600000`):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (3 passing) → `test:e2e` (1 passed) all green, exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "chore: declare engines.node >=20.19; bump CI to Node 22"
```

---

## Phase 1a Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (model, ids, hash, memoryFileSystem, groupStore, authorIdentity + Phase 0 tests).
- [ ] `npm run test:integration` passes — **3 passing** (Phase 0's 2 + the GroupStore round-trip against `vscode.workspace.fs`).
- [ ] `npm run test:e2e` still passes (1 passed).
- [ ] All work committed on the `phase-1` branch.

This delivers the tested data foundation. The next sub-plans build on it:
- **1b — Create Annotation:** command + QuickPick flow + keybindings; uses `GroupStore`, `resolveAuthor` (with the real VSCode-backed `AuthorNameSources`: git ext on desktop, `annotated.authorName` setting, GitHub session, prompt), `newId`, `sha256Hex`/`anchorText` to create groups/annotations.
- **1c — Sidebar:** rebuild the webview on the real protocol; host loads groups via `GroupStore`/`VscodeFileSystem` and pushes state; `FileSystemWatcher` live reload; crypto nonce; drop the `name` scaffold prop; conditional CSS link.
- **1d / 1e — Detail panel (group + annotation views), CodeMirror editor, navigate-to-code.**

## Phase 1b carry-over (from Phase 1a final review)

- **Concrete `VscodeAuthorNameSources`** (in `src/web/`) implementing `AuthorNameSources` — git ext (`getExtension('vscode.git')`, desktop-only), `annotated.authorName` setting, `vscode.authentication.getSession('github', …, { silent: true })?.account.label`, `showInputBox`, and `config.update` to persist.
- **Mutation pattern:** add an annotation via `getGroup → push annotation → saveGroup` (no `updateGroup` method needed). The command sets `updatedAt` (and `createdAt` on new groups).
- **Timestamp idiom:** callers use `Math.floor(Date.now() / 1000)` for epoch seconds; consider a tiny `epochSeconds()` helper in `src/shared` if it repeats.
- **MemoryFileSystem parity (minor):** `MemoryFileSystem.createDirectory` adds only the given path to its `dirs` set, while `VscodeFileSystem.createDirectory` walks all ancestor segments. `GroupStore` never calls `exists()`, so there's no impact today — but if a 1b command checks `exists('.annotations')` (an ancestor), make `MemoryFileSystem.createDirectory` walk ancestors too, to keep the two implementations' `exists()` semantics aligned for unit tests.
- **`.annotations/` is tracked, by design** (the spec stores annotations in-repo, committed — sharing + AI use cases). Do NOT gitignore it.
```
