import esbuild from 'esbuild'
import { LAZY_LANGS } from './src/pure/highlightLang.ts'

// 语法高亮的懒加载资源（dist/shiki/*）：不进 webview 主包，出现滚入视口的代码块
// 时才由 dist/chatWebview.js 动态插 <script> 拉起。内核（shiki core + JS 正则
// 引擎 + css-variables 主题 + 3 个常驻语言）一个文件，另外 23 个语言包各一个
// 文件、只挂语法定义到 window.__DSH_SHIKI_LANGS__。产物是纯数据/第三方代码，
// 不需要可读性，统一压缩（内核约 350KB，语言包 5KB–600KB）。
const shikiAssets = [
  {
    entryPoints: ['src/ui/chat/shikiCore.ts'],
    outfile: 'dist/shiki/core.js',
  },
  ...LAZY_LANGS.map((id) => ({
    stdin: {
      contents: `import grammar from 'shiki/langs/${id}.mjs'\n;(window.__DSH_SHIKI_LANGS__ || (window.__DSH_SHIKI_LANGS__ = {}))[${JSON.stringify(id)}] = grammar.default ?? grammar\n`,
      resolveDir: import.meta.dirname,
      loader: 'js',
    },
    outfile: `dist/shiki/lang-${id}.js`,
  })),
]

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
    jsx: 'automatic',
    jsxImportSource: 'preact',
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
  ...shikiAssets.map((asset) =>
    esbuild.build({
      ...asset,
      bundle: true,
      minify: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      sourcemap: false,
      logLevel: 'warning',
    }),
  ),
])

if (results.some((r) => r.warnings.length > 0)) {
  console.error('esbuild finished with warnings')
  process.exitCode = 1
} else {
  console.log(
    `built dist/extension.js + dist/chatWebview.js + dist/sessionsWebview.js + dist/spawnDsh.js + dist/shiki/{core.js, ${LAZY_LANGS.length} 个语言包}`,
  )
}
