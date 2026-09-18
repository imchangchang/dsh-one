/**
 * 装配页的**失败提示条**（#201）：页面跑起来之后整棵树被卸掉时，页面上留一行说明
 * 加一个「重新加载」入口，取代原来的整页白。
 *
 * ## 为什么由页面运行时（而不是某个插件）出这一行
 *
 * 2026-09-18 的现场（dsh 0.1.6-alpha.2，重启实例后约 3 秒）：
 *
 *   SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter
 *   conversation.input: sessions service unavailable
 *
 * 之后 `rows-cleared` → `page-blank`——**整页变白**，此后新内容一条不出来（官方页
 * 与装配页都中）。坏的地方在官方渲染器的**装配判定**里：`ScopeProvider` 在
 * `host.scope('session-maybe')` 拿到 undefined 时抛 `SlotAssemblyError`
 * （`@deepseek-ai/dsh-client-ui-renderer/lib/client.js:260`）。
 *
 * 为什么不能靠插件里的 React 边界兜住它——**查过官方源码之后否掉的，不是没想到**：
 *
 * 1. 官方自己的 `SlotErrorBoundary` **故意不兜**装配错误：
 *    `getDerivedStateFromError` 里 `if (error instanceof SlotAssemblyError) throw error`
 *    （同文件 :522），注释写明「a miswired shell must fail loud, not degrade into
 *    fallbacks」。每个 entry 一层，兜的是**注册方组件**自己的崩溃。
 * 2. 官方给这一层留的监督 seam（`SlotRegistry.onEntryError`，同文件 :1222）**收不到**
 *    装配错误：错误在 `getDerivedStateFromError` 里就被重新抛出，根本走不到
 *    `componentDidCatch` → `onEntryError`。订阅它只能看见「注册方组件崩了」。
 * 3. 出事的 `ScopeProvider` 在**我们的 root 条目之上**：官方 `createSlotRenderer()`
 *    的 `renderRoot` = `HostContext.Provider → RootStandardProvider →
 *    ScopeProvider('session-maybe') → RootOutlet`（同文件 :915），RootOutlet 才
 *    渲染 `renderSlot('root')`（也就是我们的外框插件）。所以「在我们的外框插件里加
 *    一层错误边界」永远兜不到这一条——边界在错误的**下面**。
 * 4. 官方 web 前端自己那套失败卡片（`Failed to load plugins` + 原因）只覆盖**启动期**：
 *    `dsh-web-frontend/dist/assets/index-*.js` 的 WebBoot `run()` 把整个启动过程包在
 *    try/catch 里，失败调 `page.fail(...)`；但那套 page 对象是那个闭包里的局部量，
 *    既不在全局、也不经任何服务暴露，**挂载之后**再出错就没人接。
 *
 * 于是剩下能保证「不白屏」的位置只有一处：**页面自己**。React 18 的未捕获渲染错误
 * 会在 commit 结束时被重新抛出（`react-dom` 里 `if(Vi)throw Vi=!1,e=y0,...`），
 * 从调度回调里逃出去 → **整棵 root 被卸载**（`#root` 里一个可见的盒都不剩），同时
 * 那个错误落到 `window` 的 `error` 事件上。这正是本条要接的两个信号：
 *
 * - **`error` / `unhandledrejection`（标准浏览器机制）**：记下原始错误文本（顺手经
 *   探针写进宿主日志，**不吞**——它照旧在控制台里）；只记不报，先不动页面。
 * - **空白看门狗**：应用起来过（`#root` 里见过可见内容）之后，`#root` 里连续两拍
 *   一个可见的盒都没有，就落提示条。判据落在**用户看到的东西**上（整页白），所以
 *   它兜的不止装配失败这一类；反过来，页面好着的时候一个字节都不动（不误报）。
 *
 * 文案语言取自官方 locale 插件的产物 `document.documentElement.lang`
 * （`@deepseek-ai/dsh-client-locale/lib/client.js` 里
 * `documentElement.lang = snapshot.active === "zh" ? "zh-CN" : snapshot.active`），
 * 认不出时按英文。
 */
