import esbuild from 'esbuild'

const result = await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'warning',
})

if (result.warnings.length > 0) {
  console.error('esbuild finished with warnings')
  process.exitCode = 1
} else {
  console.log('built dist/extension.js')
}
