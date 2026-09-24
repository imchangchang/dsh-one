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

// 自有插件的两种来源：**插件包**（可装进官方 dsh profile 的官方格式包）与
// **平台专用插件**（只能用在我们 shell 里的件）。
//
// 共同点：打出来都是与官方包同格式的自注册 IIFE（banner/footer 包出
// `__ModuleLoader__.load({id, factory})`），externals 必须列全（运行时由主 bundle
// 的种子表满足，打进包会双重实例化）。

/** 浏览器侧 bundle 的种子表 externals（官方 Web 与我们的 bundle 提供同一张表）。 */
const SEED_EXTERNALS = ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store']

/**
 * 官方 combo 格式的外壳。banner 里的 id **必须**是插件 id：官方 client-modules
 * 用它当 loader 行名、`__DSH_BOOT__` 的行 id 与 combo 段的 id，三者错一个就静默不加载。
 */
const comboShell = (id) => ({
  banner: {
    js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
  },
  footer: { js: '\n\t\treturn module.exports;\n\t}\n});\n' },
})

await fsp.rm('dist/assembly', { recursive: true, force: true })

// ── 1) 插件包（#73）：packages/* 里声明了 `dsh.client` 的包 ───────────────────
// 每个包产两样东西，都落回包内——包清单的 `files` 只发这两样 + cordis.patch.yml，
// 所以 `npm pack` / `pnpm add` 拿到的是自包含的包：
//   lib/client.js —— 浏览器侧 bundle（官方 combo 格式）；
//   lib/index.js  —— 宿主半（ESM 单文件），官方 loader 的行模块。
// 再把 lib/client.js **拷进** dist/assembly/plugins/<包名>/client.js：VS Code 侧
// mirror 伺服的还是这个路径，于是装配侧一行没改，两端吃的是同一份产物。
// 包清单即唯一事实源（entry、externals、id 全从它读），新增插件不必改 build.mjs。
for (const dir of (await fsp.readdir('packages')).sort()) {
  const pkgDir = path.join('packages', dir)
  const manifest = JSON.parse(await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf8'))
  const client = manifest.dsh?.client
  if (client === undefined) continue
  const id = manifest.name
  await fsp.mkdir(path.join(pkgDir, 'lib'), { recursive: true })
  await esbuild.build({
    entryPoints: [path.join(pkgDir, 'src', 'client.ts')],
    outfile: path.join(pkgDir, 'lib', 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: client.external ?? SEED_EXTERNALS,
    ...comboShell(id),
    logLevel: 'warning',
  })
  await esbuild.build({
    entryPoints: [path.join(pkgDir, 'src', 'index.ts')],
    outfile: path.join(pkgDir, 'lib', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['@deepseek-ai/cordis'],
    logLevel: 'warning',
  })
  const pluginDir = path.join('dist', 'assembly', 'plugins', id)
  await fsp.mkdir(pluginDir, { recursive: true })
  await fsp.copyFile(path.join(pkgDir, 'lib', 'client.js'), path.join(pluginDir, 'client.js'))
  console.log(`packaged plugin -> ${pkgDir}/lib/client.js + ${pluginDir}/client.js`)
}

// ── 2) 平台专用插件：只住在这个 shell 里的框与宿主协调件（`vscode-*`）────────
// 它们无法移植（要么渲染我们自己的外框，要么调 VS Code 宿主），所以不进 packages/、
// 不发 npm 包，照旧直接打成 dist/assembly/plugins/<id>/client.js。
// - @dsh-one/vscode-chat-ui-layout：chat 树 frame（对话区，#64）
// - @dsh-one/vscode-sidebar-ui-layout：sidebar 树 frame（侧栏位，#70）
// - @dsh-one/vscode-settings-ui-layout：settings 树 frame（设置独立成页，#70）
// - @dsh-one/vscode-plugins-ui-layout：plugins 树 frame（官方插件页独立成页，#247）
// - @dsh-one/vscode-theme-follow：主题跟随（三树共用，#70）
// - @dsh-one/vscode-settings-gear：侧栏设置入口 shadow（sidebar 树，#70）
// id 与 src/ui/assembly/wireFilter.ts 的常量保持一致。
const VSCODE_PLUGINS = [
  { id: '@dsh-one/vscode-chat-ui-layout', entry: 'src/ui/assembly/shell/clientEntry.ts' },
  { id: '@dsh-one/vscode-sidebar-ui-layout', entry: 'src/ui/assembly/shell/sidebarFrameEntry.ts' },
  {
    id: '@dsh-one/vscode-settings-ui-layout',
    entry: 'src/ui/assembly/shell/settingsLayoutPlugin.ts',
    // 设置行动用官方 Button 原语（与齿轮同款 require 源，种子表满足）。
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  { id: '@dsh-one/vscode-theme-follow', entry: 'src/ui/assembly/shell/themeFollowPlugin.ts' },
  {
    // #247：官方那个「插件」全局面板在 VS Code 侧的独立编辑器页（plugins 树 frame）。
    // 只要种子表那几个外部件（与 chat / sidebar 两个 frame 同源）。
    id: '@dsh-one/vscode-plugins-ui-layout',
    entry: 'src/ui/assembly/shell/pluginsLayoutPlugin.ts',
  },
  { id: '@dsh-one/vscode-session-bridge', entry: 'src/ui/assembly/shell/sessionBridgePlugin.ts' },
  { id: '@dsh-one/vscode-session-boot', entry: 'src/ui/assembly/shell/sessionBootPlugin.ts' },
  {
    id: '@dsh-one/vscode-settings-gear',
    entry: 'src/ui/assembly/shell/settingsGearPlugin.ts',
    // 齿轮图标件走官方种子表（ui-settings-general 同款 require 源）。
    externals: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
]
for (const plugin of VSCODE_PLUGINS) {
  const pluginDir = path.join('dist', 'assembly', 'plugins', plugin.id)
  await fsp.mkdir(pluginDir, { recursive: true })
  await esbuild.build({
    entryPoints: [plugin.entry],
    outfile: path.join(pluginDir, 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: [...SEED_EXTERNALS, ...(plugin.externals ?? [])],
    ...comboShell(plugin.id),
    logLevel: 'warning',
  })
  console.log(`assembled vscode plugin -> ${pluginDir}/client.js`)
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
