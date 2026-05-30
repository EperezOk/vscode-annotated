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
