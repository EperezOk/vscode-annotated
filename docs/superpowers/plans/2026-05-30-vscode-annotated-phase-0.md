# vscode-annotated — Phase 0: Scaffold & Test Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a web-compatible VSCode extension that contributes one "hello" Svelte webview in the Activity Bar, with all three test tiers (Vitest unit + component, `@vscode/test-web` integration, Playwright E2E) green.

**Architecture:** The extension runs in the **web extension host** (browser/web-worker). esbuild produces three bundles in one config: the extension host (`platform: 'browser'`, CJS), the Svelte webview (IIFE + external CSS via `esbuild-svelte`), and the integration test suite. Webviews mount Svelte 5 components and talk to the host over a typed message protocol (skeleton only in Phase 0). Tests are layered: pure logic + components in Vitest, host integration in `@vscode/test-web` (Mocha-in-browser), and a UI smoke in Playwright driving real web VSCode.

**Tech Stack:** TypeScript 5.9, Svelte 5, esbuild 0.28 + esbuild-svelte, Vitest 4 + @testing-library/svelte 5, @vscode/test-web 0.0.80, Playwright 1.60. Target `engines.vscode ^1.100.0`.

> **Conventions for the executor:** This repo commits with a trailer. Append to every commit message:
> ```
> Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
> ```
> The commit examples below omit it for brevity — add it when you commit. Work happens on the `annotated` branch (already checked out).

---

## File Structure (created across this phase)

```
package.json                          # web-extension manifest + deps + scripts
tsconfig.json                         # TS config for .ts sources (esbuild strips types; tsc only checks)
svelte.config.js                      # vitePreprocess() so vitest handles <script lang="ts">
esbuild.mjs                           # builds extension + webview + test-suite bundles
vitest.config.ts                      # two projects: node unit + jsdom component
vitest-setup.ts                       # @testing-library/jest-dom matchers
playwright.config.ts                  # boots vscode-test-web serve mode, runs e2e/
.vscodeignore                         # keeps src/tests out of the .vsix
media/icon.svg                        # activity-bar icon
src/
  svelte-shims.d.ts                   # ambient `*.svelte` module decl so tsc resolves component imports
  shared/
    protocol.ts                       # message types + parseMessage() guard (host ⇄ webview contract)
    protocol.unit.test.ts             # Vitest (node)
  web/
    extension.ts                      # activate(): registers sidebar provider + annotated.ping command
    sidebarViewProvider.ts            # WebviewViewProvider for the hello sidebar (CSP + nonce HTML)
    test/suite/
      index.ts                        # Mocha run() entry (bundled to dist/web/test/suite/index.js)
      extension.test.ts               # integration: extension activates, command/view registered
  webview/sidebar/
    App.svelte                        # hello component (data-testid for E2E)
    App.svelte.test.ts                # Vitest (jsdom) component test
    main.ts                           # mount(App) into the webview document
e2e/
  hello.spec.ts                       # Playwright smoke: open view, assert hello text in webview iframe
.github/workflows/ci.yml              # runs all tiers
```

**Build outputs:** `dist/web/extension.js`, `dist/web/test/suite/index.js`, `dist/webview/sidebar/main.js` + `main.css`.

---

