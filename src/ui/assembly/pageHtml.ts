/**
 * cordis 装配页（#64 M1）：把官方 web 前端装配进外壳的 HTML 构建器。
 * 纯函数、零依赖（不 import vscode）——VS Code webview 与浏览器验证 harness
 * （test/assembly-lab/，普通浏览器里跑）共用同一份实现，保证「页面无 acquireVsCodeApi、
 * 普通浏览器可开」的验收口径。
 *
 * 页面结构照抄网关 `/` 的注入形态（spike #63 从真实网关 HTML 提取的契约）：
 *   <head>：base href（一切相对 URL 落回 mirror）→ 诊断探针（内联，仅 webview 激活）
 *   → 队列 facade（内联）→ modulepreload/CSS →
 *   __DSH_BOOT__ wire → 阻塞 bootstrap script → 主 bundle（type=module）→
 *   __DSH_TRANSPORT__ seam（内联）
 *   <body>：主题预置 → __DSH_BOOT_READY__ resolve → 版本门信息条（可选）→ #root
 *
 * **本页不带 CSP**（#188，用户拍板）：官方 dsh 网页整页没有 CSP（网关 `/` 不带 CSP meta），
 * 装配页此前自带一份（`default-src 'none'` + 内联脚本 nonce + 受限的 img/font/media 源），
 * 于是同一张第三方插件卡片在两边处境不同——帧里的内联事件属性被挡、帧要用的远端图片与
 * 字体被 `img-src` / `font-src` 挡（#186 里那条 F-09 的红就是它）。现在这份政策去掉了，
 * 装配页与官方页同处境：代价是失去脚本注入防护（页面里跑的是官方 bundle + 我们的插件 +
 * 用户 profile 里的第三方插件，与官方页相同），取舍与宿主那层的实测证据见
 * `docs/architecture.md` 的「webview CSP」一节，常驻断言 = `npm run verify:lab` 的 F-59。
 *
 * **#185 那套「给隔离沙箱 srcdoc 帧补 nonce」的机制随之一起下线**（同一处决定）：它当年
 * 存在的唯一理由是匹配**我们自己的**那条 `script-src 'nonce-…'`（`srcdoc` 是 local scheme，
 * 本页政策会继承进帧里），本页不带 CSP 之后它匹配不到任何政策、也不再改动插件写下的
 * `srcdoc`——理由与读数见 F-59 的文件头。页面**自己**的内联脚本与那段 `<style>` 仍然带着
 * `nonce` 属性（#188 明确不要一股脑删掉）：没有政策可匹配、它今天不放行任何东西，留着只是
 * 让「把 CSP 加回来」这条退路的 diff 小一点。
 *
 * __DSH_TRANSPORT__ 是 webview 形态独有的 seam：页面源是 vscode-webview://，
 * 而 dsh-client-connection 的 RPC fetch 与 api-gateway 的 remote stream 都按
 * location.origin 寻址——webview 里 location.origin 不是 mirror，必须在这里把
 * 两条通道显式改写到 loopback mirror（fetch 重写源 + openStream 自建 WS 说
 * remote.mux 协议）。lab 同源页面下这两件事都是恒等操作，同一实现两边都成立。
 */

export interface AssemblyBootWire {
  rev: string
  entries: unknown[]
  batches: unknown[]
}

export interface AssemblyPageAssets {
  moduleJs: string
  preloadJs: string[]
  css: string[]
}

