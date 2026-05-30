# annotated-agent Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a markdown-only Claude Code skill, `annotated-agent`, that lets an AI agent participate in a `vscode-annotated` workspace by reading/writing the `.annotations/` files directly (node-free shell recipes), plus a repo contract-drift test that keeps the skill's recipes honest against the extension's code.

**Architecture:** The skill is pure documentation — `SKILL.md` (entry: when-to-use, operation map, hard safety rules, identity), `references/data-contract.md` (exact on-disk schema + the node-free hash/id/timestamp/slug recipes), `references/operations.md` (step-by-step recipes), `install.sh`, `README.md`. A vitest contract-drift test (`src/shared/skillContract.unit.test.ts`) asserts the documented `awk | sha256` hash recipe equals `sha256Hex(anchorText(...))`, that the doc embeds that exact recipe, that the documented schema round-trips through `parseGroup`/`parseCommentFile`, and that the documented slug rule matches `slugifyAuthor`.

**Tech Stack:** Markdown + POSIX shell (awk, sha256sum/shasum, uuidgen, date). Test: TypeScript + Vitest, shelling out via `node:child_process` (test-only; not bundled into the web extension).

---

## Source spec

`docs/superpowers/specs/2026-05-30-annotated-agent-skill-design.md` (approved). Key locked decisions: markdown-only; distinct agent identity (`annotated.agentName` → fallback `"Claude"`); additive write scope (create + manage-own + config; never touch others'); source-in-repo + installable; node-free; **tags writable to workspace OR global config (user decides)**.

## Existing code this plan depends on (verified to exist)

- `src/shared/hash.ts` — `export async function sha256Hex(text: string): Promise<string>` (lowercase hex, Web Crypto); `export function anchorText(fileText: string, range: LineRange): string` (= `fileText.split('\n').slice(range.startLine-1, range.endLine).join('\n')`).
- `src/shared/model.ts` — `parseGroup`, `serializeGroup` (`JSON.stringify(x, null, 2)`), `parseCommentFile`, `serializeCommentFile`; types `AnnotationGroup`, `Annotation`, `LineRange`, `Comment`, `CommentFile`.
- `src/core/comments.ts` — `export function slugifyAuthor(name: string): string` (= `name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'anon'`).
- Unit tests follow `src/**/*.unit.test.ts` and run via `npm run test:unit` (Vitest). `@types/node` is available (esbuild + vitest are Node tools).

## Conventions

- Branch: `skill-annotated-agent` (create before Task 1; merge to `main` when the plan is done — no remote, never push, per CLAUDE.md).
- Node for test/build commands: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`.
- Commit trailer (blank line, then):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- This plan adds **only** a markdown skill + one unit test — no extension `src/web` changes, no new deps. DoD is `npm run check-types` + `npm run test:unit` green (no integration/e2e needed).

## File Structure

```
skills/annotated-agent/
  SKILL.md                      # Task 3 — entry: frontmatter, when-to-use, op map, hard safety rules, identity, install pointer
  references/
    data-contract.md            # Task 1 — exact schema (groups/comments/config) + node-free recipes (hash/id/timestamp/slug)
    operations.md               # Task 2 — step-by-step recipes: surf / reply / create / manage-own / config
  install.sh                    # Task 4 — symlink (default) or --copy into ~/.claude/skills or --repo <path>/.claude/skills
  README.md                     # Task 4 — what it is + install usage
src/shared/skillContract.unit.test.ts   # Task 1 — contract-drift test (hash parity, doc-embeds-recipe, schema round-trip, slug parity)
```

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout main && git checkout -b skill-annotated-agent && git branch --show-current
```
Expected: `skill-annotated-agent`.

---

## Task 1: Data contract reference + contract-drift test

This is the heart: the test drives the documented recipe/schema/slug to be correct, and guards them against future model changes.

**Files:**
- Create: `src/shared/skillContract.unit.test.ts`
- Create: `skills/annotated-agent/references/data-contract.md`

- [ ] **Step 1: Write the failing test**

Create `src/shared/skillContract.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, anchorText } from './hash';
import {
  parseGroup,
  serializeGroup,
  parseCommentFile,
  serializeCommentFile,
  type AnnotationGroup,
  type CommentFile,
} from './model';
import { slugifyAuthor } from '../core/comments';

const CONTRACT_DOC = 'skills/annotated-agent/references/data-contract.md';

// The canonical node-free content-hash recipe. The doc MUST embed this verbatim
// (the "doc embeds recipe" test below), and it MUST hash identically to
// sha256Hex(anchorText(...)) (the "hash parity" tests below). $FILE/$START/$END are env vars.
const RECIPE = `awk -v s="$START" -v e="$END" 'NR>=s && NR<=e { printf "%s%s", sep, $0; sep="\\n" }' "$FILE" \\
  | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } \\
  | cut -d' ' -f1`;

function recipeHash(text: string, start: number, end: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'anno-contract-'));
  const file = join(dir, 'f.txt');
  writeFileSync(file, text);
  try {
    return execSync(RECIPE, {
      env: { ...process.env, FILE: file, START: String(start), END: String(end) },
    })
      .toString()
      .trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLES: Array<{ name: string; text: string; start: number; end: number }> = [
  { name: 'single line', text: 'alpha\nbravo\ncharlie', start: 2, end: 2 },
  { name: 'multi line', text: 'alpha\nbravo\ncharlie', start: 1, end: 3 },
  { name: 'blank line inside range', text: 'a\n\nc', start: 1, end: 3 },
  { name: 'no trailing newline', text: 'x\ny', start: 1, end: 2 },
  { name: 'trailing newline file', text: 'm\nn\n', start: 1, end: 2 },
  { name: 'past EOF endLine', text: 'p\nq', start: 1, end: 9 },
];

describe('annotated-agent contract: hash recipe parity', () => {
  for (const s of SAMPLES) {
    it(`recipe matches sha256Hex(anchorText) — ${s.name}`, async () => {
      const expected = await sha256Hex(anchorText(s.text, { startLine: s.start, endLine: s.end }));
      expect(recipeHash(s.text, s.start, s.end)).toBe(expected);
    });
  }
});

describe('annotated-agent contract: doc embeds the canonical recipe', () => {
  it('data-contract.md contains the exact RECIPE text', () => {
    const doc = readFileSync(CONTRACT_DOC, 'utf8');
    expect(doc.includes(RECIPE)).toBe(true);
  });
});

describe('annotated-agent contract: schema round-trip', () => {
  it('a documented group round-trips through parseGroup/serializeGroup', () => {
    const group: AnnotationGroup = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Login review',
      author: 'Claude',
      tags: ['security'],
      gitRef: null,
      status: 'open',
      createdAt: 1730000000,
      updatedAt: 1730000000,
      annotations: [
        {
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          file: 'src/auth/login.ts',
          range: { startLine: 42, endLine: 47 },
          content: 'Note body',
          contentHash: 'abc123',
        },
      ],
    };
    expect(parseGroup(JSON.parse(serializeGroup(group)))).toEqual(group);
  });

  it('a documented comment file round-trips through parseCommentFile/serializeCommentFile', () => {
    const file: CommentFile = {
      author: 'Claude',
      email: '',
      comments: [{ id: 'c1', annotationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', content: 'Reply', timestamp: 1730000050 }],
    };
    expect(parseCommentFile(JSON.parse(serializeCommentFile(file)))).toEqual(file);
  });
});

describe('annotated-agent contract: slug parity', () => {
  it('matches the documented slug rule', () => {
    expect(slugifyAuthor('Claude')).toBe('claude');
    expect(slugifyAuthor('Ana Díaz!')).toBe('ana-d-az');
    expect(slugifyAuthor('')).toBe('anon');
    expect(slugifyAuthor('@@@')).toBe('anon');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/skillContract.unit.test.ts`
