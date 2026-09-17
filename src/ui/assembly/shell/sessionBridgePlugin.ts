/**
 * @dsh-one/vscode-session-bridge——侧栏树的选择监听桥（#71 分期 B；#65 返修 7
 * 修启动竞态：不再吞掉用户启动后的第一次点击）。
 *
 * 机制层 2（官方服务 API）：订阅官方 sessions 服务的 list 快照（spike #69
 * 题2 已验证：点会话行 = 本地 select 赋值，list.current 随之变化并通知订阅），
 * 选中项变化即 postMessage {type:'dshOne.sessionSelected', sessionId} 给宿主。
 * 不拦截点击、不碰官方组件；统一获取点（__DSH_ONE_VSCODE__）复用，acquire
 * 单次约束安全。
 *
 * 启动竞态与判别（原实现只按「首个非空 current」抑制，把用户第一次点击一起吞了）：
 * - **恢复键参照**：页面加载最早期读 `dsh.sessions.current`（pageHtml 注入的
 *   `__DSH_ONE_RESTORE__`，早于官方应用改写它；实测该键会被官方启动流程重写成
 *   `{}`，所以必须早读）。首个非空 current 等于它 = 官方恢复；
 * - **交互信号（第 4 层）**：用户在侧栏自有容器（`[data-shell="dsh-one-sidebar"]`）
 *   上的 pointerdown → 之后到来的值一律视为用户驱动。官方侧没有「这次变化是点击
 *   造成的」的服务/事件接缝（list 快照只有值、没有来源），只能在自有容器上捕获
 *   一次指针事件来判断，这是第 4 层兜底的最小实现；选择器用的是**我们自己的**
 *   data 属性，不进官方 DOM 结构。
 * 判别逻辑本体在 src/pure/sidebarSelectionGate.ts（纯函数 + 单测）。
 *
 * 去重责任在**宿主**（assemblyView 按面板当前会话去重），桥只负责「值变了就上报」，
 * 不再做任何猜测。
 */
import { decideSelectionReport, restoreSessionIdOf } from '../../../pure/sidebarSelectionGate.ts'
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

interface BridgeContext {
  get(name: 'sessions'): SessionsService
  effect(body: () => (() => void) | void, label?: string): void
}



const postSelected = (sessionId: string): void => {
  const g = globalThis as {
    __DSH_ONE_VSCODE__?: { postMessage(msg: unknown): void }
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void }
  }
  let vscode = g.__DSH_ONE_VSCODE__
  if (vscode === undefined && typeof g.acquireVsCodeApi === 'function') {
    try {
      vscode = g.acquireVsCodeApi()
      g.__DSH_ONE_VSCODE__ = vscode
    } catch {
      /* 二次 acquire throw：probe 已持有且全局缺失（不应发生） */
    }
  }
  vscode?.postMessage({ type: 'dshOne.sessionSelected', sessionId })
}

export const inject = ['sessions']

/** 自有容器：侧栏树的装配 frame 根（我们自己的 data 属性）。 */
const sidebarRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell="dsh-one-sidebar"]')

/** pageHtml 注入的启动早期读数（早于官方应用改写恢复键）。 */
const restoreIdAtBoot = (): string | undefined =>
  restoreSessionIdOf((globalThis as { __DSH_ONE_RESTORE__?: string | null }).__DSH_ONE_RESTORE__)

export function apply(ctx: BridgeContext): void {
  let state: { started: boolean; lastReported?: string | undefined } = { started: false }
  let userInteracted = false
  const restoreId = restoreIdAtBoot()

  // 用户交互信号（第 4 层，见文件头）：一次 pointerdown 就够——之后到来的 current
  // 值都是用户驱动的，不再抑制。监听挂 document 捕获阶段并按**包含判定**过滤到自己
  // 的容器：插件 apply 早于 frame 挂载，直接挂容器会挂空（实测过）；只读一个布尔、
  // 不拦事件、不 preventDefault。
  const markInteracted = (event: Event): void => {
    const root = sidebarRoot()
    const target = event.target as Node | null
    if (root === null || target === null || !root.contains(target)) return
    userInteracted = true
  }
  ctx.effect(() => {
    document.addEventListener('pointerdown', markInteracted, true)
    return () => document.removeEventListener('pointerdown', markInteracted, true)
  }, 'dsh-one session bridge: user interaction probe')

  ctx.get('sessions').list.subscribe(() => {
    const snapshot = ctx.get('sessions').list.getSnapshot()
    if (snapshot.phase !== 'ready') return
    // 当前会话先归一（#191）：官方 0.1.6-alpha.2 起快照里不再有 `current` 字段，
    // 官方改成从行上的 `retainedBy.mainView` 推——不分叉就会一直读到 undefined，
    // 选择桥从此一条都不上报（宿主拿不到「面板里在看哪条会话」）。见 withCurrentSession。
    const current = withCurrentSession(snapshot).current
    // undefined（恢复未落地/被清空）只等不登记
    if (current === undefined) return
    const decision = decideSelectionReport(state, current, { restoreId, userInteracted })
    state = decision.next
    if (!decision.report) return
    postSelected(current)
  })
}
