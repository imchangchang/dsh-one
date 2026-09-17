/**
 * @dsh-one/vscode-session-boot——chat 树的会话启动注入 + 活跃上报（#71 分期 B）。
 *
 * 启动注入（spike #69 题4 机制，浏览器验证已实证）：读宿主经
 * __DSH_ONE_BOOT__.sessionId 注入的目标会话 id，等官方 sessions.list
 * phase=ready 后走官方打开会话的入口 `uiWorkspace.openSession`（机制层 2；
 * 为什么不是 `sessions.open`——那条在 0.1.6-alpha.2 被官方删了——见下面
 * openSession 的注释）——tab 启动即该会话，历史/composer 完整。无注入时保持官方
 * 恢复行为（默认 tab 不变），恢复键（dsh.sessions.current）路线禁用：多 tab 同源
 * localStorage 互相覆盖已实证（spike 题4 实验2），协调全靠宿主映射 + 本注入。
 *
 * 活跃上报：每次「当前会话」变化（含注入 open 的结果与官方恢复值）广播
 * {type:'dshOne.sessionMeta', sessionId, title}——宿主维护 tab↔会话映射、
 * 跟随面板标题；首拍恢复值也上报（默认 tab 借此挂接映射）。
 *
 * 状态上报（#169）：同一拍把「我是哪个面板、当前开着哪个会话」通过官方
 * `acquireVsCodeApi().setState()` 存进这条 webview 的 state。窗口重载 / 扩展
 * 宿主重启之后，VS Code 只把有 serializer 的 webview 的 state 交回宿主
 * （`deserializeWebviewPanel`），宿主据此把标签页恢复回原会话。状态只能由
 * 页面写——`WebviewPanel` 没有 state 属性（vscode.d.ts 头注写明了这条分工）。
 */

import { CHAT_PANEL_STATE_VERSION } from '../../../pure/chatPanelState.ts'
import { withCurrentSession, type SessionListLike } from '../../../pure/workspaceTreeView.ts'

/**
 * 会话列表快照：形状（`ids` / `byId` / `current`）见 `pure/workspaceTreeView.ts` 的
 * `SessionListLike`，这里只补这一页要用的 `phase`。
 */
interface SessionsListSnapshot extends SessionListLike {
  phase: string
}

interface SessionsService {
  list: {
    getSnapshot(): SessionsListSnapshot
    subscribe(listener: () => void): () => void
  }
}

/** 官方打开会话的入口（官方 `ui-workspace` 的 `openSession`，见下面的 openSession）。 */
interface UiWorkspaceService {
  openSession(sessionId: string): void
}

interface BootContext {
  get(name: 'sessions'): SessionsService
  get(name: 'uiWorkspace'): UiWorkspaceService
  effect(body: () => (() => void) | void, label?: string): void
}

interface VscodeApi {
  postMessage(msg: unknown): void
  /** 官方持久化口：宿主恢复标签页时会把它交回 `deserializeWebviewPanel`。 */
  setState?(state: unknown): void
}

interface BootGlobals {
  __DSH_ONE_BOOT__?: { sessionId?: unknown; panelTab?: unknown }
  __DSH_ONE_VSCODE__?: VscodeApi
  acquireVsCodeApi?: () => VscodeApi
}