export interface AssemblyPageOptions {
  /** loopback mirror 源（http://127.0.0.1:<port>），base href 与 transport 目标。 */
  mirrorOrigin: string
  /**
   * 页面自己那几段内联脚本与那段 `<style>` 上的 `nonce` 值。本页不带 CSP（#188），
   * 它今天不放行任何东西——留着只是让「把 CSP 加回来」这条退路不必再动这些落点。
   */
  cspNonce: string
  assets: AssemblyPageAssets
  /** __DSH_BOOT__ wire（blocklist 过滤后的运行时产物，见 ui/assembly/wireFilter.ts）。 */
  bootWire: AssemblyBootWire
  /** bootstrap 批 URL（阻塞 script src，相对 base）。 */
  bootstrapUrl: string
  /** 第一帧主题（官方应用起来后会按网关 settings 覆盖；实时跟随是 M2）。 */
  theme: 'dark' | 'light'
  /** 版本门信息条文本；undefined = 网关在 [0.1.2-rc.1, 0.2.0) 区间内，不显示。 */
  banner?: string
  /** 实验开关：false 时去掉 __DSH_TRANSPORT__ 桥（A/C 变体对照）。生产恒缺省。 */
  transport?: boolean
  /** #71 tab 启动注入：宿主给的会话 id；缺省无注入（官方恢复行为）。 */
  bootSessionId?: string
  /**
   * 这个页面是哪种面板（#169）：true = 显式多开的标签页，false/缺省 = 单例。
   * 页面把它连同当前会话 id 一起存进 webview 的 state，宿主恢复标签页时按它
   * 决定这个面板回到单例槽位还是多开表（见 pure/chatPanelState.ts）。
   */
  panelTab?: boolean
  /**
   * 这个页面的自有插件 id 列表（第一个 = 该树的 frame 插件 id，
   * 见 `ui/assembly/wireFilter.ts` 的各 `*_FRAME_PLUGIN_ID` 与树的 `extraPluginIds`）。
   *
   * 用途只有一个：把官方的 roster 事件流改道到 mirror 的过滤版
   * （`/plugins-local/events`，见 `server/assemblyMirror.ts` 的 serveGraphEvents）。
   * 0.1.6-alpha.2 起页面会采纳宿主经那条流下发的全量 roster，不带过滤就会把页面
   * 洗成未过滤的官方插件集（#191 的整页白）。顺序有含义：第一个必须是 frame 插件 id
   * ——mirror 按它取该树的 block list。
   */
  localPluginIds: readonly string[]
}

import { assemblyProbeJs } from './probe.ts'
import { hostSdkJs } from './hostSdk.ts'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

/** 内联 JSON（防 </script> 逃逸）。 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * 队列 facade：契约逐字来自真实网关 `/` 注入（queue 模式，仅 load+create；
 * create 从 pendingQueue 取 dsh-client-modules 注册并转交
 * createClientModuleSystem）。这是 WebBoot 消费的最小面，勿改语义。
 */
const QUEUE_FACADE_JS = `(() => {
  const pendingQueue = []
  window.__ModuleLoader__ = {
    mode: "queue",
    pendingQueue,
    load(registration) { pendingQueue.push(registration) },
    create(options) {
      if (this.mode !== "queue") throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
      const index = pendingQueue.findIndex((registration) => registration.id === "@deepseek-ai/dsh-client-modules")
      const registration = pendingQueue[index]
      if (registration === undefined) throw new Error("client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js")
      pendingQueue.splice(index, 1)
      const exports = registration.factory((specifier) => {
        throw new Error('client-modules: @deepseek-ai/dsh-client-modules/client.js requested external "' + specifier + '" before the module system existed')
      })
      if (typeof exports !== "object" || exports === null || typeof exports.createClientModuleSystem !== "function" || typeof exports.apply !== "function") {
        throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face")
      }
      return exports.createClientModuleSystem(this, { id: registration.id, exports }, options)
    }
  }
})()`

/**
 * 传输 seam：把官方客户端按 location.origin 寻址的宿主通道改写到 loopback mirror。
 * - fetch（`__DSH_TRANSPORT__.fetch`）：connection RPC 的 POST
 *   （/api/<channel>/<endpoint>）换源到 mirror。
 * - openStream：remote stream 走自建 WS 说 /api/remote.mux 协议（open/item/error/
 *   终帧/cancel 五行），返回 async iterable；错误帧带 dshRemoteStreamFailure
 *   标记（remote → 归一化成 RemoteError；carrier → 可重试的载体失败）。
 * 提供了 openStream 后 connection.rpc.open 存在，api-gateway 不会自起按
 * location.origin 寻址的 WS mux（见 dsh-api-gateway ClientRemoteService）。
 * - 页面全局 fetch（`hostFetch`，见下）：不走 `__DSH_TRANSPORT__` 那条口、
 *   自己裸 fetch 宿主路由的官方插件也要能到达网关。官方代码把「宿主」写成**页面
 *   自己的源**（`location.origin`），源读不到时退回官方常量 `http://dsh.internal`
 *   ——0.1.6-alpha.1 里用这个常量的有 `dsh-client-connection` / `dsh-api-gateway`
 *   （INTERNAL_BASE）、`dsh-client-file-upload`、`dsh-client-ui-open-in-app`、
 *   `dsh-session-log-export`（`hostBase()`）。官方 web 里页面源就是网关，所以它们
 *   裸 fetch 天然可达；VS Code webview 里页面源是 `vscode-webview://<uuid>`（真窗
 *   实测，探针日志里那一行「page origin …」），这类请求只会打空——open-in-app 的
 *   清单读取被官方 `catch {}` 吞掉 → 应用清单为空 → 按钮整块不渲染（#87 的第二个
 *   根因）。所以页面全局 fetch 只改写这两类「宿主寻址」URL，其余（Request 对象、
 *   blob:/data:、真外部源）一律原样交给原生 fetch。
 *   判定细节：webview 的 `vscode-webview://` 是**不透明源**（`origin` 序列化成
 *   `"null"`，与 `blob:` / `data:` 撞值），所以那一支比 `protocol + host` 而不是
 *   origin；比 origin 会把 blob: 一起改写掉。
 * ownsHost（官方机制第 3 层：__DSH_TRANSPORT__ 官方预留 seam 的既有字段，
 * client-connection 源码 4755 行 isLoopback 判定消费）：传输 seam 拥有
 * loopback 宿主权威——页面一切 RPC 经 loopback 代理带 cookie 到网关，
 * 网关视角即 127.0.0.1。isLoopback 判定 = transport.ownsHost || location
 * 是 loopback 主机名；VS Code webview 的 vscode-webview:// 主机名不是
 * loopback，缺这个标记会被官方判非 loopback：设置文档走 memory 不持久、
 * Models 提供方目录降级「settings are unavailable in this browser」、
 * Open configuration file 缺席。声明后三树等价官方 loopback 形态（#70）。
 */
