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
  console.log('built dist/extension.js + dist/sessionsWebview.js + dist/spawnDsh.js')
}

// cordis 装配（#64 blocklist 模式，#70 起两棵树）：面板打开时运行时才从网关取
// wire/资产，官方前端 dist 与插件包全部经 mirror 反代直引网关——构建期只剩自有
// frame 插件落盘（vsce 体积回落）。两个插件打成与官方包同格式的自注册 IIFE
// （banner/footer 包出 __ModuleLoader__.load({id, factory})）；externals 必须
// 列全（运行时由主 bundle 种子表满足，打进包会双重实例化）。
// - @dsh-one/vscode-shell：chat 树 frame（对话区，#64）
// - @dsh-one/vscode-sidebar-shell：sidebar 树 frame（侧栏位，#70）
const SHELL_PLUGINS = [
  { id: '@dsh-one/vscode-shell', entry: 'src/ui/assembly/shell/clientEntry.ts' }, // 与 wireFilter.ts SHELL_PLUGIN_ID 保持一致
  { id: '@dsh-one/vscode-sidebar-shell', entry: 'src/ui/assembly/shell/sidebarFrameEntry.ts' }, // 与 wireFilter.ts SIDEBAR_SHELL_PLUGIN_ID 保持一致
]
await fsp.rm('dist/assembly', { recursive: true, force: true })
for (const plugin of SHELL_PLUGINS) {
  const pluginDir = path.join('dist', 'assembly', 'plugins', plugin.id)
  await fsp.mkdir(pluginDir, { recursive: true })
  await esbuild.build({
    entryPoints: [plugin.entry],
    outfile: path.join(pluginDir, 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'],
    banner: {
      js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(plugin.id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    },
    footer: { js: '\n\t\treturn module.exports;\n\t}\n});\n' },
    logLevel: 'warning',
  })
  console.log(`assembled shell plugin -> ${pluginDir}/client.js`)
}
