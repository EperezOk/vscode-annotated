# vscode-annotated — Phase 1b: Create Annotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create an annotation from the editor: select lines → run **Annotated: Create Annotation** → pick an existing group or create a new one (name + multi-select tags) → the annotation is created (with a code-anchored content hash) and persisted to `.annotations/groups/<id>.json`.

**Architecture:** A pure orchestrator `runCreateAnnotation(deps)` (in `src/core`) drives the whole flow with every VSCode interaction injected as a dependency, so the flow is fully unit-tested with fakes. A thin VSCode command (`src/web/createAnnotationCommand.ts`) builds the real dependencies (editor selection, QuickPick/InputBox, `GroupStore` over `VscodeFileSystem`, `resolveAuthor` over `VscodeAuthorNameSources`, tag palette). Pure factory helpers build the model objects.

**Tech Stack:** TypeScript (web extension host). Builds on Phase 1a: `model`, `ids.newId`, `hash.sha256Hex`/`anchorText`, `GroupStore`, `VscodeFileSystem`, `resolveAuthor`/`AuthorNameSources`. Vitest unit tests; `@vscode/test-web` integration. No new runtime deps.

> **Conventions for the executor:**
> - Work on the **`phase-1`** branch (already checked out).
> - **Node:** prefix every node/npm/npx command with `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"` (verify `node -v` → v25.x). Default Node 20.15.1 is too old for Vitest.
> - Commit-message trailer (after a blank line):
>   ```
>   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
>   ```
> - `npm run test:integration` downloads/serves a VSCode web build — run with the Bash tool's `dangerouslyDisableSandbox: true` and `timeout: 600000`; `pkill -f vscode-test-web 2>/dev/null` first if a port is held. Unit tests need neither.

---

## Context: what Phase 1a provides (do not reimplement)

- `src/shared/model.ts` — `AnnotationGroup`, `Annotation`, `LineRange`, `GroupStatus`, `parseGroup`, `serializeGroup`.
- `src/shared/ids.ts` — `newId(): string`.
- `src/shared/hash.ts` — `sha256Hex(text): Promise<string>`, `anchorText(fileText, range): string`.
- `src/core/groupStore.ts` — `GroupStore` (`listGroups`, `getGroup`, `saveGroup`, `deleteGroup`).
- `src/core/fileSystem.ts`, `src/core/memoryFileSystem.ts` — `FileSystem` + in-memory impl.
- `src/web/vscodeFileSystem.ts` — `VscodeFileSystem` (`static forWorkspace()`).
- `src/core/authorIdentity.ts` — `resolveAuthor(sources)`, `AuthorNameSources`.
- `src/web/extension.ts` — `activate` registers the sidebar provider + `annotated.ping`.
- `src/web/test/suite/extension.test.ts` — 2 integration tests; `index.ts` imports `extension.test` + `groupStore.integration.test`.
- `package.json` `contributes` currently: `viewsContainers`, `views`, `commands: [annotated.ping]`.

---

## File Structure (created/modified in 1b)

```
src/core/annotationFactory.ts             # pure: createGroup / makeAnnotation / addAnnotation
src/core/annotationFactory.unit.test.ts
src/core/createAnnotationFlow.ts          # pure orchestrator: runCreateAnnotation(deps) + CreateAnnotationDeps
src/core/createAnnotationFlow.unit.test.ts
src/core/tags.ts                           # Tag type + parseTagPalette (pure, no vscode)
src/core/tags.unit.test.ts                 # tests parseTagPalette
src/web/tagPalette.ts                      # readTagPalette/addTagToPalette (vscode config glue)
src/web/authorSources.ts                   # VscodeAuthorNameSources implements AuthorNameSources
src/web/createAnnotationCommand.ts         # VSCode glue: build deps, run the flow
(modify) src/web/extension.ts              # register annotated.createAnnotation
(modify) package.json                      # command + keybinding + configuration (annotated.tags, annotated.authorName)
(modify) src/web/test/suite/extension.test.ts   # assert createAnnotation command registered
```

---

## Task 1: Pure model factory helpers