Expected: FAIL — the "doc embeds the canonical recipe" test errors/fails because `skills/annotated-agent/references/data-contract.md` does not exist yet (the hash-parity, round-trip, and slug tests should already PASS since they only use existing code).

- [ ] **Step 3: Create the data-contract reference doc**

Create `skills/annotated-agent/references/data-contract.md`:

````markdown
# Data contract — `.annotations/` on disk

The `vscode-annotated` extension stores everything as JSON files (plus a few VSCode
settings). An agent participates by reading/writing these files directly. Write files that
match this contract **exactly** or the extension won't read them back.

## Directory layout

```
.annotations/
  groups/<group-id>.json        # one annotation group per file
  comments/<author-slug>.json   # one comment file per author
```

## Group — `.annotations/groups/<id>.json`

```jsonc
{
  "id": "550e8400-e29b-41d4-a716-446655440000",   // MUST equal the filename stem
  "title": "Login review",
  "author": "Claude",                              // your agent identity for groups you create
  "tags": ["security"],                            // tag names (colors live in config)
  "gitRef": null,                                  // branch / tag / SHA, or null
  "status": "open",                                // "open" | "resolved"
  "createdAt": 1730000000,                         // epoch SECONDS
  "updatedAt": 1730000000,                         // epoch SECONDS
  "annotations": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "file": "src/auth/login.ts",                 // workspace-relative POSIX path
      "range": { "startLine": 42, "endLine": 47 }, // 1-based, inclusive, integers
      "content": "Markdown body…",
      "contentHash": "<sha256 hex of the anchored lines — see recipe>"
    }
  ]
}
```

