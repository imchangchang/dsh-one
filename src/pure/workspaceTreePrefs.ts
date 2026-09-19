/**
 * 侧栏树的**纯视图态**（#82 铁律「插件状态按官方惯例存储」的第二类：纯视图态走
 * 客户端存储，沿用官方客户端既有惯例）。
 *
 * 与「用户可感知的持久状态」（分组定义/归属）分开的理由：那些是两个 shell
 * （VS Code 与官方 web）都必须看到同一份的用户数据，归**宿主半**；而「当前在看的
 * 哪个分组 / 展开过哪些分组 / 回收站与标签组各自收起了哪些块」只是这台机器这个
 * 浏览器里的看法，官方客户端本来就把同类偏好放 `localStorage`——出处：官方
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

/**
 * 视图偏好（全部是可缺省项：解析不出来就用默认值）。
 *
 * #131 起**不再有分组方式与排序方式**：「按工作区 + 官方顺序」是侧栏唯一的形态，
 * 那两项（以及平铺的单列表模式）已随顶栏「视图选项」菜单一起退役——存过它们的旧
 * `localStorage` 记录不影响这里：解析只认下面这几个字段，多出来的键一律丢掉。
 */
export interface TreeViewPrefs {
  /** 当前过滤的分组 id；null = 全部（不是「未分组」——未分组是空串键，见 UNGROUPED_KEY）。 */
  activeGroupId: string | null
  /**
   * 分组展开态，**键是分组键**（工作区 id，未分组桶是空串），**值是展开还是收起**。
   *
   * 形状与字段名都照官方 `WorkspaceBrowser`：它的 store 里就是
   * `groupExpansion: Record<string, boolean>`（`dsh-client-ui-workspace/lib/client.js` 的
   * `createWorkspaceViewStore`，持久键 `dsh.workspace.view.v5`）。为什么不能只用
   * 「展开过的键」那张表：#151 之前这里存的是 `string[]`，于是「用户手动收起过」与
   * 「从没碰过」在记录里长得一模一样，而首开那条自动展开规则（只展开当前会话所在那一组）
   * 按「没碰过」处理——用户收起当前分组、下次开窗又被自动展开。官方靠 `false` 这条记录
   * 把两者分开（`Object.hasOwn(groupExpansion, currentGroup)`），我们也照此。
   */
  groupExpansion: Record<string, boolean>
  /**
   * 回收站抽屉里**收起**了的工作区块（键与树里的分组键同域：工作区 id /
   * UNGROUPED_KEY 的空串）。与主树的展开集合分开存：抽屉的折叠是它自己的看法，
   * 收起一个块不该影响主树里那个工作区是展开还是收起（旧侧栏同此处置）。
   */
  recycleCollapsed: string[]
  /**
   * 收起态会被跨工作区重复的标签组 id（#107 的折叠）要连桶一起认定为「哪个工作区的
   * 哪个组」，所以这里存的是 `<分组键>\u0000<组 id>` 这种复合键（见
   * `workspaceTree/tagGroups.ts` 的 `tagCollapseKey`）。
   *
   * 折叠态**不进** `tags.json`：它是纯视图态，按铁律第二类走客户端存储——旧侧栏把它
   * 记在标签组文件里，那是第二类与第一类混住，迁入时读过即弃（见
   * `pure/sessionTagGroups.ts` 的文件头）。
   */
  tagCollapsed: string[]
}

/** 官方客户端惯例的键名风格：`dsh.<区>.<名>`。 */
export const TREE_VIEW_PREF_KEY = 'dsh.workspaceTree.view'

/** 默认偏好：与官方 WorkspaceBrowser 的初始态一致（看全部、没有任何展开记录）。 */
export function defaultTreeViewPrefs(): TreeViewPrefs {
  return {
    activeGroupId: null,
    groupExpansion: {},
    recycleCollapsed: [],
    tagCollapsed: [],
  }
}

/**
 * 解析分组展开态：认新形状（`Record<string, boolean>`），也认 #151 之前那份旧记录
 * （`expandedGroups: string[]`，只记「展开过的键」）。
 *
 * 旧记录里的键一律迁成 `true`（那时展开过就是展开着）；旧记录里没有的键只能按「从没
 * 碰过」处理——旧形状根本记不下「用户收起过」，这不是这次改动能追回来的信息。
 */
function parseGroupExpansion(record: Record<string, unknown>): Record<string, boolean> {
  const value = record.groupExpansion
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    // `Object.fromEntries` 而不是逐键赋值：`__proto__` 这种键名在赋值那条路上会改到原型，
    // 而这份数据来自页面自己的 localStorage（谁都能往里面写）。
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    )
  }
  if (!Array.isArray(record.expandedGroups)) return {}
  return Object.fromEntries(
    [...new Set(record.expandedGroups.filter((key): key is string => typeof key === 'string'))].map((key) => [key, true]),
  )
}

/** 解析一条持久化记录（坏值/旧值一律回落默认，绝不抛）。 */
export function parseTreeViewPrefs(raw: unknown): TreeViewPrefs {
  const defaults = defaultTreeViewPrefs()
  if (typeof raw !== 'object' || raw === null) return defaults
  const record = raw as Record<string, unknown>
  const keyList = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === 'string'))] : []
  return {
    activeGroupId: typeof record.activeGroupId === 'string' && record.activeGroupId !== '' ? record.activeGroupId : null,
    groupExpansion: parseGroupExpansion(record),
    recycleCollapsed: keyList(record.recycleCollapsed),
    tagCollapsed: keyList(record.tagCollapsed),
  }
}

/** 展开着的分组键（`deriveGroups` 要的是「哪些键展开着」这份清单）。 */
export function expandedGroupKeys(prefs: TreeViewPrefs): string[] {
  return Object.entries(prefs.groupExpansion)
    .filter(([, expanded]) => expanded)
    .map(([key]) => key)
}

/**
 * 首开默认展开当前会话所在那一组——**只在那一组从未被显式收/展过时**动手。
 *
 * 官方同此：`WorkspaceBrowser` 里那条 effect 先问 `Object.hasOwn(groupExpansion, currentGroup)`，
 * 记录里已经有这个键（用户自己点过、无论收或展）就不再改（`dsh-client-ui-workspace/lib/client.js`
 * 的 `SessionTree`；store 的初值是空记录，所以「首开只展开当前那一组、其余全折叠」）。
 * 少了这一步，用户手动收起当前分组会被下一次列表推送或重开窗口顶回来。
 */
export function autoExpandGroup(prefs: TreeViewPrefs, key: string): TreeViewPrefs {
  if (Object.hasOwn(prefs.groupExpansion, key)) return prefs
  return { ...prefs, groupExpansion: { ...prefs.groupExpansion, [key]: true } }
}

/** 把若干分组写成同一个展开态（写进去 = 用户显式表过态，见 groupExpansion 的说明）。 */
export function setGroupExpansion(prefs: TreeViewPrefs, entries: Record<string, boolean>): TreeViewPrefs {
  return { ...prefs, groupExpansion: { ...prefs.groupExpansion, ...entries } }
}

/** 翻转一个分组的展开态（当前没记录 = 收起着，翻一下就是展开）。 */
export function toggleGroupExpansion(prefs: TreeViewPrefs, key: string): TreeViewPrefs {
  return setGroupExpansion(prefs, { [key]: prefs.groupExpansion[key] !== true })
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
