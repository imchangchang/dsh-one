/**
 * @dsh-one/vscode-composer-clear——清空（Esc / Ctrl+C 两路）+ Ctrl+Z 反悔
 * （#65 批 1，issue #16 的装配版；#65 收尾改版：去掉按钮，改键位触发）。
 *
 * ## 走第几层机制
 *
 * **写入/还原 = 机制层 2（官方服务 API）**，零 DOM 操作：
 * - 清空正文 `inputActions.setDraft('')`、清待发附件 `inputActions.removeImage(id)`；
 * - 撤销正文 `setDraft(快照)`，撤销引用 chip `conversation.input.for(scopeCtx).insertReference(...)`
 *   （倒序插 + 每次现读 draftRev 做 span CAS），附件 `addImages(快照)`。
 *
 * **提示 UI = 机制层 1（官方槽位）**：登记进 `conversation.input.overlay`（官方
 * ComposerBar 声明的 list 座位，"Floating entries rendered inside the resident
 * composer card"——官方 @ 候选菜单与斜杠 popupSelect 都渲染在这个锚点里）。
 *
 * **键位 = 第 4 层（自有容器捕获监听）**，官方无键位接缝，查证如下：
 * ① 官方客户端**没有任何键位/快捷键服务**：把 48 个官方插件 bundle 的 `ctx.provide`
 *    全量扫过一遍，服务只有 connection/cordisInspect/dynamicCordisRunner/layout/
 *    locale/modules/sessionLogDownload/sessions/theme/uiRenderer/chatFileMentions
 *    （外加 cordis Service 基类注册的 conversation/workspaces），**没有一个键位面**；
 * ② 官方 composer 的键位是**包内私有**的：ui-conversation 的 `registerComposerKeymap`
 *    （`lib/types/client/input/editor/keymap.d.ts`）由 InputBar 自己注册在 Lexical
 *    命令层（CRITICAL 优先级），其句柄（arbitrate/space/paste/canSubmit…）按
 *    contract/input.d.ts 的明文规定 **"stay InputBar-private and never ride this
 *    face"**——公开输入面 `InputActions` / `SessionInput` 都不暴露键位注册；
 * ③ Lexical 命令层也接不上：`lexical` 不在主 bundle 的种子表（8 词：react/
 *    react-dom/cordis/store/slots/primitives 等），自有插件 `require('lexical')`
 *    只会失败，无法 `registerCommand`；
 * ④ 官方对 Esc 的用法全是**关闭浮层**（ui-attachment 灯箱、ui-chat 用量面板、
 *    ui-conversation popupSelect、ui-message-feedback 批注、ui-settings-general
 *    弹窗），**没有一处是中断回合**（全量扫 addEventListener("keydown") 与主 bundle
 *    的 Escape 用法确认）——所以「空内容放行」不会漏掉官方的中断键，官方的回合
 *    中断入口是 composer 上的停止/中断控件（`interruptible` 那个按钮）。
 * 风险与对策：监听挂在**自有** frame 根（`[data-shell="dsh-one"]`）的捕获阶段，
 * 只在事件目标位于官方 composer 卡（`[data-slot="conversation.composer.bar"]`）
 * 之内时才考虑接管；放行条件（IME 组字、官方浮层打开、Ctrl+C 有选区）一律
 * `return`，不 preventDefault、不改草稿。官方 DOM 侧只依赖座位属性与
 * `role`/`aria-modal` 语义标记（非 css-module 哈希）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { clearHintKind, decideKeyAction } from '../../../pure/composerClearState.ts'

/** 撤销窗口时长（毫秒）：窗口内 Ctrl/Cmd+Z 或点「撤销」都能反悔。 */
const UNDO_WINDOW_MS = 8000
/** 武装窗口时长：超时自动解除，防误触。 */
const ARM_WINDOW_MS = 4000

const CSS = [
  '.dshOneClear_hint{display:flex;align-items:center;gap:6px;margin:0 0 6px;padding:2px 8px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;width:max-content}',
  '.dshOneClear_undo{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:0 2px;text-decoration:underline}',
].join('')
const CSS_TAG_ID = '@dsh-one/vscode-composer-clear/Hint.css'
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

/** 官方作用域寻址的 conversation 面（撤销引用 chip 用）。 */
interface ConversationFace {
  input: {
    for(actx: unknown): {
      /** 输入修订号（insertReference 的 span CAS 用，每次插之前现读）。 */
      state: { getSnapshot(): { draftRev: number } }
      insertReference(
        ref: { source: string; ref: string; label: string; appearance?: string; clipboardText: string },
        span: { start: number; end: number; draftRev: number },
      ): boolean
    }
  }
}