function transportJs(mirrorOrigin: string, localPluginIds: readonly string[]): string {
  return `(() => {
  const MIRROR = ${JSON.stringify(mirrorOrigin)}
  const WS_ORIGIN = MIRROR.replace(/^http/, "ws")
  // Diagnostic probe hook: probe.ts installs __DSH_ONE_PROBE__ in webview only; silent in browsers.
  const probe = (level, text) => { if (globalThis.__DSH_ONE_PROBE__) globalThis.__DSH_ONE_PROBE__.log(level, text) }
  // Roster event stream (see server/assemblyMirror.ts's serveGraphEvents, issue #191): the
  // official client opens an SSE on /plugins/events whose "graph" frames carry the host's FULL
  // plugin roster. 0.1.6-alpha.2 makes the client adopt it, so the stream has to go through the
  // mirror's filtered twin — otherwise the blocked official plugins come back and our own
  // entries are dropped. The path is absolute, so it resolves against the base href (mirror).
  const LOCAL_PLUGIN_IDS = ${JSON.stringify(localPluginIds)}
  const EVENTS_URL = LOCAL_PLUGIN_IDS.length === 0
    ? null
    : "/plugins-local/events?ids=" + LOCAL_PLUGIN_IDS.map(encodeURIComponent).join(",")
  const NativeEventSource = globalThis.EventSource
  if (EVENTS_URL !== null && typeof NativeEventSource === "function") {
    globalThis.EventSource = new Proxy(NativeEventSource, {
      construct(target, args, newTarget) {
        const first = args[0]
        if (typeof first === "string" || first instanceof URL) {
          try {
            if (new URL(String(first), document.baseURI).pathname === "/plugins/events") {
              return Reflect.construct(target, [EVENTS_URL, args[1]], newTarget)
            }
          } catch (ignored) {}
        }
        return Reflect.construct(target, args, newTarget)
      },
    })
  }
  // Page origin (first-hand evidence for host-routing defects such as #87): in the VS Code
  // webview it is vscode-webview://<uuid>, not the mirror, so any official code that
  // addresses the host via location.origin ends up off-target.
  probe("info", "page origin " + String(globalThis.location && globalThis.location.origin) + " mirror " + MIRROR)
  const NATIVE_FETCH = globalThis.fetch.bind(globalThis)
  const apiFetch = (input, init) => {
    const parsed = new URL(String(input), globalThis.location ? globalThis.location.href : MIRROR + "/")
    const url = new URL(parsed.pathname + parsed.search, MIRROR).href
    return NATIVE_FETCH(url, init).then((res) => {
      if (!res.ok) probe("warn", "transport fetch " + url + " -> HTTP " + res.status)
      return res
    }, (err) => {
      probe("error", "transport fetch " + url + " failed: " + err)
      throw err
    })
  }
  // Host-addressed test (see the function comment above for the official call sites):
  // the page's own origin, the official internal base, or the mirror itself.
  const page = globalThis.location
  const isHostAddressed = (url) => {
    if (url.hostname === "dsh.internal") return true
    if (url.origin === MIRROR) return true
    if (page === undefined) return false
    if (page.origin !== "null" && url.origin === page.origin) return true
    // Opaque page origin (vscode-webview://): compare protocol + host, because origin
    // serializes to "null" there and would also match blob:/data: URLs.
    return url.protocol === page.protocol && url.host === page.host
  }
  const hostFetch = (input, init) => {
    // Request objects keep native semantics untouched.
    if (typeof input !== "string" && !(input instanceof URL)) return NATIVE_FETCH(input, init)
    let url
    try {
      url = input instanceof URL ? input : new URL(input, document.baseURI)
    } catch (ignored) {
      return NATIVE_FETCH(input, init)
    }
    if (!isHostAddressed(url)) return NATIVE_FETCH(input, init)
    return NATIVE_FETCH(new URL(url.pathname + url.search, MIRROR).href, init)
  }
  globalThis.fetch = hostFetch
  const openStream = (endpoint, payload, signal) => (async function* () {
    signal && signal.throwIfAborted()
    const ws = new WebSocket(WS_ORIGIN + "/api/remote.mux")
    const streamId = globalThis.crypto.randomUUID()
    const inbox = []
    const waiters = []
    let failure = null
    let firstFrame = false
    const deliver = (frame) => {
      if (failure !== null) return
      if (!firstFrame) { firstFrame = true; probe("info", "openStream first frame " + endpoint) }
      const waiter = waiters.shift()
      if (waiter !== undefined) waiter.resolve(frame)
      else inbox.push(frame)
    }
    const carrierFail = (error) => {
      if (failure !== null) return
      failure = error
      probe("error", "openStream carrier fail " + endpoint + ": " + error.message)
      for (const waiter of waiters.splice(0)) waiter.reject(error)
    }
    const take = () => {
      if (inbox.length > 0) return Promise.resolve(inbox.shift())
      if (failure !== null) return Promise.reject(failure)
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    }
    ws.onmessage = (event) => {
      let frame
      try { frame = JSON.parse(event.data) } catch (error) { carrierFail(error); return }
      if (frame && frame.streamId === streamId) deliver(frame)
    }
    ws.onerror = () => {}
    ws.onclose = (event) => {
      const error = new Error("remote stream websocket closed (" + event.code + ")")
      error.dshRemoteStreamFailure = { kind: "carrier" }
      carrierFail(error)
    }
    const abortError = () => {
      const error = (signal && signal.reason) || new Error("remote stream aborted")
      error.dshRemoteStreamFailure = { kind: "carrier" }
      carrierFail(error)
    }
    if (signal) signal.addEventListener("abort", abortError, { once: true })
    try {
      await new Promise((resolve, reject) => {
        ws.onopen = resolve
        ws.addEventListener("error", () => reject(new Error("remote stream websocket error")), { once: true })
      })
      probe("info", "openStream open " + endpoint)
      signal && signal.throwIfAborted()
      ws.send(JSON.stringify({ type: "open", streamId, endpoint, payload }))
      while (true) {
        const frame = await take()
        signal && signal.throwIfAborted()
        if (frame.type === "item") { yield frame.value; continue }
        if (frame.type === "error") {
          const error = new Error(frame.error && frame.error.message)
          error.dshRemoteStreamFailure = { kind: "remote", code: frame.error && frame.error.code, details: frame.error && frame.error.details }
          throw error
        }
        return
      }
    } finally {
      // Clean close (final frame / consumer close) must not go through carrierFail:
      // mark finished before closing, or every normal close would be logged as a carrier failure.
      failure = failure || new Error("stream finished")
      probe("info", "openStream close " + endpoint)
      if (signal) signal.removeEventListener("abort", abortError)
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "cancel", streamId })) } catch (ignored) {}
      ws.close()
    }
  })()
  globalThis.__DSH_TRANSPORT__ = { fetch: apiFetch, openStream, ownsHost: true }
})()`
}

