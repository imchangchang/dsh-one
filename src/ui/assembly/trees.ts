/**
 * 三棵装配树的定义（#78 从 `ui/assemblyView.ts` 抽出的纯数据）：每棵树 =
 * 一份 block list + 一个自有 frame 插件 id + 该树追加的共用插件。
 *
 * 为什么单独成模块：浏览器验证 harness（`test/assembly-lab/`）要在普通 Node
 * 环境里按**同一份定义**造装配页，而 `assemblyView.ts` 依赖 vscode API 进不去。
 * 定义留在 UI 层就会两份漂移，抽到这里两边共用一个事实源。
 */
import {
  CHAT_BLOCK_LIST,
  CHAT_FRAME_PLUGIN_ID,
  COMPOSER_CLEAR_PLUGIN_ID,
  CONTEXT_MENU_PLUGIN_ID,
  GIT_CARD_PLUGIN_ID,
  SESSION_BOOT_PLUGIN_ID,
  SESSION_BRIDGE_PLUGIN_ID,
  SESSION_EXPORT_PLUGIN_ID,
  SETTINGS_BLOCK_LIST,
  SETTINGS_FRAME_PLUGIN_ID,
  SETTINGS_GEAR_PLUGIN_ID,
  SIDEBAR_BLOCK_LIST,
  SIDEBAR_FRAME_PLUGIN_ID,
  THEME_FOLLOW_PLUGIN_ID,
  WORKSPACE_TREE_PLUGIN_ID,
  type BlockedPlugin,
} from './wireFilter.ts'

/** 一棵树 = 一份 block list + 一个自有 frame 插件 id + 追加的共用插件。 */
export interface AssemblyTree {
  blockList: ReadonlyArray<BlockedPlugin>
  framePluginId: string
  extraPluginIds: readonly string[]
}

/**
 * chat 树（#64）：装配对话区——官方外框与官方侧栏下线，对话流卡片全保留。
 */
export const CHAT_TREE: AssemblyTree = {
  blockList: CHAT_BLOCK_LIST,
  framePluginId: CHAT_FRAME_PLUGIN_ID,
  extraPluginIds: [
    THEME_FOLLOW_PLUGIN_ID,
    SESSION_BOOT_PLUGIN_ID,
    SESSION_EXPORT_PLUGIN_ID,
    // #65 批 1：Git 卡片 / 右键菜单家族 / 清空三件套（均 chat 树）。
    GIT_CARD_PLUGIN_ID,
    CONTEXT_MENU_PLUGIN_ID,
    COMPOSER_CLEAR_PLUGIN_ID,
  ],
}

/**
 * sidebar 树（#70 侧栏位装配）：只下官方外框，官方侧栏件原样进侧栏位。
 */
export const SIDEBAR_TREE: AssemblyTree = {
  blockList: SIDEBAR_BLOCK_LIST,
  framePluginId: SIDEBAR_FRAME_PLUGIN_ID,
  // #65 批 2：工作区/会话树换成自有遮蔽插件（官方 sidebar.workspaces 槽位）。
  extraPluginIds: [THEME_FOLLOW_PLUGIN_ID, SETTINGS_GEAR_PLUGIN_ID, SESSION_BRIDGE_PLUGIN_ID, WORKSPACE_TREE_PLUGIN_ID],
}

/**
 * settings 树（#70 设置独立成页）：block list = 官方外框 + 官方侧栏 + 对话流卡片组。
 */
export const SETTINGS_TREE: AssemblyTree = {
  blockList: SETTINGS_BLOCK_LIST,
  framePluginId: SETTINGS_FRAME_PLUGIN_ID,
  extraPluginIds: [THEME_FOLLOW_PLUGIN_ID],
}

/** mirror 要同时伺服的树（缓存键 = 各树 framePluginId，见 server/assemblyMirror.ts）。 */
export const ASSEMBLY_TREES: ReadonlyArray<AssemblyTree> = [CHAT_TREE, SIDEBAR_TREE, SETTINGS_TREE]

/**
 * 一棵树的「自有插件 id」列表：第一个是 frame 插件 id，其余是该树追加的共用插件。
 *
 * 顺序有含义，消费方别自己拼：装配页的 `localPluginIds` 选项（`ui/assembly/pageHtml.ts`）
 * 与镜像的事件流路由（`server/assemblyMirror.ts` 的 serveGraphEvents）都按「第一个 =
 * 该树的 frame 插件 id」取 block list。
 */
export function localPluginIdsOf(tree: AssemblyTree): string[] {
  return [tree.framePluginId, ...tree.extraPluginIds]
}