## Task 1: Project manifest, TS config, extension stub, dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.vscodeignore`
- Create: `media/icon.svg`
- Create: `src/web/extension.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vscode-annotated",
  "displayName": "Annotated",
  "description": "Annotate a codebase with grouped, shareable Markdown annotations.",
  "version": "0.0.0",
  "publisher": "openzeppelin",
  "license": "MIT",
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "activationEvents": [],
  "browser": "./dist/web/extension.js",
  "contributes": {
    "commands": [
      { "command": "annotated.ping", "title": "Annotated: Ping" }
    ]
  },
  "scripts": {
    "compile": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "package": "node esbuild.mjs --production",
    "check-types": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:integration": "npm run compile && vscode-test-web --browserType=chromium --extensionDevelopmentPath=. --extensionTestsPath=dist/web/test/suite/index.js --headless --quality=stable",
    "serve:web": "vscode-test-web --browserType=none --extensionDevelopmentPath=. --port=3000",
    "test:e2e": "playwright test",
    "test": "npm run check-types && npm run test:unit && npm run test:integration && npm run test:e2e",
    "start": "vscode-test-web --browserType=chromium --extensionDevelopmentPath=.",
    "vscode:prepublish": "npm run package"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@sveltejs/vite-plugin-svelte": "^7.1.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/svelte": "^5.3.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/mocha": "^10.0.7",
    "@types/vscode": "^1.100.0",
    "@vscode/test-web": "^0.0.80",
    "esbuild": "^0.28.0",
    "esbuild-svelte": "^0.9.5",
    "jsdom": "^29.1.1",
    "mocha": "^11.7.6",
    "svelte": "^5.56.0",
    "svelte-preprocess": "^6.0.5",
    "typescript": "^5.9.2",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["mocha"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "e2e", "**/*.svelte.test.ts"]
}
```

> `*.svelte.test.ts` is excluded from `tsc` because it imports `.svelte` files that `tsc` cannot resolve; those are type-checked by the Svelte/Vite toolchain at test time.

- [ ] **Step 3: Create `.vscodeignore`**

```
.vscode/**
.github/**
src/**
e2e/**
node_modules/**
**/*.test.ts
**/*.map
esbuild.mjs
vitest.config.ts
vitest-setup.ts
playwright.config.ts
svelte.config.js
tsconfig.json
docs/**
.superpowers/**
```

- [ ] **Step 4: Create `media/icon.svg`** (placeholder activity-bar icon)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 4h16v12H7l-3 3z"/>
  <line x1="8" y1="9" x2="16" y2="9"/>
  <line x1="8" y1="12" x2="13" y2="12"/>
</svg>
```

- [ ] **Step 5: Create `src/web/extension.ts`** (minimal stub — registration comes in Task 5)

```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
  // Contributions are registered in later tasks.
}

export function deactivate(): void {
  // No-op.
}
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes without error; `node_modules/` and `package-lock.json` created.

- [ ] **Step 7: Verify type-check passes**

Run: `npm run check-types`
Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .vscodeignore media/icon.svg src/web/extension.ts
git commit -m "chore: scaffold web extension manifest, tsconfig, deps"
```

---

## Task 2: esbuild build for the extension host bundle

**Files:**
- Create: `esbuild.mjs`

- [ ] **Step 1: Create `esbuild.mjs`** (extension config only for now; webview + test configs are appended in later tasks)

```js
import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/web/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/web/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  define: { global: 'globalThis' },
  logLevel: 'info',
};

// Later tasks push more configs (webview, test suite) into this array.
const configs = [extensionConfig];

async function run() {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('[esbuild] watching…');
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the build**

Run: `npm run compile`
Expected: `[esbuild]` log lines, exit code 0.

- [ ] **Step 3: Verify the bundle exists**

Run: `test -f dist/web/extension.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add esbuild.mjs
git commit -m "build: esbuild bundling for the web extension host"
```

---

## Task 3: Vitest harness + shared message protocol (Tier 1, node)

This proves the node-environment unit test tier and creates the host⇄webview message contract skeleton.

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest-setup.ts`
- Create: `svelte.config.js`
- Create: `src/shared/protocol.unit.test.ts`
- Create: `src/shared/protocol.ts`

- [ ] **Step 1: Create `svelte.config.js`** (needed by the Vite Svelte plugin for `lang="ts"`)

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 2: Create `vitest-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Create `vitest.config.ts`** (two projects: node unit, jsdom component)

```ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.unit.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          setupFiles: ['./vitest-setup.ts'],
          include: ['src/**/*.svelte.test.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 4: Write the failing test** — `src/shared/protocol.unit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseMessage } from './protocol';

