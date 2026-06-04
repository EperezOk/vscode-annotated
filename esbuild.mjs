import esbuild from 'esbuild';
import esbuildSvelte from 'esbuild-svelte';
import { sveltePreprocess } from 'svelte-preprocess';

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

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: {
    'sidebar/main': 'src/webview/sidebar/main.ts',
    'detail/main': 'src/webview/detail/main.ts',
  },
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

// The test-suite bundle is only needed by test/dev builds — keep it out of production output.
const configs = production
  ? [extensionConfig, webviewConfig]
  : [extensionConfig, webviewConfig, testSuiteConfig];

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
