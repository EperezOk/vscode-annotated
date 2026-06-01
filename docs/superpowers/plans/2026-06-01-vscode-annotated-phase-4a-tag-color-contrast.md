# Phase 4a — Tag Color & Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw hex-input for new-tag colors with a visual swatch QuickPick, and make tag-chip text legible by auto-picking black/white based on background luminance (TODO #1 + #7).

**Architecture:** Add two small pure utilities in `src/shared` (`color.ts` for contrast, `svgIcon.ts` for `data:` URI SVGs), a fixed swatch list in `src/core/tags.ts`, and a single shared host helper `promptNewTag()` in `src/web/tagPalette.ts` that replaces three duplicated hex-prompt blocks. Svelte chips consume `contrastColor`. The `svgIcon.ts` helper is reused later by the gutter feature (4g).

**Tech Stack:** TypeScript, Svelte 5 (runes), Vitest (unit + jsdom component projects), VSCode extension API (QuickPick `iconPath`).

**Test commands** (machine default Node is too old — always prefix):
```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
```

---

## File Structure

- **Create** `src/shared/color.ts` — `contrastColor(hex)` (pure, no deps).
- **Create** `src/shared/color.unit.test.ts` — its tests.
- **Create** `src/shared/svgIcon.ts` — `svgDataUri(svg)` + `swatchIconSvg(hex)` (pure).
- **Create** `src/shared/svgIcon.unit.test.ts` — its tests.
- **Modify** `src/core/tags.ts` — add `TAG_SWATCHES`.
- **Modify** `src/core/tags.unit.test.ts` — add `TAG_SWATCHES` coverage.
- **Modify** `src/web/tagPalette.ts` — add `promptNewTag()`.
- **Modify** `src/web/createAnnotationCommand.ts` — use `promptNewTag()` (call site 1).
- **Modify** `src/web/extension.ts` — use `promptNewTag()` (call sites 2 & 3).
- **Modify** `src/webview/detail/GroupView.svelte` + `.svelte.test.ts` — contrast chip text.
- **Modify** `src/webview/sidebar/GroupCard.svelte` + `.svelte.test.ts` — contrast chip text.

---

### Task 1: `contrastColor` luminance helper

**Files:**
- Create: `src/shared/color.ts`
- Test: `src/shared/color.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/color.unit.test.ts
import { describe, it, expect } from 'vitest';
import { contrastColor } from './color';

describe('contrastColor', () => {
  it('returns black on light backgrounds', () => {
    expect(contrastColor('#ffffff')).toBe('#000000');
    expect(contrastColor('#ffff00')).toBe('#000000'); // yellow
    expect(contrastColor('#fff')).toBe('#000000');     // shorthand
  });

  it('returns white on dark backgrounds', () => {
    expect(contrastColor('#000000')).toBe('#ffffff');
    expect(contrastColor('#0000ff')).toBe('#ffffff'); // blue
    expect(contrastColor('#5B5BD6')).toBe('#ffffff'); // indigo swatch
  });

  it('defaults to white for malformed input', () => {
    expect(contrastColor('not-a-color')).toBe('#ffffff');
    expect(contrastColor('')).toBe('#ffffff');
    expect(contrastColor('#12')).toBe('#ffffff');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/color.unit.test.ts`
Expected: FAIL — `Failed to resolve import './color'` / `contrastColor is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/color.ts
/** Pick black or white text for legible contrast on a solid background color. */
export function contrastColor(hex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(hex);
  if (!rgb) {
    return '#ffffff';
  }
  // Perceived brightness (ITU-R BT.601 / "YIQ"), 0–255.
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness >= 128 ? '#000000' : '#ffffff';
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return null;
  }
  let h = m[1];
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/color.unit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/color.ts src/shared/color.unit.test.ts
git commit -m "feat(color): contrastColor luminance helper (TODO #7)"
```

---

### Task 2: `svgIcon` data-URI helpers

