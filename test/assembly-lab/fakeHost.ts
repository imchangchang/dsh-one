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
 *   的假提交——实验室要的是契约与配对语义，不是真 git。另按能力各自记录观测值：
 *   `openedUrls`（VS Code 侧开外链的要求）、`sessionTabsOpened`（多开通道要求开的
 *   会话 id，#72）。
 * - `window.open`：官方 web 侧的开外链出口（#83），调用记进
 *   `__LAB_HOST__.openedByWindow`（不真的开窗）。
 * - **状态三件套**（`state.read/write/delete`，#82）：宿主半的状态存储在实验室里由
 *   一张页内内存表代行（`__LAB_HOST__.stateStore`），初值可由套件注入
 *   （`openTreePage(..., { state })`）——套件据此验「旧 groups.json 能被读进来」
 *   与「写回的键名/形状对得上」，而不去动用户真实的 `~/.dsh`。
 * - `__LAB_HOST__.send(msg)`：模拟宿主→页面方向的消息（`dshOne.setTheme` /
 *   `dshOne.switchSession` 等），供后续套件驱动。
 * - `__LAB_HOST__.failCalls`（套件给的开关，#110）：列进来的宿主调用一律回
 *   `{code:'lab/forced'}` 失败回执——验「动作失败时界面给不给可见反馈」要用**真的
 *   失败回执**，而不是去造假界面（归档/分叉那两条另有 HTTP 层的失败夹具，见套件）。
 *
 * 走 addInitScript 而不是往装配页里插 <script>：装配页 HTML 由仓库真实模块
 * （pageHtml.ts）产出、页面 CSP 只放行自己带 nonce 的内联脚本——实验室不该为
 * 了测试去改生产页面的注入形态，CDP 注入恰好对应「VS Code 在 webview 里预置
 * 宿主对象」的真实位置。
 */

/** 假提交的 40 位 hash 底座（git.show 回执里 commitHash 用）。 */
const FULL_HASH = '0123456789abcdef0123456789abcdef01234567'

