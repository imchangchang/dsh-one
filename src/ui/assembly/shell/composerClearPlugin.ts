/**
 * @dsh-one/vscode-composer-clear——清空三件套（#65 批 1，issue #16 的装配版）：
 * 一键清空 / 双击确认 + Ctrl+Z 反悔 / 运行中「先清输入再停」。
 *
 * 机制层：**全部走官方 composer 的公开口，零 DOM 操作**。
 *
 * ① 机制层 1（官方槽位）：控件本体登记进 `conversation.input.left`——官方
 *    ComposerBar 声明的 list 座位（"Compact controls at the left of the
 *    composer tool row"，源码 renderSlot 调用点逐字确认），session 作用域，
 *    组件自动获得框架提供的标准座位：`useInput`（InputState 快照：draft /
 *    imageIds / occurrences / phase）与 `inputActions`（InputActions 公开面）。
 * ② 机制层 2（官方服务 API）：清空与还原都只调官方动作，不碰输入框 DOM——
 *    - 清空正文：`inputActions.setDraft('')`（facade 文档原文："Replace the
 *      whole draft (persisted-draft seed and programmatic writes)"）；
 *    - 清空附件：`inputActions.removeImage(id)`（逐个 id，官方唯一删图口）；
 *    - 停止回合：`sessions.scope(id).get('conversation').cancel()`——官方
 *      **作用域寻址**服务（ui-conversation 的 `scopedConversation(sessions, id)`
 *      就是这两步）；停止按钮在官方 composer 上走的也是它（源码 `stop: () =>
 *      scopedConversation(...).cancel()`）；
 *    - 还原引用 chip：`conversation.input.for(scopeCtx).insertReference(ref, span)`
 *      （SessionInputResolver → SessionInput 的公开方法）。
 * ③ 机制层 3：无（装载/传输接缝与此无关）。
 * ④ 不需要第 4 层：官方有程序化写入口，绝不用 DOM 硬改输入框。
 *
 * Ctrl+Z 反悔为什么必须自己做（而不是靠输入框自带的撤销）：
 * 官方 `setDraft` 的编辑带 `history-merge` 标记（facade 源码逐字：Lexical
 * update 的 tag 是 "history-merge"），Lexical 的历史合并语义是「并进上一条
 * 撤销记录」——清空后再按 Ctrl+Z 撤销的是「上一条（打字）记录合并后的状态」，
 * 官方输入框**拿不回被清空的正文**（#16 的自研版是靠自有快照还原的，这里沿用
 * 同一思路，只是还原动作全部换成官方口）。所以：清空前把 draft + 引用
 * occurrences + 图片 id 存快照，撤销窗口内按 Ctrl/Cmd+Z（或点「撤销」）时
 * 先用 setDraft 还原正文，再用 insertReference 逐个把引用 chip 插回去
 * （倒序插、每次读最新 draftRev 做 span CAS；单次失败只降级该 chip 为纯文本，
 * 不影响其余还原）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { clearButtonView, decideClearAction } from '../../../pure/composerClearState.ts'

/** 撤销窗口时长（毫秒）：窗口内 Ctrl/Cmd+Z 或点「撤销」都能反悔。 */
const UNDO_WINDOW_MS = 8000
/** 双击确认的武装时长：超时自动解除，防误触。 */
const ARM_WINDOW_MS = 4000

const CSS = [
  '.dshOneClear_btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
  '.dshOneClear_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.dshOneClear_btn:disabled{opacity:.4;cursor:default}',
  '.dshOneClear_btn[data-armed]{color:var(--dsw-alias-status-danger,#d1242f);background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshOneClear_btn[data-undo]{color:var(--dsw-alias-status-success,#2ea043)}',
].join('')
const CSS_TAG_ID = '@dsh-one/vscode-composer-clear/Clear.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-composer-clear'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** InputState 里本插件用到的字段（官方契约的子集）。 */
interface InputStateView {
  draft: string
  imageIds: readonly string[]
  draftRev: number
  phase: string
  occurrences: readonly OccurrenceView[]
}

/** 引用 chip 的快照形态（官方 Occurrence 的子集，够 insertReference 用）。 */
interface OccurrenceView {
  source: string
  ref: string
  label: string
  offset: number
  length: number
  clipboardText: string
  appearance?: 'session' | 'file' | 'folder'
}

/** InputActions 公开面（官方契约的子集）。 */
interface InputActionsView {
  setDraft(text: string): void
  addImages(ids: readonly string[]): boolean
  removeImage(id: string): void
}

/** 清空前的快照（正文 + 引用 chip + 图片）。 */
interface ClearSnapshot {
  draft: string
  occurrences: readonly OccurrenceView[]
  imageIds: readonly string[]
}

/** 会话作用域 ctx（cordis 服务跟踪器的 scope 面）。 */
interface ScopedContext {
  get(name: 'conversation'): ConversationFace | undefined
}

