/**
 * 清空三件套的状态判定（纯函数，便于单测）：把「这一刻按下去该做什么」从
 * React 组件里抽出来，行为矩阵与 issue #16 定稿的语义一一对应——
 *
 * 1. 撤销窗口开着 → 按下去是撤销（反悔）；
 * 2. 有内容（正文或附件）→ 第一次按 = 武装（提示「再按一次」），第二次 = 清空；
 *    运行中有内容时**只清空、不打断回合**（先清输入）；
 * 3. 内容为空且在运行 → 按下去是停止回合（清完了才轮到停，即「先清输入再停」）；
 * 4. 内容为空且不在运行 → 无事可做（按钮禁用）。
 */
export interface ClearButtonState {
  /** 武装态（第一次按过，等第二次确认）。 */
  armed: boolean
  /** 撤销窗口开着（刚清空，可反悔）。 */
  undoOpen: boolean
  /** 输入里还有东西（正文或附件）。 */
  hasContent: boolean
  /** 当前会话在跑回合。 */
  running: boolean
}

/** 按下去要执行的动作。 */
export type ClearAction = 'undo' | 'arm' | 'clear' | 'stop' | 'none'

/** 零散值（按钮的形态：文案 key + 是否禁用）。 */
export interface ClearButtonView {
  labelKey: 'cleared' | 'armHint' | 'clear' | 'stop'
  hintKey: 'undoHint' | 'armHint' | 'clearHint' | 'stopHint'
  disabled: boolean
}

/** 判定本次点击的动作。 */
export function decideClearAction(state: ClearButtonState): ClearAction {
  if (state.undoOpen) return 'undo'
  if (state.hasContent) return state.armed ? 'clear' : 'arm'
  if (state.running) return 'stop'
  return 'none'
}

/** 按钮当前该长什么样（文案 key + 禁用态）。 */
export function clearButtonView(state: ClearButtonState): ClearButtonView {
  if (state.undoOpen) return { labelKey: 'cleared', hintKey: 'undoHint', disabled: false }
  if (state.hasContent) {
    return state.armed
      ? { labelKey: 'armHint', hintKey: 'armHint', disabled: false }
      : { labelKey: 'clear', hintKey: 'clearHint', disabled: false }
  }
  if (state.running) return { labelKey: 'stop', hintKey: 'stopHint', disabled: false }
  return { labelKey: 'clear', hintKey: 'clearHint', disabled: true }
}