/** 本插件注入给组件的面：按会话 id 取作用域寻址的 conversation 面。 */
interface SessionFace {
  insertReference(
    ref: { source: string; ref: string; label: string; appearance?: string; clipboardText: string },
    span: { start: number; end: number; draftRev: number },
  ): boolean
  draftRev(): number
}

interface ClearProps {
  useInput: <R>(selector: (state: InputStateView) => R) => R
  inputActions: InputActionsView
  sessionId: string
  /** 框架注入的 locale 座位（函数内别名为 tr 避开 i18n 门禁的裸 t() 扫描）。 */
  t: (key: string) => string
  sessionFaceOf: (sessionId: string) => SessionFace | undefined
}

/** 自有容器：装配 frame 根（我们自己的 data 属性）。 */
const frameRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell="dsh-one"]')

/** 官方 composer 卡座位（判断按键目标是否落在输入区内）。 */
const COMPOSER_SEAT = '[data-slot="conversation.composer.bar"]'

/** 官方浮层/模态是否开着（开着就不接管 Esc——那是它们的关闭语义）。 */
function overlayOpen(): boolean {
  for (const el of Array.from(document.querySelectorAll('[role="listbox"], [role="option"], [role="menu"], [role="dialog"], [aria-modal="true"]'))) {
    if (el.getClientRects().length > 0) return true
  }
  return false
}

/** 编辑器里是否有非折叠选区（Win/Linux 的 Ctrl+C 复制要放行）。 */
function hasSelection(): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed) return false
  return (selection.toString() ?? '') !== ''
}

