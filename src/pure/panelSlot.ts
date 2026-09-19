/**
 * 单例编辑器 tab 的槽位（#100 安装引导 tab）：已开则聚焦、没开才新建；面板被
 * 用户关掉后槽位自动空出来，下次打开再新建一个。
 *
 * 纯逻辑（不 import VS Code API），宿主侧的 `WebviewPanel` 与单测里的假面板
 * 共用：「再打开一次会不会开出第二个 tab」是一条行为约定，得有单测钉住。
 */

/** 槽位认的最小面板形态（宿主里是 `vscode.WebviewPanel`）。 */
export interface RevealablePanel {
  reveal(): void
}

export interface PanelSlot<T extends RevealablePanel> {
  /** 当前已开的面板；没有则 undefined。 */
  current(): T | undefined
  /** 已开 → 聚焦并返回它（不调 create）；没开 → 调 create、记住并返回。 */
  open(create: () => T): T
  /** 面板被关掉时调用：句柄对得上才清空，避免误清替换后的新面板。 */
  close(panel: T): void
}

export function createPanelSlot<T extends RevealablePanel>(): PanelSlot<T> {
  let current: T | undefined
  return {
    current: () => current,
    open: (create) => {
      if (current !== undefined) {
        current.reveal()
        return current
      }
      current = create()
      return current
    },
    close: (panel) => {
      if (current === panel) current = undefined
    },
  }
}