/** 主题预置：逐字来自官方 body 注入（preference 由外壳烘焙；官方 settings 起来后会覆盖）。
 * 宿主主题（#70 主题跟随）：theme-follow 插件首帧同步官方 theme 服务的
 * preference，之后靠宿主 dshOne.setTheme 广播切换（__DSH_ONE_HOST_THEME__）。 */
function themePresetJs(theme: 'dark' | 'light'): string {
  return `(() => {
  const preference = ${JSON.stringify(theme)}
  globalThis.__DSH_ONE_HOST_THEME__ = preference
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', "14px")
})()`
}

/**
 * #185 的「给隔离沙箱 `srcdoc` 帧补本页 nonce」在这里下线了（#188，与去掉本页 CSP 同一处决定）。
 *
 * 它当年存在的唯一理由是匹配**我们自己的**那条 `script-src 'nonce-…'`：`srcdoc` 是 local
 * scheme，本页政策会继承进帧里，而帧的 HTML 由插件生成、拿不到本页 nonce，于是「帧内脚本量出
 * 内容高度再 postMessage 回来撑开卡片」这类插件在官方页正常、在装配页永远停在插件自己的最小
 * 高度（#185 的现场：`@dsh-external/dsh-visualize` 的 HTML 预览卡被压成 48px）。
 *
 * 去掉本页 CSP 之后它匹配不到任何政策，能做的只剩「改写插件写下的 `srcdoc`」——那是一处全局
 * `Element.prototype.setAttribute` 补丁（页面上每一次属性写都要过一次判据）加一次整文档的属性
 * 观察（#196 为「两个属性谁先写」补的两条落点），换来的却是用户看不到、断言也判不到的副作用。
 * 所以按「少一层机制」收掉：装配页现在**一个字节都不改**第三方帧的 `srcdoc`（与官方页同处境，
 * F-59 逐帧断言这一点）。用户拍板的取舍若哪天反过来做（恢复本页 CSP），这一层要连同一起回来
 * ——两者是同一处约定的两半，本仓历史里就是同一个 commit。
 */