**Files:** Create `src/core/annotationFactory.ts`, `src/core/annotationFactory.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/annotationFactory.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createGroup, makeAnnotation, addAnnotation } from './annotationFactory';

describe('createGroup', () => {
  it('builds an open group with timestamps and copied tags', () => {
    const tags = ['security'];
    const g = createGroup({ id: 'g1', title: 'T', author: 'A', tags, now: 100 });
    expect(g).toEqual({
      id: 'g1',
      title: 'T',
      author: 'A',
      tags: ['security'],
      gitRef: null,
      status: 'open',
      createdAt: 100,
      updatedAt: 100,
      annotations: [],
    });
    tags.push('mutated');
    expect(g.tags).toEqual(['security']); // input array not aliased
  });

  it('accepts an explicit gitRef', () => {
    expect(createGroup({ id: 'g1', title: 'T', author: 'A', tags: [], gitRef: 'main', now: 1 }).gitRef).toBe('main');
  });
});

describe('makeAnnotation', () => {
  it('builds an annotation with empty content by default', () => {
    const a = makeAnnotation({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 2 }, contentHash: 'h' });
    expect(a).toEqual({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' });
  });
});

describe('addAnnotation', () => {
  it('appends an annotation and bumps updatedAt without mutating the input', () => {
    const g = createGroup({ id: 'g1', title: 'T', author: 'A', tags: [], now: 1 });
    const a = makeAnnotation({ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, contentHash: 'h' });
    const next = addAnnotation(g, a, 200);
    expect(next.annotations).toEqual([a]);
    expect(next.updatedAt).toBe(200);
    expect(g.annotations).toEqual([]); // original unchanged
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/annotationFactory.unit.test.ts`
Expected: FAIL — cannot resolve `./annotationFactory`.

- [ ] **Step 3: Implement `src/core/annotationFactory.ts`**

```ts
import { type Annotation, type AnnotationGroup, type LineRange } from '../shared/model';

/** Build a new, empty open group. Caller supplies id, timestamps (`now`), and tags. */
export function createGroup(input: {
  id: string;
  title: string;
  author: string;
  tags: string[];
  gitRef?: string | null;
  now: number;
}): AnnotationGroup {
  return {
    id: input.id,
    title: input.title,
    author: input.author,
    tags: [...input.tags],
    gitRef: input.gitRef ?? null,
    status: 'open',
    createdAt: input.now,
    updatedAt: input.now,
    annotations: [],
  };
}

/** Build a new annotation (empty Markdown content by default). */
export function makeAnnotation(input: {
  id: string;
  file: string;
  range: LineRange;
  content?: string;
  contentHash: string;
}): Annotation {
  return {
    id: input.id,
    file: input.file,
    range: input.range,
    content: input.content ?? '',
    contentHash: input.contentHash,
  };
}

/** Return a copy of `group` with `annotation` appended and `updatedAt` set to `now`. */
export function addAnnotation(group: AnnotationGroup, annotation: Annotation, now: number): AnnotationGroup {
  return {
    ...group,
    annotations: [...group.annotations, annotation],
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/annotationFactory.unit.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/annotationFactory.ts src/core/annotationFactory.unit.test.ts
git commit -m "feat: pure annotation/group factory helpers"
```

---

## Task 2: Create-annotation flow orchestrator (pure)

