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
 * **注入是「盯住目标直到落定」，不是「喊一次/几拍固定重试」**（#205）：官方的启动
 * 恢复会来抢同一个选中值，而且**喊不动**的两类情形（目标还没出现在这页的列表里、
 * 这一页开不了它）都不能静默——前者的旧写法把「一眼没看到」当成结论就此收手，后者
 * 的旧写法把抛出的错吞掉。落点见 `assertDesired` / `watchTick`。
 *
 * **目标开不了时落到「新对话页」，不留在官方空态**（#211，用户拍板）：观察窗口走完
 * 目标仍不是当前会话 = 这一页开不了它（不存在 / 已删除 / 在归档或回收站里），那一刻
 * 经官方那条「新会话」入口（`uiWorkspace.startSession`，复用空白会话、没有才新建）
 * 把这一页落到新对话页，并吹哨让遮罩揭幕。落点与副作用见 `landOnNewConversation`；
 * 运行时就地切换那条通路不落（见 `fallbackEligible`）。
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
  /**
   * 官方「新会话」入口（`ui-workspace` 的 `startSession`，官方侧栏那枚 ＋ 与官方
   * agent-preset 调的也是它）。语义与落点见 {@link landOnNewConversation}；老版本上
   * 没有这一条时按「拿不到入口」处置，所以标成可选。
   */
  startSession?(workspaceId?: string): void
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
  /**
   * 这一页已经落到「新对话页」（#211 的目标开不了时，见 {@link landOnNewConversation}）。
   *
   * 与 `__DSH_ONE_BOOT__` 同一条 seam（第 3 层）：两个自有 shell 插件是两个独立
   * bundle，没有共享的模块作用域；遮罩（`chatLayoutPlugin`）据此揭幕。
   */
  __DSH_ONE_BOOT_NEW_CONVERSATION__?: boolean
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

/**
 * 盯目标的观察窗口（毫秒）：这段时间里只要「想要的当前会话」还没落定就继续喊，到点按实际
 * 读数说一句并放手。**为什么要一个窗口而不是几拍固定重试**（#205）：旧写法是 150/400/900
 * 三拍固定时刻重试，加上一条「目标不在列表里就当它已经定下来」的早退——那三拍错过了就永远
 * 错过了，而且「一眼没看到目标」被当成了结论（列表分批到、会话刚从回收站恢复，都会先看不到
 * 它）。窗口内的每一拍都是重新看一眼当前读数，不依赖「上一次是第几拍」。
 */
const WATCH_TARGET_MS = 1500

/** 盯目标的节拍（毫秒）：窗口内每隔这么久看一眼；列表有变化时另有一拍（订阅驱动）。 */
const WATCH_TICK_MS = 250

/** 两次真的喊 `openSession` 之间的最小间隔：列表频繁刷新时别把它打成风暴。 */
const WATCH_MIN_GAP_MS = 250

/**
 * 目标开不了时把这一页落到「新对话页」（#211）——走官方 `uiWorkspace.startSession`。
 *
 * **为什么是它**（也就是「注入目标开不了时的行为」这条口径的落点）：它就是官方那枚
 * 「新会话」按钮的实现（官方侧栏的 ＋ 走 `workspaceNavigation.startSession`、官方
 * agent-preset 也调它），语义正是我们要的——目标工作区按
 * `workspaceId ?? 当前会话所属工作区 ?? 最近的工作区` 取，在里面**复用一条空白会话、
 * 没有才新建**（官方 `connectWorkspace`），然后选中它。这与官方 web 在「没有当前会话」
 * 时的启动行为同源（官方 `ui-workspace` 的 `watchNavigation` 也是
 * `connectWorkspace(recentWorkspace)` 之后再 open），所以这一页的落点与官方页对齐：
 * #211 实测官方页在没有当前会话时渲染的就是这个「新对话页」——hero 标题 + 工作区 chip +
 * 可用的 composer（占位「描述你想要构建的内容…」）。
 *
 * **副作用**（#211 要求写清）：目标工作区里没有可复用的空白会话时，官方这条入口会在
 * 网关**真建一条会话**（`sessions.create`）。官方 web 在同一情形下同样会建，所以这不是
 * 我们额外加的动作；反过来，我们自己挑工作区、自己 create 会重新实现一遍官方策略
 * （最近工作区的算法在官方是内部函数），所以不那样做。
 *
 * 拿不到这条入口（老版本没有 `startSession`）时不假装成功：记一条事实，这一页停在官方
 * 空态。**不在运行时就地切换那条通路上落**（见 `fallbackEligible`）：用户点的是某一条
 * 具体的会话，那一刻说清「开不了它」比擅自换成新会话更贴他的意图。
 */