describe('parseMessage', () => {
  it('accepts a valid webview->host ready message', () => {
    expect(parseMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts a valid ping message with a string value', () => {
    expect(parseMessage({ type: 'ping', value: 'hi' })).toEqual({ type: 'ping', value: 'hi' });
  });

  it('rejects an unknown type', () => {
    expect(parseMessage({ type: 'nope' })).toBeNull();
  });

  it('rejects a ping without a string value', () => {
    expect(parseMessage({ type: 'ping', value: 42 })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage('ready')).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run src/shared/protocol.unit.test.ts`
Expected: FAIL — cannot resolve `./protocol` (module not found).

- [ ] **Step 6: Implement `src/shared/protocol.ts`**

```ts
// Typed message contract between the extension host and webviews.
// Phase 0 is a skeleton; later phases extend these unions.

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'ping'; value: string };

export type HostToWebview =
  | { type: 'init' }
  | { type: 'pong'; value: string };

export type Message = WebviewToHost | HostToWebview;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Validates an untrusted value as a known Message; returns it narrowed, or null. */
export function parseMessage(raw: unknown): Message | null {
  if (!isObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'init':
      return { type: 'init' };
    case 'ping':
      return typeof raw.value === 'string' ? { type: 'ping', value: raw.value } : null;
    case 'pong':
      return typeof raw.value === 'string' ? { type: 'pong', value: raw.value } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/shared/protocol.unit.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 8: Verify the full unit script works**

Run: `npm run test:unit`
Expected: PASS — the `unit` project runs `protocol.unit.test.ts` green (the `component` project finds no files yet, which is fine).

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts vitest-setup.ts svelte.config.js src/shared/protocol.ts src/shared/protocol.unit.test.ts
git commit -m "test: vitest harness + shared message protocol with parseMessage"
```

---

## Task 4: Hello Svelte webview component (Tier 1, jsdom component)

This proves the jsdom component test tier.

**Files:**
- Create: `src/webview/sidebar/App.svelte.test.ts`
- Create: `src/webview/sidebar/App.svelte`
- Create: `src/webview/sidebar/main.ts`

- [ ] **Step 1: Write the failing test** — `src/webview/sidebar/App.svelte.test.ts`

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import App from './App.svelte';

describe('App.svelte', () => {
  it('renders the default greeting', () => {
    render(App);
    expect(screen.getByTestId('hello')).toHaveTextContent('Annotated is alive');
  });

  it('renders a custom name', () => {
    render(App, { name: 'Reviewer' });
    expect(screen.getByTestId('hello')).toHaveTextContent('Hello, Reviewer');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/webview/sidebar/App.svelte.test.ts`
Expected: FAIL — cannot resolve `./App.svelte`.

- [ ] **Step 3: Implement `src/webview/sidebar/App.svelte`**

```svelte
<script lang="ts">
  let { name = '' }: { name?: string } = $props();
</script>

<main data-testid="hello">
  {#if name}
    <h1>Hello, {name}</h1>
  {:else}
    <h1>Annotated is alive</h1>
  {/if}
</main>

<style>
  main {
    padding: 0.75rem;
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground, #ccc);
  }
  h1 {
    font-size: 1rem;
    font-weight: 600;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/webview/sidebar/App.svelte.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Add the ambient `*.svelte` module shim `src/svelte-shims.d.ts`**

`tsc` (used by `check-types`) cannot resolve `.svelte` imports on its own. This shim lets `main.ts`'s `import App from './App.svelte'` type-check. (Vite/esbuild resolve `.svelte` natively and ignore this.)

```ts
declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
}
```

- [ ] **Step 6: Create the mount entry `src/webview/sidebar/main.ts`** (Svelte 5 `mount` API)

```ts
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.body });

export default app;
```

- [ ] **Step 7: Verify the whole unit+component suite is green**

Run: `npm run test:unit`
Expected: PASS — both `unit` and `component` projects pass.

- [ ] **Step 8: Verify type-check still passes (shim resolves the `.svelte` import)**

Run: `npm run check-types`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/webview/sidebar/App.svelte src/webview/sidebar/App.svelte.test.ts src/webview/sidebar/main.ts src/svelte-shims.d.ts
git commit -m "feat: hello Svelte webview component + component test"
```

---

## Task 5: Bundle the webview + register the sidebar WebviewView

**Files:**
- Modify: `esbuild.mjs`
- Modify: `package.json` (add `viewsContainers` + `views` contributions)
- Create: `src/web/sidebarViewProvider.ts`
- Modify: `src/web/extension.ts`

- [ ] **Step 1: Add the webview bundle to `esbuild.mjs`**

Add this config object above the `const configs = [...]` line:

```js
import esbuildSvelte from 'esbuild-svelte';
import { sveltePreprocess } from 'svelte-preprocess';
```

(Place the two imports at the top of the file, next to `import esbuild from 'esbuild';`.)

Then add the webview config and include it in `configs`:

```js
/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: { 'sidebar/main': 'src/webview/sidebar/main.ts' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outdir: 'dist/webview',
  mainFields: ['svelte', 'browser', 'module', 'main'],
  conditions: ['svelte', 'browser'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  plugins: [
    esbuildSvelte({
      preprocess: sveltePreprocess(),
      compilerOptions: { dev: !production },
    }),
  ],
};
```

Change the configs line to:

```js
const configs = [extensionConfig, webviewConfig];
```

- [ ] **Step 2: Run the build and verify webview output**

Run: `npm run compile && test -f dist/webview/sidebar/main.js && test -f dist/webview/sidebar/main.css && echo OK`
Expected: `OK`

- [ ] **Step 3: Add view contributions to `package.json`**

Replace the `"contributes"` block with:

```json
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "annotated", "title": "Annotated", "icon": "media/icon.svg" }
      ]
    },
    "views": {
      "annotated": [
        { "type": "webview", "id": "annotated.sidebar", "name": "Annotations" }
      ]
    },
    "commands": [
      { "command": "annotated.ping", "title": "Annotated: Ping" }
    ]
  },
```

- [ ] **Step 4: Create `src/web/sidebarViewProvider.ts`**

```ts
import * as vscode from 'vscode';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'annotated.sidebar';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
    const nonce = getNonce();
    const csp =
      `default-src 'none'; ` +
      `style-src ${webview.cspSource}; ` +
      `script-src 'nonce-${nonce}'; ` +
      `font-src ${webview.cspSource}; ` +
      `img-src ${webview.cspSource} https: data:;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Annotations</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

- [ ] **Step 5: Wire registration in `src/web/extension.ts`**

```ts
import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.ping', () => 'pong'),
  );
}

export function deactivate(): void {
  // No-op.
}
```

- [ ] **Step 6: Verify build + type-check**

Run: `npm run check-types && npm run compile`
Expected: exit 0; `dist/web/extension.js` and `dist/webview/sidebar/main.js` present.

- [ ] **Step 7: Manual smoke (optional but recommended)**

Run: `npm start`
Expected: a browser opens web VSCode; clicking the **Annotated** icon in the Activity Bar shows the "Annotated is alive" view. Close the browser when done. (Automated coverage of this lands in Tasks 6–7.)

- [ ] **Step 8: Commit**

```bash
git add esbuild.mjs package.json src/web/sidebarViewProvider.ts src/web/extension.ts
git commit -m "feat: register hello sidebar webview view + bundle it"
```

---

## Task 6: Integration test tier (`@vscode/test-web` + Mocha)

**Files:**
- Modify: `esbuild.mjs` (add the test-suite bundle)
- Create: `src/web/test/suite/index.ts`
- Create: `src/web/test/suite/extension.test.ts`

- [ ] **Step 1: Add the test-suite bundle to `esbuild.mjs`**

Add this config object above the `const configs = [...]` line:

```js
/** @type {import('esbuild').BuildOptions} */
const testSuiteConfig = {
  entryPoints: ['src/web/test/suite/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/web/test/suite/index.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: false,
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"test"' },
  logLevel: 'info',
};
```

Change the configs line to:

```js
const configs = [extensionConfig, webviewConfig, testSuiteConfig];
```

- [ ] **Step 2: Create the Mocha entry `src/web/test/suite/index.ts`**

> Note: the official sample uses webpack's `require.context` to auto-glob test files. esbuild has no such feature, so we set up Mocha first, then dynamically import each test file explicitly (after the `suite`/`test` globals exist).

> The global `mocha` (BrowserMocha) and the TDD globals `suite`/`test` are typed by `@types/mocha` (enabled via `"types": ["mocha"]` in `tsconfig.json`). The side-effect import below defines `mocha` at runtime.
>
> **Reporter:** use the object form `mocha.setup({ ui: 'tdd', reporter: 'spec' })`. The string shorthand `mocha.setup('tdd')` leaves Mocha on its default **HTML reporter**, which calls `document` APIs and throws `ReferenceError: document is not defined` in the web-worker extension host (there is no DOM). The `spec` reporter is DOM-free and writes to the console.

```ts
import 'mocha/mocha';

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({ ui: 'tdd', reporter: 'spec' });

    // Register suites AFTER mocha.setup so the tdd globals (suite/test) exist.
    import('./extension.test')
      .then(() => {
        try {
          mocha.run((failures) => {
            if (failures > 0) {
              reject(new Error(`${failures} test(s) failed.`));
            } else {
              resolve();
            }
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .catch(reject);
  });
}
```

- [ ] **Step 3: Write the integration test** — `src/web/test/suite/extension.test.ts`

> No `assert` import — the `assert` module needs Node typings/polyfills we deliberately avoid on a web target. A thrown error fails the Mocha test, which is all we need.

```ts
import * as vscode from 'vscode';

suite('Annotated web extension', () => {
  test('activates and registers the ping command', async () => {
    const ext = vscode.extensions.getExtension('openzeppelin.vscode-annotated');
    if (!ext) {
      throw new Error('extension not found by id openzeppelin.vscode-annotated');
    }
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.ping')) {
      throw new Error('annotated.ping should be registered');
    }
  });

  test('ping command returns pong', async () => {
    const result = await vscode.commands.executeCommand('annotated.ping');
    if (result !== 'pong') {
      throw new Error(`expected "pong", got ${String(result)}`);
    }
  });
});
```

- [ ] **Step 4: Build and run the integration tests (verify they pass)**

Run: `npm run test:integration`
Expected: esbuild compiles all three bundles, then `@vscode/test-web` launches headless Chromium, loads the extension, and Mocha reports `2 passing`. Exit code 0.

> If Chromium isn't present, `@vscode/test-web` downloads it on first run. First run may be slow.

- [ ] **Step 5: Commit**

```bash
git add esbuild.mjs src/web/test/suite/index.ts src/web/test/suite/extension.test.ts
git commit -m "test: @vscode/test-web integration tier (activation + command)"
```

---

## Task 7: E2E smoke tier (Playwright against web VSCode)

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/hello.spec.ts`

- [ ] **Step 1: Install the Playwright browser**

Run: `npx playwright install chromium`
Expected: Chromium downloaded (or "is already installed").

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run compile && npm run serve:web',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Write the E2E smoke test** — `e2e/hello.spec.ts`

```ts
import { test, expect } from '@playwright/test';

test('sidebar webview renders the hello message', async ({ page }) => {
  await page.goto('/');

  // Wait for the workbench to finish booting.
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open our Activity Bar container ("Annotated").
  await page
    .locator('.activitybar')
    .getByRole('tab', { name: /Annotated/i })
    .click();

  // Drill into the nested webview iframes: outer .webview -> inner #active-frame.
  const frame = page
    .locator('iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();

  await expect(frame.getByTestId('hello')).toHaveText(/Annotated is alive/, { timeout: 30_000 });
});
```

- [ ] **Step 4: Run the E2E test (verify it passes)**

Run: `npm run test:e2e`
Expected: Playwright boots `vscode-test-web` (compiling first), opens web VSCode, opens the Annotated view, and asserts the hello text inside the webview iframe. `1 passed`.

> Flakiness notes for the executor: web VSCode can take 30–60s to become interactive — the generous timeouts above cover it. The `iframe.webview` / `#active-frame` selectors are VSCode internals; if a VSCode version changes them, prefer asserting on our own `data-testid` (already present) and adjust the iframe chain. Keep `fullyParallel: false` (one shared VSCode instance).

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/hello.spec.ts
git commit -m "test: Playwright E2E smoke against web VSCode"
```

---

## Task 8: Aggregate test script + CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: Verify the aggregate `test` script runs all tiers**

Run: `npm test`
Expected: `check-types` → `test:unit` → `test:integration` → `test:e2e` all pass in sequence, exit 0.

> The `test` script was added in Task 1; this step confirms the full chain is green now that every tier exists.

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main, annotated]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run check-types
      - run: npm run test:unit
      - run: npx playwright install --with-deps chromium
      - run: npm run test:integration
      - run: npm run test:e2e
        env:
          CI: 'true'
```

- [ ] **Step 3: Create `README.md`**

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: run all test tiers; add README"
```

---

## Phase 0 Done — Definition of Done

- [ ] `npm run check-types` passes.
- [ ] `npm run test:unit` passes (node `unit` + jsdom `component` projects).
- [ ] `npm run test:integration` passes (`@vscode/test-web`, 2 Mocha tests).
- [ ] `npm run test:e2e` passes (Playwright sidebar smoke).
- [ ] `npm start` shows the "Annotated is alive" webview in the Activity Bar.
- [ ] All work committed on the `annotated` branch.

This establishes the foundation Phase 1 builds on: a web-compatible extension, the Svelte webview pipeline, the shared protocol module, and a green three-tier test harness. The Phase 1 plan (MVP core — storage, Create Annotation, sidebar cards, detail panels, navigate-to-code) will be written next, grounded in this scaffold.

## Phase 1 carry-over (from final review)

Non-blocking items surfaced during Phase 0 execution/review, to fold into Phase 1:

- **Wire the message protocol.** `protocol.ts` + `parseMessage` exist and are tested, but nothing calls them yet. Phase 1 establishes the `webview.postMessage` (webview→host) and `webviewView.webview.onDidReceiveMessage` (host) plumbing, with the canonical `parse → discriminate → handle` pattern on the host side.
- **Nonce → Web Crypto.** `getNonce()` in `sidebarViewProvider.ts` uses `Math.random()` (the VSCode-sample pattern). Switch to `crypto.getRandomValues` before real/untrusted content is rendered in webviews.
- **Replace the `name` test-scaffold prop** on `App.svelte` with real host-provided state.
- **Consolidate Svelte preprocessing.** Two preprocessors exist (`svelte-preprocess` for esbuild, `vitePreprocess` for Vitest). Standardize on one canonical config referenced by both toolchains as components grow.
- **Conditional CSS `<link>`.** The webview HTML always links `main.css`; if a future entry component has no `<style>`, esbuild-svelte emits no CSS → silent 404. Guard it (or guarantee a stylesheet).
- **Node engine requirement.** Vite 8 / Vitest 4 require Node ≥20.19. Pin/declare this (e.g. `engines.node`, `.nvmrc`) and reflect it in CI (the workflow currently uses Node 20 — bump to 20.19+/22).
- **CI ordering nit.** `npx playwright install --with-deps chromium` can move to just before `test:e2e` (it's not needed by the integration tier).
```
