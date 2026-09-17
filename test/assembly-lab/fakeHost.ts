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
 *   会话 id，#72）、`panelQueries` / `panelsOpened`（#121 侧栏树问「这条会话开在面板里
 *   吗」与请宿主把面板亮到某会话——宿主面板本身在真宿主里；#147 起这份「哪些会话开着」
 *   的事实有一份**按 id** 的确定性夹具：`host.reportPanelSessions([…])` 同时记表并广播，
 *   逐条查询与整份读取都以它为准，见下面 `session.inPanel` 的说明）。
 * - `window.open`：官方 web 侧的开外链出口（#83），调用记进
 *   `__LAB_HOST__.openedByWindow`（不真的开窗）。
 * - **状态三件套**（`state.read/write/delete`，#82）：宿主半的状态存储在实验室里由
 *   一张页内内存表代行（`__LAB_HOST__.stateStore`），初值可由套件注入
 *   （`openTreePage(..., { state })`）——套件据此验「旧 groups.json 能被读进来」
 *   与「写回的键名/形状对得上」，而不去动用户真实的 `~/.dsh`。
 * - `__LAB_HOST__.send(msg)`：模拟宿主→页面方向的消息（`dshOne.setTheme` /
 *   `dshOne.switchSession` / `dshOne.panelSessions` 等），供后续套件驱动。
 * - **VS Code 打开的文件夹**（`vscode.workspaceFolders`，#112）：假宿主没有「用户开了
 *   哪个文件夹」这件真事，所以由套件喂（`openTreePage(..., { workspaceFolders })`）；
 *   缺省空表 = 这个窗口没开任何文件夹，也就是「没有当前工作区」（不显示徽标、不置顶）。
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

