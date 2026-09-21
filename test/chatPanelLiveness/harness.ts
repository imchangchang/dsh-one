/**
 * #223 / #224 的宿主侧 harness：在 node 里用**真实宿主代码**跑「点会话 → 对话面板」
 * 这条通路（`src/ui/assemblyView.ts`），把判据要吃的几样东西交出去——建出来的面板、
 * 弹给用户的提示、扩展自己的日志行，以及把请求送进去的两个入口（侧栏桥消息
 * `dshOne.sessionSelected` 与宿主能力口 `dshOne.hostCall` + `session.openPanel`）。
 *
 * 三样替身，各自的边界写在该替身自己的文件/函数上：
 * - **`vscode` 模块**（`vscodeStub.ts`）：面板与 webview 的生命周期、可见提示、命令表；
 * - **网关**：本进程起一个只回一份最小 `__DSH_BOOT__` 注入 HTML 的 HTTP 服务
 *   （只绑 127.0.0.1、端口现取）——`prepareChatPanel` 要的那一步（拉清单）因此是真的
 *   走了一遍网络，只是对端是我们自己；
 * - **`ServerManager` / `ExtensionContext`**：按结构化兼容给出 `ensureStarted` /
 *   `getStatus` / `extensionUri`（不 spawn 任何 dsh 进程、不碰用户目录）。
 *
 * 共享 mirror 是真的（`startAssemblyMirror` 起 loopback），所以「引用计数配平」这一条
 * 判据读的是**真端口**：最后一个引用释放后那个端口应当不再接受连接。
 */
import * as http from 'node:http'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Logger } from '../../src/log.ts'
import type { ServerManager } from '../../src/server/manager.ts'
import {
  createStubWebview,
  panels,
  messagesShown,
  registeredCommands,
  viewProviders,
  type StubPanel,
  type StubWebview,
} from './vscodeStub.ts'

/** 仓库根（harness 文件在 test/chatPanelLiveness/ 下）。 */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** 一条日志 / 一条用户提示。 */
export interface LogLine {
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface Harness {
  /** 扩展自己的日志（`Logger` 的三条通道都记在这里；本 harness 一份）。 */
  readonly logs: LogLine[]
  /** 替网关的地址（fake gateway）。 */
  readonly gatewayUrl: string
  /** 本 harness 建出来的面板（模块级的表是全进程共享的，这里只暴露自己这一段）。 */
  readonly panels: StubPanel[]
  /** 本 harness 期间弹给用户的提示。 */
  readonly messages: { level: 'error' | 'warn' | 'info'; message: string }[]
  /** 侧栏 view 那条 webview（宿主能力口与桥消息都从它进来）。 */
  readonly sidebarWebview: StubWebview
  /** 宿主侧那几个出口（真实装配视图导出的函数）。 */
  readonly assembly: {
    revealAssembledChat(): boolean
    hasAssembledChatPanel(): boolean
    wasAssembledChatClosedByUser(): boolean
    openSessionInNewTab(sessionId: string): Promise<void>
  }
  /** 让下一次 `createWebviewPanel` 抛错。 */
  setFailNextPanelCreate(fail: boolean): void
  /** 侧栏页发 `dshOne.sessionSelected`（会话桥：点会话行的那条路）。 */
  clickSession(sessionId: string): void
  /** 侧栏页走宿主能力口 `session.openPanel`（会话行点击 / 新建会话那条路）。 */
  requestPanel(sessionId: string): void
  /** 跑一条登记过的命令（`dshOne.assembledChat`：新建会话 / fork / 默认打开那条路）。 */
  runCommand(commandId: string): Promise<void>
  /** 把侧栏 view 关掉（释放它持有的那份 mirror 引用）。 */
  disposeSidebarView(): void
  /** 某个面板页面里的 mirror 源（页面 HTML 的 `<base href>`）。 */
  mirrorOriginOf(panel: StubPanel): string
  /** 日志里匹配这个正则的行。 */
  lines(pattern: RegExp): string[]
  /** 等一个条件成立（默认 5 秒），不成立就抛。 */
  waitFor(what: string, predicate: () => boolean | Promise<boolean>, timeoutMs?: number): Promise<void>
  /** 收掉本 harness 起的网关与侧栏 view，并关掉本 harness 建出来的面板。 */
  close(): Promise<void>
}

/** 一份最小合法 wire：bootstrap + application 各一批，前端资产三样齐全。 */
function gatewayHtml(): string {
  const wire = {
    rev: 'labrev',
    entries: [{ id: 'client-modules', url: '/plugins/??client-modules/client.js&rev=bootrev', rev: 'bootrev' }],
    batches: [
      {
        phase: 'bootstrap',
        url: '/plugins/??client-modules/client.js&rev=bootrev',
        rev: 'bootrev',
        entries: ['client-modules'],
      },
      {
        phase: 'application',
        url: '/plugins/??client-modules/client.js&rev=apprev',
        rev: 'apprev',
        entries: ['client-modules'],
      },
    ],
  }
  return [
    '<!doctype html><html><head>',
    '<link rel="modulepreload" href="./assets/index.js">',
    '<link rel="stylesheet" href="./assets/index.css">',
    '</head><body>',
    `<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(wire)}</script>`,
    '<script type="module" src="./assets/index.js"></script>',
    '</body></html>',
  ].join('')
}

/** 侧栏 view 的替身（provider 要的那几件）。 */
function fakeWebviewView(webview: StubWebview): {
  viewType: string
  visible: boolean
  webview: StubWebview
  onDidChangeVisibility(cb: () => void): { dispose(): void }
  onDidDispose(cb: () => void): { dispose(): void }
  dispose(): void
} {
  const disposeListeners = new Set<() => void>()
  const visibilityListeners = new Set<() => void>()
  return {
    viewType: 'dshOne.chat',
    visible: true,
    webview,
    onDidChangeVisibility(cb: () => void) {
      visibilityListeners.add(cb)
      return { dispose: () => visibilityListeners.delete(cb) }
    },
    onDidDispose(cb: () => void) {
      disposeListeners.add(cb)
      return { dispose: () => disposeListeners.delete(cb) }
    },
    dispose() {
      for (const listener of [...disposeListeners]) listener()
    },
  }
}

export async function startHarness(): Promise<Harness> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(gatewayHtml())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const logs: LogLine[] = []
  const logger = {
    info: (message: string) => logs.push({ level: 'info', message }),
    warn: (message: string) => logs.push({ level: 'warn', message }),
    error: (message: string) => logs.push({ level: 'error', message }),
  } as unknown as Logger