const bootSessionId = (): string | undefined => {
  const raw = (globalThis as BootGlobals).__DSH_ONE_BOOT__?.sessionId
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** 本页是不是多开的标签页（宿主经 __DSH_ONE_BOOT__ 注入，#169）。 */
const bootPanelTab = (): boolean => (globalThis as BootGlobals).__DSH_ONE_BOOT__?.panelTab === true

/** 共用取一次 acquireVsCodeApi（全页只允许调一次，probe 是统一获取点）。 */
const vscodeApi = (): VscodeApi | undefined => {
  const g = globalThis as BootGlobals
  let vscode = g.__DSH_ONE_VSCODE__
  if (vscode === undefined && typeof g.acquireVsCodeApi === 'function') {
    try {
      vscode = g.acquireVsCodeApi()
      g.__DSH_ONE_VSCODE__ = vscode
    } catch {
      /* 二次 acquire throw：probe 已持有且全局缺失（不应发生） */
    }
  }
  return vscode
}

const postMeta = (sessionId: string, title: string | undefined): void => {
  vscodeApi()?.postMessage({ type: 'dshOne.sessionMeta', sessionId, title })
}

/** 上次存进 webview state 的会话 id（同值不重复写）。 */
let persistedSessionId: string | null | undefined

/**
 * 把这条面板的身份存进 webview 的 state（#169）。恢复链路上宿主读回来的就是
 * 它；浏览器里没有 acquireVsCodeApi（实验室/官方 web），setState 缺席，整个
 * 调用是空操作。
 */
const persistPanelState = (sessionId: string | undefined): void => {
  const value = sessionId ?? null
  if (persistedSessionId === value) return
  persistedSessionId = value
  vscodeApi()?.setState?.({ v: CHAT_PANEL_STATE_VERSION, sessionId: value, tab: bootPanelTab() })
}

const timingLog = (phase: string, detail = ''): void => {
  const line = `[assembly] boot-timing ${phase} ${Math.round(performance.now())}ms ${detail}`.trim()
  console.log(line)
  const probe = (globalThis as { __DSH_ONE_PROBE__?: { log(level: string, text: string): void } }).__DSH_ONE_PROBE__
  if (probe) probe.log('info', line)
}

export const inject = ['sessions', 'uiWorkspace']

/**
 * 打开（选中）一条会话——官方 `uiWorkspace.openSession`。
 *
 * **为什么不调 `sessions.open(id)`**（#191）：那个方法在 dsh 0.1.6-alpha.2 被删掉了
 * （官方把「选中」交给会话视图的所有者，`ctx.sessions` 只剩引用管理口）。继续调它，
 * 这里是 `try/catch` 吞掉的——于是「宿主注入的会话」静默不生效：面板停在官方恢复的
 * 那条（或空），宿主也就永远收不到 first-meta（alpha.2 上 F-08 实测红在这里）。
 * 官方那条入口两代都在、实现随版本自更新（alpha.1 = `sessions.open(id)` +
 * `layout.selectPanel(null)`；alpha.2 = retain 一条 `mainView` 引用 + 记选中），
 * 官方 ui-chat / ui-subagent / ui-workflow-run 也走它——一个入口覆盖两代，不分叉。
 */
const openSession = (ctx: BootContext, sessionId: string): void => {
  ctx.get('uiWorkspace').openSession(sessionId)
}

export function apply(ctx: BootContext): void {
  // apply 时刻 ≈ 整树插件装载完（本插件在 application 批末位）。
  timingLog('apply')
  // 运行时就地切换（#71 单例终态）：宿主转发的 dshOne.switchSession → 官方
  // uiWorkspace.openSession(id)（机制层 2 官方服务 API）——不 reload、不遮罩（遮罩只
  // 服务冷启动注入），官方切换自带加载态。
  const onSwitchMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; sessionId?: unknown } | undefined
    if (data?.type !== 'dshOne.switchSession' || typeof data.sessionId !== 'string' || data.sessionId === '') return
    const list = ctx.get('sessions').list.getSnapshot()
    if (withCurrentSession(list).current === data.sessionId) return
    try {
      openSession(ctx, data.sessionId)
      timingLog('switch', data.sessionId.slice(0, 13))
    } catch {
      /* 目标不在列表（被归档等）：保持现状 */
    }
  }
  window.addEventListener('message', onSwitchMessage)
  const target = bootSessionId()
  // 整包网络字节（transferSize=0 = 命中 HTTP 缓存，#71 性能对照指标）。
  const comboEntry = performance
    .getEntriesByType('resource')
    .find((entry) => entry.name.includes('/plugins-local/')) as PerformanceResourceTiming | undefined
  timingLog('combo', `bytes=${comboEntry?.transferSize ?? '?'} dur=${Math.round(comboEntry?.duration ?? 0)}ms`)
  let injected = false
  let reportedFirstMeta = false
  /**
   * 这一页的身份定了没有：`true` = 注入目标已经是当前会话，或者压根不再等它
   * （没有注入 / 目标不在列表 / 重试预算用尽）。`false` 期间**不上报**：此刻的
   * current 是官方启动恢复的过渡值，多开页共用同一份 localStorage，那个值是别的
   * 面板的会话，报给宿主只会让 tab↔会话映射绑错（#72 的「互不串」判据盯的就是它）。
   */
  let identitySettled = target === undefined
  const normalize = (): SessionsListSnapshot => ctx.get('sessions').list.getSnapshot()
  const currentOf = (list: SessionsListSnapshot): string | undefined => withCurrentSession(list).current
  /**
   * 活跃上报：当前会话与标题（变化即报，宿主去重）。身份没定下来之前一条都不报
   * （见 `identitySettled` 的说明）。
   */
  const report = (list: SessionsListSnapshot): void => {
    if (!identitySettled) return
    const current = currentOf(list)
    if (current === undefined) return
    if (!reportedFirstMeta) {
      reportedFirstMeta = true
      timingLog('first-meta', current.slice(0, 13))
    }
    persistPanelState(current)
    postMeta(current, list.byId[current]?.displayTitle ?? list.byId[current]?.title)
  }
  /** 目标已落定？落定就把身份标记为定下来（之后的切换按正常路径上报）。 */
  const settle = (list: SessionsListSnapshot): boolean => {
    if (target === undefined || identitySettled) return identitySettled
    if (currentOf(list) === target) identitySettled = true
    else if (list.byId[target] === undefined) identitySettled = true
    return identitySettled
  }
  const injectTarget = (): void => {
    if (target === undefined || settle(normalize())) return
    try {
      openSession(ctx, target)
    } catch {
      /* 目标 id 不在列表（会话被归档等）：保持官方恢复值 */
    }
  }
  /**
   * 启动注入：喊一次 + 落定前的有限次重试。
   *
   * 为什么不是喊一次就够（#191 实测）：0.1.6-alpha.2 起官方把「恢复上次选中的会话」搬进
   * ui-workspace 自己的 watcher（它等 sessions/workspaces 双双 ready 才动），与我们
   * 「sessions ready 就注入」几乎同时——实测**首次**注入会被它盖掉（多开页上恢复值是
   * 别的面板的会话），要再喊一次才落定。重试只到「目标成为当前会话」为止，预算用尽就
   * 不再等（那时按正常路径上报，不把这一页永久钉住）。
   */
  const injectRetries = target === undefined ? [] : [150, 400, 900]
  /** 重试预算用尽的时刻：那时还等不到目标就不再拦上报（这一页不永久哑掉）。 */
  const INJECT_GIVE_UP_MS = 1500
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const scheduleInjectRetries = (): void => {
    for (const delay of injectRetries) {
      timers.push(
        setTimeout(() => {
          if (settle(normalize())) return
          injectTarget()
        }, delay),
      )
    }
    timers.push(
      setTimeout(() => {
        if (identitySettled) return
        identitySettled = true
        report(normalize())
      }, INJECT_GIVE_UP_MS),
    )
  }
  ctx.effect(() => {
    return () => {
      window.removeEventListener('message', onSwitchMessage)
      for (const timer of timers) clearTimeout(timer)
    }
  }, 'dsh-one session boot: dispose switch listener + inject retries')
  ctx.get('sessions').list.subscribe(() => {
    const list = ctx.get('sessions').list.getSnapshot()
    if (list.phase !== 'ready') return
    // 当前会话先归一（#191）：官方 0.1.6-alpha.2 起快照里不再有 `current` 字段，
    // 官方改成从行上的 `retainedBy.mainView` 推（见 withCurrentSession）。不归一的话
    // 这一页既不会注入目标会话，也不会往宿主上报名。
    const current = withCurrentSession(list).current
    if (!injected) {
      injected = true
      timingLog('list-ready', `target=${target ?? 'none'}`)
      injectTarget()
      scheduleInjectRetries()
    }
    settle(list)
    report(list)
  })
}
