# annotated skill

A Claude Code skill that lets an AI agent participate in a
[`vscode-annotated`](https://github.com/EperezOk/vscode-annotated) workspace by reading/writing
the `.annotations/` files directly — surf groups & threads, reply, create groups/annotations, and update config. Markdown
only, node-free shell recipes, distinct agent identity, additive write scope.

Contents:
- `SKILL.md` — entry point (when-to-use, identity, hard rules)
- `references/data-contract.md` — exact on-disk schema + node-free recipes
- `references/operations.md` — step-by-step recipes per operation

## Install

With a skill manager (recommended):

```bash
# GitHub CLI (gh ≥ 2.93)
gh skill install EperezOk/vscode-annotated annotated

# skills.sh
npx skills add EperezOk/vscode-annotated
```

Both discover the skill via the standard `skills/*/SKILL.md` layout and install the full bundle
(including `references/`) into your agent's skills directory.

Or from a local clone of this repo:

```bash
npx skills add /path/to/vscode-annotated --skill annotated
```

The canonical source lives in the `vscode-annotated` repo and is kept in lockstep with the data
contract by `src/shared/skillContract.unit.test.ts` (run via `npm run test:unit`).