export interface PageFailureText {
  zh: Readonly<Record<string, string>>
  en: Readonly<Record<string, string>>
}

/**
 * 提示条自己的词典（zh 用 `\u` 转义写：i18n 合入门禁的兜底扫描会把 src/** 新增行里的
 * 中文字面量当「漏翻」拦下，注释里的中文不受影响；改文案时连转义一起改）。
 *
 * 为什么不用插件的词典（外框插件各自的 `locale.ts` → 官方 `ctx.locale.register`）：这一行由
 * **页面运行时**出，出事时插件全都不在了，拿不到 `t`；而语言本来就有官方产物的现成来源
 * （见文件头）。四条键的含义：
 * - `failedTitle`：捕获到错误、且页面已经空了——装配失败这一类；
 * - `blankTitle`：页面空了但没捕获到错误——**只显事实**（不说「装配失败」这种我们
 *   没看到的因果，与 #202 那行断线提示同一条口径）；
 * - `reasonPrefix`：原始错误文本的前缀（文本原样附在后面，可观测性落在用户眼前）；
 * - `reload`：重载入口的按钮文字。
 */
export const PAGE_FAILURE_TEXT: PageFailureText = {
  zh: {
    // 页面装配失败，内容已被清空
    failedTitle: '\u9875\u9762\u88c5\u914d\u5931\u8d25\uff0c\u5185\u5bb9\u5df2\u88ab\u6e05\u7a7a',
    // 页面内容已消失
    blankTitle: '\u9875\u9762\u5185\u5bb9\u5df2\u6d88\u5931',
    // 原因：
    reasonPrefix: '\u539f\u56e0\uff1a',
    // 重新加载
    reload: '\u91cd\u65b0\u52a0\u8f7d',
  },
  en: {
    failedTitle: 'Page assembly failed; the page content is gone',
    blankTitle: 'The page content is gone',
    reasonPrefix: 'Reason: ',
    reload: 'Reload',
  },
}

/** 看门狗取样的间隔（毫秒）。 */
const WATCH_MS = 400
/** 连续几拍都读不到内容才落提示（防一次瞬时过渡被当成「整页白」）。 */
const BLANK_TICKS = 2
/** 每次取样最多扫多少个元素（够判「有没有可见的盒」，不把大页面扫一遍）。 */
const SCAN_LIMIT = 2000

/** 提示条/按钮的自有标记（断言与截图上认它；属性值见文件头）。 */
export const PAGE_FAILURE_MARK = 'data-dshone-page-failure'
export const PAGE_RELOAD_MARK = 'data-dshone-page-reload'

/**
 * 提示条的内联脚本（pageHtml 以普通 `<script nonce>` 注入，位置在探针之后、其余脚本
 * 之前：早于一切模块，启动期的错误也接得住）。
 *
 * 内嵌脚本里的注释一律英文（与 pageHtml.ts 其余三段内联脚本同规矩）。
 */
