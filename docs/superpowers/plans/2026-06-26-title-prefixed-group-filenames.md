# Title-prefixed Group Filenames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store annotation groups as `.annotations/groups/<title-slug>-<idseg>.json` (e.g. `misleading-docs-550e8400.json`) instead of `<uuid>.json`, while still reading/editing/deleting existing `<uuid>.json` files.

**Architecture:** The filename becomes a cosmetic handle; the full UUID in the JSON's `id` field stays canonical. `GroupStore` gains a `resolvePath(id)` that locates a group's file by scanning the directory (legacy `<id>.json` exact match, or `<slug>-<idseg>.json` where the trailing token is a prefix of the de-hyphenated id, disambiguated by reading the internal id). `saveGroup` writes under the title-derived name, renames on retitle, lazily migrates legacy files, and guards against clobbering a different group. Agent-facing contract docs are updated to match.

**Tech Stack:** TypeScript, Vitest (`npm run test:unit`), web-compatible extension (no Node built-ins in `src/`; pure logic in `src/shared` + `src/core`).

## Global Constraints

- **No Node built-ins in `src/`** (`fs`/`path`/etc.) — `src/shared` + `src/core` are pure (no `vscode` import). (The `*.unit.test.ts` files may use Node modules — `skillContract.unit.test.ts` already uses `node:child_process`.)
- **JSON serialization is `serializeGroup`** (2-space indent, no trailing newline) — never hand-build group JSON; reuse the existing serializer in tests.
- **The internal `id` field is the full UUID and never changes.** Only the filename changes.
- **`idseg` = first 8 hex chars of the de-hyphenated id**, extended only by the save-time collision guard.
- **Title slug = lowercase → collapse non-`[a-z0-9]` runs to `-` → strip leading/trailing `-` → cap to 40 chars → strip trailing `-` → fallback `untitled`.**
- **Local verification gate:** `npm run check-types` + `npm run test:unit` (integration/e2e need network — out of scope).
- **Commit message trailer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Shared `slugify` + `slugifyTitle`; refactor `slugifyAuthor`

**Files:**
- Create: `src/shared/slug.ts`
- Test: `src/shared/slug.unit.test.ts`
- Modify: `src/core/comments.ts:3-7` (reimplement `slugifyAuthor` via `slugify`)

**Interfaces:**
- Produces: `slugify(text: string, opts: { fallback: string; max?: number }): string` and `slugifyTitle(title: string): string` (= `slugify(title, { fallback: 'untitled', max: 40 })`), both from `src/shared/slug.ts`. `slugifyAuthor` keeps its location/signature in `src/core/comments.ts` (now delegates to `slugify`).

- [ ] **Step 1: Write the failing test**

Create `src/shared/slug.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, slugifyTitle } from './slug';

describe('slugify', () => {
  it('lowercases and collapses non-alphanumeric runs to single dashes', () => {
    expect(slugify('Hello, World!!', { fallback: 'x' })).toBe('hello-world');
  });
  it('strips leading and trailing dashes', () => {
    expect(slugify('  --Hi--  ', { fallback: 'x' })).toBe('hi');
  });
  it('falls back when the result is empty', () => {
    expect(slugify('', { fallback: 'anon' })).toBe('anon');
    expect(slugify('@@@', { fallback: 'anon' })).toBe('anon');
  });
  it('caps to max and strips a trailing dash left by the cut', () => {
    expect(slugify('abcdefghij', { fallback: 'x', max: 5 })).toBe('abcde');
    expect(slugify('ab cd ef', { fallback: 'x', max: 3 })).toBe('ab'); // 'ab-' -> 'ab'
  });
});

describe('slugifyTitle', () => {
  it('uses untitled as the fallback', () => {
    expect(slugifyTitle('')).toBe('untitled');
    expect(slugifyTitle('###')).toBe('untitled');
  });
  it('caps at 40 characters', () => {
    expect(slugifyTitle('a'.repeat(50))).toBe('a'.repeat(40));
  });
  it('slugifies a normal title', () => {
    expect(slugifyTitle('Misleading docs')).toBe('misleading-docs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/shared/slug.unit.test.ts`