**Files:** Create `src/core/createAnnotationFlow.ts`, `src/core/createAnnotationFlow.unit.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/createAnnotationFlow.unit.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { runCreateAnnotation, type CreateAnnotationDeps } from './createAnnotationFlow';
import { createGroup } from './annotationFactory';
import { type AnnotationGroup } from '../shared/model';

function deps(overrides: Partial<CreateAnnotationDeps>): CreateAnnotationDeps {
  return {
    getSelection: () => ({ file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, fileText: 'a\nb\nc' }),
    resolveAuthor: async () => 'Author',
    listGroups: async () => [],
    pickGroup: async () => ({ kind: 'new' }),
    promptGroupTitle: async () => 'New Group',
    pickTags: async () => [],
    saveGroup: vi.fn(async () => {}),
    newId: () => 'id-1',
    now: () => 1000,
    hashContent: async () => 'HASH',
    showInfo: vi.fn(),
    showWarning: vi.fn(),
    ...overrides,
  };
}

describe('runCreateAnnotation', () => {
  it('warns and aborts when there is no selection', async () => {
    const showWarning = vi.fn();
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    const result = await runCreateAnnotation(deps({ getSelection: () => undefined, showWarning, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalled();
  });

  it('creates a new group with the annotation and saves it', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    let nextId = 0;
    const result = await runCreateAnnotation(
      deps({ saveGroup, newId: () => `id-${++nextId}`, pickTags: async () => ['security'] }),
    );
    expect(saveGroup).toHaveBeenCalledTimes(1);
    const saved = saveGroup.mock.calls[0][0] as AnnotationGroup;
    expect(saved.title).toBe('New Group');
    expect(saved.author).toBe('Author');
    expect(saved.tags).toEqual(['security']);
    expect(saved.annotations).toHaveLength(1);
    expect(saved.annotations[0]).toMatchObject({ file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'HASH' });
    expect(result?.id).toBe(saved.id);
  });

  it('hashes the anchored code lines (not the whole file)', async () => {
    const hashContent = vi.fn(async () => 'HASH');
    await runCreateAnnotation(deps({ hashContent, getSelection: () => ({ file: 'f', range: { startLine: 2, endLine: 3 }, fileText: 'l1\nl2\nl3\nl4' }) }));
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
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    const result = await runCreateAnnotation(deps({ pickGroup: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('aborts without saving when the new-group title is cancelled', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    const result = await runCreateAnnotation(deps({ promptGroupTitle: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('aborts without saving when tag selection is cancelled', async () => {
    const saveGroup = vi.fn<(group: AnnotationGroup) => Promise<void>>(async () => {});
    const result = await runCreateAnnotation(deps({ pickTags: async () => undefined, saveGroup }));
    expect(result).toBeUndefined();
    expect(saveGroup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: FAIL — cannot resolve `./createAnnotationFlow`.

- [ ] **Step 3: Implement `src/core/createAnnotationFlow.ts`**

```ts
import { type AnnotationGroup, type LineRange } from '../shared/model';
import { anchorText } from '../shared/hash';
import { addAnnotation, createGroup, makeAnnotation } from './annotationFactory';

/** The current editor selection to annotate. */
export interface SelectionInfo {
  /** Workspace-relative POSIX path. */
  file: string;
  range: LineRange;
  /** Full text of the file (used to compute the anchored content hash). */
  fileText: string;
}

/** Result of the group QuickPick. */
export type GroupChoice = { kind: 'existing'; id: string } | { kind: 'new' };

/** All side-effecting interactions the flow needs, injected for testability. */
export interface CreateAnnotationDeps {
  getSelection(): SelectionInfo | undefined;
  resolveAuthor(): Promise<string>;
  listGroups(): Promise<AnnotationGroup[]>;
  /** Pick an existing group or choose to create a new one; undefined = cancelled. */
  pickGroup(groups: AnnotationGroup[]): Promise<GroupChoice | undefined>;
  /** New-group title; undefined = cancelled. */
  promptGroupTitle(): Promise<string | undefined>;
  /** Tag names for a new group; [] = none, undefined = cancelled. */
  pickTags(): Promise<string[] | undefined>;
  saveGroup(group: AnnotationGroup): Promise<void>;
  newId(): string;
  /** Current time, epoch seconds. */
  now(): number;
  hashContent(text: string): Promise<string>;
  showInfo(message: string): void;
  showWarning(message: string): void;
}

/**
 * Drive the create-annotation flow. Returns the saved group, or undefined if the
 * user cancelled or there was nothing to annotate.
 */
export async function runCreateAnnotation(deps: CreateAnnotationDeps): Promise<AnnotationGroup | undefined> {
  const selection = deps.getSelection();
  if (!selection) {
    deps.showWarning('Select one or more lines to annotate.');
    return undefined;
  }

  const contentHash = await deps.hashContent(anchorText(selection.fileText, selection.range));
  const annotation = makeAnnotation({
    id: deps.newId(),
    file: selection.file,
    range: selection.range,
    contentHash,
  });

  const groups = await deps.listGroups();
  const choice = await deps.pickGroup(groups);
  if (!choice) {
    return undefined;
  }

  if (choice.kind === 'existing') {
    const group = groups.find((g) => g.id === choice.id);
    if (!group) {
      deps.showWarning('Selected group no longer exists.');
      return undefined;
    }
    const updated = addAnnotation(group, annotation, deps.now());
    await deps.saveGroup(updated);
    deps.showInfo(`Annotation added to "${updated.title}".`);
    return updated;
  }

  const title = await deps.promptGroupTitle();
  if (title === undefined) {
    return undefined;
  }
  const tags = await deps.pickTags();
  if (tags === undefined) {
    return undefined;
  }
  const author = await deps.resolveAuthor();
  const base = createGroup({ id: deps.newId(), title, author, tags, now: deps.now() });
  const group = addAnnotation(base, annotation, deps.now());
  await deps.saveGroup(group);
  deps.showInfo(`Created group "${group.title}".`);
  return group;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/createAnnotationFlow.unit.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/createAnnotationFlow.ts src/core/createAnnotationFlow.unit.test.ts
git commit -m "feat: pure create-annotation flow orchestrator"
```

---

## Task 3: Tag palette (config-backed)

**Files:** Create `src/core/tags.ts`, `src/core/tags.unit.test.ts`, `src/web/tagPalette.ts`

> Why two files: the pure parser must be unit-testable WITHOUT importing `vscode` (Vitest can't resolve the `vscode` module). So the `Tag` type + `parseTagPalette` live in `src/core/tags.ts` (no vscode), and the config read/write glue lives in `src/web/tagPalette.ts`.

- [ ] **Step 1: Write the failing test** — `src/core/tags.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseTagPalette } from './tags';

