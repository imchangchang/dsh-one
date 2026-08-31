import esbuild from 'esbuild'

const results = await Promise.all([
  // Extension host bundle.
  esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'warning',
  }),
  // Chat webview frontend bundle (runs in the browser context of the webview).
  esbuild.build({
    entryPoints: ['src/ui/chat/webview.ts'],
    bundle: true,
    outfile: 'dist/chatWebview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'warning',
  }),
  // Short-lived dsh launcher, spawned standalone by ServerManager so dsh gets
  // reparented to launchd and escapes the extension host's process tree.
  esbuild.build({
    entryPoints: ['src/server/spawnDsh.ts'],
    bundle: true,
    outfile: 'dist/spawnDsh.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: false,
    logLevel: 'warning',
  }),
])

if (results.some((r) => r.warnings.length > 0)) {
  console.error('esbuild finished with warnings')
  process.exitCode = 1
} else {
  console.log('built dist/extension.js + dist/chatWebview.js + dist/spawnDsh.js')
}