const landOnNewConversation = (ctx: BootContext): void => {
  const workspace = ctx.get('uiWorkspace')
  if (typeof workspace.startSession !== 'function') {
    timingLog('fallback-unavailable', 'uiWorkspace.startSession is missing; leaving the shell in the official no-session state')
    return
  }
  // 揭幕的哨子先吹，再喊官方那条入口（chatLayoutPlugin 据此揭幕，见下面的 why）。
  ;(globalThis as BootGlobals).__DSH_ONE_BOOT_NEW_CONVERSATION__ = true
  // **为什么要一个事件，而不只是那个全局**（实测踩出来的，不是保险）：遮罩是 React 渲染的，
  // 读全局只在下一次重渲时生效——而「落到新对话页」这一下**未必**引起重渲（目标开不了时
  // 官方那条 watcher 往往已经把一条空白会话选成当前会话了，我们再选中同一条，会话列表一个
  // 字节都不变），那一刻遮罩就永远停在那里（#211 实验室实测：注入不存在的 id 那一档，改成
  // 只写全局之后遮罩盖到底、下面明明已经是可用的新对话页）。事件是跨 bundle 的**主动**通知，
  // 遮罩那一侧收到就提一个 state，重渲一次；全局留着当事实源——遮罩那一侧后挂载时（React
  // 重新挂载 ShellFrame）仍能从它读到「哨已经吹过」，不会把遮罩盖回来。
  window.dispatchEvent(new Event('dsh-one:boot-new-conversation'))
  timingLog('fallback-new-conversation', 'target cannot be opened in this page; opening a new conversation in the default workspace')
  try {
    workspace.startSession()
  } catch (err) {
    console.warn(`[dsh-one] opening a new conversation failed: ${describeError(err)}`)
  }
}