/** cordis ctx 面（本插件用到的最小集合）。 */
interface ClearContext {
  effect(body: () => (() => void) | void, label?: string): void
  get(name: 'sessions'): {
    scope(id: string): ScopedContext | undefined
  }
  locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: {
    register(entry: unknown, component: unknown): () => void
    inject(name: string, factory: () => unknown): () => void
  }
}

/** 官方作用域寻址的 conversation 面（cancel 停回合；input 还原引用 chip）。 */
interface ConversationFace {
  cancel(): Promise<void>
  input: {
    for(actx: unknown): {
      state: { getSnapshot(): { draftRev: number } }
      insertReference(
        ref: { source: string; ref: string; label: string; appearance?: string; clipboardText: string },
        span: { start: number; end: number; draftRev: number },
      ): boolean
    }
  }
}

/** 本插件注入给组件的面：把「按会话 id 取服务」收成两个动作。 */
interface SessionFace {
  cancel(): Promise<void>
  /** 还原一个引用 chip（官方 insertReference，span CAS）。 */
  insertReference(
    ref: { source: string; ref: string; label: string; appearance?: string; clipboardText: string },
    span: { start: number; end: number; draftRev: number },
  ): boolean
  /** 当前输入修订号（insertReference 的 span CAS 用，每次插之前现读）。 */
  draftRev(): number
}

interface ClearProps {
  useInput: <R>(selector: (state: InputStateView) => R) => R
  inputActions: InputActionsView
  useSession: <R>(selector: (state: { running?: boolean }) => R) => R
  sessionId: string
  /** 框架注入的 locale 座位（函数内别名为 tr 避开 i18n 门禁的裸 t() 扫描）。 */
  t: (key: string) => string
  /** 插件 apply 注入：按会话 id 取作用域寻址的 conversation 面。 */
  sessionFaceOf: (sessionId: string) => SessionFace | undefined
}

