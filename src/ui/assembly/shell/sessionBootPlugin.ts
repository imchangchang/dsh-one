/**
 * @dsh-one/vscode-session-boot——chat 树的会话启动注入 + 活跃上报（#71 分期 B）。
 *
 * 启动注入（spike #69 题4 机制，浏览器验证已实证）：读宿主经
 * __DSH_ONE_BOOT__.sessionId 注入的目标会话 id，等官方 sessions.list
 * phase=ready 后走官方 sessions 服务 open(id)（机制层 2）——tab 启动即
 * 该会话，历史/composer 完整。无注入时保持官方恢复行为（默认 tab 不变），
 * 恢复键（dsh.sessions.current）路线禁用：多 tab 同源 localStorage 互相
 * 覆盖已实证（spike 题4 实验2），协调全靠宿主映射 + 本注入。
 *
 * 活跃上报：每次 list.current 变化（含注入 open 的结果与官方恢复值）广播
 * {type:'dshOne.sessionMeta', sessionId, title}——宿主维护 tab↔会话映射、
 * 跟随面板标题；首拍恢复值也上报（默认 tab 借此挂接映射）。
 */

interface SessionsListSnapshot {
  phase: string
  current?: string
  byId: Record<string, { displayTitle?: string; title?: string }>
}

interface SessionsService {
  open(id: string): void
  list: {
    getSnapshot(): SessionsListSnapshot
    subscribe(listener: () => void): () => void
  }
}

interface BootContext {
  get(name: 'sessions'): SessionsService
  effect(body: () => (() => void) | void, label?: string): void
}

interface BootGlobals {
  __DSH_ONE_BOOT__?: { sessionId?: unknown }
  __DSH_ONE_VSCODE__?: { postMessage(msg: unknown): void }
  acquireVsCodeApi?: () => { postMessage(msg: unknown): void }
}

const bootSessionId = (): string | undefined => {
  const raw = (globalThis as BootGlobals).__DSH_ONE_BOOT__?.sessionId
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

const postMeta = (sessionId: string, title: string | undefined): void => {
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
  vscode?.postMessage({ type: 'dshOne.sessionMeta', sessionId, title })
}

const timingLog = (phase: string, detail = ''): void => {
  const line = `[assembly] boot-timing ${phase} ${Math.round(performance.now())}ms ${detail}`.trim()
  console.log(line)
  const probe = (globalThis as { __DSH_ONE_PROBE__?: { log(level: string, text: string): void } }).__DSH_ONE_PROBE__
  if (probe) probe.log('info', line)
}

export const inject = ['sessions']

export function apply(ctx: BootContext): void {
  // apply 时刻 ≈ 整树插件装载完（本插件在 application 批末位）。
  timingLog('apply')
  // 运行时就地切换（#71 单例终态）：宿主转发的 dshOne.switchSession → 官方
  // sessions.open(id)（机制层 2 官方服务 API）——不 reload、不遮罩（遮罩只
  // 服务冷启动注入），官方切换自带加载态。
  const onSwitchMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; sessionId?: unknown } | undefined
    if (data?.type !== 'dshOne.switchSession' || typeof data.sessionId !== 'string' || data.sessionId === '') return
    const list = ctx.get('sessions').list.getSnapshot()
    if (list.current === data.sessionId) return
    try {
      ctx.get('sessions').open(data.sessionId)
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
  ctx.effect(() => {
    return () => window.removeEventListener('message', onSwitchMessage)
  }, 'dsh-one session boot: dispose switch listener')
  ctx.get('sessions').list.subscribe(() => {
    const list = ctx.get('sessions').list.getSnapshot()
    if (list.phase !== 'ready') return
    // 启动注入：一次、幂等（open 对已是 current 的 id 早退）。
    if (!injected) {
      injected = true
      timingLog('list-ready', `target=${target ?? 'none'}`)
      if (target !== undefined && list.current !== target) {
        try {
          ctx.get('sessions').open(target)
        } catch {
          /* 目标 id 不在列表（会话被归档等）：保持官方恢复值 */
        }
      }
    }
    // 活跃上报：current 与标题（变化即报，宿主去重）。
    const current = list.current
    if (current !== undefined) {
      if (!reportedFirstMeta) {
        reportedFirstMeta = true
        timingLog('first-meta', current.slice(0, 13))
      }
      postMeta(current, list.byId[current]?.displayTitle ?? list.byId[current]?.title)
    }
  })
}
