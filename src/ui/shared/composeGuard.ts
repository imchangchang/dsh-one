/**
 * IME 组合守护（chat webview 与 sessions webview 共用）。
 *
 * 浏览器 composition 会话（拼音/日文候选窗）期间销毁输入元素会中止组合——
 * 「恢复焦点/文本」救不了它。所以两个 bundle 的保活/冻结逻辑都以
 * `composingInside(root)` 作为兜底：组合落在某区域内时，该区域的重建推迟到
 * compositionend，结束时由 `onCompositionEnd` 注册的回调补一帧落地。
 */
let composingEl: Element | null = null
let installed = false
let onEnd: (() => void) | null = null

/**
 * 安装 document 级 composition 跟踪（每个 bundle 启动时调用一次）。
 * onEnd：compositionend 时的补帧回调（chat 传 render，sessions 传 renderSessions）。
 */
export function initComposeGuard(onCompositionEnd: () => void): void {
  onEnd = onCompositionEnd
  if (installed) return
  installed = true
  document.addEventListener('compositionstart', (e) => {
    composingEl = e.target instanceof Element ? e.target : null
  })
  document.addEventListener('compositionend', () => {
    composingEl = null
    onEnd?.()
  })
  document.addEventListener('focusout', () => {
    // 组合未正常结束（异常销毁/程序抢焦点）时清标志，避免永久冻结/保活。
    if (composingEl !== null && !composingEl.isConnected) composingEl = null
  })
}

/** 活动中的 IME 组合是否落在 root 子树内（root 为 null 恒 false）。 */
export function composingInside(root: Element | null): boolean {
  return root !== null && composingEl !== null && root.contains(composingEl)
}

/** 是否有活动中的 IME 组合（不区分区域；sessions 的整列表冻结用它）。 */
export function composingActive(): boolean {
  return composingEl !== null
}
