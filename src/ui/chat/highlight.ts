/**
 * 代码块语法高亮的懒加载外壳（编进 chatWebview.js 主包的那部分，很薄）。
 *
 * 三层懒：① 高亮内核与语言包都不在主包里，出现第一个「滚入视口」的代码块才去
 * 拉 dist/shiki/*.js；② 语言包按语言各拉各的（23 个，官方同款）；③ 只有真的
 * 滚进视口的代码块才着色——聊天里翻历史时大量代码块根本不进视口，白着色就是
 * 白花解析时间。
 *
 * 资源用 <script> 注入而不是动态 import：webview 的 CSP 是 nonce 制
 * （script-src 'nonce-…'），动态 import 不带 nonce 会被拦；注入的 <script> 带
 * 上页面自己的 nonce 就能过。加载失败（离线/资源缺失/宿主差异）一律静默降级成
 * 纯文本，不影响代码块的复制与折叠。
 */
import { canonicalLang, isLazyLang, langAssetName } from '../../pure/highlightLang.ts'
import type { ShikiApi } from './shikiCore.ts'

/** 主 bundle 所在的 dist/ 目录（shiki 资源与它同级）。currentScript 只在脚本
 *  求值期有值，所以这里必须在模块体里取。 */
const assetDir = (() => {
  const el = document.currentScript as HTMLScriptElement | null
  return el?.src ? new URL('.', el.src).href : ''
})()

/** 页面自身的 CSP nonce（VS Code webview 需要；harness 无 CSP 时为空）。 */
function scriptNonce(): string {
  for (const el of Array.from(document.querySelectorAll('script'))) {
    const nonce = (el as HTMLScriptElement).nonce
    if (nonce) return nonce
  }
  return ''
}

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('script')
    const nonce = scriptNonce()
    if (nonce) el.nonce = nonce
    el.src = src
    el.onload = () => resolve(true)
    el.onerror = () => resolve(false)
    document.head.appendChild(el)
  })
}

let corePromise: Promise<ShikiApi | null> | null = null

function loadCore(): Promise<ShikiApi | null> {
  corePromise ??= (async () => {
    if (!assetDir) return null
    if (!window.__DSH_SHIKI__ && !(await loadScript(new URL('shiki/core.js', assetDir).href))) return null
    return window.__DSH_SHIKI__?.create() ?? null
  })()
  return corePromise
}

const langPromises = new Map<string, Promise<boolean>>()

/** 拉一个懒加载语言包（同一语言只拉一次，失败也不重试）。 */
function loadLang(id: string): Promise<boolean> {
  let promise = langPromises.get(id)
  if (promise === undefined) {
    promise = (async () => {
      if (window.__DSH_SHIKI_LANGS__?.[id] !== undefined) return true
      if (!(await loadScript(new URL(`shiki/${langAssetName(id)}`, assetDir).href))) return false
      return window.__DSH_SHIKI_LANGS__?.[id] !== undefined
    })()
    langPromises.set(id, promise)
  }
  return promise
}

/** 高亮结果缓存（同语言同文本复用）：流式渲染会反复重建代码块 DOM，
 *  缓存让重复文本不必重复分词。 */
const htmlCache = new Map<string, string>()
const HTML_CACHE_MAX = 60

function cacheHighlight(key: string, html: string): void {
  if (htmlCache.size >= HTML_CACHE_MAX) {
    const oldest = htmlCache.keys().next().value
    if (oldest !== undefined) htmlCache.delete(oldest)
  }
  htmlCache.set(key, html)
}

/* ---- 视口激活：滚进视口才着色（对齐官方 dsh web 的 visibility activator） ---- */

let observer: IntersectionObserver | null = null
const activators = new Map<Element, () => void>()

function activate(el: Element): void {
  const run = activators.get(el)
  if (!run) return
  activators.delete(el)
  observer?.unobserve(el)
  if (activators.size === 0 && observer) {
    observer.disconnect()
    observer = null
  }
  run()
}

function observeOnce(el: Element, run: () => void): void {
  if (typeof IntersectionObserver === 'undefined') {
    run()
    return
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        activate(entry.target)
        continue
      }
      // 已从 DOM 摘除的登记项（渲染换掉了整块）就地清掉，别一直占着闭包。
      // 只在观察器回调里判摘除：渲染中新建的元素在被 append 之前是「暂时
      // 游离」的，那时候清会把还没上屏的块一并清掉、永远等不到 intersecting。
      if (!entry.target.isConnected) {
        activators.delete(entry.target)
        observer?.unobserve(entry.target)
      }
    }
  })
  activators.set(el, run)
  observer.observe(el)
}

async function applyHighlight(code: Element, id: string, text: string, lang: string): Promise<void> {
  const api = await loadCore()
  if (!api) return
  if (!api.hasLanguage(id)) {
    if (!isLazyLang(id)) return
    if (!(await loadLang(id))) return
    const grammar = window.__DSH_SHIKI_LANGS__?.[id]
    if (grammar === undefined) return
    api.loadLanguage(id, grammar)
  }
  const key = `${id}\u0000${text}`
  let html = htmlCache.get(key)
  if (html === undefined) {
    html = api.highlight(text, id) ?? ''
    cacheHighlight(key, html)
  }
  if (!html || !code.isConnected) return
  code.innerHTML = html
  // 行内 span 的样式来自 --shiki-token-*，颜色在 CSS 里（浅/深两套）。
  code.parentElement?.setAttribute('data-hl', lang)
}

/**
 * 登记一个代码块：语言可识别时，等它滚入视口再着色。
 * 语言未登记 / 文本为空 / 资源加载失败都保持现状（纯文本）。
 */
export function highlightCodeBlock(code: Element, lang: string | undefined, text: string): void {
  const id = canonicalLang(lang)
  if (!id || text.length === 0) return
  observeOnce(code, () => {
    void applyHighlight(code, id, text, lang ?? id).catch(() => {
      // 静默降级：着色失败不影响代码块本身的可读/可复制。
    })
  })
}