## Comment file — `.annotations/comments/<author-slug>.json`

```jsonc
{
  "author": "Claude",
  "email": "",                                     // best-effort; "" is valid
  "comments": [
    {
      "id": "uuid",
      "annotationId": "f47ac10b-…",                // references an annotation in ANY group file
      "content": "Markdown body…",
      "timestamp": 1730000050                      // epoch SECONDS; thread order (ascending)
    }
  ]
}
```

A **thread** for an annotation = every comment, across **all** `comments/*.json`, whose
`annotationId` matches — sorted ascending by `timestamp`.

## Invariants (must hold or the extension can't read your writes)

- **Group `id` == filename stem.** `groups/<id>.json`; a mismatch hides the group.
- **Comment filename == author slug** (see slug recipe). Edit/delete-own only works on your own slug file.
- **`contentHash` is mandatory + exact** (see hash recipe). A wrong/placeholder hash renders the annotation "stale" (amber).
- **Line ranges:** 1-based, inclusive, integers.
- **Timestamps:** epoch **seconds** (not milliseconds).
- **JSON formatting:** 2-space indent, **no trailing newline** (matches the extension's
  `JSON.stringify(value, null, 2)` serializer → minimal diffs).

## Node-free recipes (POSIX shell only)

### contentHash

Reproduce `anchorText` (the full lines in `[START,END]`, 1-based inclusive, joined by `\n`,
**no trailing newline**) then SHA-256 it. `$FILE` is the workspace-relative path; `$START`/`$END`
are line numbers:

```bash
awk -v s="$START" -v e="$END" 'NR>=s && NR<=e { printf "%s%s", sep, $0; sep="\n" }' "$FILE" \
  | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } \
  | cut -d' ' -f1
```

- `awk` keeps blank lines, preserves any `\r` (splits on `\n` only — same as the source), clamps a past-EOF range, and `printf` emits **no trailing newline**.
- `sha256sum` (Linux) with `shasum -a 256` fallback (macOS) → the lowercase hex the extension expects.

### IDs