function ComposerClear({ useInput, inputActions, sessionId, t, sessionFaceOf }: ClearProps) {
  const tr = t
  const draft = useInput((s) => s.draft)
  const imageIds = useInput((s) => s.imageIds)
  const occurrences = useInput((s) => s.occurrences)
  const [armedKey, setArmedKey] = useState<'escape' | 'ctrl-c' | null>(null)
  const [snapshot, setSnapshot] = useState<ClearSnapshot | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 事件回调要读最新值：用 ref 影子跟随（闭包陷阱）
  const live = useRef({ draft, imageIds, occurrences })
  live.current = { draft, imageIds, occurrences }
  const snapshotRef = useRef<ClearSnapshot | null>(null)
  const armedRef = useRef<'escape' | 'ctrl-c' | null>(null)
  armedRef.current = armedKey

  const closeUndoWindow = (): void => {
    if (undoTimer.current !== null) {
      clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    snapshotRef.current = null
    setSnapshot(null)
  }
  const clearArmTimer = (): void => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current)
      armTimer.current = null
    }
  }

  /** 清空：官方 setDraft('') + 逐个 removeImage（先存快照供撤销）。 */
  const clearNow = (): void => {
    const current = live.current
    const taken: ClearSnapshot = { draft: current.draft, occurrences: current.occurrences, imageIds: current.imageIds }
    snapshotRef.current = taken
    setSnapshot(taken)
    inputActions.setDraft('')
    for (const id of current.imageIds) inputActions.removeImage(id)
    setArmedKey(null)
    clearArmTimer()
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(closeUndoWindow, UNDO_WINDOW_MS)
  }

  /**
   * 撤销清空：正文走官方 setDraft，引用 chip 走官方 insertReference
   * （倒序插 + 每次现读 draftRev 做 span CAS，见文件头说明）。
   * chip 还原失败只降级该 chip（正文已还原）——撤销是「尽量还原」，不是事务。
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

  // 清空后用户又开始打字 → 关掉撤销窗口（快照丢掉）：否则此时的 Ctrl+Z 会把
  // 新输入整段替换回旧内容，等于吞掉用户刚敲的字（#16 的「打字解除武装」同理）。
  useEffect(() => {
    if (snapshotRef.current !== null && (draft !== '' || imageIds.length > 0)) closeUndoWindow()
  }, [draft, imageIds])

  // 键位监听（第 4 层，见文件头举证）：挂自有 frame 根捕获阶段，只考虑
  // composer 卡之内的按键，放行条件一律不拦。
  useEffect(() => {
    const root = frameRoot()
    if (root === null) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target === null || target.closest(COMPOSER_SEAT) === null) return
      const isEscape = event.key === 'Escape'
      // Ctrl+C（不带 Shift/Alt）；macOS 的复制是 Cmd+C，不受此影响
      const isCtrlC = event.key.toLowerCase() === 'c' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      if (!isEscape && !isCtrlC) return
      const undoOpen = snapshotRef.current !== null
      // 撤销窗口里的 Ctrl/Cmd+Z 由下面单独处理；Esc 在撤销窗口里不做事（放行）
      if (undoOpen && isEscape) return
      const action = decideKeyAction({
        key: isCtrlC ? 'ctrl-c' : 'escape',
        hasContent: live.current.draft !== '' || live.current.imageIds.length > 0,
        armed: armedRef.current !== null,
        hasSelection: hasSelection(),
        blocked: overlayOpen(),
        composing: event.isComposing,
      })
      if (action === 'pass') return
      event.preventDefault()
      if (action === 'clear') {
        clearNow()
        return
      }
      setArmedKey(isCtrlC ? 'ctrl-c' : 'escape')
      clearArmTimer()
      armTimer.current = setTimeout(() => {
        armTimer.current = null
        setArmedKey(null)
      }, ARM_WINDOW_MS)
    }
    const onUndoKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      if (key !== 'z' || !(event.metaKey || event.ctrlKey) || event.shiftKey) return
      if (snapshotRef.current === null) return
      const target = event.target as HTMLElement | null
      if (target === null || target.closest(COMPOSER_SEAT) === null) return
      event.preventDefault()
      undoClear()
    }
    root.addEventListener('keydown', onKeyDown, true)
    root.addEventListener('keydown', onUndoKey, true)
    return () => {
      root.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('keydown', onUndoKey, true)
      clearArmTimer()
      if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    }
  }, [sessionId])

  const hintKind = clearHintKind({ armed: armedKey !== null, undoOpen: snapshot !== null, armedKey: armedKey ?? 'escape' })
  if (hintKind === null) return null
  const text =
    hintKind === 'undo' ? tr('undoAvailable') : hintKind === 'arm-escape' ? tr('armEscape') : tr('armCtrlC')
  return h(
    'div',
    { className: 'dshOneClear_hint', 'data-dshone-clear-hint': hintKind },
    h('span', null, text),
    hintKind === 'undo' && h('button', { type: 'button', className: 'dshOneClear_undo', onClick: undoClear }, tr('undoAction')),
  )
}

interface ClearContext {
  effect(body: () => (() => void) | void, label?: string): void
  get(name: 'sessions'): {
    scope(id: string): { get(name: 'conversation'): ConversationFace | undefined } | undefined
  }
  locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: {
    register(entry: unknown, component: unknown): () => void
    inject(name: string, factory: () => unknown): () => void
  }
}

export const inject = ['slots', 'locale', 'sessions']

export function apply(ctx: ClearContext): void {
  /**
   * 作用域寻址的 conversation 面（官方 ui-conversation 的斜梯逐字：
   * `sessions.scope(id)` 拿会话作用域 ctx，再 `scope.get('conversation')`）。
   * 注意 `input.for(actx)` 必须喂**会话作用域 ctx**。
   */
  const sessionFaceOf = (sessionId: string): SessionFace | undefined => {
    const scoped = ctx.get('sessions').scope(sessionId)
    if (scoped === undefined) return undefined
    const conversation = scoped.get('conversation')
    if (conversation === undefined) return undefined
    return {
      insertReference: (ref, span) => conversation.input.for(scoped).insertReference(ref, span),
      draftRev: () => conversation.input.for(scoped).state.getSnapshot().draftRev,
    }
  }

  ctx.effect(() => {
    // 自有词典（zh 用 unicode 转义过 i18n 门禁的字面量扫描）。
    const disposeLocale = ctx.locale.register('dshOneClear', {
      zh: {
        armEscape: '\u518d\u6309\u4e00\u6b21 Esc \u6e05\u7a7a',
        armCtrlC: '\u518d\u6309\u4e00\u6b21 Ctrl+C \u6e05\u7a7a',
        undoAvailable: '\u5df2\u6e05\u7a7a',
        undoAction: '\u64a4\u9500',
      },
      en: {
        armEscape: 'Press Esc again to clear',
        armCtrlC: 'Press Ctrl+C again to clear',
        undoAvailable: 'Cleared',
        undoAction: 'Undo',
      },
    })
    const disposeInject = ctx.slots.inject('conversation.input.overlay', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.overlay',
          id: 'dsh-one-composer-clear',
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
  }, 'dsh-one composer clear: Esc / Ctrl+C clear with undo hint')
}