describe('parseTagPalette', () => {
  it('returns [] for non-array input', () => {
    expect(parseTagPalette(undefined)).toEqual([]);
    expect(parseTagPalette('nope')).toEqual([]);
  });

  it('keeps entries with a string name and defaults a missing color', () => {
    expect(parseTagPalette([{ name: 'security', color: '#c0392b' }, { name: 'todo' }])).toEqual([
      { name: 'security', color: '#c0392b' },
      { name: 'todo', color: '#888888' },
    ]);
  });

  it('skips entries without a string name', () => {
    expect(parseTagPalette([{ color: '#fff' }, 42, null, { name: 5 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tags.unit.test.ts`
Expected: FAIL — cannot resolve `./tags`.

- [ ] **Step 3: Implement the pure parser `src/core/tags.ts`** (no vscode import)

```ts
/** A user-configured tag: a name and a display color. */
export interface Tag {
  name: string;
  color: string;
}

const DEFAULT_COLOR = '#888888';

/** Validate/normalize the raw `annotated.tags` config value into a Tag[]. */
export function parseTagPalette(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const tags: Tag[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
      const name = (item as { name: string }).name;
      const colorValue = (item as { color?: unknown }).color;
      tags.push({ name, color: typeof colorValue === 'string' ? colorValue : DEFAULT_COLOR });
    }
  }
  return tags;
}
```

- [ ] **Step 4: Implement the VSCode glue `src/web/tagPalette.ts`**

```ts
import * as vscode from 'vscode';
import { type Tag, parseTagPalette } from '../core/tags';

const DEFAULT_COLOR = '#888888';

/** Read the configured tag palette (`annotated.tags`). */
export function readTagPalette(): Tag[] {
  return parseTagPalette(vscode.workspace.getConfiguration('annotated').get('tags'));
}

/** Add a tag to the palette if its name isn't already present. */
export async function addTagToPalette(name: string, color = DEFAULT_COLOR): Promise<void> {
  const config = vscode.workspace.getConfiguration('annotated');
  const current = parseTagPalette(config.get('tags'));
  if (current.some((t) => t.name === name)) {
    return;
  }
  await config.update('tags', [...current, { name, color }], vscode.ConfigurationTarget.Global);
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/core/tags.unit.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Verify type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/tags.ts src/core/tags.unit.test.ts src/web/tagPalette.ts
git commit -m "feat: tag palette parsing (pure) + config read/write glue"
```

---

## Task 4: VSCode glue — author sources, command, contributions

**Files:** Create `src/web/authorSources.ts`, `src/web/createAnnotationCommand.ts`; Modify `src/web/extension.ts`, `package.json`

- [ ] **Step 1: Implement `src/web/authorSources.ts`**

```ts
import * as vscode from 'vscode';
import { type AuthorNameSources } from '../core/authorIdentity';

/** Minimal shape of the built-in git extension API we use. */
interface GitApiRepository {
  getConfig(key: string): Promise<string>;
  getGlobalConfig(key: string): Promise<string>;
}
interface GitApi {
  repositories: GitApiRepository[];
}
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/** AuthorNameSources backed by VSCode APIs. git is desktop-only; the rest work on web. */
export class VscodeAuthorNameSources implements AuthorNameSources {
  async gitUserName(): Promise<string | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) {
      return undefined; // git extension is unavailable in the web host
    }
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      const repo = ext.exports.getAPI(1).repositories[0];
      if (!repo) {
        return undefined;
      }
      const local = await repo.getConfig('user.name').catch(() => undefined);
      if (local) {
        return local;
      }
      return await repo.getGlobalConfig('user.name').catch(() => undefined);
    } catch {
      return undefined;
    }
  }

  settingAuthorName(): string | undefined {
    return vscode.workspace.getConfiguration('annotated').get<string>('authorName');
  }

  async githubAccountLabel(): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
      return session?.account.label;
    } catch {
      return undefined;
    }
  }

  async promptForName(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: 'Your name for annotations',
      ignoreFocusOut: true,
    });
  }

  async persistName(name: string): Promise<void> {
    await vscode.workspace
      .getConfiguration('annotated')
      .update('authorName', name, vscode.ConfigurationTarget.Global);
  }
}
```

- [ ] **Step 2: Implement `src/web/createAnnotationCommand.ts`**

```ts
import * as vscode from 'vscode';
import { type AnnotationGroup } from '../shared/model';
import { newId } from '../shared/ids';
import { sha256Hex } from '../shared/hash';
import { GroupStore } from '../core/groupStore';
import { resolveAuthor } from '../core/authorIdentity';
import {
  runCreateAnnotation,
  type CreateAnnotationDeps,
  type GroupChoice,
  type SelectionInfo,
} from '../core/createAnnotationFlow';
import { VscodeFileSystem } from './vscodeFileSystem';
import { VscodeAuthorNameSources } from './authorSources';
import { readTagPalette, addTagToPalette } from './tagPalette';

const CREATE_NEW_LABEL = '$(add) Create new group…';
const NEW_TAG_LABEL = '$(add) New tag…';

/** Register the `annotated.createAnnotation` command. */
export function registerCreateAnnotationCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('annotated.createAnnotation', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage('Annotated: open a folder to create annotations.');
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const editor = vscode.window.activeTextEditor;

    const deps: CreateAnnotationDeps = {
      getSelection: () => getSelection(editor),
      resolveAuthor: () => resolveAuthor(new VscodeAuthorNameSources()),
      listGroups: () => store.listGroups(),
      pickGroup: (groups) => pickGroup(groups),
      promptGroupTitle: () => promptGroupTitle(),
      pickTags: () => pickTags(),
      saveGroup: (group) => store.saveGroup(group),
      newId,
      now: () => Math.floor(Date.now() / 1000),
      hashContent: (text) => sha256Hex(text),
      showInfo: (message) => void vscode.window.showInformationMessage(message),
      showWarning: (message) => void vscode.window.showWarningMessage(message),
    };

    await runCreateAnnotation(deps);
  });
}

