/**
 * 多开会话标签页的映射规则（#72，纯函数，便于单测）。
 *
 * 默认形态是与官方一致的单 tab（#71）：侧栏点会话 = 让那一个面板就地切换。
 * 本模块只服务**显式多开**——会话行菜单「在新标签页打开」为某个会话单开一个
 * 面板（用户知情选择：那个面板付一次完整启动成本）。宿主用一张
 * 「会话 id → 面板」的表记住已开的多开面板，再点同一个会话就聚焦既有面板。
 *
 * 这张表有三条必须守住的规则（旧 tab-per-session 实现踩过第 2 条）：
 *
 * 1. **单射**：一格只在登记时写入。同一个面板换了会话（页面内切走）时必须先把
 *    自己那一格清掉，否则旧会话会永久指向这个面板——再点它会聚焦一个已经切走
 *    的页面。
 * 2. **只清自己的格子**：关面板与换会话都只动该面板自己的映射，**绝不能按会话
 *    id 直接删**——旧实现 `sessionTabs.delete(old)` 在两个面板的映射交叉时会删掉
 *    另一个面板的格子（A 切到 B 的会话、B 切到 A 的会话之后，任一方关掉都会让
 *    另一方的导航失灵）。判定一律按「这一格是不是这个面板占的」。
 * 3. **单例不在表里**：单 tab 面板的会话身份记在面板自身（宿主另一处），本表只
 *    记多开面板——所以关掉多开面板不改单 tab 的行为，多开与单例互不影响
 *    （#72 验收口径）。
 */

/** 一张「会话 id → 面板」的表（宿主侧只存这一份；单例不在这张表里）。 */
export type SessionTabTable<T> = ReadonlyMap<string, T>

/** 某个会话当前的多开面板（没开 = undefined）。 */
export function sessionTabOf<T>(table: SessionTabTable<T>, sessionId: string): T | undefined {
  return table.get(sessionId)
}

/**
 * 这个会话现在算不算「已经有面板」：已开的多开面板，或在途创建（按会话 id 记的
 * 创建中任务）。两者都算「已有」——连点两次右键不该开两个面板。
 *
 * @param creating - 在途创建的会话集合（Set 或「会话 id → 创建中任务」的 Map 都行，
 *                   只用到 `has`）。
 */
export function hasSessionTab<T>(
  table: SessionTabTable<T>,
  creating: { has(sessionId: string): boolean },
  sessionId: string,
): boolean {
  return table.has(sessionId) || creating.has(sessionId)
}

/**
 * 把一个面板登记到某会话名下（初次登记与换会话共用同一条规则）：
 * 先清掉**这个面板自己**的旧格子，再写新格子。别的面板的格子一律不碰。
 */
export function assignSessionTab<T>(table: Map<string, T>, panel: T, sessionId: string): void {
  for (const [id, owner] of table) {
    if (owner === panel && id !== sessionId) table.delete(id)
  }
  table.set(sessionId, panel)
}

/** 面板关闭：只清它自己占着的那一格（别的面板的映射不受影响）。 */
export function releaseSessionTab<T>(table: Map<string, T>, panel: T): void {
  for (const [id, owner] of table) {
    if (owner === panel) table.delete(id)
  }
}
