/**
 * 侧栏树的**持久状态**（#82 铁律「插件状态按官方惯例存储」的第一类：用户可感知的
 * 持久状态，由宿主半拥有、落 `~/.dsh`、经官方 RPC 暴露）。
 *
 * ## 这个模块是什么
 * 树插件要记的用户数据只有一件：**工作区分组**（组定义 + 归属）。它的家是宿主
 * 能力口的 `stateRead/stateWrite('groups')`——不是 VS Code 的 Memento，也不是扩展
 * 自建的状态文件；VS Code 侧与官方 web 侧因此看到同一份（见
 * `src/ui/assembly/shell/hostCapabilities.ts` 的能力表）。
 *
 * ## 为什么键名与文件格式沿用旧侧栏的 `groups.json`
 * 旧的 vanilla 侧栏把同一件事存在 `~/.dsh/dsh-one/groups.json`（`{version:1,
 * groups, membership, activeGroupId}`）。宿主半的状态存储本来就落同一个目录
 * （`~/.dsh/dsh-one/<键>.json`，见 `packages/dsh-host-capabilities/src/stateStore.ts`
 * 的说明），所以**键名取 `groups`、格式一字不改**的结果是：用户在旧侧栏建的分组，
 * 新的装配树打开就能看到，一次数据搬家都不用做。这正是铁律「同一份数据不该有
 * 第二个家」想要的效果——不是迁移得漂亮，而是根本没迁移。
 *
 * `activeGroupId`（旧侧栏记「当前在看哪个分组」）**不再由本模块写**：它是纯视图态，
 * 按铁律走客户端存储（`workspaceTreePrefs.ts` 的 `dsh.workspaceTree.view`）。但文件
 * 里的这个字段**原样保留**——旧版本可能还在读它，我们没有理由动别人的数据。
 */

import { sanitizeGroupFile, serializeGroupFile, type GroupFile } from './dshStateFile.ts'
import {
  addGroup,
  deleteGroup,
  removeGroupId,
  renameGroup,
  setWorkspaceGroupIds,
  type WorkspaceGroupDef,
} from './workspaceGroups.ts'

export type { WorkspaceGroupDef }

/** 宿主能力口的键（= `~/.dsh/dsh-one/groups.json`）。 */
export const TREE_GROUPS_STATE_KEY = 'groups'

/** 空状态（与旧侧栏的初值同形：三段字段齐全，version 1）。 */
export function emptyTreeGroups(): GroupFile {
  return { version: 1, groups: [], membership: {}, activeGroupId: null }
}

/**
 * 校核宿主能力口读回的值（`stateRead` 给的是解析后的对象）。
 * 坏值/旧版本 → null，调用方按空状态处理（绝不抛）。
 */
export function parseTreeGroups(value: unknown): GroupFile | null {
  return sanitizeGroupFile(value)
}

/** 落盘用的文本（与旧侧栏 `serializeGroupFile` 同一份，格式不会漂）。 */
export function serializeTreeGroups(file: GroupFile): string {
  return serializeGroupFile(file)
}

/** 建组结果：成功给新状态，失败给原因（界面按原因出文案）。 */
export type TreeGroupCreate = { ok: true; file: GroupFile; id: string } | { ok: false; error: 'empty' | 'duplicate' }

/** 建一个分组并把它加进当前状态（不改变任何归属）。 */
export function createTreeGroup(file: GroupFile, name: string, id: string): TreeGroupCreate {
  const groups = addGroup(file.groups, name, id)
  if (groups === null) return { ok: false, error: name.trim() === '' ? 'empty' : 'duplicate' }
  return { ok: true, file: { ...file, groups }, id }
}

/** 重命名；无变化/非法返回 null（调用方跳过落盘）。 */
export function renameTreeGroup(file: GroupFile, id: string, name: string): GroupFile | null {
  const groups = renameGroup(file.groups, id, name)
  if (groups === null) return null
  return { ...file, groups }
}

/** 删组：定义与全部归属一起删（归属残留指向不存在的组只会变成脏数据）。 */
export function deleteTreeGroup(file: GroupFile, id: string): GroupFile | null {
  const groups = deleteGroup(file.groups, id)
  if (groups === null) return null
  return { ...file, groups, membership: removeGroupId(file.membership, id) }
}

/** 把工作区加入/移出一个分组；无变化返回 null。 */
export function toggleWorkspaceGroup(file: GroupFile, workspaceId: string, groupId: string): GroupFile | null {
  const known = new Set(file.groups.map((g) => g.id))
  if (!known.has(groupId) || workspaceId === '') return null
  const current = file.membership[workspaceId] ?? []
  const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
  const membership = setWorkspaceGroupIds(file.membership, workspaceId, next, known)
  if (membership === null) return null
  return { ...file, membership }
}

/**
 * 批量设置归属（#139 成员清单里的「全选 / 清空」）：对给定的一批工作区逐个折叠
 * {@link toggleWorkspaceGroup} 这**同一个纯函数**，返回最终状态（无变化回 null）。
 *
 * 为什么要有它：逐项调 {@link toggleWorkspaceGroup} 要每步拿上一步的结果，而界面的
 * 状态更新是异步的（连续调用会各自基于同一份旧状态算，最终只剩最后一次生效）。这一层
 * 把折叠做完再交回调用方落盘一次，于是「界面上一次动作 = 一次落盘」，而**成员判定与
 * 增删语义仍然只有一份**（判定用过滤 / 计数同款的 {@link workspaceMatchesGroup}，
 * 增删仍走 `toggleWorkspaceGroup`）。
 */
export function setWorkspacesGroupMembership(
  file: GroupFile,
  workspaceIds: readonly string[],
  groupId: string,
  member: boolean,
): GroupFile | null {
  let next = file
  let changed = false
  for (const workspaceId of workspaceIds) {
    if (workspaceMatchesGroup(next, workspaceId, groupId) === member) continue
    const updated = toggleWorkspaceGroup(next, workspaceId, groupId)
    if (updated === null) continue
    next = updated
    changed = true
  }
  return changed ? next : null
}

/**
 * 过滤用的判定：当前选中的分组下，某个工作区是否可见。
 *
 * 语义（与旧侧栏的「选中分组即过滤」一致）：`activeGroupId` 为 null 时全部可见；
 * 否则只有归属该分组的工作区可见。**未分组桶（散会话）在过滤态下不参与**——
 * 散会话不属于任何工作区，也就无法归属任何分组，跟着过滤一起收起才符合直觉。
 */
export function workspaceMatchesGroup(
  file: GroupFile,
  workspaceId: string,
  activeGroupId: string | null,
): boolean {
  if (activeGroupId === null) return true
  return (file.membership[workspaceId] ?? []).includes(activeGroupId)
}

/** 某工作区归属的分组 id（菜单里显示勾选用）。 */
export function workspaceGroupIds(file: GroupFile, workspaceId: string): string[] {
  return file.membership[workspaceId] ?? []
}

/** 分组表里还存在的 id（过滤态下 activeGroupId 被删组后要回落「全部」）。 */
export function hasTreeGroup(file: GroupFile, groupId: string | null): boolean {
  return groupId !== null && file.groups.some((g) => g.id === groupId)
}

/** 供界面用的组定义列表（保持显示顺序）。 */
export function treeGroupDefs(file: GroupFile): readonly WorkspaceGroupDef[] {
  return file.groups
}