```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```
(macOS `uuidgen` is uppercase; the extension's IDs are lowercase, so normalize.)

### Timestamps

```bash
date +%s
```

### Author slug (for the comment filename)

Lowercase → replace each run of non-`[a-z0-9]` with `-` → strip leading/trailing `-` →
fallback `anon` if empty:

```bash
printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | sed 's/^$/anon/'
```

Examples: `Claude` → `claude`; `Ana Díaz!` → `ana-d-az`; `` (empty) → `anon`.

## Config — VSCode settings

- `annotated.tags`: `[{ "name": string, "color": string }]` — the tag palette.
  **Tag writes may target the workspace OR the user's global config — ask the user which**
  (default: workspace):
  - **Workspace:** `.vscode/settings.json` in the repo (shared/committed).
  - **Global (user):** the user's `settings.json` — path varies by OS + VSCode flavor:
    - macOS: `~/Library/Application Support/Code/User/settings.json`
    - Linux: `~/.config/Code/User/settings.json`
    - Windows: `%APPDATA%\Code\User\settings.json`
    - (swap the `Code` segment for `Code - Insiders` / `VSCodium` / `Cursor` as needed)

    **Resolve the path and confirm it with the user before writing.**

  Either target: read-merge-write `annotated.tags`, **dedup by `name`**, preserve other keys.
  Both files may be absent — create with `{ }` if needed.
- `annotated.authorName` / `annotated.authorEmail`: the **human's** identity — read, never overwrite.
- **Agent identity:** `annotated.agentName` (optional) → fallback `"Claude"`. Used as your
  group `author` and the basis for your comment-file slug.
````

CRITICAL: the `contentHash` fenced block above must be **byte-identical** to the `RECIPE`
constant in the test (same text, same indentation, same `\n`/`\` characters) — the
"doc embeds the canonical recipe" test does an exact substring match.

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run src/shared/skillContract.unit.test.ts`
Expected: PASS (all hash-parity samples, doc-embeds-recipe, both round-trips, slug parity).

If the "doc embeds the canonical recipe" test fails, the fenced block doesn't byte-match `RECIPE` — diff the two and align whitespace/escapes until it passes. Do NOT relax the test to a fuzzy match.

- [ ] **Step 5: Type-check + full unit suite**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: exit 0; all unit green (the new file runs under `test:unit`). If `check-types` flags the `node:*` imports, confirm `@types/node` resolves (it should — vitest/esbuild need it); the test is not bundled into the web extension.

- [ ] **Step 6: Commit**

```bash
git add src/shared/skillContract.unit.test.ts skills/annotated-agent/references/data-contract.md
git commit -m "feat(skill): data contract reference + contract-drift test"
```

---

## Task 2: Operations reference

Pure documentation: the step-by-step recipes for each operation. No new test (the recipes
compose JSON the agent writes; the only computed values are already guarded by Task 1).

**Files:**
- Create: `skills/annotated-agent/references/operations.md`

- [ ] **Step 1: Create the operations doc**

Create `skills/annotated-agent/references/operations.md`:

````markdown
# Operations

All paths are workspace-relative. See `data-contract.md` for the exact schema, invariants,
and the node-free recipes (hash / id / timestamp / slug). **Always uphold the invariants and
the safety rules in `SKILL.md`.**

## 1. Surf / read

- **List groups:** read each `.annotations/groups/*.json`; for each report
  `title` · `author` · `tags` · `status` · `annotations.length`.
- **Filter:** by tag (`tags` includes X), author (`author` == X), or status
  (`status` == `open`/`resolved`).
- **Open an annotation:** read its `file` over the lines in `range` to see the code in context.
- **Assemble a thread for an annotation `A`:** read every `.annotations/comments/*.json`,
  collect comments where `annotationId == A.id`, sort ascending by `timestamp`, and present
  each as `author` · (relative time from `timestamp`) · `content`.

`grep`/`jq` are optional conveniences; your Read tool over the JSON is sufficient.

## 2. Reply in a thread

1. Determine your identity: `agentName` = `annotated.agentName` from config, else `"Claude"`.
2. Compute your comment-file slug from `agentName` (slug recipe) → path
   `.annotations/comments/<slug>.json`.
3. Read that file if it exists; otherwise start `{ "author": "<agentName>", "email": "", "comments": [] }`.
4. Append a comment: `{ "id": "<uuidgen>", "annotationId": "<the annotation's id>", "content": "<markdown>", "timestamp": <date +%s> }`.
5. Write the file back (2-space indent, no trailing newline).

You may reply to **any** annotation, but only ever write your **own** slug file.

## 3. Create an annotation group (and annotations)

1. For each annotation, gather `file` (workspace-relative POSIX), 1-based inclusive `range`,
   and markdown `content`. Compute `contentHash` via the hash recipe with that `file`/range.
2. Build the group:
   ```jsonc
   {
     "id": "<uuidgen>",
     "title": "<title>",
     "author": "<agentName>",
     "tags": [<tag names — must exist in the palette, or add them first (op 5)>],
     "gitRef": null,            // or a branch/tag/SHA string
     "status": "open",
     "createdAt": <date +%s>,
     "updatedAt": <same as createdAt>,
     "annotations": [ { "id": "<uuidgen>", "file": "...", "range": {...}, "content": "...", "contentHash": "..." } ]
   }
   ```
3. Write `.annotations/groups/<id>.json` — **the filename stem MUST equal `id`**.

**Add an annotation to a group you already authored:** append to its `annotations`, recompute
nothing for existing entries, set the new entry's `contentHash`, and bump `updatedAt` to `date +%s`.

## 4. Manage your own

Only on groups whose `author` is your `agentName`, and your own comment file:
- **Resolve / restore a group:** set `status` to `"resolved"` / `"open"`, bump `updatedAt`.
- **Delete a group:** remove its `.annotations/groups/<id>.json`.
- **Edit/delete your comment:** in your own slug file, change a comment's `content`, or drop it
  from `comments`; write back.

Never modify or delete a group authored by someone else, or another author's comment file.

## 5. Update config (tags / identity)

- **Add a tag** to `annotated.tags` (`{ "name": "...", "color": "#rrggbb" }`), dedup by `name`:
  - Ask the user whether to write the **workspace** config (`.vscode/settings.json`) or the
    **global** user config. For global, resolve the OS/flavor path (see `data-contract.md`) and
    **confirm it before writing**.
  - Read the target settings JSON (create `{}` if absent), merge `annotated.tags` (append or
    replace-by-name), write it back preserving other keys.
- **Set agent identity:** write `annotated.agentName` to the workspace `.vscode/settings.json`.
````

- [ ] **Step 2: Self-review the doc**

Read `skills/annotated-agent/references/operations.md` and confirm: every operation references the
verified recipes (not a re-stated hash), the identity/slug steps match `data-contract.md`, the
"own only" boundary is explicit on reply/manage/create, and there are no TODO/placeholder lines.

- [ ] **Step 3: Verify nothing regressed**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run test:unit`
Expected: still green (no code changed; this confirms the new markdown didn't break test discovery).

- [ ] **Step 4: Commit**

```bash
git add skills/annotated-agent/references/operations.md
git commit -m "docs(skill): operations reference (surf / reply / create / manage-own / config)"
```

---

## Task 3: SKILL.md entry point

**Files:**
- Create: `skills/annotated-agent/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

Create `skills/annotated-agent/SKILL.md`:

````markdown
---
name: annotated-agent
description: Use when working in a repo that has a `.annotations/` directory (the vscode-annotated extension) and the user wants to surf annotation groups or comment threads, reply in a thread, create annotation groups/annotations, or update the tag palette / identity config. The agent reads and writes the `.annotations/` JSON files directly, under a distinct agent identity, using node-free shell recipes.
---

# annotated-agent

Participate in a `vscode-annotated` workspace by reading and writing its on-disk artifacts
directly. Everything the extension stores lives in `.annotations/` JSON files plus a few
VSCode settings — no extension API or server is involved.

## When to use

A repo has a `.annotations/groups/` directory and the user wants to: **surf** existing
annotations/threads, **reply** in a thread, **create** annotation groups/annotations, or
**update** the tag palette / agent identity.

## How to work

1. Read `references/data-contract.md` for the exact on-disk schema, the invariants, and the
   node-free recipes (content hash, UUID, timestamp, author slug). **Get the schema and the
   `contentHash` recipe right — a wrong hash makes your annotation render "stale."**
2. Read `references/operations.md` for the step-by-step recipe for the operation at hand
   (surf / reply / create / manage-own / config).

## Identity

You act under a **distinct agent identity** — not the human's. Your identity is
`annotated.agentName` from config, falling back to `"Claude"`. You write your groups under that
`author` and your comments to `.annotations/comments/<slug-of-agentName>.json`.

## Hard rules (always)

- **Own-only writes.** Create groups/annotations and reply anywhere, but **edit/resolve/delete
  only what you authored** (groups whose `author` is your identity, and your own comment file).
  Never modify or delete a human's group or another author's comments.
- **Hash honesty.** Always compute `contentHash` with the documented recipe — never a placeholder.
- **Uphold the invariants.** Group `id` == filename stem; comment filename == author slug;
  1-based integer line ranges; epoch-**second** timestamps; 2-space JSON with no trailing newline.
- **Read fresh before write.** The extension reloads files live; re-read a file right before
  mutating it to avoid clobbering concurrent edits.
- **Leave version control to the human.** Write the files; don't `git add`/commit `.annotations/`
  unless asked.

## Installation

This skill is maintained in the `vscode-annotated` repo under `skills/annotated-agent/`. To use
it elsewhere, run its `install.sh` (see `README.md`) to symlink/copy it into `~/.claude/skills`
(global) or a target repo's `.claude/skills`.
````

- [ ] **Step 2: Self-review**

Confirm the frontmatter `name`/`description` are present and the description names the triggers
(`.annotations/`, surf/reply/create/config); the hard rules match the spec's safety section; no
placeholders.

- [ ] **Step 3: Commit**

```bash
git add skills/annotated-agent/SKILL.md
git commit -m "docs(skill): SKILL.md entry point (when-to-use, identity, hard rules)"
```

---

## Task 4: install.sh + README

**Files:**
- Create: `skills/annotated-agent/install.sh`
- Create: `skills/annotated-agent/README.md`

- [ ] **Step 1: Create install.sh**

Create `skills/annotated-agent/install.sh`:

```bash
#!/usr/bin/env bash
# Install the annotated-agent skill into a Claude Code skills directory.
#
# Usage:
#   ./install.sh                 # symlink into ~/.claude/skills/annotated-agent (global)
#   ./install.sh --copy          # copy instead of symlink
#   ./install.sh --repo <path>   # install into <path>/.claude/skills/annotated-agent
#   ./install.sh --help
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
NAME="annotated-agent"
MODE="symlink"
DEST_ROOT="$HOME/.claude/skills"

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy"; shift ;;
    --repo) DEST_ROOT="${2:?--repo needs a path}/.claude/skills"; shift 2 ;;
    --help|-h)
      sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

DEST="$DEST_ROOT/$NAME"
mkdir -p "$DEST_ROOT"
rm -rf "$DEST"
if [ "$MODE" = "copy" ]; then
  cp -R "$SRC" "$DEST"
  echo "Copied $NAME -> $DEST"
else
  ln -s "$SRC" "$DEST"
  echo "Symlinked $NAME -> $DEST"
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x skills/annotated-agent/install.sh`

- [ ] **Step 3: Verify install.sh works (dry-ish, into a temp dir)**

Run:
```bash
T=$(mktemp -d)
bash skills/annotated-agent/install.sh --repo "$T" && ls -la "$T/.claude/skills/annotated-agent/SKILL.md" 2>/dev/null; echo "exit=$?"
bash skills/annotated-agent/install.sh --copy --repo "$T" && test -f "$T/.claude/skills/annotated-agent/SKILL.md" && echo "copy-ok"
bash skills/annotated-agent/install.sh --help | head -1
rm -rf "$T"
```
Expected: the symlink resolves to `SKILL.md` (exit=0), `copy-ok` prints, and `--help` prints the usage comment. (Note: SKILL.md exists from Task 3, so the symlinked path resolves.)

- [ ] **Step 4: Create README.md**

Create `skills/annotated-agent/README.md`:

````markdown
# annotated-agent skill

A Claude Code skill that lets an AI agent participate in a
[`vscode-annotated`](../../README.md) workspace by reading/writing the `.annotations/` files
directly — surf groups & threads, reply, create groups/annotations, and update config. Markdown
only, node-free shell recipes, distinct agent identity, additive write scope.

Contents:
- `SKILL.md` — entry point (when-to-use, identity, hard rules)
- `references/data-contract.md` — exact on-disk schema + node-free recipes
- `references/operations.md` — step-by-step recipes per operation

## Install

```bash
# Global (all repos): symlink into ~/.claude/skills
./install.sh

# …or copy instead of symlink
./install.sh --copy

# Into a specific repo's .claude/skills
./install.sh --repo /path/to/repo
```

The canonical source lives in the `vscode-annotated` repo and is kept in lockstep with the data
contract by `src/shared/skillContract.unit.test.ts` (run via `npm run test:unit`).
````

- [ ] **Step 5: Commit**

```bash
git add skills/annotated-agent/install.sh skills/annotated-agent/README.md
git commit -m "docs(skill): install.sh + README"
```

---

## Task 5: Repo pointer + final verification

**Files:**
- Modify: `README.md` (repo root)

- [ ] **Step 1: Add a pointer from the repo README**

In the repo-root `README.md`, after the intro paragraph (the line ending `docs/superpowers/`), add:

```markdown

## Agent skill

`skills/annotated-agent/` is a Claude Code skill for AI agents to participate in an
annotated workspace (surf, reply, create, configure) by reading/writing `.annotations/`
directly. See `skills/annotated-agent/README.md`.
```

- [ ] **Step 2: Final verification (Definition of Done)**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: exit 0; all unit green (incl. the 4 contract-drift describe blocks). No integration/e2e needed — this plan adds only docs + one unit test, no extension `src/web` changes.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: link the annotated-agent skill from the repo README"
```

---

## Definition of Done

- [ ] `skills/annotated-agent/` contains `SKILL.md`, `references/data-contract.md`, `references/operations.md`, `install.sh` (executable), `README.md`.
- [ ] `src/shared/skillContract.unit.test.ts` passes: hash-recipe parity across all 6 samples, doc-embeds-recipe (exact match), both schema round-trips, slug parity.
- [ ] `npm run check-types` + `npm run test:unit` green.
- [ ] `install.sh` verified to symlink/copy/`--repo`/`--help`.
- [ ] Repo README links the skill.
- [ ] All work committed on `skill-annotated-agent`; merge to `main` when done.

## Self-review notes (spec coverage)

- Markdown-only skill (SKILL.md + 2 references + install.sh + README) → Tasks 1-4. ✓
- Node-free recipes (awk+sha256sum/shasum, uuidgen, date) → data-contract.md, guarded by Task 1's parity test. ✓
- Distinct identity (`annotated.agentName`→"Claude") → SKILL.md + operations.md. ✓
- Additive write scope / own-only → SKILL.md hard rules + operations.md boundaries. ✓
- Tags to workspace OR global (user decides) → data-contract.md config section + operations.md op 5. ✓
- Source-in-repo + installable → install.sh + README + repo pointer. ✓
- Contract-drift test (hash parity, schema round-trip, slug parity) → Task 1. ✓ (Plus a "doc embeds recipe" assertion tying doc⇄behavior.)
```
