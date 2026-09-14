import esbuild from 'esbuild'
import * as fsp from 'node:fs/promises'
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

// cordis 装配（#64，blocklist 模式）：面板打开时运行时才从网关取 wire/资产，
// 官方前端 dist 与插件包全部经 mirror 反代直引网关——构建期只剩自有 shell
// 插件落盘（vsce 体积回落）。shell 打成与官方包同格式的自注册 IIFE
// （banner/footer 包出 __ModuleLoader__.load({id, factory})）；externals 必须
// 列全（运行时由主 bundle 种子表满足，打进包会双重实例化）。
const SHELL_PLUGIN_ID = '@dsh-one/vscode-shell' // 与 src/ui/assembly/wireFilter.ts 保持一致
const SHELL_PLUGIN_DIR = path.join('dist', 'assembly', 'plugins', SHELL_PLUGIN_ID)
await fsp.rm('dist/assembly', { recursive: true, force: true })
await fsp.mkdir(SHELL_PLUGIN_DIR, { recursive: true })
await esbuild.build({
  entryPoints: ['src/ui/assembly/shell/clientEntry.ts'],
  outfile: path.join(SHELL_PLUGIN_DIR, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'],
  banner: {
    js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(SHELL_PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
  },
  footer: { js: '\n\t\treturn module.exports;\n\t}\n});\n' },
  logLevel: 'warning',
})
console.log(`assembled shell plugin -> ${SHELL_PLUGIN_DIR}/client.js`)