export function assemblyPageHtml(options: AssemblyPageOptions): string {
  const { mirrorOrigin, cspNonce, assets, bootWire, bootstrapUrl, theme, banner } = options
  // 启动早期读官方恢复键（dsh.sessions.current）：官方应用启动流程会改写它，
  // 侧栏桥要靠这个「加载那一刻的值」判别「首个非空选中是官方恢复还是用户点击」。
  // 读数失败（隐私模式等）不影响任何行为，只是判别退化为「用户没点过就抑制」。
  const bootGlobals =
    `    <script nonce="${cspNonce}">globalThis.__DSH_ONE_BOOT__ = ${JSON.stringify({ sessionId: options.bootSessionId ?? null, panelTab: options.panelTab === true })};` +
    `try{globalThis.__DSH_ONE_RESTORE__=localStorage.getItem("dsh.sessions.current")}catch(ignored){globalThis.__DSH_ONE_RESTORE__=null}</script>\n`
  const transportOn = options.transport !== false
  const preload = assets.preloadJs.map((href) => `    <link rel="modulepreload" crossorigin href="./${escapeAttr(href)}">`).join('\n')
  const styles = assets.css.map((href) => `    <link rel="stylesheet" crossorigin href="./${escapeAttr(href)}">`).join('\n')
  const bannerHtml =
    banner === undefined
      ? ''
      : `<div style="position:sticky;top:0;z-index:100;padding:6px 12px;background:#8a6d1d;color:#fff;font:12px/1.5 var(--vscode-font-family,system-ui,sans-serif);">${escapeHtml(banner)}</div>`
  const transportScript = transportOn ? `    <script nonce="${cspNonce}">${transportJs(mirrorOrigin, options.localPluginIds)}</script>\n` : ''
  // body 归零（#70）：VS Code 给每条 webview 注入 @layer vscode-default
  // { body { padding: 0 20px } }（pre/index.html defaultStyles）——层内规则
  // 输给任何非层样式，但页面没人设置 body padding 时它就生效（实验室普通
  // 浏览器无此层所以贴 0，webview 里左右各空 20px + 侧栏底色边界成「细竖
  // 线」）。非层 reset 直接压掉它，三树统一对齐官方 web 的 body{margin:0;
  // padding:0}（chat 内容列自居中不受影响，settings 整页表单受益）。
  const bodyReset = `    <style nonce="${cspNonce}">body{margin:0;padding:0}</style>\n`
  return `<!doctype html>
<html lang="en">
  <head>
    <base href="${escapeAttr(mirrorOrigin)}/">
    <meta charset="utf-8" />
    <title>DeepSeek Harness (assembled)</title>
    <script nonce="${cspNonce}">${assemblyProbeJs()}</script>
    <script nonce="${cspNonce}">${QUEUE_FACADE_JS}</script>
    <script nonce="${cspNonce}">${hostSdkJs()}</script>${bodyReset}${bootGlobals}${preload}
${styles}
    <script nonce="${cspNonce}">globalThis["__DSH_BOOT__"] = ${jsonForScript(bootWire)}</script>
    <script src="${escapeAttr(bootstrapUrl)}"></script>
${transportScript}    <script type="module" crossorigin src="./${escapeAttr(assets.moduleJs)}"></script>
  </head>
  <body>
    <script nonce="${cspNonce}">${themePresetJs(theme)}</script>
    <script nonce="${cspNonce}">(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>
    ${bannerHtml}
    <div id="root"></div>
  </body>
</html>
`
}
