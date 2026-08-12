# UX feedback round 6 — file-level annotations, preview indentation, hover-label escaping

Date: 2026-08-05 · Base version: 0.4.1 · Target release: 0.5.0 (new feature + model extension)

Three items of user feedback (TODO.md items 1–3):

1. Annotations may target a **whole file** (no line range) — clicking one just opens the file.
2. Blockquotes and top-level list items render indented in the detail panel; they must be
   flush-left (nesting still indents one level per level).
3. One gutter-hover item rendered as a literal `[📝 …](command:annotated.openAnnotation?…)`
   instead of a link.

---

## Item 1 — File-level annotations

### Model

`Annotation.range` becomes `LineRange | null`. `null` means "the whole file"; there is no
separate `kind` discriminator.

```ts
export interface Annotation {
  id: string;
  file: string;
  /** 1-based inclusive lines, or null for a whole-file annotation. */
  range: LineRange | null;
  content: string;
  /** SHA-256 of the anchored lines; '' for a whole-file annotation. */
  contentHash: string;
}
```

- `parseAnnotation` accepts a missing **or** `null` `range` → `null`. A present `range` is
  validated exactly as today (integers ≥ 1, `endLine ≥ startLine`).
- `contentHash` stays a required string; whole-file annotations carry `''`.
- Nullable (not optional) so `strict` type-checking enumerates every consumer.
- New pure helper in `shared/model.ts`:

  ```ts
  /** `src/foo.ts:12–18`, or `src/foo.ts` for a whole-file annotation. */
  export function formatAnnotationLocation(a: Pick<Annotation, 'file' | 'range'>): string;
  ```

  Every display site (detail panel header, annotation rows, the
  `openAnnotationAtCursor` QuickPick description, the copy-path payload) uses it, so the
  "no `:lines` suffix" rule lives in one place.

Backward/forward compatibility: existing group files are unaffected (they always carry a
range). Older extension builds reading a new file would throw on `range: null` — acceptable,
same as previous format extensions in this project.

### Creating one

New command `annotated.createFileAnnotation` — title **"Annotated: Create File Annotation"**.

Surfaces (no `editor/context` entry, per user decision):

- Command palette — targets the **active editor's** file; warns if there is no active editor.
- `explorer/context` — targets the right-clicked resource (`Uri` argument); the menu item is
  hidden for folders where possible, and a folder/unreadable target warns and no-ops.

No keybinding.

Flow reuse: `createAnnotationFlow.SelectionInfo.range` becomes `LineRange | null`.
`runCreateAnnotation` still calls `readWorkingText(file)` for a whole-file annotation — this
keeps the existing "this view has no file on disk" guard for diff/virtual documents — but
skips `hashContent` and stores `contentHash: ''`. Group pick / new-group / tag / gitRef
handling is untouched, so both commands share one flow.

The extension-side registration is parameterized by scope: the existing
`registerCreateAnnotationCommand` gains a sibling that supplies a
`getSelection` returning `{ file, range: null }` from a `Uri` or the active editor. Shared
dependency wiring is factored out rather than copy-pasted.

### Detail panel

- **Location label**: `formatAnnotationLocation` output; short form drops the `:lines`
  suffix too (`foo.ts`). The copy-path button copies `src/foo.ts`.
- **Range editor**: while editing, a `whole file` checkbox appears next to the two number
  inputs. Checked → inputs disabled and saving sends "no range"; unchecking a whole-file
  annotation seeds the inputs with `1`–`1` so it can be converted back to a line range.
- **Stale banner**: a whole-file annotation can only be stale because its file is gone, so
  the banner text becomes *"⚠ File not found — it may have been moved or deleted."* Line
  annotations keep the existing "Lines changed since this was written" wording. The
  annotation-row stale-dot tooltip follows the same split.

### Protocol + persistence

- `updateAnnotationRange` message: `startLine: number | null`, `endLine: number | null`.
  Both `null` = whole file; mixed null/number is rejected by `parseMessage`.
- `GroupStore.updateAnnotationRange(groupId, annotationId, range: LineRange | null,
  contentHash, now)`.
- The extension handler: `range === null` → persist `range: null, contentHash: ''` (no file
  read); otherwise re-hash as today.

### Navigation, indicators, staleness

- `revealAnnotation`: `range === null` → `showTextDocument(uri, { preserveFocus: true })`
  with no selection, no `revealRange`, no line highlight; previous highlights are still
  cleared. Out-of-workspace / unopenable targets warn as today. "Refocus code" therefore
  re-opens the file.
- `gutterBarsByLine` and `annotationsAtLine` skip annotations with `range === null` — no
  gutter bar, no editor hover, no line highlight for whole-file annotations (they are
  visible in the sidebar and detail panel only).
- `computeStaleIds`: `range === null` → stale only if the file cannot be read; no hashing.

