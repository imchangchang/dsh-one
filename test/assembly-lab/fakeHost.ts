/**
 * 假宿主（#78 装配实验室）：`page.addInitScript` 注入的页面侧脚本，在装配页任何
 * 脚本之前执行，模拟 VS Code webview 宿主的最小面：
 *
 * - `acquireVsCodeApi()`：与 VS Code 同语义——**全页只允许调一次**，第二次直接
 *   throw（装配页的硬约束：统一获取点 `__DSH_ONE_VSCODE__` 之外的插件不得自行
 *   acquire，见 ui/assembly/probe.ts / hostSdk.ts）。计数暴露为
 *   `__LAB_HOST__.acquireCalls`，验证套件用它断言「全页正好 acquire 一次」。
 * - `postMessage`：上行消息全部记进 `__LAB_HOST__.sent`；`dshOne.hostCall` 按
 *   `src/pure/hostCalls.ts` 的同一套协议应答（`dshOne.hostResult`），数据是固定
 *   的假提交——实验室要的是契约与配对语义，不是真 git。
 * - `__LAB_HOST__.send(msg)`：模拟宿主→页面方向的消息（`dshOne.setTheme` /
 *   `dshOne.switchSession` 等），供后续套件驱动。
 *
 * 走 addInitScript 而不是往装配页里插 <script>：装配页 HTML 由仓库真实模块
 * （pageHtml.ts）产出、页面 CSP 只放行自己带 nonce 的内联脚本——实验室不该为
 * 了测试去改生产页面的注入形态，CDP 注入恰好对应「VS Code 在 webview 里预置
 * 宿主对象」的真实位置。
 */

/** 假提交的 40 位 hash 底座（git.show 回执里 commitHash 用）。 */
const FULL_HASH = '0123456789abcdef0123456789abcdef01234567'

export function fakeHostScript(): string {
  return `(() => {
  var FULL_HASH = ${JSON.stringify(FULL_HASH)}
  var host = {
    acquireCalls: 0,
    sent: [],
    hostCalls: [],
    openedUrls: [],
    gitShows: []
  }
  globalThis.__LAB_HOST__ = host
  var resume = function (data) {
    window.dispatchEvent(new MessageEvent("message", { data: data }))
  }
  var result = function (id, ok, payload) {
    var message = { type: "dshOne.hostResult", id: id, ok: ok }
    if (ok) message.data = payload === undefined ? null : payload
    else message.error = payload
    setTimeout(function () { resume(message) }, 0)
  }
  var gitShow = function (args) {
    var hash = args && typeof args.hash === "string" ? args.hash : ""
    if (hash.replace(/^0+$/, "") === "") return { sha: hash, found: false }
    return {
      sha: hash,
      found: true,
      commitHash: FULL_HASH,
      message: "lab: fake commit " + hash,
      fullMessage: "lab: fake commit " + hash + "\\n\\nsecond line of the fake body",
      authorName: "Lab Bot",
      authorEmail: "lab@example.com",
      commitDate: "2026-09-15T08:00:00.000Z",
      files: 3,
      insertions: 12,
      deletions: 4,
      githubUrl: "https://github.com/example/repo/commit/" + hash,
      repoPath: "/lab/repo",
      pushedToRemote: true
    }
  }
  var handle = function (message) {
    host.hostCalls.push({ call: message.call, args: message.args, id: message.id })
    if (message.call === "git.show") {
      host.gitShows.push(message.args)
      result(message.id, true, gitShow(message.args))
      return
    }
    if (message.call === "vscode.openExternal") {
      var url = message.args && typeof message.args.url === "string" ? message.args.url : ""
      host.openedUrls.push(url)
      result(message.id, true, null)
      return
    }
    result(message.id, false, { code: "unknown-call", message: "lab host: unknown call " + String(message.call) })
  }
  var api = {
    postMessage: function (message) {
      host.sent.push(message)
      if (message !== null && typeof message === "object" && message.type === "dshOne.hostCall") handle(message)
    },
    getState: function () { return undefined },
    setState: function () {}
  }
  globalThis.acquireVsCodeApi = function () {
    host.acquireCalls += 1
    if (host.acquireCalls > 1) throw new Error("lab host: acquireVsCodeApi called more than once")
    return api
  }
  host.send = function (message) { resume(message) }
})()`
}