export function fakeHostScript(
  stateScope: Record<string, unknown> = {},
  failCalls: readonly string[] = [],
  workspaceFolders: readonly string[] = [],
): string {
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
    // #112：这个「VS Code 窗口」打开的文件夹（侧栏树的当前工作区判定读它）。缺省空表
    // = 一个都没开；套件也可以直接改它（见 harness 的 setLabWorkspaceFolders，改完
    // 重载页面即生效——下一次导航会重新装这份初始化脚本，所以覆盖要另装一条脚本）。
    workspaceFolders: ${JSON.stringify([...workspaceFolders])},
    // 套件可写的注入点：置成某个状态键名后，对该键的 state.write 一律失败
    //（#108 用它验「批量动作失败时失败项留在勾选里、红字报出来」——真宿主也可能
    // 因为磁盘/权限写不进去，这条就是那个情形的可复现版本）。
    failStateWrite: null,
    // 另一个注入点：置成某个状态键名后，对该键的 state.write **先按住不回执**
    //（套件随后调 host.releaseHeld() 放行）——#144 用它把「有动作在飞（busy）」的那一刻
    // 钉住，验 busy 时抽屉行尾两枚动作都禁用。与 failStateWrite 是两回事：那个回失败，
    // 这个只是慢（真宿主在磁盘忙的时候也是这个表现）。
    holdStateWrite: null,
    held: [],
    sessionTabsOpened: [],
    // #121 宿主面板：假宿主不做真的面板（那是真宿主的事），只回答侧栏树问的那句
    // 「这条会话现在开在对话面板里吗」，并记录「树请宿主把面板亮到哪个会话」。
    // panelSession 缺省 true = 一律答「开着」（既有姿态：#115 的「点当前会话行 =
    // 就地改名」成立，F-22 等套件按它验）；设 false 就造出「宿主说没打开」的现场
    //（#121 的 F-26 要的正是它）。session.openPanel 到达时把它翻回 true——真宿主
    // 在那之后确实开着这条会话了；要让「没打开」一直成立，套件点完再设回 false。
    //
    // #147 起多一份**按 id 的**确定性夹具 panelSessions（字符串数组，或 null = 还没
    // 设过）：非 null 时逐条查询（session.inPanel）与整份读取（session.panelSessions）
    // 都以它为准——「宿主报的这批就是开着的」这条事实在两处必须是同一份（真宿主就是
    // 同一份，见 src/pure/sessionPanelRouting.ts 的 panelOpenSessionIds）。null 时退回
    // 上面那个全局开关（逐条查询按它答；整份读取答不出，回空表——那是 #147 之前的
    // 老夹具形态，新套件请用 panelSessions）。
    panelSession: true,
    panelSessions: null,
    panelQueries: [],
    panelsOpened: [],
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
  // 放行被 holdStateWrite 按住的那几条 state.write（#144：套件读够 busy 态之后调它）。
  var releaseHeld = function () {
    var queued = host.held.splice(0)
    queued.forEach(function (message) {
      host.stateStore[message.args.key] = message.args.value
      result(message.id, true, {})
    })
  }
  host.releaseHeld = releaseHeld
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
      // 注入的按住（见 host.holdStateWrite）：先不回执，套件调 releaseHeld() 才放行——
      // 「有动作在飞」的那一刻因此可以被钉住读界面（#144）。
      if (host.holdStateWrite === writeKey) {
        host.held.push(message)
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
    if (message.call === "session.inPanel") {
      // #121 侧栏树问「这条会话现在开在宿主面板里吗」：假宿主如实回——#147 起按 id 的
      // 那份集合优先（panelSessions 非 null 时），没设过就按全局开关 panelSession。
      var askedId = message.args && typeof message.args.sessionId === "string" ? message.args.sessionId : ""
      if (askedId === "") {
        result(message.id, false, { code: "invalid-args", message: "lab host: empty session id" })
        return
      }
      host.panelQueries.push(askedId)
      var openNow = host.panelSessions === null ? host.panelSession === true : host.panelSessions.indexOf(askedId) >= 0
      result(message.id, true, { open: openNow })
      return
    }
    if (message.call === "session.panelSessions") {
      // #147 侧栏页挂载时读一次「面板里开着哪些会话」（只有推送会漏掉页面起来之前就
      // 开着的那批）。按 id 的那份集合就是答案；没设过（老夹具的全局开关）答空表。
      var openIds = host.panelSessions === null ? [] : host.panelSessions.slice()
      result(message.id, true, { sessionIds: openIds })
      return
    }
    if (message.call === "session.openPanel") {
      // #121 树请宿主把对话面板亮到这个会话：真宿主在这里 openSessionChat（创建 /
      // 聚焦 / 就地切换）；假宿主记录「请亮哪个会话」，并把面板状态翻成「开着它」
      //（真宿主做完这件事之后确实如此）。
      var showId = message.args && typeof message.args.sessionId === "string" ? message.args.sessionId : ""
      if (showId === "") {
        result(message.id, false, { code: "invalid-args", message: "lab host: empty session id" })
        return
      }
      host.panelsOpened.push(showId)
      host.panelSession = true
      // 真宿主在这之后确实开着这条会话：按 id 的那份集合在场时把它并进去（#147）。
      if (host.panelSessions !== null && host.panelSessions.indexOf(showId) < 0) host.panelSessions.push(showId)
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
    if (message.call === "vscode.workspaceFolders") {
      // #112 当前工作区判定：VS Code 侧由扩展宿主回 vscode.workspace.workspaceFolders
      // 的 fsPath 列表，这里回套件喂的那份。
      result(message.id, true, { paths: host.workspaceFolders.slice() })
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
  // #147：把「面板里开着哪些会话」这份事实同时记进按 id 的表并广播一条——真宿主在这两处
  // 就是同一份事实（读取一次快照 + 每次变化广播），套件用这一个入口造现场即可。
  host.reportPanelSessions = function (ids) {
    host.panelSessions = ids.slice()
    host.send({ type: "dshOne.panelSessions", sessionIds: ids.slice() })
  }
})()`
}
