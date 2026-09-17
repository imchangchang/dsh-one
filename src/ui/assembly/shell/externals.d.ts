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
  export function Button(props: { variant?: string; size?: string; disabled?: boolean; onClick?: () => void; className?: string; children?: unknown }): unknown
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
  export function IconCodeOutline16(props: { size?: number }): unknown
  export function IconFolderOpenOutline16(props: { size?: number }): unknown
  /**
   * 官方图标件（#65 批 2 侧栏自有树用；名与尺寸档全部取自官方 primitives
   * 导出表「Object.freeze」那一份，未新增自造图标）。
   */
  export function IconFolderOpen16(props: { size?: number; className?: string }): unknown
  export function IconFolderClose16(props: { size?: number; className?: string }): unknown
  export function IconTriangleRightFill14(props: { size?: number; className?: string }): unknown
  export function IconEllipsisOutline16(props: { size?: number; className?: string }): unknown
  export function IconPlusOutline16(props: { size?: number; className?: string }): unknown
  export function IconSearchOutline16(props: { size?: number; className?: string }): unknown
  export function IconCloseFill14(props: { size?: number; className?: string }): unknown
  export function IconPersonalizationOutline16(props: { size?: number; className?: string }): unknown
  export function IconEditOutline16(props: { size?: number; className?: string }): unknown
  export function IconTrashOutline16(props: { size?: number; className?: string }): unknown
  export function IconBranchOutline16(props: { size?: number; className?: string }): unknown
  export function IconArchiveOutline20(props: { size?: number; className?: string }): unknown
  /** 官方图标件（#110：活跃定时任务标记，官方 ui-workspace 的 ActiveScheduleIndicator 同款）。 */
  export function IconAlarmClockOutline16(props: { size?: number; className?: string }): unknown
  /** 官方图标件（#81：批量选择入口、回收站「还原」）。 */
  export function IconChecklistOutline14(props: { size?: number; className?: string }): unknown
  export function IconRefreshOutline16(props: { size?: number; className?: string }): unknown
  /**
   * 官方图标件（#99 侧栏顶栏：折叠/展开全部、添加工作区、回收站入口行）。
   * 名与尺寸档同样取自官方 primitives 导出表（未新增自造图标）。
   */
  export function IconChevronDownOutline14(props: { size?: number; className?: string }): unknown
  export function IconChevronUpOutline14(props: { size?: number; className?: string }): unknown
  export function IconProjectAddOutline16(props: { size?: number; className?: string }): unknown
  /** 官方状态点（三档：ongoing / warning / done）。 */
  export function StateDot(props: { state: string; className?: string }): unknown
  /** 官方紧凑相对时间（单位 + 数值，文案由词典拼）。 */
  export function relativeTime(updatedAt: number, now: number): { unit: string; n: number }
  /** 官方 tooltip（primitives 导出；label + side + delayMs，cloneElement 挂到子元素上）。 */
  export function Tooltip(props: { label: string; side?: 'top' | 'right' | 'bottom'; delayMs?: number; disabled?: boolean; children?: unknown }): unknown
  /** 官方悬停卡（anchor + content + 复制按钮文案）。 */
  export function HoverCard(props: {
    anchor: unknown
    content: unknown
    disabled?: boolean
    copyText?: string
    copyLabel?: string
    copiedLabel?: string
  }): unknown
  /**
   * 官方模态（设置/重命名等对话框的通用壳）。
   *
   * `className` 挂在 dialog 元素上、`headless` 只渲染 mask + dialog + children
   * （标题/关闭钮/页脚由调用方给）——两件都是官方件的公开 prop，#127 的弹窗靠它们
   * 走紧凑档（举证见 workspaceTree/styles.ts 的 `.dshOneTree_modal` 那一节）。
   */
  export function Modal(props: {
    open: boolean
    onClose: () => void
    closeLabel?: string
    title?: string
    description?: string
    footer?: unknown
    className?: string
    contentClassName?: string
    headless?: boolean
    children?: unknown
  }): unknown
  /** 官方菜单件（右键菜单家族复用官方观感与定位/外点关闭语义）。 */
  export function Menu(props: {
    open: boolean
    anchor?: unknown
    items: readonly unknown[]
    onSelect: (id: string, ...rest: unknown[]) => void
    onClose: () => void
    getAnchorRect?: () => DOMRect | null
    portal?: boolean
    dense?: boolean
    compact?: boolean
    closeOnPointerLeave?: boolean
    selectedIds?: readonly string[]
    align?: 'start' | 'end'
    side?: 'top' | 'bottom'
  }): unknown
}