Expected: FAIL — `Cannot find module './slug'` / `slugify is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/slug.ts`:

```ts
/**
 * Filesystem-safe slug of arbitrary text: lowercase, each run of non-`[a-z0-9]`
 * collapsed to a single `-`, leading/trailing `-` stripped, optionally capped to
 * `opts.max` characters (a trailing `-` left by the cut is removed). An empty
 * result becomes `opts.fallback`.
 */
export function slugify(text: string, opts: { fallback: string; max?: number }): string {
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (opts.max !== undefined && slug.length > opts.max) {
    slug = slug.slice(0, opts.max).replace(/-+$/g, '');
  }
  return slug || opts.fallback;
}

/** Slug for a group title, used in its filename: ≤40 chars, fallback `untitled`. */
export function slugifyTitle(title: string): string {
  return slugify(title, { fallback: 'untitled', max: 40 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/shared/slug.unit.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Refactor `slugifyAuthor` to delegate (behavior-preserving)**

In `src/core/comments.ts`, add the import at the top (line 1 area) and replace the function body. Current lines 3-7:

```ts
/** A filesystem-safe slug of an author display name (collisions are tolerated). */
export function slugifyAuthor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'anon';
}
```

Replace with:

```ts
/** A filesystem-safe slug of an author display name (collisions are tolerated). */
export function slugifyAuthor(name: string): string {
  return slugify(name, { fallback: 'anon' });
}
```

And add to the imports at the top of `src/core/comments.ts` (after the existing `import { type AnnotationGroup, ... } from '../shared/model';` line):

```ts
import { slugify } from '../shared/slug';
```

- [ ] **Step 6: Run the unit suite to confirm no regression**

Run: `npm run test:unit -- src/shared/slug.unit.test.ts src/core/comments.unit.test.ts src/shared/skillContract.unit.test.ts`
Expected: PASS — `slugifyAuthor` behavior unchanged (the existing author-slug parity tests in `skillContract.unit.test.ts` still pass).

- [ ] **Step 7: Type-check**

Run: `npm run check-types`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/slug.ts src/shared/slug.unit.test.ts src/core/comments.ts
git commit -m "$(cat <<'EOF'
feat(core): shared slugify util; slugifyTitle; slugifyAuthor delegates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `idSegment` helper + GroupStore read-side resolution

**Files:**
- Modify: `src/shared/ids.ts` (add `idSegment`)
- Test: `src/shared/ids.unit.test.ts` (create)
- Modify: `src/core/groupStore.ts` (add `UUID_RE` const + `resolvePath`; rewrite `getGroup` and `deleteGroup`)
- Test: `src/core/groupStore.unit.test.ts` (add read-side cases)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `idSegment(id: string, len?: number): string` from `src/shared/ids.ts` (default `len = 8`; returns the first `len` chars of `id` with `-` removed). `GroupStore.resolvePath(id: string): Promise<string | null>` (private). `getGroup`/`deleteGroup` keep their existing public signatures and now resolve the real filename. **Note:** `saveGroup` is unchanged in this task (still writes `<id>.json` via the existing `path(id)`); the title-derived naming lands in Task 3.

- [ ] **Step 1: Write the failing test for `idSegment`**

Create `src/shared/ids.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { idSegment } from './ids';

