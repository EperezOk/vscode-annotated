# Logo & marketplace branding — design

**Date:** 2026-06-03
**Status:** approved (visual decisions validated interactively via brainstorm companion)

## Goal

Give the Annotated extension a real identity: a marketplace icon (PNG, required by the
VS Code Marketplace) and a matching monochrome activity-bar icon (SVG), replacing the
generic placeholder `media/icon.svg`.

## Validated visual decisions

Explored interactively (motif → composition → palette → sidebar derivation). Final choices:

- **Motif:** hybrid of "margin note" and "comment bubble" — code lines with one
  highlighted line, annotated by a comment bubble.
- **Composition:** bubble above, its tail diving down-left onto the highlighted line
  (the tail *is* the anchor).
- **Palette ("sticky-note amber", flat — no gradients):**
  - Tile: `#1b1f2e` (navy, rounded corners `rx=22` at 96 viewBox)
  - Bubble: `#ffc94d` (amber)
  - Highlighted line: `#4da3ff` (blue)
  - Other code lines: `#5e6678` (gray)
  - Bubble text lines: `#1b1f2e` (tile color)
- **Sidebar icon:** "bubble + anchor line" — outline-style bubble with two text lines
  plus the anchored code line beneath; single color, matching VS Code's native
  outline icon weight.

## Assets

### `media/logo.svg` — master logo (source of truth)

Exact approved markup (element order matters — code lines overlap the tail tip):

```svg
<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
  <rect width="96" height="96" rx="22" fill="#1b1f2e"/>
  <rect x="34" y="17" width="47" height="33" rx="9" fill="#ffc94d"/>
  <path d="M51 50 L41.5 61.5 Q40 63.5 43 62.5 L65 50 Z" fill="#ffc94d"/>
  <line x1="15" y1="27" x2="29" y2="27" stroke="#5e6678" stroke-width="5" stroke-linecap="round"/>
  <line x1="15" y1="39" x2="27" y2="39" stroke="#5e6678" stroke-width="5" stroke-linecap="round"/>
  <line x1="15" y1="61" x2="47" y2="61" stroke="#4da3ff" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="15" y1="73" x2="35" y2="73" stroke="#5e6678" stroke-width="5" stroke-linecap="round"/>
  <line x1="43" y1="29" x2="72" y2="29" stroke="#1b1f2e" stroke-width="4.5" stroke-linecap="round"/>
  <line x1="43" y1="38.5" x2="64" y2="38.5" stroke="#1b1f2e" stroke-width="4.5" stroke-linecap="round"/>
</svg>
```

### `media/logo.png` — marketplace icon

- 256×256 px export of `media/logo.svg` (Marketplace requires PNG; rejects SVG icons).
- Corners outside the rounded tile must be **transparent**.
- Committed to the repo; regenerable via `npm run build:logo` (see below).

### `media/icon.svg` — activity bar icon (replaces placeholder)

Exact approved markup:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="1.5 1.5 21 21" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 11.5a2 2 0 0 1-2 2h-7l-4 4v-4h-1a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>
  <line x1="8" y1="7" x2="16" y2="7"/>
  <line x1="8" y1="10" x2="13" y2="10"/>
  <line x1="4" y1="21" x2="14" y2="21"/>
</svg>
```

The `viewBox` is cropped to `1.5 1.5 21 21` (instead of `0 0 24 24`) so the artwork fills
the 24×24 render box like VS Code's native activity-bar icons — a ~14% uniform scale-up
that brings the effective stroke to ~2px (still native weight). Found during the manual
visual check: the un-cropped version rendered visibly smaller than neighboring icons.

Both view containers (`annotated` activity bar + `annotated-detail` secondary sidebar)
already point at `media/icon.svg`, so they pick this up with no manifest change.

## PNG render script

`scripts/render-logo.mjs` (new), wired as `"build:logo": "node scripts/render-logo.mjs"`:

- Uses Playwright's chromium — already a devDependency for e2e; **no new packages**.
  Import: `import { chromium } from '@playwright/test'` (verified to export `chromium`;
  it is the declared devDependency, unlike transitive `playwright-core`).
- Loads `media/logo.svg` rendered at 256×256 in a page with a transparent background,
  screenshots with `omitBackground: true`, writes `media/logo.png`.
- One-shot script, exits non-zero on failure. Node ≥20.19 (same as tests).

## `package.json` changes

```json
"icon": "media/logo.png",
"galleryBanner": { "color": "#1b1f2e", "theme": "dark" }
```

`galleryBanner` tints the marketplace page header to match the tile.

## Acceptance criteria

1. `media/logo.svg` and `media/icon.svg` match the markup above byte-for-byte
   (modulo trailing newline).
2. `media/logo.png` exists, is exactly 256×256, has transparent corners, and
   `npm run build:logo` regenerates a valid replacement (pixel-exact reproducibility
   across chromium versions is NOT required).
3. `package.json` contains the `icon` and `galleryBanner` fields.
4. `npx vsce package` succeeds and the `.vsix` contains `media/logo.png`
   (proves the Marketplace accepts the manifest + the asset ships).
5. Local gate stays green: `npm run check-types` + `npm run test:unit`.
6. Manual visual check: `npm start`, activity bar shows the new bubble+anchor icon.

## Out of scope

- README branding/banner imagery, screenshots, demo GIFs.
- Light-theme variant of the marketplace tile (single PNG serves both surfaces; the
  navy tile was validated on white and dark backgrounds).
- Any change to the webview UIs.