### Agent skill docs

`skills/annotated/SKILL.md`, `references/data-contract.md` and `references/operations.md`
stay in lockstep (guarded by `skillContract.unit.test.ts`):

- The annotation shape documents `"range": null` + `"contentHash": ""` for a whole-file
  annotation, and that the content-hash recipe does not apply to it.
- The "create an annotation" operation notes when to prefer file-level (notes about a file
  as a whole rather than specific lines).
- Local-link syntax gains the file-only form (below).

## Item 1b — File-only local links

`parseLocationLink(href)` accepts a target with **no** `#L` fragment and returns
`{ file, range: null }`, gated so ordinary prose links are not hijacked:

- no URL scheme (unchanged), and
- the target looks like a path: it contains `/` **or** ends in a `.<ext>` (e.g. `README.md`,
  `src/foo.ts`, `docs/adr/0001-x.md`). `[see above](whatever)` stays an ordinary link.
- A target with a `#` fragment that is not a valid `#L…` spec stays a non-local link
  (unchanged), so `[x](foo.md#heading)` is not treated as a code link.

`formatLocationLink(file, null)` → `file`. `isLocationLink` (the paste-to-link guard)
inherits the widened parse. `MarkdownPreview` titles such anchors with just the path, and
`revealLocation(folderUri, file, null)` opens the file without selecting or highlighting.
`onlocallink` callbacks carry `LineRange | null`.

`annotated.copyLocationLink` stays selection-based (always emits `#L…`); a user who wants a
file link can delete the fragment.

## Item 2 — Preview indentation

`MarkdownPreview.svelte` styles headings, code, `pre` and links but never lists or quotes,
so UA defaults apply: `ul/ol { padding-inline-start: 40px }` and
`blockquote { margin: 1em 40px }`. Add:

```css
.md-preview :global(ul), .md-preview :global(ol) { margin: 0.4em 0; padding-left: 1.4em; }
.md-preview :global(li) { margin: 0.15em 0; }
.md-preview :global(blockquote) {
  margin: 0.5em 0;
  padding: 0 0 0 8px;
  border-left: 3px solid var(--vscode-textBlockQuote-border, #454545);
  background: var(--vscode-textBlockQuote-background, transparent);
}
```

A `1.4em` list padding keeps the marker inside the panel while indenting each nesting level
exactly once; quotes trade the 40px indent for a left border. One fix covers annotation
bodies, comment bodies and group descriptions, since they all render through this component.

Verification: a component test asserting the emitted rule set / computed `padding-left` where
jsdom supports it; otherwise the rules are asserted against the compiled component CSS. No
snapshot tests.

## Item 3 — Broken hover link

`hoverMarkdown` interpolates a raw label into `[📝 ${label}](command:…)`. Reproduced against
markdown-it (the renderer VSCode uses for `MarkdownString`): a label containing `]`, or
ending in `\`, makes the entire construct render as literal text — exactly the reported
symptom — and a backtick code span containing `](` can hijack the link destination.

Fix: escape the structural characters at that single choke point.

```ts
/** Backslash-escape the characters that can break a Markdown link label. */
function escapeLinkLabel(text: string): string; // \ [ ] `
```

Emphasis markers (`*`, `_`) cannot break bracket or destination parsing, so bold/italic in a
snippet keeps rendering. Labels are still built by `hoverItems` (group title + `oneLine`
snippet); only the rendering step escapes.

Tests (unit, rendering each label through markdown-it and asserting exactly one anchor whose
text matches the escaped-then-rendered label): a `]` in the snippet, a trailing `\`, a code
span containing `](`, a plain label (regression), and multiple items joined by a blank line.

## Testing

- **Unit (Vitest)** — model parse/serialize with `range: null` and legacy ranges;
  `formatAnnotationLocation`; `createAnnotationFlow` with a null range (no hashing, empty
  hash, both group paths); `gutterIndicators` skipping range-less annotations;
  `hoverMarkdown` escaping; `locationLink` file-only parse/format; `drift`/staleness
  behavior; protocol message validation; Svelte component tests for the whole-file
  location label, the range editor's checkbox, and the file-specific stale banner.
- **Integration (`@vscode/test-web`)** — creating a file annotation via the command
  (palette path) writes `range: null`; `updateAnnotationRange` with nulls converts an
  existing annotation to whole-file and back.
- **Gate** — `npm run check-types` + `npm run test:unit` locally, plus
  `npm run test:integration` where the sandbox has network.

## Out of scope

- No Explorer file-decoration badges and no gutter/hover presence for whole-file
  annotations (decided: nothing in the editor).
- No whole-file hashing / "file changed" staleness.
- No `editor/context` menu entry for the new command.
- `annotated.copyLocationLink` keeps emitting a line fragment.