export function fakeHostScript(stateScope: Record<string, unknown> = {}, failCalls: readonly string[] = []): string {
  return `(() => {
  var FULL_HASH = ${JSON.stringify(FULL_HASH)}
  var FAIL_CALLS = ${JSON.stringify([...failCalls])}
  var host = {
    acquireCalls: 0,
    sent: [],
    hostCalls: [],
    openedUrls: [],
    openedByWindow: [],
    gitShows: [],
    stateStore: {},
    // 套件可写的注入点：置成某个状态键名后，对该键的 state.write 一律失败
    //（#108 用它验「批量动作失败时失败项留在勾选里、红字报出来」——真宿主也可能
    // 因为磁盘/权限写不进去，这条就是那个情形的可复现版本）。
    failStateWrite: null,
    sessionTabsOpened: [],
    settingsOpened: [],
    workspaceCreateCalls: [],
    openedFolders: [],
    terminalsOpened: []
  }
  host.failCalls = FAIL_CALLS.slice()
  var scope = ${JSON.stringify(stateScope)}
  Object.keys(scope).forEach(function (key) { host.stateStore[key] = scope[key] })
  globalThis.__LAB_HOST__ = host
  // 官方 web 侧的开外链出口（#83）：没有宿主桥时能力口用页面 window.open。记下调用
  // （不真的开窗）——F-06 套件据此断言官方侧那条路走通。官方客户端自己不调
  // window.open（全量扫过，只有一处字符串黑名单里有这个词），所以覆盖它不影响页面。
  globalThis.open = function (url) {
    host.openedByWindow.push(String(url))
    return null
  }
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
    // 套件点名的调用一律失败回执（#110）：验「失败可见」要用真失败，而不是假界面。
    if (FAIL_CALLS.indexOf(message.call) >= 0) {
      result(message.id, false, { code: "lab/forced", message: "lab host: forced failure for " + String(message.call) })
      return
    }
    if (message.call === "git.show") {
      host.gitShows.push(message.args)
      result(message.id, true, gitShow(message.args))
      return
    }
    // 宿主能力口的状态三件套（#82）：实验室里用一个**页内内存表**代行宿主半的
    // 状态存储——套件要验的是「插件把状态读对了、写对了、键名与形状对得上」，
    // 而不是真去动用户的 ~/.dsh（那是 verify:host-half 的事，它跑在临时 HOME 里）。
    if (message.call === "state.read") {
      var readKey = message.args && message.args.key
      var stored = Object.prototype.hasOwnProperty.call(host.stateStore, readKey)
      result(message.id, true, { value: stored ? host.stateStore[readKey] : null })
      return
    }
    if (message.call === "state.write") {
      var writeKey = message.args && message.args.key
      if (typeof writeKey !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(writeKey)) {
        result(message.id, false, { code: "invalid-args", message: "expected a state key" })
        return
      }
      // 注入的写失败（见 host.failStateWrite）：动作侧会如实报错，界面据此报红字。
      if (host.failStateWrite === writeKey) {
        result(message.id, false, { code: "lab-injected-write-failure", message: "lab host: injected state.write failure for " + writeKey })
        return
      }
      host.stateStore[writeKey] = message.args.value
      result(message.id, true, {})
      return
    }
    if (message.call === "state.delete") {
      var deleteKey = message.args && message.args.key
      var existed = Object.prototype.hasOwnProperty.call(host.stateStore, deleteKey)
      delete host.stateStore[deleteKey]
      result(message.id, true, { deleted: existed })
      return
    }
    if (message.call === "vscode.openExternal") {
      var url = message.args && typeof message.args.url === "string" ? message.args.url : ""
      host.openedUrls.push(url)
      result(message.id, true, null)
      return
    }
    if (message.call === "session.openInNewTab") {
      // 多开通道（#72）：真宿主在这里开一个 WebviewPanel；假宿主只记录「为哪个会话
      // 开」——实验室验的是页面→宿主这条链路的身份与次数，面板本身在真宿主里。
      var sessionId = message.args && typeof message.args.sessionId === "string" ? message.args.sessionId : ""
      if (sessionId === "") {
        result(message.id, false, { code: "invalid-args", message: "lab host: empty session id" })
        return
      }
      host.sessionTabsOpened.push(sessionId)
      result(message.id, true, null)
      return
    }
    if (message.call === "vscode.openSettings") {
      // #99 顶栏齿轮：真宿主在这里开/聚焦设置页（独立编辑器页）；假宿主只记录
      // 「页面确实经能力口要过这件事」——设置页本身在真宿主里。
      host.settingsOpened.push(true)
      result(message.id, true, null)
      return
    }
    if (message.call === "vscode.openFolder") {
      // #109 工作区行「在 VS Code 打开」/「在新窗口打开文件夹」：真宿主执行
      // vscode.openFolder；假宿主只记录路径与「要不要新窗口」，不真的开窗。
      var folderPath = message.args && typeof message.args.path === "string" ? message.args.path : ""
      if (folderPath === "") {
        result(message.id, false, { code: "invalid-args", message: "lab host: empty workspace path" })
        return
      }
      host.openedFolders.push({ path: folderPath, newWindow: message.args.newWindow === true })
      result(message.id, true, null)
      return
    }
    if (message.call === "vscode.openTerminal") {
      // #109 工作区行「终端打开」：真宿主开集成终端（cwd = 该目录）；假宿主只记录。
      var terminalPath = message.args && typeof message.args.path === "string" ? message.args.path : ""
      if (terminalPath === "") {
        result(message.id, false, { code: "invalid-args", message: "lab host: empty workspace path" })
        return
      }
      host.terminalsOpened.push({ path: terminalPath })
      result(message.id, true, null)
      return
    }
    if (message.call === "vscode.workspaceCreate") {
      // #99 ＋ 菜单「创建新工作区目录」：真宿主跑 dshOne.workspace.create（原生输入框
      // + 建目录 + 注册）；假宿主只计数，不去碰用户真实目录。
      host.workspaceCreateCalls.push(true)
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