function getSelection(editor: vscode.TextEditor | undefined): SelectionInfo | undefined {
  if (!editor) {
    return undefined;
  }
  const sel = editor.selection;
  // VSCode lines are 0-based; the model uses 1-based inclusive lines.
  const startLine = sel.start.line + 1;
  // If the selection ends at column 0 of a later line, that line is not really included.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  return {
    file: vscode.workspace.asRelativePath(editor.document.uri, false),
    range: { startLine, endLine },
    fileText: editor.document.getText(),
  };
}

interface GroupQuickPickItem extends vscode.QuickPickItem {
  groupId?: string;
}

async function pickGroup(groups: AnnotationGroup[]): Promise<GroupChoice | undefined> {
  const items: GroupQuickPickItem[] = [
    { label: CREATE_NEW_LABEL, alwaysShow: true },
    ...groups.map((g) => ({
      label: g.title,
      description: `${g.annotations.length} annotation(s)${g.tags.length ? ` · ${g.tags.join(', ')}` : ''}`,
      groupId: g.id,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Add annotation to group…' });
  if (!picked) {
    return undefined;
  }
  return picked.groupId ? { kind: 'existing', id: picked.groupId } : { kind: 'new' };
}

async function promptGroupTitle(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Name for the new annotation group',
    validateInput: (value) => (value.trim().length === 0 ? 'Please enter a name' : undefined),
  });
}

async function pickTags(): Promise<string[] | undefined> {
  const palette = readTagPalette();
  const items: vscode.QuickPickItem[] = [
    ...palette.map((t) => ({ label: t.name })),
    { label: NEW_TAG_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select tags (optional)',
  });
  if (picked === undefined) {
    return undefined;
  }
  const names: string[] = [];
  let addNew = false;
  for (const item of picked) {
    if (item.label === NEW_TAG_LABEL) {
      addNew = true;
    } else {
      names.push(item.label);
    }
  }
  if (addNew) {
    const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
    if (name && name.trim()) {
      const color = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: '#888888' });
      await addTagToPalette(name.trim(), color?.trim() || '#888888');
      names.push(name.trim());
    }
  }
  return names;
}
```

- [ ] **Step 3: Register the command in `src/web/extension.ts`**

Add the import near the other imports:

```ts
import { registerCreateAnnotationCommand } from './createAnnotationCommand';
```

And inside `activate`, after the existing `annotated.ping` registration, add:

```ts
  context.subscriptions.push(registerCreateAnnotationCommand());
