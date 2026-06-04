# vscode-annotated — agent working agreement

Project-specific guidance for AI agents working in this repo.

## Workflow preferences

- **Plan execution:** always use the **superpowers:subagent-driven-development** approach to
  execute implementation plans — a fresh subagent per task, with spec + code-quality review
  between tasks. Don't ask which execution mode to use; default to subagent-driven.
- **Git branches:** manage branches as you see fit to keep work moving — create feature
  branches, fast-forward / merge into `main` at sensible checkpoints. The remote is `origin`
  (<https://github.com/EperezOk/vscode-annotated>), but **never push automatically — the user
  decides when to push**. Prepare commits (and tags) locally and leave `git push` to the user;
  no PRs unless explicitly asked. Only surface a branch/merge decision if there's a genuine
  blocker.
- **Keep going without asking:** do all sub-plans of a phase on a **single branch** (e.g.
  `phase-2`), and proceed through them — and across phases — **autonomously**. Do NOT pause to
  ask permission at sub-plan or phase boundaries; just continue (write the next plan, execute it
  subagent-driven, review, repeat). Report progress at milestones and merge to `main` when a
  phase is complete, but don't wait for a go-ahead. Only stop for a genuine blocker, an ambiguity
  that truly prevents progress, or when the user interjects.
- **Pipelining (speed-up):** to save latency you MAY overlap a sub-plan's **review** with the
  **next** sub-plan's **implementation** — but ONLY when the next sub-plan is *independent* of the
  one under review: **disjoint files AND no logical/interface dependency** on it. Reviews are
  read-only, so they can always overlap safely. Stay **strictly sequential** when sub-plans share
  files or one builds on another (e.g. a model/format change that later sub-plans consume) — there
  the review gate must pass before building on it. **Never run two implementers writing the same
  branch at once** (git index races); if a review turns up required fixes, apply them before — or
  file-isolated from — any concurrent next-sub-plan work. When unsure, stay sequential.

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
