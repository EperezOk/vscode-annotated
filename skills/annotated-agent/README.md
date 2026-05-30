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
