import esbuild from 'esbuild'
import * as fsp from 'node:fs/promises'
import { ASSEMBLY_PACKAGE_NAMES, generateAssemblyManifest } from './scripts/gen-assembly-manifest.mjs'
import path from 'node:path'

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
  // Session-list webview frontend (sidebar dshOne.chat view; sessions only).
  esbuild.build({
    entryPoints: ['src/ui/sessionsWebview.ts'],
    bundle: true,
    outfile: 'dist/sessionsWebview.js',
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
  console.log('built dist/extension.js + dist/chatWebview.js + dist/sessionsWebview.js + dist/spawnDsh.js')
}

// cordis 装配资产（#64）：vsce 不打包 devDependencies，官方前端 dist 与 20 个
// 自托管插件 bundle 必须在构建期落进 dist/assembly（assemblyMirror 伺服、
// assemblyView 读 manifest）。manifest 重新生成并与提交进 src/ui/assembly 的
// 清单比对——漂移直接构建失败（防「改了包忘了再生清单」）。
const manifest = await generateAssemblyManifest()
const manifestJson = JSON.stringify(manifest, null, 2) + '\n'
const committedManifest = await fsp.readFile('src/ui/assembly/manifest.json', 'utf8')
if (committedManifest !== manifestJson) {
  console.error('src/ui/assembly/manifest.json 与 node_modules 现状不一致，请运行 node scripts/gen-assembly-manifest.mjs')
  process.exit(1)
}
const FRONTEND_DIST = 'node_modules/@deepseek-ai/dsh-web-frontend/dist'
await fsp.rm('dist/assembly', { recursive: true, force: true })
await fsp.mkdir('dist/assembly/plugins', { recursive: true })
// 前端 dist 整体拷贝，index.html 除外（装配页由外壳生成，不伺服官方入口页）。
await fsp.cp(FRONTEND_DIST, 'dist/assembly/frontend', {
  recursive: true,
  filter: (src) => path.basename(src) !== 'index.html',
})
for (const name of ASSEMBLY_PACKAGE_NAMES) {
  const to = path.join('dist/assembly/plugins', name)
  await fsp.mkdir(to, { recursive: true })
  await fsp.copyFile(path.join('node_modules/@deepseek-ai', name, 'lib', 'client.js'), path.join(to, 'client.js'))
}
await fsp.writeFile('dist/assembly/manifest.json', manifestJson)
console.log(`assembled dist/assembly/ (pin=${manifest.version}, plugins=${ASSEMBLY_PACKAGE_NAMES.length})`)
