/**
 * 清空（Esc / Ctrl+C 两路）的键位分流与提示形态（纯函数，便于单测）。
 *
 * 语义（issue #16 定稿，装配版）：**有内容才接管，空内容一律放行**——
 * - 有内容：第一次按 = 武装（提示「再按一次…清空」，草稿原样不动），第二次按 = 清空
 *   （正文 + 待发附件）；清空后进入撤销窗口，Ctrl/Cmd+Z 可反悔。
 * - 空内容：直接放行（不 preventDefault、不改草稿）——官方键盘逻辑（弹层关闭、
 *   回合的中断入口）照常生效，我们绝不吞键。
 * - 运行中双语义保留：有内容只清不打断；空内容交给官方。
 *
 * 放行条件（任一命中即 pass，绝不接管）：
 * - IME 组字中（composing）；
 * - 有官方浮层/模态打开（菜单、@ 候选、斜杠候选、设置/灯箱等）——Esc 在那里是关闭语义；
 * - **有非折叠选区**（Win/Linux 的 Ctrl+C 复制必须不被拦；Esc 不受此限）。
 */
export interface ClearKeyState {
  /** 按下的键：Esc 或Ctrl+C（macOS 复制是 Cmd+C，Ctrl+C 不被占用）。 */
  key: 'escape' | 'ctrl-c'
  /** 草稿有内容（正文或待发附件）。 */
  hasContent: boolean
  /** 已在武装态（提示过「再按一次」）。 */
  armed: boolean
  /** 编辑器里有非折叠选区。 */
  hasSelection: boolean
  /** 有官方浮层/模态打开。 */
  blocked: boolean
  /** IME 组字中。 */
  composing: boolean
}

/** 接管后的动作（pass = 放行给官方）。 */
export type ClearKeyAction = 'pass' | 'arm' | 'clear'

/** 判定一次按键该走哪条路。 */
export function decideKeyAction(state: ClearKeyState): ClearKeyAction {
  if (state.composing) return 'pass'
  if (state.blocked) return 'pass'
  // 选区只在 Ctrl+C 上豁免（复制优先）；Esc 与选区无关
  if (state.key === 'ctrl-c' && state.hasSelection) return 'pass'
  if (!state.hasContent) return 'pass'
  return state.armed ? 'clear' : 'arm'
}

/** 提示的两种形态（无提示 = null）。 */
export type ClearHintKind = 'arm-escape' | 'arm-ctrl-c' | 'undo' | null

/** 当前该显示哪条提示：撤销窗口优先，其次武装提示（按触发的键给对应文案）。 */
export function clearHintKind(state: { armed: boolean; undoOpen: boolean; armedKey: 'escape' | 'ctrl-c' }): ClearHintKind {
  if (state.undoOpen) return 'undo'
  if (state.armed) return state.armedKey === 'escape' ? 'arm-escape' : 'arm-ctrl-c'
  return null
}
