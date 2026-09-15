/**
 * shell 插件的外部依赖类型声明：react / @deepseek-ai/dsh-client-store 在运行
 * 时由主 bundle 的 PLATFORM_MODULES 种子表满足（#63 调研：8 词种子表，私有包
 * 不打进 bundle），构建时 esbuild external 不解析实体包——这里给 tsc 一份
 * 最小环境声明即可。注意保持「最小面」：只声明本插件用到的 API。
 */

declare module 'react' {
  export type ReactNode = unknown
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useLayoutEffect(effect: () => (() => void) | void, deps?: readonly unknown[]): void
  export function useRef<T>(initial: T): { current: T }
  export function useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void]
  export const Fragment: unique symbol
}

declare module '@deepseek-ai/dsh-client-store' {
  /**
   * 官方 store 形态（ui-layout stores.js）：{ init, actions }，actions 的
   * 第一个参数是可变 draft。框架（renderer standardKit）按 entry 实例化并
   * 注入 useStore / actions 两个座位。
   */
  export function defineStore<S>(spec: {
    init: () => S
    actions: Record<string, (draft: S, ...args: any[]) => void>
  }): unknown
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** 官方图标件（设置齿轮，ui-settings-general TriggerContent 同款）。 */
  export function IconSettingsOutline16(props: { size?: number }): unknown
  export function IconSettingsOutline14(props: { size?: number }): unknown
  /** 官方按钮件（设置行动，ui-settings-general SettingsDocumentAction 同款）。 */
  export function Button(props: { variant?: string; size?: string; disabled?: boolean; onClick?: () => void; children?: unknown }): unknown
  /** 官方下载图标（session-log-export HeaderAction 同款）。 */
  export function IconDownloadOutline16(props: { size?: number }): unknown
  /** 官方剪贴板写入（带 execCommand 回退；webview 里比裸 navigator.clipboard 稳）。 */
  export function writeClipboard(text: string): Promise<boolean>
  /** 官方图标件（git 卡片/右键菜单用，名取自官方 primitives 导出表）。 */
  export function IconUserOutline16(props: { size?: number }): unknown
  export function IconClockOutline16(props: { size?: number }): unknown
  export function IconCopyOutline16(props: { size?: number }): unknown
  export function IconCheckOutline16(props: { size?: number }): unknown
  export function IconRightUpOutline16(props: { size?: number }): unknown
  export function IconGlobeOutline14(props: { size?: number }): unknown
  export function IconBrowseOutline16(props: { size?: number }): unknown
  export function IconCodeOutline16(props: { size?: number }): unknown
  /** 官方菜单件（右键菜单家族复用官方观感与定位/外点关闭语义）。 */
  export function Menu(props: {
    open: boolean
    anchor?: unknown
    items: readonly unknown[]
    onSelect: (id: string) => void
    onClose: () => void
    getAnchorRect?: () => DOMRect | null
    portal?: boolean
    dense?: boolean
    compact?: boolean
    align?: 'start' | 'end'
    side?: 'top' | 'bottom'
  }): unknown
}
