/**
 * @dsh-one/vscode-settings-gear——侧栏树**底部设置行的隐藏影子**（#70 起，形态随 #99 改）。
 *
 * ## 它现在做什么
 * single 槽 `sidebar.settings` 以 priority −1 顶掉官方 SettingsRoot（注册表原文
 * 「register at a different priority to shadow it (lowest renders)」），渲染**空**。
 * 官方那条 entry 照常装载（#99 不顶替其角色），只是它的触发行不再渲染。
 *
 * ## 为什么官方设置行要藏掉（#98 定稿）
 * 设置入口收到侧栏顶栏最右的齿轮图标（我们自己的树插件渲染，`workspaceTree/toolbar.ts`）
 * ——与搜索、折叠展开全部、添加工作区同处一行，底部那一行就成了重复入口。设置页本身
 * 没变：仍是我们的独立编辑器页（`@dsh-one/vscode-settings-ui-layout` 那条装配树）。
 *
 * ## 齿轮为什么不在本件里渲染
 * 它属于「我们的侧栏浏览区顶栏」，而那个顶栏由树插件（可移植的 `dsh-*`）渲染；
 * 打开设置页这件事与宿主有关，所以走**宿主能力口** `openSettings`（能力表见
 * `hostCapabilities.ts`），插件代码不碰 `acquireVsCodeApi`、不 postMessage。
 * 本插件因此退化成一条纯遮蔽：不改外观语言、不带词典、不带样式。
 *
 * 旧文件名与 id 保留（改名要同步 build.mjs / wireFilter / trees / 包清单，属 #73 的
 * 命名收敛范围）；本文件说明与实现已同步到现状。
 */
/**
 * 遮蔽组件：什么都不渲染（官方设置行藏起来的全部实现）。返回 null 而不是空元素
 * ——与 sidebarLayoutPlugin 的品牌位影子同一做法，槽位容器里不留下任何节点。
 */
function Nothing(): unknown {
  return null
}

interface GearContext {
  effect(body: () => (() => void) | void, label?: string): void
  slots: {
    register(entry: unknown, component: unknown): () => void
    /** 等目标名被任一 entry 的 children 表声明后再注册（官方贡献的正规挂法）。 */
    inject(name: string, factory: () => unknown): () => void
  }
}

export const inject = ['slots']

export function apply(ctx: GearContext): void {
  ctx.effect(() => {
    // 对既有座位名（官方 ui-sidebar 的 children 表声明）必须走 slots.inject：
    // 直接 register 会在「未声明」时抛错（跨插件 effect 时序不保证声明已落）。
    // single 槽影子：priority -1 < 官方 SettingsRoot 的默认 0 → 本件渲染（空）。
    return ctx.slots.inject('sidebar.settings', () =>
      ctx.slots.register({ name: 'sidebar.settings', priority: -1 }, Nothing),
    )
  }, 'dsh-one settings row: hide sidebar.settings (the gear lives in the toolbar now)')
}
