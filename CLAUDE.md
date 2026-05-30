# vscode-annotated — agent working agreement

Project-specific guidance for AI agents working in this repo.

## Workflow preferences

- **Plan execution:** always use the **superpowers:subagent-driven-development** approach to
  execute implementation plans — a fresh subagent per task, with spec + code-quality review
  between tasks. Don't ask which execution mode to use; default to subagent-driven.
- **Git branches:** manage branches as you see fit to keep work moving — create feature
  branches, fast-forward / merge into `main` at sensible checkpoints. There is **no remote**
  for now, so never push or open PRs. Only surface a branch/merge decision if there's a genuine
  blocker.

## Build & test

- Tests need **Node ≥20.19** (Vite 8 / Vitest 4). The machine default is 20.15.1 (too old).
  Prefix node/npm/npx commands with: `export PATH="/opt/homebrew/opt/node@25/bin:$PATH"`
- Tiers: `npm run test:unit` (Vitest unit + Svelte components), `npm run test:integration`
  (`@vscode/test-web` Mocha-in-browser), `npm run test:e2e` (Playwright against web VSCode),
  `npm test` (type-check + all tiers). Integration/e2e download/serve a VSCode web build (network).
- This is a **web-compatible** extension: no Node built-ins in `src/` (`fs`/`path`/etc.) — use
  `vscode.workspace.fs` and `vscode.Uri.joinPath`. Pure logic lives in `src/shared` + `src/core`
  (no `vscode` import); the thin VSCode layer is in `src/web`; webviews (Svelte) in `src/webview`.

## Docs

- Design spec: `docs/superpowers/specs/`. Phased implementation plans: `docs/superpowers/plans/`.
- The project is built in phases (0 → 1a → 1b → … ), each plan with bite-sized TDD tasks.
