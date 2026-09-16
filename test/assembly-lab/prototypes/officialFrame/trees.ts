/**
 * 官方 AppFrame 形态适配原型的三棵树（#89 评估原型，只跑实验室、不进生产）。
 *
 * 与生产三棵树的差别只有两处：
 * 1. **不 block 官方 `@deepseek-ai/dsh-client-ui-layout`**——由官方 AppFrame 渲染
 *    root（生产是我们自己的 frame 插件渲染，见 src/ui/assembly/shell/）；
 * 2. 每棵树多装一个**原型形态插件**（`@dsh-one/proto-frame-*`）做 VS Code 形态适配。
 *    这个 id 同时充当 `filterWire` 的「该树自有插件 id」：mirror 靠它选 block list
 *    与 combo 缓存键（与生产三棵树同一套机制）。
 *
 * 其余（block list、追加插件）逐字沿用生产三棵树，这样「原型 vs 现状」的差别就只剩
 * 「谁渲染 root」，量出来的差异可以直接归因。
 */
import {
  CHAT_BLOCK_LIST,
  SETTINGS_BLOCK_LIST,
  SIDEBAR_BLOCK_LIST,
  SHELL_PLUGIN_ID,
  type BlockedPlugin,
} from '../../../../src/ui/assembly/wireFilter.ts'
import { CHAT_TREE, SETTINGS_TREE, SIDEBAR_TREE, type AssemblyTree } from '../../../../src/ui/assembly/trees.ts'

/** 官方应用外框插件 id（生产三棵树都 block 它，原型不 block）。 */
export const OFFICIAL_FRAME_PLUGIN_ID = '@deepseek-ai/dsh-client-ui-layout'

/** 原型形态插件 id（一树一个；同时是 mirror 的树路由键）。 */
export const PROTO_CHAT_PLUGIN_ID = '@dsh-one/proto-frame-chat'
export const PROTO_SIDEBAR_PLUGIN_ID = '@dsh-one/proto-frame-sidebar'
export const PROTO_SETTINGS_PLUGIN_ID = '@dsh-one/proto-frame-settings'

/** 原型形态插件 id → 源码入口（build.ts 用它打 bundle）。 */
/** 形态观测探针插件 id（原型专用诊断件：记录主题服务的偏好与每次变更）。 */
export const PROTO_THEME_PROBE_PLUGIN_ID = '@dsh-one/proto-theme-probe'

export const PROTO_PLUGINS: ReadonlyArray<{ id: string; entry: string }> = [
  { id: PROTO_THEME_PROBE_PLUGIN_ID, entry: 'plugins/themeProbe.ts' },
  { id: PROTO_CHAT_PLUGIN_ID, entry: 'plugins/chatShape.ts' },
  { id: PROTO_SIDEBAR_PLUGIN_ID, entry: 'plugins/sidebarShape.ts' },
  { id: PROTO_SETTINGS_PLUGIN_ID, entry: 'plugins/settingsShape.ts' },
]

/** 从生产 block list 里去掉「block 官方外框」那一条（原型让官方 AppFrame 上场）。 */
function withoutFramePlugin(list: ReadonlyArray<BlockedPlugin>): BlockedPlugin[] {
  return list.filter((blocked) => blocked.id !== OFFICIAL_FRAME_PLUGIN_ID)
}

export const CHAT_PROTO_TREE: AssemblyTree = {
  blockList: withoutFramePlugin(CHAT_BLOCK_LIST),
  shellPluginId: PROTO_CHAT_PLUGIN_ID,
  extraPluginIds: [...CHAT_TREE.extraPluginIds, PROTO_THEME_PROBE_PLUGIN_ID],
}

/**
 * 控制组（#89 A/B 实验）：**同一棵 chat 树**，只差「谁渲染 root」——
 * block list 与生产 chat 树完全一致（照样 block 官方 ui-layout、用自有
 * `@dsh-one/vscode-shell`），只多挂一个形态插件（形态插件在自有 frame 上不命中任何
 * 选择器，等于空转）。它用来把「官方 AppFrame 在场」造成的差异从别的变量里摘出来
 * ——实测到的第一处差异就是收尾主题（见 run.ts 的 P-11）。
 */
export const CHAT_CONTROL_TREE: AssemblyTree = {
  blockList: CHAT_BLOCK_LIST,
  shellPluginId: SHELL_PLUGIN_ID,
  extraPluginIds: [...CHAT_TREE.extraPluginIds, PROTO_THEME_PROBE_PLUGIN_ID, PROTO_CHAT_PLUGIN_ID],
}

export const SIDEBAR_PROTO_TREE: AssemblyTree = {
  blockList: withoutFramePlugin(SIDEBAR_BLOCK_LIST),
  shellPluginId: PROTO_SIDEBAR_PLUGIN_ID,
  extraPluginIds: SIDEBAR_TREE.extraPluginIds,
}

export const SETTINGS_PROTO_TREE: AssemblyTree = {
  blockList: withoutFramePlugin(SETTINGS_BLOCK_LIST),
  shellPluginId: PROTO_SETTINGS_PLUGIN_ID,
  extraPluginIds: SETTINGS_TREE.extraPluginIds,
}

/** 原型三棵树（与 labServer 的 LabTreeRoute 同形，供 run.ts 复用）。 */
export interface ProtoTreeRoute {
  /** 路由名（URL 路径去掉斜杠）。 */
  route: string
  title: string
  tree: AssemblyTree
  /**
   * 首屏就绪选择器：原型三棵树统一等「官方 AppFrame 的 overlay 层」出现——
   * 它只由官方 AppFrame 渲染，出现即说明官方 root 条目上台了。
   */
  readySelector: string
  note: string
}

/** 官方 AppFrame 的 overlay 层标记（AppFrame 给 shell.overlay 层打的官方语义属性）。 */
export const FRAME_READY_SELECTOR = '[data-shell-overlay]'

export const PROTO_ROUTES: ReadonlyArray<ProtoTreeRoute> = [
  {
    route: 'proto-chat',
    title: '官方 AppFrame × chat 树',
    tree: CHAT_PROTO_TREE,
    readySelector: FRAME_READY_SELECTOR,
    note: '官方 AppFrame 渲染 root，形态插件把侧栏列去掉（VS Code 对话面板没有侧栏），中列与官方右栏列按官方语义。',
  },
  {
    route: 'proto-chat-control',
    title: '控制组 × chat 树（自有 frame，其余与原型一致）',
    tree: CHAT_CONTROL_TREE,
    readySelector: '[data-slot="conversation.composer.bar"]',
    note: 'A/B 实验的控制组：block list 与追加插件和原型 chat 树一致，只是 root 由自有 @dsh-one/vscode-shell 渲染——用来把差异归因到「官方 AppFrame 在场」这一个变量。',
  },
  {
    route: 'proto-sidebar',
    title: '官方 AppFrame × sidebar 树',
    tree: SIDEBAR_PROTO_TREE,
    readySelector: FRAME_READY_SELECTOR,
    note: '官方 AppFrame 渲染 root，形态插件让侧栏列单列铺满（官方侧栏根的内联 width 被覆盖成 100%）。',
  },
  {
    route: 'proto-settings',
    title: '官方 AppFrame × settings 树',
    tree: SETTINGS_PROTO_TREE,
    readySelector: FRAME_READY_SELECTOR,
    note: '官方 AppFrame 渲染 root，设置页按官方 keyed `main` 机制注册成全局面板（ctx.layout.selectPanel）。',
  },
]