```

- [ ] **Step 4: Add contributions to `package.json`**

In `contributes.commands`, add the create command (keep `annotated.ping`):

```json
    "commands": [
      { "command": "annotated.ping", "title": "Annotated: Ping" },
      { "command": "annotated.createAnnotation", "title": "Annotated: Create Annotation" }
    ],
```

Add a `keybindings` contribution and a `configuration` contribution as siblings of `commands` inside `contributes`:

```json
    "keybindings": [
      {
        "command": "annotated.createAnnotation",
        "key": "ctrl+alt+a",
        "mac": "cmd+alt+a",
        "when": "editorTextFocus && editorHasSelection"
      }
    ],
    "configuration": {
      "title": "Annotated",
      "properties": {
        "annotated.tags": {
          "type": "array",
          "default": [],
          "description": "Tag palette: each tag has a name and a display color.",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "color": { "type": "string" }
            }
          }
        },
        "annotated.authorName": {
          "type": "string",
          "description": "Display name used as the author of annotation groups you create."
        }
      }
    }
```

- [ ] **Step 5: Build + type-check**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run compile`
Expected: exit 0; bundles emitted.

- [ ] **Step 6: Run unit tests (no regression)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit`
Expected: PASS — all unit tests green (factory + flow + tags + Phase 1a/0).

- [ ] **Step 7: Commit**

```bash
git add src/web/authorSources.ts src/web/createAnnotationCommand.ts src/web/extension.ts package.json
git commit -m "feat: Create Annotation command, keybinding, and configuration"
```

---

## Task 5: Integration test + full suite

**Files:** Modify `src/web/test/suite/extension.test.ts`

- [ ] **Step 1: Add a registration test** — append to the existing `suite('Annotated web extension', …)` in `src/web/test/suite/extension.test.ts` a third `test`:

```ts
  test('registers the createAnnotation command', async () => {
    const ext = vscode.extensions.getExtension('openzeppelin.vscode-annotated');
    if (!ext) {
      throw new Error('extension not found by id openzeppelin.vscode-annotated');
    }
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.createAnnotation')) {
      throw new Error('annotated.createAnnotation should be registered');
    }
  });
```

(Add it inside the existing `suite(...)` block, after the `ping command returns pong` test. Do not change the other tests.)

- [ ] **Step 2: Run the integration suite**

Run (with `dangerouslyDisableSandbox: true` and Bash `timeout: 600000`; `pkill -f vscode-test-web 2>/dev/null` first):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:integration`
Expected: Mocha reports **4 passing** (3 in the extension suite + 1 GroupStore round-trip). Exit 0.

- [ ] **Step 3: Run the full suite (Definition of Done)**

Run (same sandbox/timeout settings):
`export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm test`
Expected: `check-types` → `test:unit` → `test:integration` (4 passing) → `test:e2e` (1 passed) all green.

- [ ] **Step 4: Commit**

```bash
git add src/web/test/suite/extension.test.ts
git commit -m "test: integration coverage for the createAnnotation command"
```

---

## Phase 1b Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (annotationFactory 4, createAnnotationFlow 7, tags 3 + Phase 1a/0 tests).
- [ ] `npm run test:integration` passes — **4 passing**.
- [ ] `npm run test:e2e` passes (1 passed).
- [ ] All work committed on the `phase-1` branch.
- [ ] Manual sanity (optional): `npm start`, open a folder, select lines, run **Annotated: Create Annotation** (or `cmd/ctrl+alt+a`), create a group, and confirm `.annotations/groups/<id>.json` is written.

Next: **1c — Sidebar** rebuilt on the real protocol (group cards from `GroupStore`, click-to-open, `FileSystemWatcher` live reload, crypto nonce, drop the `name` scaffold prop, conditional CSS link), then **1d/1e** (detail panel: group + annotation views, CodeMirror editor, navigate-to-code).
```