export function apply(ctx: BootContext): void {
  // apply 时刻 ≈ 整树插件装载完（本插件在 application 批末位）。
  timingLog('apply')
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
   * （没有注入 / 观察窗口走完）。`false` 期间**不上报**：此刻的 current 是官方启动恢复的
   * 过渡值，多开页共用同一份 localStorage，那个值是别的面板的会话，报给宿主只会让
   * tab↔会话映射绑错（#72 的「互不串」判据盯的就是它）。
   */
  let identitySettled = target === undefined
  /**
   * 这一页「想要的当前会话」：冷启动是宿主注入的目标，运行时就地切换会改写它（同一个
   * 盯法服务两条通路，见 assertDesired）。
   */
  let desired = target
  /** 目标盯到什么时候为止；窗口走完就不再插手（用户手动切走不会被拽回来）。 */
  let watchUntil = desired === undefined ? 0 : performance.now() + WATCH_TARGET_MS
  /** 上一次真的喊 `openSession` 的时刻（节流，见 WATCH_MIN_GAP_MS）。 */
  let lastAssert = 0
  /** 「目标还没出现在列表里」只记一次（每一拍都记会把日志刷满）。 */
  let waitingLogged = false
  /** 「这一页开不了它」只记一次（同上）。 */
  let failedLogged = false
  /** 窗口走完时那句「没落定」的读数只说一次。 */
  let gaveUpLogged = false
  /**
   * 目标开不了时「落到新对话页」这一步交出去了没有（#211，见 landOnNewConversation）。
   * 一次就够：同一个页面不需要再交第二次。
   */
  let fallbackApplied = false
  /**
   * 这条通路上目标开不了时要不要落到新对话页（#211）：**只有启动注入要**。运行时就地切换
   * （宿主转发的 `dshOne.switchSession`）不落——用户点的是某一条具体的会话，那一刻说清
   * 「开不了它」（#205 那条通路上的判据）比擅自给他换一条新会话更贴他的意图。
   */
  let fallbackEligible = target !== undefined
  let disposed = false
  const timers: Array<ReturnType<typeof setTimeout>> = []
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
  /**
   * 喊一次 `openSession(desired)`——**盯住目标**这一条的中心：不是「喊过了就算了」，
   * 而是在窗口内每一拍都重新看一眼「它到了没有」，没到就再喊一次。
   *
   * 为什么必须盯（#205）：官方 0.1.6-alpha.2 起把「恢复上次选中的会话」搬进了
   * ui-workspace 自己的 watcher（它等 sessions/workspaces 双双 ready 才动），与我们
   * 「sessions ready 就注入」几乎同时——多开页上恢复值是别的面板的会话，首次注入会被它
   * 盖掉，要再喊才落定；官方这次先到、我们后到也一样要靠再喊补上。而**喊不动**的两种
   * 情形都不许静默：目标还没出现在列表里（列表分批到、会话刚从回收站恢复）只记一条
   * `inject-wait` 并继续等，`openSession` 抛了（这一页开不了它）当场说出来——旧写法把
   * 抛出的错吞掉、把「一眼没看到目标」当成「已经定下来」，于是用户看到的是一个空面板，
   * 日志里只有遮罩那句「timed out」（#205 的现场）。
   */
  const assertDesired = (list: SessionsListSnapshot): void => {
    if (desired === undefined) return
    if (currentOf(list) === desired) {
      identitySettled = true
      return
    }
    if (performance.now() >= watchUntil) return
    if (list.byId[desired] === undefined) {
      if (!waitingLogged) {
        waitingLogged = true
        timingLog('inject-wait', `target=${desired.slice(0, 13)} not in this page's session list yet`)
      }
      return
    }
    const now = performance.now()
    if (now - lastAssert < WATCH_MIN_GAP_MS) return
    lastAssert = now
    try {
      openSession(ctx, desired)
    } catch (err) {
      if (!failedLogged) {
        failedLogged = true
        console.warn(`[dsh-one] opening session ${desired.slice(0, 13)} failed: ${describeError(err)}`)
      }
    }
  }
  /**
   * 盯目标的一拍：先喊（该喊的话），再看窗口走完没有。走完时按**实际读数**说一句——
   * 目标没落定时那句 warn 说的就是「谁成了当前会话 / 它压根不在这页的列表里」，与遮罩
   * 那句 generic 的 timeout 分开（遮罩只管盖不盖着，这里管目标到底怎么了）。
   *
   * 窗口走完而目标仍不是当前会话 = 这一页**开不了它**（清单 ready 之后目标仍不在本页
   * 清单里，就是不存在或不属于这一页；在清单里却没成为当前会话的，是被官方按归档清掉了
   * ——#211 实验室实测的两档读数）：那一刻这一页不许停在「没有当前会话」的官方空态，
   * 按官方那条「新会话」入口落到新对话页（见 landOnNewConversation）。
   *
   * `listDriven` = 这一拍由列表变化驱动（那是「页面状态变了」，照旧往宿主上报一次）；
   * 纯节拍只在「身份刚定下来」那一拍上报，免得盯着的 1.5 秒里每 250ms 重复报一遍。
   */
  const watchTick = (listDriven: boolean): void => {
    const list = normalize()
    const settledBefore = identitySettled
    assertDesired(list)
    if (performance.now() >= watchUntil) {
      if (desired !== undefined && currentOf(list) !== desired && !gaveUpLogged) {
        gaveUpLogged = true
        const current = currentOf(list)
        const why =
          list.byId[desired] === undefined
            ? 'not in this page session list'
            : current === undefined
              ? 'no current session'
              : `current is ${current.slice(0, 13)}`
        console.warn(
          `[dsh-one] session ${desired.slice(0, 13)} did not become current within ${String(WATCH_TARGET_MS)}ms (${why})`,
        )
      }
      // 窗口走完就放手：这一页不永久哑掉，宿主照常拿到它实际开着的那条。
      identitySettled = true
      // #211：目标开不了 → 落到新对话页（不是停在空态、也不是留住恢复键那条别的会话）。
      if (fallbackEligible && !fallbackApplied && desired !== undefined && currentOf(list) !== desired) {
        fallbackApplied = true
        landOnNewConversation(ctx)
      }
    }
    if (listDriven || (identitySettled && !settledBefore)) report(list)
  }
  /**
   * 盯着目标的节拍：窗口内每隔 `WATCH_TICK_MS` 走一拍（列表有变化时另有一拍，见下面
   * 的订阅）。节拍靠 `ticking` 去重——运行时就地切换会重开一个新窗口。
   */
  let ticking = false
  const ensureTicker = (): void => {
    if (ticking) return
    ticking = true
    const step = (): void => {
      timers.push(
        setTimeout(() => {
          if (disposed) {
            ticking = false
            return
          }
          watchTick(false)
          if (performance.now() < watchUntil) step()
          else ticking = false
        }, WATCH_TICK_MS),
      )
    }
    step()
  }
  // 运行时就地切换（#71 单例终态）：宿主转发的 dshOne.switchSession 也走**同一条**
  // 盯目标的通路（机制层 2 官方服务 API）——不 reload、不遮罩（遮罩只服务冷启动注入），
  // 官方切换自带加载态。旧写法在这里只喊一次且吞错：被盖掉或喊不动时用户看到的是
  // 「点了没反应」，日志里一个字都没有。
  const onSwitchMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; sessionId?: unknown } | undefined
    if (data?.type !== 'dshOne.switchSession' || typeof data.sessionId !== 'string' || data.sessionId === '') return
    const list = ctx.get('sessions').list.getSnapshot()
    if (withCurrentSession(list).current === data.sessionId) return
    desired = data.sessionId
    watchUntil = performance.now() + WATCH_TARGET_MS
    waitingLogged = false
    failedLogged = false
    gaveUpLogged = false
    lastAssert = 0
    // 运行时就地切换这条通路上不落新对话页（见 fallbackEligible 的说明）——用户点的是
    // 某一条具体的会话，那一条开不了时页面照旧说得出原因（#205 的第四档判据）。
    fallbackEligible = false
    timingLog('switch', data.sessionId.slice(0, 13))
    ensureTicker()
    watchTick(true)
  }
  window.addEventListener('message', onSwitchMessage)
  ctx.effect(() => {
    return () => {
      disposed = true
      window.removeEventListener('message', onSwitchMessage)
      for (const timer of timers) clearTimeout(timer)
    }
  }, 'dsh-one session boot: dispose switch listener + target watch')
  ctx.get('sessions').list.subscribe(() => {
    const list = ctx.get('sessions').list.getSnapshot()
    if (list.phase !== 'ready') return
    // 当前会话先归一（#191）：官方 0.1.6-alpha.2 起快照里不再有 `current` 字段，
    // 官方改成从行上的 `retainedBy.mainView` 推（见 withCurrentSession）。不归一的话
    // 这一页既不会注入目标会话，也不会往宿主上报名。
    if (!injected) {
      injected = true
      timingLog('list-ready', `target=${desired ?? 'none'}`)
      ensureTicker()
      watchTick(true)
      return
    }
    watchTick(true)
  })
}

/** 错误对象说成人话（`openSession` 抛的是什么，日志里要看得见）。 */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