**Files:**
- Create: `src/shared/svgIcon.ts`
- Test: `src/shared/svgIcon.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/svgIcon.unit.test.ts
import { describe, it, expect } from 'vitest';
import { svgDataUri, swatchIconSvg } from './svgIcon';

const PREFIX = 'data:image/svg+xml;base64,';

describe('svgDataUri', () => {
  it('produces a base64 data URI that round-trips back to the SVG', () => {
    const uri = svgDataUri('<svg/>');
    expect(uri.startsWith(PREFIX)).toBe(true);
    expect(atob(uri.slice(PREFIX.length))).toBe('<svg/>');
  });
});

describe('swatchIconSvg', () => {
  it('embeds the given color in a square svg data URI', () => {
    const svg = atob(swatchIconSvg('#E5484D').slice(PREFIX.length));
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#E5484D"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/svgIcon.unit.test.ts`
Expected: FAIL — cannot resolve `./svgIcon`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/svgIcon.ts
/** Wrap a raw (ASCII) SVG string as a base64 `data:` URI usable as an icon path / img src. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** A small filled rounded-square swatch icon for the given hex color, as a `data:` URI. */
export function swatchIconSvg(hex: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<rect x="1" y="1" width="14" height="14" rx="3" fill="${hex}"/>` +
    `</svg>`;
  return svgDataUri(svg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/shared/svgIcon.unit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/svgIcon.ts src/shared/svgIcon.unit.test.ts
git commit -m "feat(svg): svgDataUri + swatchIconSvg helpers (shared, reused by gutter 4g)"
```

---

### Task 3: `TAG_SWATCHES` palette

**Files:**
- Modify: `src/core/tags.ts`
- Test: `src/core/tags.unit.test.ts`

- [ ] **Step 1: Write the failing test** — append this `describe` block to `src/core/tags.unit.test.ts`, and add `TAG_SWATCHES` to the existing import on line 2 (`import { parseTagPalette, NEW_TAG_LABEL, splitPickedTags, TAG_SWATCHES } from './tags';`):

```ts
describe('TAG_SWATCHES', () => {
  it('lists the eight named swatches in order with valid 6-digit hex colors', () => {
    expect(TAG_SWATCHES.map((s) => s.name)).toEqual([
      'Red', 'Amber', 'Yellow', 'Green', 'Teal', 'Blue', 'Indigo', 'Gray',
    ]);
    for (const s of TAG_SWATCHES) {
      expect(s.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/tags.unit.test.ts`
Expected: FAIL — `TAG_SWATCHES` is `undefined` / not exported.

- [ ] **Step 3: Write minimal implementation** — append to `src/core/tags.ts`:

```ts
/** The fixed set of named color swatches offered when creating a new tag. */
export const TAG_SWATCHES: readonly { name: string; hex: string }[] = [
  { name: 'Red', hex: '#E5484D' },
  { name: 'Amber', hex: '#F5A623' },
  { name: 'Yellow', hex: '#E5C100' },
  { name: 'Green', hex: '#3FB950' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Blue', hex: '#3794FF' },
  { name: 'Indigo', hex: '#5B5BD6' },
  { name: 'Gray', hex: '#8B949E' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project unit src/core/tags.unit.test.ts`
Expected: PASS (all `tags` tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tags.ts src/core/tags.unit.test.ts
git commit -m "feat(tags): TAG_SWATCHES fixed 8-color palette (TODO #1)"
```

---

### Task 4: `promptNewTag()` shared host helper + de-duplicate 3 call sites

> **Note on testing:** `tagPalette.ts` imports `vscode`, so it is not unit-testable in the Vitest `node` project (no `vscode` module). Verification for this task is `npm run check-types` (it compiles, types line up) plus the unit suite staying green. The pure pieces it composes (`TAG_SWATCHES`, `swatchIconSvg`) are already covered by Tasks 2–3.

**Files:**
- Modify: `src/web/tagPalette.ts`
- Modify: `src/web/createAnnotationCommand.ts`
- Modify: `src/web/extension.ts`

- [ ] **Step 1: Add `promptNewTag()` to `src/web/tagPalette.ts`.** Replace the file's current import line and add the helper. New top imports:

```ts
import * as vscode from 'vscode';
import { type Tag, parseTagPalette, TAG_SWATCHES } from '../core/tags';
import { swatchIconSvg } from '../shared/svgIcon';
```

Keep the existing `DEFAULT_COLOR`, `readTagPalette`, and `addTagToPalette` exactly as they are, and append:

```ts
const CUSTOM_HEX_LABEL = '$(paintcan) Custom hex…';

/**
 * Prompt for a new tag's name + color (visual swatch QuickPick, with a custom-hex
 * fallback), persist it to the palette, and return it. Returns undefined if the user
 * cancels at any step or leaves the name blank.
 */
export async function promptNewTag(): Promise<Tag | undefined> {
  const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
  if (!name || !name.trim()) {
    return undefined;
  }
  const items: vscode.QuickPickItem[] = [
    ...TAG_SWATCHES.map((s) => ({
      label: s.name,
      description: s.hex,
      iconPath: vscode.Uri.parse(swatchIconSvg(s.hex)),
    })),
    { label: CUSTOM_HEX_LABEL, alwaysShow: true },
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Tag color' });
  if (!picked) {
    return undefined;
  }
  let color: string;
  if (picked.label === CUSTOM_HEX_LABEL) {
    const hex = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: DEFAULT_COLOR });
    color = hex?.trim() || DEFAULT_COLOR;
  } else {
    color = picked.description ?? DEFAULT_COLOR;
  }
  const tag: Tag = { name: name.trim(), color };
  await addTagToPalette(tag.name, tag.color);
  return tag;
}
```

- [ ] **Step 2: Refactor call site 1 — `src/web/createAnnotationCommand.ts`.** Change the import on line 15 from `import { readTagPalette, addTagToPalette } from './tagPalette';` to:

```ts
import { readTagPalette, promptNewTag } from './tagPalette';
```

Then in `pickTags`, replace the `if (addNew) { ... }` block (currently the inline name+hex prompts that call `addTagToPalette`) with:

```ts
  const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
  if (addNew) {
    const tag = await promptNewTag();
    if (tag) {
      names.push(tag.name);
    }
  }
  return names;
```

- [ ] **Step 3: Refactor call sites 2 & 3 — `src/web/extension.ts`.** Change the import on line 7 from `import { readTagPalette, addTagToPalette } from './tagPalette';` to:

```ts
import { readTagPalette, promptNewTag } from './tagPalette';
```

In **both** `onBulkEditTags` and `onEditTags`, replace each occurrence of this block:

```ts
    if (addNew) {
      const name = await vscode.window.showInputBox({ prompt: 'New tag name' });
      if (name && name.trim()) {
        const color = await vscode.window.showInputBox({ prompt: 'Tag color (hex)', value: '#888888' });
        await addTagToPalette(name.trim(), color?.trim() || '#888888');
        names.push(name.trim());
      }
    }
```

with:

```ts
    if (addNew) {
      const tag = await promptNewTag();
      if (tag) {
        names.push(tag.name);
      }
    }
```

- [ ] **Step 4: Verify it compiles and the unit suite is green**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check passes (no "addTagToPalette is declared but never read" — it's still used inside `promptNewTag`); all unit + component tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/tagPalette.ts src/web/createAnnotationCommand.ts src/web/extension.ts
git commit -m "feat(tags): swatch QuickPick via shared promptNewTag, de-dup 3 call sites (TODO #1)"
```

---

### Task 5: Auto-contrast chip text in `GroupView.svelte`

**Files:**
- Modify: `src/webview/detail/GroupView.svelte`
- Test: `src/webview/detail/GroupView.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — append to the `describe('GroupView', ...)` block in `src/webview/detail/GroupView.svelte.test.ts`:

```ts
  it('uses readable (auto-contrast) text color on tag chips', () => {
    const dark = render(GroupView, { group: group(), palette: [{ name: 'security', color: '#c0392b' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(255, 255, 255)'); // dark bg → white
    dark.unmount();
    render(GroupView, { group: group(), palette: [{ name: 'security', color: '#ffff00' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(0, 0, 0)'); // light bg → black
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/GroupView.svelte.test.ts`
Expected: FAIL — `Unable to find an element by: [data-testid="tag-chip"]`.

- [ ] **Step 3: Implement.** In `src/webview/detail/GroupView.svelte`:

(a) Add the import after the existing `import { tagColor } from '../../core/sidebarState';` line:

```ts
  import { contrastColor } from '../../shared/color';
```

(b) Replace the tag chip markup (the `{#each group.tags ...}` span inside `.tags-row`) with:

```svelte
      {#each group.tags as tag (tag)}
        <span class="chip" data-testid="tag-chip" style="background:{tagColor(palette, tag)}; color:{contrastColor(tagColor(palette, tag))}">{tag}</span>
      {/each}
```

(c) In the `<style>` block, remove the now-overridden `color: #fff;` from the `.chip` rule so it reads:

```css
  .chip { font-size: 10.5px; padding: 1px 8px; border-radius: 9px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/detail/GroupView.svelte.test.ts`
Expected: PASS (all GroupView tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/detail/GroupView.svelte src/webview/detail/GroupView.svelte.test.ts
git commit -m "feat(detail): auto-contrast tag chip text in GroupView (TODO #7)"
```

---

### Task 6: Auto-contrast chip text in `GroupCard.svelte`

**Files:**
- Modify: `src/webview/sidebar/GroupCard.svelte`
- Test: `src/webview/sidebar/GroupCard.svelte.test.ts`

- [ ] **Step 1: Write the failing test** — append to the `describe('GroupCard', ...)` block in `src/webview/sidebar/GroupCard.svelte.test.ts`:

```ts
  it('uses readable (auto-contrast) text color on tag chips', () => {
    const dark = render(GroupCard, { group: group(), palette: [{ name: 'security', color: '#c0392b' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(255, 255, 255)'); // dark bg → white
    dark.unmount();
    render(GroupCard, { group: group(), palette: [{ name: 'security', color: '#ffff00' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(0, 0, 0)'); // light bg → black
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/GroupCard.svelte.test.ts`
Expected: FAIL — `Unable to find an element by: [data-testid="tag-chip"]`.

- [ ] **Step 3: Implement.** In `src/webview/sidebar/GroupCard.svelte`:

(a) Add the import after the existing `import { tagColor } from '../../core/sidebarState';` line:

```ts
  import { contrastColor } from '../../shared/color';
```

(b) Replace the tag chip markup (the `{#each group.tags ...}` span inside `.chips`) with:

```svelte
      {#each group.tags as tag (tag)}
        <span class="chip" data-testid="tag-chip" style="background:{tagColor(palette, tag)}; color:{contrastColor(tagColor(palette, tag))}">{tag}</span>
      {/each}
```

(c) In the `<style>` block, remove the now-overridden `color: #fff;` from the `.chip` rule so it reads:

```css
  .chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 9px;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npx vitest run --project component src/webview/sidebar/GroupCard.svelte.test.ts`
Expected: PASS (all GroupCard tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/sidebar/GroupCard.svelte src/webview/sidebar/GroupCard.svelte.test.ts
git commit -m "feat(sidebar): auto-contrast tag chip text in GroupCard (TODO #7)"
```

---

### Task 7: Full-suite gate

- [ ] **Step 1: Type-check + all unit/component tests**

Run: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH" && npm run check-types && npm run test:unit`
Expected: type-check clean; all Vitest unit + component tests PASS.

- [ ] **Step 2: Sanity-grep that the duplicated hex prompt is gone**

Run: `grep -rn "Tag color (hex)" src/`
Expected: exactly **one** match, inside `src/web/tagPalette.ts` (the `promptNewTag` custom-hex fallback). No matches remain in `createAnnotationCommand.ts` or `extension.ts`.

---

## Self-Review (done while writing — recorded for the executor)

- **Spec coverage:** TODO #1 (swatch picker w/ visual icons) → Tasks 2,3,4. TODO #7 (auto-contrast chips) → Tasks 1,5,6. Shared `svgIcon.ts` for 4g reuse → Task 2. ✓
- **Type consistency:** `promptNewTag(): Promise<Tag | undefined>` returns the core `Tag` type; call sites use `tag.name`. `contrastColor(hex): '#000000' | '#ffffff'` consumed via inline style. `swatchIconSvg(hex): string` → `vscode.Uri.parse(...)`. `QuickPickItem.iconPath` is valid in `@types/vscode` ^1.106. ✓
- **No placeholders:** every code step shows full content. ✓
- **`verbatimModuleSyntax`:** type-only imports use the `import { type X }` form (matches existing code). ✓
