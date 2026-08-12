# vscode-annotated — agent working agreement

Project-specific guidance for AI agents working in this repo.

## Workflow preferences

- **Pipelining (speed-up):** to save latency you MAY overlap a sub-plan's **review** with the
  **next** sub-plan's **implementation** — but ONLY when the next sub-plan is *independent* of the
  one under review: **disjoint files AND no logical/interface dependency** on it. Reviews are
  read-only, so they can always overlap safely. Stay **strictly sequential** when sub-plans share
  files or one builds on another (e.g. a model/format change that later sub-plans consume) — there
  the review gate must pass before building on it. **Never run two implementers writing the same
  branch at once** (git index races); if a review turns up required fixes, apply them before — or
  file-isolated from — any concurrent next-sub-plan work. When unsure, stay sequential.

## Build & test

- Tiers: `npm run test:unit` (Vitest unit + Svelte components), `npm run test:integration`
  (`@vscode/test-web` Mocha-in-browser), `npm run test:e2e` (Playwright against web VSCode),
  `npm test` (type-check + all tiers). Integration/e2e download/serve a VSCode web build (network).
- This is a **web-compatible** extension: no Node built-ins in `src/` (`fs`/`path`/etc.) — use
  `vscode.workspace.fs` and `vscode.Uri.joinPath`. Pure logic lives in `src/shared` + `src/core`
  (no `vscode` import); the thin VSCode layer is in `src/web`; webviews (Svelte) in `src/webview`.

## Docs

- Design spec: `docs/superpowers/specs/`. Phased implementation plans: `docs/superpowers/plans/`.