  const status = { state: 'running' as const, url: gatewayUrl, version: '0.1.6-alpha.1' }
  const manager = {
    ensureStarted: async () => status,
    getStatus: () => status,
    onDidChangeState: () => ({ dispose: () => undefined }),
  } as unknown as ServerManager

  const stub = await import('./vscodeStub.ts')
  const context = {
    extensionUri: stub.Uri.file(REPO_ROOT),
    subscriptions: [] as { dispose(): void }[],
  } as unknown as Parameters<typeof import('../../src/ui/assemblyView.ts').registerAssembledChat>[0]

  const view = await import('../../src/ui/assemblyView.ts')
  view.registerAssembledChat(context, manager, logger)
  view.registerAssembledSidebar(context, manager, logger)

  const provider = stub.viewProviders.get('dshOne.chat') as { resolveWebviewView(v: unknown): void }
  const { webview, kill } = createStubWebview()
  const sidebarView = fakeWebviewView(webview)
  provider.resolveWebviewView(sidebarView)
  // 侧栏那一页自己也要装一次（它占一份 mirror 引用，配平判据要把它算进去）。
  await waitUntil('侧栏 webview 装上装配页', () => webview.html !== '', 10_000)

  let hostCallId = 0
  // 模块级的表是全进程共享的（同一份 `src/ui/assemblyView.ts` 被所有 harness 共用），
  // 所以这里只暴露本 harness 这一段：面板与用户提示都按基线切片给出。
  const panelBase = panels.length
  const messageBase = messagesShown.length
  let closed = false

  return {
    logs,
    gatewayUrl,
    get panels(): StubPanel[] {
      return panels.slice(panelBase)
    },
    get messages(): { level: 'error' | 'warn' | 'info'; message: string }[] {
      return messagesShown.slice(messageBase)
    },
    sidebarWebview: webview,
    assembly: {
      revealAssembledChat: () => view.revealAssembledChat(),
      hasAssembledChatPanel: () => view.hasAssembledChatPanel(),
      wasAssembledChatClosedByUser: () => view.wasAssembledChatClosedByUser(),
      openSessionInNewTab: (sessionId: string) => view.openSessionInNewTab(sessionId),
    },
    setFailNextPanelCreate: stub.setFailNextPanelCreate,
    clickSession(sessionId: string): void {
      webview.__receive({ type: 'dshOne.sessionSelected', sessionId })
    },
    requestPanel(sessionId: string): void {
      hostCallId += 1
      webview.__receive({
        type: 'dshOne.hostCall',
        id: `lab-call-${hostCallId}`,
        call: 'session.openPanel',
        args: { sessionId },
      })
    },
    async runCommand(commandId: string): Promise<void> {
      const handler = registeredCommands.get(commandId)
      if (handler === undefined) throw new Error(`lab: command ${commandId} is not registered`)
      await handler()
    },
    disposeSidebarView(): void {
      sidebarView.dispose()
      kill()
    },
    mirrorOriginOf(panel: StubPanel): string {
      const match = /<base href="(http:\/\/[^"]+)\/">/.exec(panel.webview.html)
      if (match === null) throw new Error('lab: panel page has no mirror base href')
      return match[1]!
    },
    lines(pattern: RegExp): string[] {
      return logs.map((line) => line.message).filter((message) => pattern.test(message))
    },
    waitFor: (what, predicate, timeoutMs) => waitUntil(what, predicate, timeoutMs),
    async close(): Promise<void> {
      if (closed) return
      closed = true
      sidebarView.dispose()
      kill()
      // 本 harness 建出来的面板全部关掉：模块状态是全进程共享的，留着会串到下一个用例
      // （残留的多开格子会让下一个用例以为「这个会话已经开着」）。
      for (const panel of panels.slice(panelBase)) if (!panel.dead) panel.dispose()
      // fetch 的 keep-alive 连接会让 server.close() 一直不回调：先掐连接再关。
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** 等一个条件成立；不成立就抛（带上看的是哪一件事）。 */
export async function waitUntil(
  what: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`lab: timed out waiting for ${what}`)
}

/** 这个地址现在还有人在监听吗（mirror 引用归零后应当没人了）。 */
export async function portAnswers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(500) })
    await res.text()
    return true
  } catch {
    return false
  }
}
