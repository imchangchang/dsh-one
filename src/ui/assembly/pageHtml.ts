/**
 * cordis 装配页（#64 M1）：把官方 web 前端装配进外壳的 HTML 构建器。
 * 纯函数、零依赖（不 import vscode）——VS Code webview 与 lab harness
 * （.dev-host，普通浏览器验证）共用同一份实现，保证「页面无 acquireVsCodeApi、
 * 普通浏览器可开」的验收口径。
 *
 * 页面结构照抄网关 `/` 的注入形态（spike #63 从真实网关 HTML 提取的契约）：
 *   <head>：base href（一切相对 URL 落回 mirror）→ CSP → 队列 facade（内联，
 *   nonce）→ modulepreload/CSS → __DSH_BOOT__ wire → 阻塞 bootstrap script →
 *   主 bundle（type=module）→ __DSH_TRANSPORT__ 接缝（内联，nonce）
 *   <body>：主题预置 → __DSH_BOOT_READY__ resolve → 版本门信息条（可选）→ #root
 *
 * __DSH_TRANSPORT__ 是 webview 形态独有的接缝：页面源是 vscode-webview://，
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
  /** CSP nonce：webview 内联脚本用；lab 里任意随机值。 */
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
}

const CSP = [
  "default-src 'none'",
  // nonce 给四个内联脚本；loopback 源给 mirror 伺服的 bootstrap/主 bundle；
  // unsafe-eval：cordis 配置文档的 __jsExpr（!!js dshHomePath(...) 这类）在客户端
  // 用 new Function+with 求值（主 bundle lu/Ol），不放行则装载即 CSP 违规。
  "script-src 'nonce-NONCE' http://127.0.0.1:* http://localhost:* 'unsafe-eval'",
  "style-src http://127.0.0.1:* http://localhost:* 'unsafe-inline'",
  'img-src http://127.0.0.1:* http://localhost:* data:',
  // data:：官方把图标字体以 data:font/woff2 内联 FontFace 加载（CSP 拦则一条 font 违规）。
  'font-src http://127.0.0.1:* http://localhost:* data:',
  // fetch（transport 改写后落 mirror）+ WS（openStream 的 remote.mux）。
  'connect-src http://127.0.0.1:* http://localhost:* ws: ws://127.0.0.1:* ws://localhost:*',
].join('; ')

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
 * 传输接缝：把官方客户端按 location.origin 寻址的两条通道改写到 loopback mirror。
 * - fetch：connection RPC 的 POST（/api/<channel>/<endpoint>）换源到 mirror。
 * - openStream：remote stream 走自建 WS 说 /api/remote.mux 协议（open/item/error/
 *   终帧/cancel 五行），返回 async iterable；错误帧带 dshRemoteStreamFailure
 *   标记（remote → 归一化成 RemoteError；carrier → 可重试的载体失败）。
 * 提供了 openStream 后 connection.rpc.open 存在，api-gateway 不会自起按
 * location.origin 寻址的 WS mux（见 dsh-api-gateway ClientRemoteService）。
 */
function transportJs(mirrorOrigin: string): string {
  return `(() => {
  const MIRROR = ${JSON.stringify(mirrorOrigin)}
  const WS_ORIGIN = MIRROR.replace(/^http/, "ws")
  const apiFetch = (input, init) => {
    const parsed = new URL(String(input), globalThis.location ? globalThis.location.href : MIRROR + "/")
    return fetch(new URL(parsed.pathname + parsed.search, MIRROR).href, init)
  }
  const openStream = (endpoint, payload, signal) => (async function* () {
    signal && signal.throwIfAborted()
    const ws = new WebSocket(WS_ORIGIN + "/api/remote.mux")
    const streamId = globalThis.crypto.randomUUID()
    const inbox = []
    const waiters = []
    let failure = null
    const deliver = (frame) => {
      if (failure !== null) return
      const waiter = waiters.shift()
      if (waiter !== undefined) waiter.resolve(frame)
      else inbox.push(frame)
    }
    const carrierFail = (error) => {
      if (failure !== null) return
      failure = error
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
      if (signal) signal.removeEventListener("abort", abortError)
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "cancel", streamId })) } catch (ignored) {}
      ws.close()
    }
  })()
  globalThis.__DSH_TRANSPORT__ = { fetch: apiFetch, openStream }
})()`
}

/** 主题预置：逐字来自官方 body 注入（preference 由外壳烘焙；官方 settings 起来后会覆盖）。 */
function themePresetJs(theme: 'dark' | 'light'): string {
  return `(() => {
  const preference = ${JSON.stringify(theme)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', "14px")
})()`
}

export function assemblyPageHtml(options: AssemblyPageOptions): string {
  const { mirrorOrigin, cspNonce, assets, bootWire, bootstrapUrl, theme, banner } = options
  const csp = CSP.replace('NONCE', cspNonce)
  const preload = assets.preloadJs.map((href) => `    <link rel="modulepreload" crossorigin href="./${escapeAttr(href)}">`).join('\n')
  const styles = assets.css.map((href) => `    <link rel="stylesheet" crossorigin href="./${escapeAttr(href)}">`).join('\n')
  const bannerHtml =
    banner === undefined
      ? ''
      : `<div style="position:sticky;top:0;z-index:100;padding:6px 12px;background:#8a6d1d;color:#fff;font:12px/1.5 var(--vscode-font-family,system-ui,sans-serif);">${escapeHtml(banner)}</div>`
  return `<!doctype html>
<html lang="en">
  <head>
    <base href="${escapeAttr(mirrorOrigin)}/">
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>DeepSeek Harness (assembled)</title>
    <script nonce="${cspNonce}">${QUEUE_FACADE_JS}</script>
${preload}
${styles}
    <script nonce="${cspNonce}">globalThis["__DSH_BOOT__"] = ${jsonForScript(bootWire)}</script>
    <script src="${escapeAttr(bootstrapUrl)}"></script>
    <script nonce="${cspNonce}">${transportJs(mirrorOrigin)}</script>
    <script type="module" crossorigin src="./${escapeAttr(assets.moduleJs)}"></script>
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
