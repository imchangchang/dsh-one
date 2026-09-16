/**
 * 侧栏树的**纯视图态**（#82 铁律「插件状态按官方惯例存储」的第二类：纯视图态走
 * 客户端存储，沿用官方客户端既有惯例）。
 *
 * 与「用户可感知的持久状态」（分组定义/归属）分开的理由：那些是两个 shell
 * （VS Code 与官方 web）都必须看到同一份的用户数据，归**宿主半**；而「分组方式 /
 * 排序方式 / 当前在看的哪个分组 / 展开过哪些分组」只是这台机器这个浏览器里的
 * 看法，官方客户端本来就把同类偏好放 `localStorage`——出处：官方
 * `dsh-client-ui-conversation/lib/client.js` 的 `WIDTH_PREF_KEY =
 * "dsh.conversation.contentWidth"`（`localStorage.getItem/setItem` 直存），
 * 官方 `dsh-api-terminal-controller` 亦同。所以本模块的键名沿用 `dsh.<区>.<名>`
 * 风格（`dsh.workspaceTree.view`），不另起第二套。
 *
 * 纯逻辑（不碰 DOM）：存取口以 `StorageLike` 注入，单测用假件。
 */

/** `localStorage` 的最小面（浏览器有，单测的假件也有）。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 视图偏好（全部是可缺省项：解析不出来就用默认值）。 */
export interface TreeViewPrefs {
  /** 分组方式：按工作区 / 单列表（官方 ViewOptionsMenu 的两档）。 */
  groupBy: 'workspace' | 'flat'
  /** 排序方式：手动序 / 最近更新（官方同两档）。 */
  orderBy: 'manual' | 'updated'
  /** 当前过滤的分组 id；null = 全部（不是「未分组」——未分组是空串键，见 UNGROUPED_KEY）。 */
  activeGroupId: string | null
  /** 显式展开/收起过的分组键（含未分组桶的空串）。 */
  expandedGroups: string[]
}

/** 官方客户端惯例的键名风格：`dsh.<区>.<名>`。 */
export const TREE_VIEW_PREF_KEY = 'dsh.workspaceTree.view'

/** 默认偏好：与官方 WorkspaceBrowser 的初始态一致（按工作区 / 手动序 / 看全部）。 */
export function defaultTreeViewPrefs(): TreeViewPrefs {
  return { groupBy: 'workspace', orderBy: 'manual', activeGroupId: null, expandedGroups: [] }
}

/** 解析一条持久化记录（坏值/旧值一律回落默认，绝不抛）。 */
export function parseTreeViewPrefs(raw: unknown): TreeViewPrefs {
  const defaults = defaultTreeViewPrefs()
  if (typeof raw !== 'object' || raw === null) return defaults
  const record = raw as Record<string, unknown>
  const expanded = Array.isArray(record.expandedGroups)
    ? [...new Set(record.expandedGroups.filter((key): key is string => typeof key === 'string'))]
    : []
  return {
    groupBy: record.groupBy === 'flat' ? 'flat' : 'workspace',
    orderBy: record.orderBy === 'updated' ? 'updated' : 'manual',
    activeGroupId: typeof record.activeGroupId === 'string' && record.activeGroupId !== '' ? record.activeGroupId : null,
    expandedGroups: expanded,
  }
}

/** 读视图偏好（无存储/坏 JSON/无此键都给默认值）。 */
export function readTreeViewPrefs(storage: StorageLike | undefined): TreeViewPrefs {
  if (storage === undefined) return defaultTreeViewPrefs()
  let text: string | null
  try {
    text = storage.getItem(TREE_VIEW_PREF_KEY)
  } catch {
    return defaultTreeViewPrefs()
  }
  if (text === null || text === '') return defaultTreeViewPrefs()
  try {
    return parseTreeViewPrefs(JSON.parse(text) as unknown)
  } catch {
    return defaultTreeViewPrefs()
  }
}

/** 写视图偏好（存储不可用/写满时静默跳过：视图态丢了不影响功能）。 */
export function writeTreeViewPrefs(storage: StorageLike | undefined, prefs: TreeViewPrefs): void {
  if (storage === undefined) return
  try {
    storage.setItem(TREE_VIEW_PREF_KEY, JSON.stringify(prefs))
  } catch {
    /* 隐私模式/配额满：视图态不是数据，静默降级 */
  }
}

/** 页面可用的客户端存储（非浏览器环境——单测/SSR——返回 undefined）。 */
export function pageStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
