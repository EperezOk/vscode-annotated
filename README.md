# vscode-annotated

A VSCode extension for annotating a codebase with grouped, shareable Markdown
annotations. See the design spec in `docs/superpowers/specs/`.

## Agent skill

`skills/annotated-agent/` is a Claude Code skill for AI agents to participate in an annotated
workspace (surf, reply, create, configure) by reading/writing `.annotations/` directly. Install
it with `gh skill install EperezOk/vscode-annotated annotated-agent` or
`npx skills add EperezOk/vscode-annotated`. See `skills/annotated-agent/README.md`.

## Development

```bash
npm install
npm run compile        # build extension + webview bundles
npm start              # launch in web VSCode (Chromium)
```

## Testing

```bash
npm run test:unit          # Vitest: pure logic (node) + Svelte components (jsdom)
npm run test:integration   # @vscode/test-web: extension host activation/commands
npm run test:e2e           # Playwright: UI smoke against web VSCode
npm test                   # all of the above + type-check
```