describe('idSegment', () => {
  it('returns the first 8 hex chars of a de-hyphenated UUID by default', () => {
    expect(idSegment('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400');
  });
  it('honors a custom length', () => {
    expect(idSegment('550e8400-e29b-41d4-a716-446655440000', 9)).toBe('550e8400e');
  });
  it('returns the whole de-hyphenated id when shorter than len', () => {
    expect(idSegment('g1')).toBe('g1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/shared/ids.unit.test.ts`
Expected: FAIL — `idSegment is not a function`.

- [ ] **Step 3: Implement `idSegment`**

Append to `src/shared/ids.ts`:

```ts
/**
 * The first `len` characters of an id with hyphens removed — the human handle
 * embedded in a group's filename (`<title-slug>-<idSegment>.json`). The full id
 * stays the canonical identifier inside the file.
 */
export function idSegment(id: string, len = 8): string {
  return id.replace(/-/g, '').slice(0, len);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/shared/ids.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing read-side tests for GroupStore**

In `src/core/groupStore.unit.test.ts`, add a new `describe` block at the end of the top-level `describe('GroupStore', ...)` (just before its closing `});` on line 220). It reuses the existing `group(id, title)` helper and `fs`/`store` from `beforeEach`:

```ts
  describe('filename resolution (read-side)', () => {
    const enc = (g: AnnotationGroup) => new TextEncoder().encode(serializeGroup(g));

    it('reads and deletes a legacy <uuid>.json file by id', async () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      await fs.writeFile(`.annotations/groups/${id}.json`, enc(group(id, 'Legacy')));
      expect((await store.getGroup(id))?.title).toBe('Legacy');
      await store.deleteGroup(id);
      expect(await store.getGroup(id)).toBeNull();
      expect(await fs.exists(`.annotations/groups/${id}.json`)).toBe(false);
    });

    it('reads a new-format <slug>-<idseg>.json file by full id', async () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      await fs.writeFile('.annotations/groups/misleading-docs-550e8400.json', enc(group(id, 'Misleading docs')));
      expect((await store.getGroup(id))?.title).toBe('Misleading docs');
    });

    it('resolves prefix-colliding slugged files by internal id', async () => {
      const a = '550e8400-aaaa-41d4-a716-446655440000';
      const b = '550e8400-bbbb-41d4-a716-446655440000';
      await fs.writeFile('.annotations/groups/x-550e8400.json', enc(group(a, 'A')));
      await fs.writeFile('.annotations/groups/y-550e8400b.json', enc(group(b, 'B')));
      expect((await store.getGroup(a))?.title).toBe('A');
      expect((await store.getGroup(b))?.title).toBe('B');
    });

    it('getGroup returns null when no file matches the id', async () => {
      await fs.writeFile('.annotations/groups/other-deadbeef.json', enc(group('deadbeef-0000-0000-0000-000000000000', 'Other')));
      expect(await store.getGroup('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    });
  });
```

- [ ] **Step 6: Run the read-side tests to verify they fail**

Run: `npm run test:unit -- src/core/groupStore.unit.test.ts -t "filename resolution"`
Expected: FAIL — current `getGroup`/`deleteGroup` use `path(id)` (`<id>.json`), so they can't find `misleading-docs-550e8400.json` and mis-handle the prefix-collision case.

- [ ] **Step 7: Implement `resolvePath` and rewrite `getGroup`/`deleteGroup`**

In `src/core/groupStore.ts`, add the UUID regex constant just below the existing `enc`/`dec` lines (after line 6):

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

Add this private method to the class (e.g. directly under the existing `private path(id)` method):

```ts
  /**
   * The real on-disk path for a group `id`, or null. The filename is cosmetic; the
   * canonical id lives inside the JSON. A file belongs to `id` when its stem equals
   * `id` (legacy `<uuid>.json`) or its trailing `-` token is a prefix of the
   * de-hyphenated id (`<title-slug>-<idseg>.json`). Exact matches are unambiguous;
   * shorter-prefix matches are confirmed by reading each candidate's internal id.
   */
  private async resolvePath(id: string): Promise<string | null> {
    const names = await this.fs.readDirectory(this.dir);
    const deId = id.replace(/-/g, '');
    const exact: string[] = [];
    const prefix: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const stem = name.slice(0, -'.json'.length);
      if (UUID_RE.test(stem)) {
        if (stem === id) {
          exact.push(name);
        }
        continue;
      }
      const seg = stem.slice(stem.lastIndexOf('-') + 1); // whole stem when there is no '-'
      if (seg.length === 0 || !deId.startsWith(seg)) {
        continue;
      }
      (seg === deId ? exact : prefix).push(name);
    }
    if (exact.length > 0) {
      return `${this.dir}/${exact[0]}`;
    }
    for (const name of prefix) {
      try {
        const parsed = JSON.parse(dec.decode(await this.fs.readFile(`${this.dir}/${name}`)));
        if (parsed?.id === id) {
          return `${this.dir}/${name}`;
        }
      } catch {
        // unparseable candidate — skip
      }
    }
    return null;
  }
```

Replace the existing `getGroup` (lines 38-45):

```ts
  /** Load one group by id, or null if missing/invalid. */
  async getGroup(id: string): Promise<AnnotationGroup | null> {
    const path = await this.resolvePath(id);
    if (!path) {
      return null;
    }
    try {
      return parseGroup(JSON.parse(dec.decode(await this.fs.readFile(path))));
    } catch {
      return null;
    }
  }
```

Replace the existing `deleteGroup` (lines 53-56):

```ts
  /** Delete a group's file (found by id). No-op if absent. */
  async deleteGroup(id: string): Promise<void> {
    const path = await this.resolvePath(id);
    if (path) {
      await this.fs.delete(path);
    }
  }
```

Leave `private path(id)` and `saveGroup` as they are — they are replaced in Task 3.

- [ ] **Step 8: Run the GroupStore suite to verify all pass**

Run: `npm run test:unit -- src/core/groupStore.unit.test.ts src/shared/ids.unit.test.ts`
Expected: PASS — the new read-side cases pass, and the existing round-trip/list/update tests still pass (a `g1.json` written by the unchanged `saveGroup` resolves via the exact branch, since `seg === deId` for `id = 'g1'`).

- [ ] **Step 9: Type-check**

Run: `npm run check-types`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/shared/ids.ts src/shared/ids.unit.test.ts src/core/groupStore.ts src/core/groupStore.unit.test.ts
git commit -m "$(cat <<'EOF'
feat(core): resolve group files by id (legacy + slugged), idSegment helper

getGroup/deleteGroup now locate a group's file via resolvePath, which matches
legacy <uuid>.json and new <slug>-<idseg>.json names, disambiguating prefix
collisions by internal id. saveGroup naming follows in the next change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: GroupStore `saveGroup` — title-derived naming, rename, lazy migration, collision guard

**Files:**
- Modify: `src/core/groupStore.ts` (rewrite `saveGroup`; add `nameFor`/`takenByOther` helpers; remove the now-unused `private path(id)`; add imports)
- Test: `src/core/groupStore.unit.test.ts` (update 3 existing path-literal assertions; add write-side cases)

**Interfaces:**
- Consumes: `slugifyTitle` from `src/shared/slug.ts` (Task 1); `idSegment` from `src/shared/ids.ts` and `resolvePath` from Task 2.
- Produces: `saveGroup(group: AnnotationGroup): Promise<void>` (unchanged signature) now writes `<slugifyTitle(title)>-<idSegment(id)>.json`, renames on title change, migrates legacy files on first write, and never overwrites a different group's file.

- [ ] **Step 1: Update the 3 existing tests that assert literal `<id>.json` paths**

In `src/core/groupStore.unit.test.ts`:

Test `writes to .annotations/groups/<id>.json` (lines 34-37) — rename and update the assertion. `group('g1')` has default title `'T'` → slug `'t'`, idseg `'g1'`:

```ts
  it('writes to .annotations/groups/<title-slug>-<idseg>.json', async () => {
    await store.saveGroup(group('g1'));
    expect(await fs.exists('.annotations/groups/t-g1.json')).toBe(true);
  });
```

Test `persists exactly the serialized form` (lines 75-80) — `group('g1', 'Exact')` → `exact-g1.json`:

```ts
  it('persists exactly the serialized form', async () => {
    const g = group('g1', 'Exact');
    await store.saveGroup(g);
    const bytes = await fs.readFile('.annotations/groups/exact-g1.json');
    expect(new TextDecoder().decode(bytes)).toBe(serializeGroup(g));
  });
```

Test `keeps the (now empty) group file when the last annotation is deleted` (lines 206-212) — `withAnnotations('g1')` uses default title `'T'` → `t-g1.json`. Change only the final `fs.exists` line:

```ts
      expect(await fs.exists('.annotations/groups/t-g1.json')).toBe(true);
```

- [ ] **Step 2: Add the failing write-side tests**

In `src/core/groupStore.unit.test.ts`, add another `describe` block at the end of the top-level `describe('GroupStore', ...)`:

```ts
  describe('filename scheme (write-side)', () => {
    const UID = '550e8400-e29b-41d4-a716-446655440000';

    it('names a new group <title-slug>-<idseg>.json', async () => {
      await store.saveGroup(group(UID, 'Misleading docs'));
      expect(await fs.exists('.annotations/groups/misleading-docs-550e8400.json')).toBe(true);
    });

    it('renames the file when the title changes and removes the old one', async () => {
      await store.saveGroup(group(UID, 'Old title'));
      expect(await fs.exists('.annotations/groups/old-title-550e8400.json')).toBe(true);
      await store.updateGroup(UID, { title: 'New title' }, 2);
      expect(await fs.exists('.annotations/groups/old-title-550e8400.json')).toBe(false);
      expect(await fs.exists('.annotations/groups/new-title-550e8400.json')).toBe(true);
      expect((await store.getGroup(UID))?.title).toBe('New title');
      expect((await fs.readDirectory('.annotations/groups')).length).toBe(1);
    });

    it('migrates a legacy <uuid>.json file to the slugged name on first write', async () => {
      await fs.writeFile(`.annotations/groups/${UID}.json`, new TextEncoder().encode(serializeGroup(group(UID, 'Legacy'))));
      await store.updateGroup(UID, { status: 'resolved' }, 2);
      expect(await fs.exists(`.annotations/groups/${UID}.json`)).toBe(false);
      expect(await fs.exists('.annotations/groups/legacy-550e8400.json')).toBe(true);
      expect((await store.getGroup(UID))?.status).toBe('resolved');
    });

    it('does not overwrite a different group that wants the same filename', async () => {
      const a = '550e8400-aaaa-41d4-a716-446655440000';
      const b = '550e8400-bbbb-41d4-a716-446655440000';
      await store.saveGroup(group(a, 'Same'));
      await store.saveGroup(group(b, 'Same')); // same slug + same first-8 hex → guard lengthens idseg
      const names = await fs.readDirectory('.annotations/groups');
      expect(names.length).toBe(2);
      expect((await store.getGroup(a))?.title).toBe('Same');
      expect((await store.getGroup(b))?.title).toBe('Same');
    });

    it('falls back to untitled for an empty title', async () => {
      await store.saveGroup(group(UID, ''));
      expect(await fs.exists('.annotations/groups/untitled-550e8400.json')).toBe(true);
    });
  });
```

- [ ] **Step 3: Run the write-side tests to verify they fail**

Run: `npm run test:unit -- src/core/groupStore.unit.test.ts -t "write-side"`
Expected: FAIL — `saveGroup` still writes `<id>.json` (e.g. `550e8400-...json`), not `misleading-docs-550e8400.json`.

- [ ] **Step 4: Rewrite `saveGroup` and add helpers; remove `path(id)`; add imports**

In `src/core/groupStore.ts`, update the imports at the top:

- Change the model import to also pull nothing new (it already imports what's needed). Add two imports below the existing import lines (after line 3):

```ts
import { slugifyTitle } from '../shared/slug';
import { idSegment } from '../shared/ids';
```

Remove the now-unused `private path(id)` method (current lines 15-17):

```ts
  private path(id: string): string {
    return `${this.dir}/${id}.json`;
  }
```

Replace the existing `saveGroup` (current lines 47-51) with:

```ts
  /** Write a group (whole-file) under `<title-slug>-<idseg>.json`. Renames on
   *  title change, migrates a legacy `<id>.json` file, and never clobbers a
   *  different group. Caller is responsible for timestamps. */
  async saveGroup(group: AnnotationGroup): Promise<void> {
    await this.fs.createDirectory(this.dir);
    const existing = await this.resolvePath(group.id);
    let len = 8;
    let target = this.nameFor(group, len);
    while (await this.takenByOther(target, group.id)) {
      const next = this.nameFor(group, ++len);
      if (next === target) {
        break; // id segment can't grow any further
      }
      target = next;
    }
    const targetPath = `${this.dir}/${target}`;
    await this.fs.writeFile(targetPath, enc.encode(serializeGroup(group)));
    if (existing && existing !== targetPath) {
      await this.fs.delete(existing);
    }
  }

  /** The canonical filename for `group`, using the first `len` chars of its id segment. */
  private nameFor(group: AnnotationGroup, len: number): string {
    return `${slugifyTitle(group.title)}-${idSegment(group.id, len)}.json`;
  }

  /** True when `name` exists and holds a group whose id differs from `id` (or is unreadable). */
  private async takenByOther(name: string, id: string): Promise<boolean> {
    const path = `${this.dir}/${name}`;
    if (!(await this.fs.exists(path))) {
      return false;
    }
    try {
      const parsed = JSON.parse(dec.decode(await this.fs.readFile(path)));
      return parsed?.id !== id;
    } catch {
      return true; // present but unreadable — don't clobber
    }
  }
```

- [ ] **Step 5: Run the full GroupStore suite**

Run: `npm run test:unit -- src/core/groupStore.unit.test.ts`
Expected: PASS — write-side cases pass; the 3 updated path-literal tests pass; all `update*`/`reorder*`/`deleteAnnotation` tests (which route through `getGroup` + `saveGroup`) still pass.

- [ ] **Step 6: Run the whole unit tier + type-check**

Run: `npm run test:unit && npm run check-types`
Expected: PASS, no type errors. (Confirms nothing else depended on `path(id)` or the old naming.)

- [ ] **Step 7: Commit**

```bash
git add src/core/groupStore.ts src/core/groupStore.unit.test.ts
git commit -m "$(cat <<'EOF'
feat(core): write group files as <title-slug>-<idseg>.json

saveGroup derives the filename from the title, renames on retitle, migrates
legacy <uuid>.json files on first write, and lengthens the id segment to avoid
clobbering a different group. Backward compatible: legacy files still read.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update the agent contract docs + slug-recipe parity test

**Files:**
- Modify: `skills/annotated/references/data-contract.md` (layout line, Group heading, `id` comment, invariant, add Title-slug recipe)
- Modify: `skills/annotated/references/operations.md:87,99` (create/delete group wording)
- Modify: `src/shared/skillContract.unit.test.ts` (add title-slug parity + doc-embed test)

**Interfaces:**
- Consumes: `slugifyTitle` from `src/shared/slug.ts` (Task 1).
- Produces: documentation consistent with the new filename scheme; a parity test proving the documented shell recipe matches `slugifyTitle`.

- [ ] **Step 1: Write the failing parity + doc-embed test**

In `src/shared/skillContract.unit.test.ts`, add the import (next to the existing `import { slugifyAuthor } from '../core/comments';` on line 15):

```ts
import { slugifyTitle } from './slug';
```

Add this near the other recipe constants (after the `SLUG_RECIPE` definition, ~line 31):

```ts
// Canonical node-free title-slug recipe. The doc MUST embed this verbatim, and it MUST match
// slugifyTitle for every title. $TITLE is an env var.
const TITLE_SLUG_RECIPE = `s=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 | sed -E 's/-+$//')
[ -n "$s" ] || s=untitled
printf '%s\\n' "$s"`;

function titleSlugViaRecipe(title: string): string {
  return execSync(TITLE_SLUG_RECIPE, { env: { ...process.env, TITLE: title } }).toString().trim();
}
```

Add this `describe` block at the end of the file (after the existing slug-recipe block):

```ts
describe('annotated contract: title slug recipe parity + doc embed', () => {
  const TITLES = [
    'Misleading docs',
    'Login Review!!',
    'Ana Díaz',
    '',
    '###',
    'a'.repeat(50),
    'word word word word word word word word word',
  ];
  for (const title of TITLES) {
    it(`shell title-slug recipe matches slugifyTitle — ${JSON.stringify(title)}`, () => {
      expect(titleSlugViaRecipe(title)).toBe(slugifyTitle(title));
    });
  }
  it('data-contract.md embeds the exact TITLE_SLUG_RECIPE', () => {
    const doc = readFileSync(CONTRACT_DOC, 'utf8');
    expect(doc.includes(TITLE_SLUG_RECIPE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- src/shared/skillContract.unit.test.ts -t "title slug"`
Expected: FAIL — the parity cases pass (recipe vs `slugifyTitle`), but `data-contract.md embeds the exact TITLE_SLUG_RECIPE` FAILS because the doc doesn't contain the recipe yet. (If any parity case fails, the recipe and `slugifyTitle` have diverged — fix before continuing.)

- [ ] **Step 3: Update `data-contract.md` — directory layout line**

Edit `skills/annotated/references/data-contract.md`. Replace line 11:

```
  groups/<group-id>.json        # one annotation group per file
```

with:

```
  groups/<title-slug>-<idseg>.json   # one annotation group per file
```

- [ ] **Step 4: Update `data-contract.md` — Group heading + `id` comment**

Replace the heading on line 15:

```
## Group — `.annotations/groups/<id>.json`
```

with:

```
## Group — `.annotations/groups/<title-slug>-<idseg>.json`
```

Replace the `id` field comment on line 19:

```
  "id": "550e8400-e29b-41d4-a716-446655440000",   // MUST equal the filename stem
```

with:

```
  "id": "550e8400-e29b-41d4-a716-446655440000",   // canonical id (full UUID); filename's <idseg> = its first 8 hex
```

- [ ] **Step 5: Update `data-contract.md` — invariant**

Replace the invariant bullet on line 80:

```
- **Group `id` == filename stem.** `groups/<id>.json`; a mismatch hides the group.
```

with:

```
- **Filename = `<title-slug>-<idseg>.json`** (e.g. `misleading-docs-550e8400.json`), where
  `<idseg>` is the first 8 hex chars of the de-hyphenated `id`. The extension keys off the
  in-file `id`, not the filename, so a stale slug is cosmetic, not corrupting. Legacy
  `groups/<id>.json` files are still read. When you create a group, name it this way; when you
  edit/delete one, find it by its `id` (its filename ends with the id segment, or is the legacy
  `<id>.json`).
```

- [ ] **Step 6: Update `data-contract.md` — add the Title-slug recipe**

Edit the Author-slug recipe block (lines 126-129). Replace:

```
s=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$s" ] || s=anon
printf '%s\n' "$s"
```

with (same author recipe, then a new Title-slug subsection — the bash body must be byte-identical to `TITLE_SLUG_RECIPE`):

```
s=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$s" ] || s=anon
printf '%s\n' "$s"
```
````

### Title slug (for the group filename)

Same as the author slug, then **cap to 40 characters** (strip a trailing `-` left by the cut)
and fall back to `untitled` if empty. `$TITLE` is the group title:

```bash
s=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 | sed -E 's/-+$//')
[ -n "$s" ] || s=untitled
printf '%s\n' "$s"
```

The group filename is then `<title-slug>-<first-8-hex-of-id>.json`.
````

> **Edit note for the implementer:** the block above shows the replacement region. In the
> actual file, the Author-slug recipe is closed by a ```` ``` ```` fence; insert the
> `### Title slug …` heading, prose, and the new ```` ```bash ```` … ```` ``` ```` fence
> immediately after that closing fence. The three-line bash body inside the new fence must
> exactly equal `TITLE_SLUG_RECIPE` from the test (including `printf '%s\n' "$s"`).

- [ ] **Step 7: Update `operations.md` — create + delete group**

Edit `skills/annotated/references/operations.md`. Replace line 87:

```
4. Write `.annotations/groups/<id>.json` — **the filename stem MUST equal `id`**.
```

with:

```
4. Write `.annotations/groups/<title-slug>-<first-8-hex-of-id>.json` (title-slug recipe in
   `data-contract.md`). The extension reads the canonical `id` from inside the file, so the
   filename is a human-friendly handle, not load-bearing.
```

Replace line 99:

```
- **Delete a group:** remove its `.annotations/groups/<id>.json`.
```

with:

```
- **Delete a group:** remove its file under `.annotations/groups/` — the one whose name ends
  with the group's id segment (or the legacy `<id>.json`).
```

- [ ] **Step 8: Run the contract test to verify it passes**

Run: `npm run test:unit -- src/shared/skillContract.unit.test.ts`
Expected: PASS — including `data-contract.md embeds the exact TITLE_SLUG_RECIPE` and the author-slug doc-embed test (unchanged). If the embed test still fails, the bash body in the doc differs from `TITLE_SLUG_RECIPE` (check whitespace/quotes).

- [ ] **Step 9: Full gate**

Run: `npm run test:unit && npm run check-types`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add skills/annotated/references/data-contract.md skills/annotated/references/operations.md src/shared/skillContract.unit.test.ts
git commit -m "$(cat <<'EOF'
docs(annotated): contract for <title-slug>-<idseg>.json group filenames

Update data-contract.md + operations.md to the new naming, add a node-free
title-slug recipe with a parity test against slugifyTitle.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Filename scheme `<title-slug>-<idseg>.json` → Task 3 (`nameFor`), Task 1 (`slugifyTitle`), Task 2 (`idSegment`). ✓
- Internal `id` canonical / filename cosmetic → Task 2 (`resolvePath` matches by id; disambiguates by internal id). ✓
- `getGroup`/`deleteGroup`/`saveGroup` updated → Tasks 2 & 3. ✓ (`update*`/`reorder*`/`deleteAnnotation` inherit via `getGroup`+`saveGroup` — covered by existing tests re-run in Task 3 Step 5.)
- Rename on retitle + lazy legacy migration → Task 3 (rename/migration tests). ✓
- Save-time collision guard → Task 3 (`takenByOther` + extend loop; "does not overwrite" test). ✓
- Backward-compat read of legacy `<uuid>.json` → Task 2 (legacy read/delete test). ✓
- Slug util extracted; `slugifyAuthor` delegates → Task 1. ✓
- Contract docs (data-contract.md, operations.md) + title-slug recipe + parity test → Task 4. ✓
- Out of scope (no bulk migration, no id-format/comment/local-link changes, no UI changes) → respected; no such tasks. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. The one prose "Edit note" in Task 4 Step 6 clarifies a fence-insertion that is awkward to render literally — it is guidance, not a deferred decision.

**Type consistency:** `slugify(text, { fallback, max? })`, `slugifyTitle(title)`, `idSegment(id, len?)`, `resolvePath(id): Promise<string|null>`, `nameFor(group, len)`, `takenByOther(name, id): Promise<boolean>` — names and signatures match across Tasks 1→3. `getGroup`/`deleteGroup`/`saveGroup` keep their public signatures. The collision guard's `idSegment(id, len)` length parameter matches Task 2's definition.

**Note on test ids:** existing tests use non-UUID ids like `g1`; `resolvePath` handles them via the new-format `seg === deId` exact branch (since `'g1'` has no hyphen, `seg = 'g1' = deId`), so the legacy round-trip tests keep passing without UUID-shaped ids.