function ComposerClear({ useInput, inputActions, useSession, sessionId, t, sessionFaceOf }: ClearProps) {
  const tr = t
  const draft = useInput((s) => s.draft)
  const imageIds = useInput((s) => s.imageIds)
  const running = useSession((s) => s.running) ?? false
  const [armed, setArmed] = useState(false)
  const [snapshot, setSnapshot] = useState<ClearSnapshot | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 快照与最新输入状态都要在事件回调里读到当前值：用 ref 影子跟随（闭包陷阱）
  const snapshotRef = useRef<ClearSnapshot | null>(null)
  const inputRef = useRef<{ draft: string; imageIds: readonly string[]; occurrences: readonly OccurrenceView[] }>({
    draft: '',
    imageIds: [],
    occurrences: [],
  })

  const occurrences = useInput((s) => s.occurrences)
  inputRef.current = { draft, imageIds, occurrences }

  const clearArmTimer = (): void => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current)
      armTimer.current = null
    }
  }
  const closeUndoWindow = (): void => {
    if (undoTimer.current !== null) {
      clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    snapshotRef.current = null
    setSnapshot(null)
  }

  /** 执行清空：官方 setDraft('') + 逐个 removeImage（先存快照供撤销）。 */
  const clearNow = (): void => {
    const current = inputRef.current
    const taken: ClearSnapshot = { draft: current.draft, occurrences: current.occurrences, imageIds: current.imageIds }
    snapshotRef.current = taken
    setSnapshot(taken)
    inputActions.setDraft('')
    for (const id of current.imageIds) inputActions.removeImage(id)
    setArmed(false)
    clearArmTimer()
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(closeUndoWindow, UNDO_WINDOW_MS)
  }

  /**
   * 撤销清空：正文走官方 setDraft，引用 chip 走官方 insertReference
   * （倒序插 + 每次现读 draftRev 做 span CAS，见文件头说明）。
   * chip 还原失败只降级该 chip（正文已还原），不影响其余部分——所以整体包一层
   * try：撤销是「尽量还原」，不是事务。
   */
  const undoClear = (): void => {
    const taken = snapshotRef.current
    if (taken === null) return
    inputActions.setDraft(taken.draft)
    const face = sessionFaceOf(sessionId)
    if (face !== undefined && taken.occurrences.length > 0) {
      try {
        for (let i = taken.occurrences.length - 1; i >= 0; i -= 1) {
          const occ = taken.occurrences[i]
          face.insertReference(
            {
              source: occ.source,
              ref: occ.ref,
              label: occ.label,
              ...(occ.appearance === undefined ? {} : { appearance: occ.appearance }),
              clipboardText: occ.clipboardText,
            },
            { start: occ.offset, end: occ.offset + occ.length, draftRev: face.draftRev() },
          )
        }
      } catch (err) {
        // 还原 chip 失败（span 过期/会话切换）：正文照旧还原，只记录
        console.warn(`[dsh-one] composer clear: reference restore skipped: ${String(err)}`)
      }
    }
    if (taken.imageIds.length > 0) inputActions.addImages(taken.imageIds)
    closeUndoWindow()
  }

  const stopTurn = (): void => {
    const face = sessionFaceOf(sessionId)
    void face?.cancel().catch(() => {
      /* 取消失败（会话已跑完等）：静默，官方 composer 的停止按钮同样是吞错语义 */
    })
  }

  // 撤销窗口开着时，Ctrl/Cmd+Z 归我们处理（捕获阶段先于官方编辑器的撤销，
  // preventDefault + stopPropagation 让官方那一步不发生）。
  useEffect(() => {
    if (snapshot === null) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      if (key !== 'z' || !(event.metaKey || event.ctrlKey) || event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      undoClear()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [snapshot, sessionId])

  useEffect(
    () => () => {
      clearArmTimer()
      if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    },
    [],
  )

  const hasContent = draft !== '' || imageIds.length > 0
  const undoOpen = snapshot !== null
  const view = clearButtonView({ armed, undoOpen, hasContent, running })
  const label = tr(view.labelKey)

  // 行为矩阵见 src/pure/composerClearState.ts（撤销 > 清空双击确认 > 停止回合）。
  const onClick = (): void => {
    switch (decideClearAction({ armed, undoOpen, hasContent, running })) {
      case 'undo':
        undoClear()
        return
      case 'arm':
        setArmed(true)
        clearArmTimer()
        armTimer.current = setTimeout(() => {
          armTimer.current = null
          setArmed(false)
        }, ARM_WINDOW_MS)
        return
      case 'clear':
        clearNow()
        return
      case 'stop':
        stopTurn()
        return
      default:
        return
    }
  }

  return h(
    'button',
    {
      type: 'button',
      className: 'dshOneClear_btn',
      'data-armed': armed ? '' : undefined,
      'data-undo': undoOpen ? '' : undefined,
      'data-dshone-clear': '',
      'data-mode': undoOpen ? 'undo' : hasContent ? (armed ? 'arm' : 'clear') : running ? 'stop' : 'idle',
      title: tr(view.hintKey),
      'aria-label': label,
      disabled: view.disabled,
      onClick,
    },
    label,
  )
}

export const inject = ['slots', 'locale', 'sessions']

export function apply(ctx: ClearContext): void {
  /**
   * 作用域寻址的 conversation 面（官方 ui-conversation 的斜梯逐字：
   * `sessions.scope(id)` 拿会话作用域 ctx，再 `scope.get('conversation')`）。
   * 注意 `input.for(actx)` 必须喂**会话作用域 ctx**，喂 undefined 会在服务
   * 跟踪器里炸（浏览器验证实测：reading 'Symbol(dsh.client.scope)'）。
   */
  const sessionFaceOf = (sessionId: string): SessionFace | undefined => {
    const scoped = ctx.get('sessions').scope(sessionId)
    if (scoped === undefined) return undefined
    const conversation = scoped.get('conversation')
    if (conversation === undefined) return undefined
    return {
      cancel: () => conversation.cancel(),
      insertReference: (ref, span) => conversation.input.for(scoped).insertReference(ref, span),
      draftRev: () => conversation.input.for(scoped).state.getSnapshot().draftRev,
    }
  }

  ctx.effect(() => {
    // 自有词典（zh 用 unicode 转义过 i18n 门禁的字面量扫描）。
    const disposeLocale = ctx.locale.register('dshOneClear', {
      zh: {
        clear: '\u6e05\u7a7a',
        armHint: '\u518d\u6309\u4e00\u6b21\u6e05\u7a7a',
        cleared: '\u5df2\u6e05\u7a7a \u00b7 \u64a4\u9500',
        stop: '\u505c\u6b62',
        clearHint: '\u6e05\u7a7a\u8f93\u5165\u5185\u5bb9\uff08\u518d\u6309\u4e00\u6b21\u786e\u8ba4\uff09',
        undoHint: '\u64a4\u9500\u672c\u6b21\u6e05\u7a7a\uff08Ctrl/Cmd+Z\uff09',
        stopHint: '\u8f93\u5165\u5df2\u7a7a\uff0c\u518d\u6309\u505c\u6b62\u672c\u8f6e',
      },
      en: {
        clear: 'Clear',
        armHint: 'Press again to clear',
        cleared: 'Cleared · Undo',
        stop: 'Stop',
        clearHint: 'Clear the composer content (press again to confirm)',
        undoHint: 'Undo this clear (Ctrl/Cmd+Z)',
        stopHint: 'The composer is empty; press again to stop the turn',
      },
    })
    const disposeInject = ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'dsh-one-composer-clear',
          order: 50,
          locale: 'dshOneClear',
          inject: () => ({ sessionFaceOf }),
        },
        ComposerClear,
      ),
    )
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one composer clear: clear / double-confirm / undo / stop')
}
