/** 自定义分组的本地常量与 id 生成（持久状态走宿主能力口）。 */

/** 行菜单里「所属分组」那一节的 id 前缀（与 rename/delete 等动作 id 区分开）。 */
export const GROUP_MENU_PREFIX = 'group:'

/**
 * 行菜单里「标签组」那一节的 id 前缀（#107）。与工作区分组的 `group:` 分开：两处
 * 都在会话/工作区行菜单里出，前缀混了就会把「归到哪个标签组」当成「归到哪个工作区分组」。
 */
export const TAG_MENU_PREFIX = 'tag:'

/**
 * 新建标签组的 id：`t-<uuid>`——与旧侧栏建标签组时的形态一字不差（旧文件里现存的
 * 自建组就是 `t-...` 这种 id，新老混在一份归属表里不会互相认错）。
 */
export function newTagGroupId(): string {
  const uuid =
    typeof crypto === 'object' && crypto !== null && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
  return `t-${uuid}`
}

/**
 * 新分组的 id：`g-<uuid>`——与旧侧栏建组时的形态一字不差（旧文件里现存的分组
 * 就是 `g-...` 这种 id，新老混在一份 membership 里不会互相认错）。
 */
export function newGroupId(): string {
  const uuid = typeof crypto === 'object' && crypto !== null && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
  return `g-${uuid}`
}