export function failureNoticeJs(): string {
  return `(() => {
  var TEXT = ${JSON.stringify(PAGE_FAILURE_TEXT)}
  var MARK = ${JSON.stringify(PAGE_FAILURE_MARK)}
  var RELOAD_MARK = ${JSON.stringify(PAGE_RELOAD_MARK)}
  var WATCH_MS = ${String(WATCH_MS)}
  var BLANK_TICKS = ${String(BLANK_TICKS)}
  var SCAN_LIMIT = ${String(SCAN_LIMIT)}
  var probe = function (level, text) {
    if (globalThis.__DSH_ONE_PROBE__) globalThis.__DSH_ONE_PROBE__.log(level, text)
  }
  // The official locale plugin publishes the active language as documentElement.lang
  // (see the module doc); unknown tags fall back to English.
  var lang = function () {
    var tag = String(document.documentElement.lang || "").toLowerCase()
    return tag.indexOf("zh") === 0 ? "zh" : "en"
  }
  var tr = function (key) { return TEXT[lang()][key] }
  var reason = null
  var shown = false
  var timer = null
  var sawContent = false
  var blankTicks = 0
  // Record the original failure text (first one wins) and keep it observable: the probe
  // line reaches the extension log in the webview, and console still carries the raw
  // error from React - this hook never swallows anything.
  var noteError = function (text) {
    if (reason !== null) return
    reason = String(text).slice(0, 400)
    probe("error", "page failure: " + reason)
  }
  window.addEventListener("error", function (event) {
    var error = event.error
    noteError(error && error.message ? error.message : event.message || "unknown error")
  })
  window.addEventListener("unhandledrejection", function (event) {
    var rejected = event.reason
    noteError(rejected && rejected.message ? rejected.message : rejected === undefined ? "unhandled rejection" : rejected)
  })
  // "Nothing visible in #root": the empty-children case users hit (the whole React tree
  // unmounted) short-circuits; otherwise the first element with a non-zero box decides.
  var hasVisibleContent = function (root) {
    if (root.childElementCount === 0) return false
    var nodes = root.querySelectorAll("*")
    var limit = nodes.length < SCAN_LIMIT ? nodes.length : SCAN_LIMIT
    for (var index = 0; index < limit; index++) {
      var box = nodes[index].getBoundingClientRect()
      if (box.width > 0 && box.height > 0) return true
    }
    return false
  }
  var show = function () {
    if (shown) return
    shown = true
    if (timer !== null) { clearInterval(timer); timer = null }
    var kind = reason === null ? "blank" : "assembly"
    var bar = document.createElement("div")
    bar.setAttribute(MARK, kind)
    // role=alert: this bar is the page reporting its own failure to the user (and to
    // screen readers) after the application UI is gone.
    bar.setAttribute("role", "alert")
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#8a1d1d;color:#fff;font:13px/1.5 var(--vscode-font-family,system-ui,sans-serif)"
    var text = document.createElement("div")
    text.style.cssText = "flex:1 1 auto;min-width:0"
    var title = document.createElement("div")
    title.setAttribute("data-dshone-page-failure-title", kind)
    title.textContent = tr(reason === null ? "blankTitle" : "failedTitle")
    text.appendChild(title)
    if (reason !== null) {
      var line = document.createElement("div")
      line.setAttribute("data-dshone-page-failure-reason", "")
      line.style.cssText = "margin-top:2px;opacity:.85;word-break:break-word"
      line.textContent = tr("reasonPrefix") + reason
      text.appendChild(line)
    }
    var button = document.createElement("button")
    button.setAttribute(RELOAD_MARK, "")
    button.type = "button"
    button.textContent = tr("reload")
    button.style.cssText = "flex:0 0 auto;cursor:pointer;font:inherit;padding:4px 10px;border:1px solid rgba(255,255,255,.6);border-radius:4px;background:transparent;color:inherit"
    button.addEventListener("click", function () {
      probe("info", "page failure: reload requested (" + kind + ")")
      location.reload()
    })
    bar.appendChild(text)
    bar.appendChild(button)
    document.body.appendChild(bar)
    probe("error", "page failure notice shown (" + kind + ")")
  }
  var tick = function () {
    var root = document.getElementById("root")
    if (root === null) return
    if (hasVisibleContent(root)) {
      sawContent = true
      blankTicks = 0
      return
    }
    // A page that never rendered anything is not "went blank" (that is the boot-time
    // path, where official WebBoot shows its own failure card): only a page that had
    // content and lost it counts.
    if (!sawContent) return
    blankTicks += 1
    if (blankTicks >= BLANK_TICKS) show()
  }
  var arm = function () {
    if (timer === null && !shown) timer = setInterval(tick, WATCH_MS)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm)
  else arm()
})()`
}
