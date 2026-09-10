/**
 * 代码块语法高亮内核（懒加载资源，**不进 chatWebview.js 主包**）。
 *
 * 单独打包成 dist/shiki/core.js：只有出现「已滚入视口且语言可识别」的代码块时
 * 才由 webview 侧动态插 <script> 拉起（scripts/build 里的一条独立 esbuild 输出）。
 * 内核 = shiki core（同步构造）+ 纯 JS 正则引擎（webview 的 CSP 禁 wasm/eval，
 * oniguruma 引擎用不了）+ css-variables 主题（token 颜色走 --shiki-token-* 变量，
 * 由宿主 CSS 定义，与官方 dsh web 的 theme 包一致）+ 3 个常驻语言。
 *
 * 懒加载语言包由 build 生成成 dist/shiki/lang-<id>.js：每个文件把官方语法定义
 * 挂到 window.__DSH_SHIKI_LANGS__[id]，这里用 loadLanguageSync 现场登记。
 */
import { createCssVariablesTheme, createHighlighterCoreSync, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import typescript from 'shiki/langs/typescript.mjs'
import shellscript from 'shiki/langs/shellscript.mjs'
import json from 'shiki/langs/json.mjs'

/** 高亮内核对外暴露的能力（webview 侧经 window.__DSH_SHIKI__ 调用）。 */
export interface ShikiApi {
  /** 该语言是否已经可用（常驻语言构造即就绪）。 */
  hasLanguage: (lang: string) => boolean
  /** 登记一个懒加载语言包的语法定义。 */
  loadLanguage: (lang: string, grammar: unknown) => void
  /** 代码文本 → 高亮后的行 HTML（<span class="line">…</span>，样式走 CSS 变量）。 */
  highlight: (code: string, lang: string) => string | null
}

/** 官方同款参数：css-variables 主题 + forgiving 的 JS 正则引擎。 */
function createHighlighter(): HighlighterCore {
  const theme = createCssVariablesTheme({
    name: 'css-variables',
    variablePrefix: '--shiki-',
    fontStyle: true,
  })
  const engine = createJavaScriptRegexEngine({ forgiving: true })
  return createHighlighterCoreSync({
    themes: [theme],
    langs: [typescript, shellscript, json],
    engine,
  })
}

export function createShikiApi(): ShikiApi {
  const highlighter = createHighlighter()
  return {
    hasLanguage: (lang) => highlighter.getLoadedLanguages().includes(lang as never),
    loadLanguage: (lang, grammar) => {
      highlighter.loadLanguageSync(grammar as never)
    },
    highlight: (code, lang) => {
      if (!highlighter.getLoadedLanguages().includes(lang as never)) return null
      const html = highlighter.codeToHtml(code, { lang, theme: 'css-variables' })
      // 只取 <code> 里的行内容：外层 <pre> 是我们自己的（折叠/复制按钮都挂在
      // 它外面），背景与前景色由 .md-code pre 的 CSS 变量给。
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return doc.querySelector('code')?.innerHTML ?? null
    },
  }
}

declare global {
  interface Window {
    /** 内核脚本就绪后挂上的高亮入口（webview 侧 highlight.ts 读取）。 */
    __DSH_SHIKI__?: { create: () => ShikiApi }
    /** 懒加载语言包登记表：语言 id → 官方语法定义。 */
    __DSH_SHIKI_LANGS__?: Record<string, unknown>
  }
}

window.__DSH_SHIKI__ = { create: createShikiApi }
