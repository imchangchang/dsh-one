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

// cordis 装配（#64 blocklist 模式，#70 起三棵树）：面板打开时运行时才从网关取
// wire/资产，官方前端 dist 与插件包全部经 mirror 反代直引网关——构建期只剩自有
// frame 插件落盘（vsce 体积回落）。各插件打成与官方包同格式的自注册 IIFE
// （banner/footer 包出 __ModuleLoader__.load({id, factory})）；externals 必须
// 列全（运行时由主 bundle 种子表满足，打进包会双重实例化）。
// - @dsh-one/vscode-shell：chat 树 frame（对话区，#64）
// - @dsh-one/vscode-sidebar-shell：sidebar 树 frame（侧栏位，#70）
// - @dsh-one/vscode-settings-shell：settings 树 frame（设置独立成页，#70）
// - @dsh-one/vscode-theme-follow：主题跟随（三树共用，#70）
// - @dsh-one/vscode-settings-gear：侧栏设置入口影子（sidebar 树，#70）
// id 与 src/ui/assembly/wireFilter.ts 的常量保持一致。
const SHELL_PLUGINS = [
  { id: '@dsh-one/vscode-shell', entry: 'src/ui/assembly/shell/clientEntry.ts' },
  { id: '@dsh-one/vscode-sidebar-shell', entry: 'src/ui/assembly/shell/sidebarFrameEntry.ts' },
  {
    id: '@dsh-one/vscode-settings-shell',
    entry: 'src/ui/assembly/shell/settingsFramePlugin.ts',
    // 设置行动用官方 Button 原语（与齿轮同款 require 源，种子表满足）。
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  { id: '@dsh-one/vscode-theme-follow', entry: 'src/ui/assembly/shell/themeFollowPlugin.ts' },
  { id: '@dsh-one/vscode-session-bridge', entry: 'src/ui/assembly/shell/sessionBridgePlugin.ts' },
  { id: '@dsh-one/vscode-session-boot', entry: 'src/ui/assembly/shell/sessionBootPlugin.ts' },
  {
    // #84：导出动作走宿主能力口（+ 官方网关 RPC），零 VS Code 耦合 → dsh-*。
    id: '@dsh-one/dsh-session-export',
    entry: 'src/ui/assembly/shell/sessionExportPlugin.ts',
    // 导出胶囊用官方 Button/下载图标原语（种子表满足）。
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  {
    id: '@dsh-one/vscode-settings-gear',
    entry: 'src/ui/assembly/shell/settingsGearPlugin.ts',
    // 齿轮图标件走官方种子表（ui-settings-general 同款 require 源）。
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  {
    // #65 批 1 / #83：消息正文的 commit hash 卡片——数据走宿主能力口、扫描与
    // 委托挂官方对话区容器，零 VS Code 耦合 → dsh-*（图标件 + 官方 writeClipboard）。
    id: '@dsh-one/dsh-git-card',
    entry: 'src/ui/assembly/shell/gitCardPlugin.ts',
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  {
    // #65 批 1 / #83：行内码右键「复制这段」（官方 Menu 原语 + 官方 writeClipboard；
    // 委托挂官方对话区容器）→ dsh-*。
    id: '@dsh-one/dsh-context-menu',
    entry: 'src/ui/assembly/shell/contextMenuPlugin.ts',
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  {
    // #65 批 1 / #83：清空件（官方 composer 座位 + InputActions + 键位监听挂
    // 官方对话区容器）→ dsh-*。
    id: '@dsh-one/dsh-composer-clear',
    entry: 'src/ui/assembly/shell/composerClearPlugin.ts',
  },
  {
    // #65 批 2：侧栏工作区/会话树的 shadow 件（官方 sidebar.workspaces 座位 +
    // 官方服务）。零宿主耦合（无 hostCall/acquireVsCodeApi）→ 按 AGENTS.md 铁律
    // 「自有插件命名分两类」命名 dsh-*（官方 web 侧也能用，见 #83）。
    id: '@dsh-one/dsh-workspace-tree',
    entry: 'src/ui/assembly/shell/workspaceTreeEntry.ts',
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
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
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', ...(plugin.externals ?? [])],
    banner: {
      js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(plugin.id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    },
    footer: { js: '\n\t\treturn module.exports;\n\t}\n});\n' },
    logLevel: 'warning',
  })
  console.log(`assembled shell plugin -> ${pluginDir}/client.js`)
}

// 宿主半插件（#84）：`packages/dsh-host-capabilities` 是**可安装的官方格式包**
// （`dsh.bundle.patch` + 包主入口即宿主半），所以它的 lib/index.js 必须是与官方包
// 同形的 **ESM 单文件**，由 esbuild 打成自包含（官方包留 external，运行时从 dsh
// 安装目录/profile 解析）。**不压缩**：官方网关按方法形参名取值（SRC 回退），压
// 缩改了形参名端点就认不出（test/hostCapabilities.test.ts 有断言盯着）。
// 这条构建与上面三棵树的客户端 bundle 是两回事：那些跑在页面里，这条跑在 dsh
// 宿主进程里。
await esbuild.build({
  entryPoints: ['packages/dsh-host-capabilities/src/index.ts'],
  outfile: 'packages/dsh-host-capabilities/lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol'],
  logLevel: 'warning',
})
console.log('built host half -> packages/dsh-host-capabilities/lib/index.js')
