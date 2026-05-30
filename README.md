# vscode-annotated

A VSCode extension for annotating a codebase with grouped, shareable Markdown
annotations. See the design spec in `docs/superpowers/specs/`.

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
