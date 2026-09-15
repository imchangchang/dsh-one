/**
 * @dsh-one/vscode-session-bridge——侧栏树的选择监听桥（#71 分期 B）。
 *
 * 机制层 2（官方服务 API）：订阅官方 sessions 服务的 list 快照（spike #69
 * 题2 已验证：点会话行 = 本地 select 赋值，list.current 随之变化并通知订阅），
 * 选中项变化即 postMessage {type:'dshOne.sessionSelected', sessionId} 给宿主。
 * 不拦截点击、不碰官方组件；统一获取点（__DSH_ONE_VSCODE__）复用，acquire
 * 单次约束安全。
 *
 * 首值抑制：list ready 时的初始选中（官方恢复或 watchNavigation 自动选择）
 * 只记录不上报——避免宿主把「默认 tab 的官方恢复」误开成第二个 tab；此后
 * current 每次真实变化（用户点行 / New Session 建空白会话后的导航）都上报。
 */

interface SessionsListSnapshot {
  phase: string
  current?: string
}

interface SessionsService {
  open(id: string): void
  list: {
    getSnapshot(): SessionsListSnapshot
    subscribe(listener: () => void): () => void
  }
}

interface BridgeContext {
  get(name: 'sessions'): SessionsService
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

export function apply(ctx: BridgeContext): void {
  let lastReported: string | undefined
  let initialized = false
  ctx.get('sessions').list.subscribe(() => {
    const snapshot = ctx.get('sessions').list.getSnapshot()
    if (snapshot.phase !== 'ready') return
    const current = snapshot.current
    // undefined（恢复未落地/被清空）只等不登记：初始选中以「首个非空
    // current」为准，官方恢复/watchNavigation 自动选择都发生在 ready 之后，
    // 全部静默——默认 tab 走官方恢复（#68 语义），不替它开第二个 tab。
    if (current === undefined) return
    if (!initialized) {
      initialized = true
      lastReported = current
      return
    }
    if (current === lastReported) return
    lastReported = current
    postSelected(current)
  })
}
