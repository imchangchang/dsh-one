/**
 * 装配页诊断探针（#64 真窗遥测）：仅 webview 激活——`window.acquireVsCodeApi`
 * 存在才挂探针并把日志 postMessage 给外壳；浏览器/实验室环境探针早退、
 * 零行为变化（保持「装配页零 acquireVsCodeApi 依赖、普通浏览器可开」的约束：
 * 页面绝不主动要求 VS Code API，只是「有就用」）。
 *
 * 覆盖：console.error/warn 包装 + window.onerror/unhandledrejection、键盘
 * （keydown/keyup/compositionstart）与点击的 capture 探针（各前 20 次，
 * 带 target/elementFromPoint 摘要）、transport 桥埋点（openStream 建连/
 * 关闭/首帧、fetch 改写非 2xx）。键盘与点击共享计数器（合计 20 条后停，
 * 防刷屏）。
 *
 * 诊断用途：定位真窗「composer 无法输入 / 控制缺席」两症状（实验室六条件
 * 不可复现）。定位后保留（轻量）或再议。安全：消息只含 level/text 且截断
 * 500 字符，绝不携带 cookie/token；外壳侧再过 Logger.sanitize 脱敏。
 */

/** 探针内联脚本：pageHtml 以普通 <script nonce> 注入（head 最前，包住早期错误）。
 * 统一获取点：VS Code 的 acquireVsCodeApi 全页只允许调一次——实例挂到
 * 共享全局，自有插件（设置齿轮等 postMessage 方）一律经
 * globalThis.__DSH_ONE_VSCODE__ 复用，不得自行再 acquire（二次调用 throw）。 */
export function assemblyProbeJs(): string {
  return `(() => {
  if (typeof window.acquireVsCodeApi !== "function") return
  var vscode = window.acquireVsCodeApi()
  globalThis.__DSH_ONE_VSCODE__ = vscode
  var send = function (level, text) {
    try {
      vscode.postMessage({ type: "assembly:log", level: level, text: String(text).slice(0, 500) })
    } catch (ignored) {}
  }
  globalThis.__DSH_ONE_PROBE__ = { log: send }
  function wrapConsole(level) {
    var orig = console[level].bind(console)
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments)
      orig.apply(console, args)
      send(level, args.map(String).join(" "))
    }
  }
  wrapConsole("error")
  wrapConsole("warn")
  window.addEventListener("error", function (e) {
    send("error", "onerror: " + e.message + " @" + String(e.filename).slice(-60) + ":" + e.lineno)
  })
  window.addEventListener("unhandledrejection", function (e) {
    send("error", "unhandledrejection: " + String(e.reason).slice(0, 200))
  })
  var keyCount = 0
  function keyProbe(kind, e) {
    if (keyCount >= 20) return
    keyCount++
    var t = e.target
    var cls = t && t.className ? String(t.className).slice(0, 40) : ""
    send("info", kind + " " + String(e.key || "") + " target=" + (t ? t.tagName : "?") + "." + cls)
    if (keyCount === 20) send("info", "key probe: 20 cap reached, stopping")
  }
  document.addEventListener("keydown", function (e) { keyProbe("keydown", e) }, true)
  document.addEventListener("keyup", function (e) { keyProbe("keyup", e) }, true)
  document.addEventListener("compositionstart", function () {
    if (keyCount >= 20) return
    keyCount++
    send("info", "compositionstart (IME)")
  }, true)
  var clickCount = 0
  document.addEventListener("click", function (e) {
    if (clickCount >= 20) return
    clickCount++
    var hit = document.elementFromPoint(e.clientX, e.clientY)
    var cls = hit && hit.className ? String(hit.className).slice(0, 40) : ""
    send("info", "click (" + Math.round(e.clientX) + "," + Math.round(e.clientY) + ") hit=" + (hit ? hit.tagName : "?") + "." + cls)
    if (clickCount === 20) send("info", "click probe: 20 cap reached, stopping")
  }, true)
  send("info", "probe active (webview)")
})()`
}
