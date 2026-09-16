/**
 * 会话的**资格判定**（能不能勾选、能不能移入回收站、能不能归档）：纯函数、无 IO、
 * 无 `vscode` import（`node --test` 直接测）。
 *
 * ## 为什么要单独一份纯判定
 * 同一件事（「这条会话现在允许做什么」）在界面上有四处要问：多选行的勾选框、会话行
 * 菜单的两项动作、组头三态全选、以及将来按工作区/标签组批量操作时的过滤。判定散在
 * 各处必然漂移（旧侧栏就是几份 if 各写一遍），所以口径只留这一份，界面按原因码取
 * 文案。
 *
 * ## 两条线（#98 定稿的回收站两层语义）
 * - **移入回收站**（`canRecycle`）＝ 可逆的一层：只要不是置顶就允许。运行中 / 未读 /
 *   正在等用户的会话**可以**移入——进去还能还原，不是丢东西。
 * - **归档**（`canArchive`）＝ 终点动作：置顶与「状态还在动」的会话（运行中、后代
 *   子代理在跑、手动未读、正在等用户）一律不归档——归档后这些状态无从追踪。
 *
 * 置顶两条线都不允许（置顶的意义就是「不会被顺手清掉」）。
 *
 * 判定吃的是**事实**而不是会话对象：置顶与未读住在插件状态里（宿主能力口的两份 id
 * 集合），不在官方会话快照里，所以由调用方把它们并进来（见 `WorkspaceTree` 的行渲染）。
 */

/** 判定要用到的事实（结构化最小面：`SessionNode` 加上外部状态就能拼出来）。 */
export interface SessionEligibilityFacts {
  /** 在置顶 id 集合里。 */
  readonly pinned: boolean
  /** 会话本身在跑。 */
  readonly running: boolean
  /** 在跑的**后代子代理**数（`SessionNode.runningSubagentCount`；缺省 0）。 */
  readonly runningSubagentCount?: number
  /** 在手动未读 id 集合里。 */
  readonly unread: boolean
  /** 正在等用户（`approval` / `plan-review` / `question`）。 */
  readonly pendingInteraction?: string
}

/** 不允许的原因（界面按它取文案；#103 的「移入回收站」项同样吃这四个码）。 */
export type SessionBlockReason = 'pinned' | 'running' | 'unread' | 'pending'

/** 会话或其后代子代理正在跑 = 「状态还在动」。 */
export function sessionBusy(facts: SessionEligibilityFacts): boolean {
  return facts.running || (facts.runningSubagentCount ?? 0) > 0
}

/** 能不能移入回收站（可逆的一层）：只有置顶不允许。 */
export function canRecycle(facts: SessionEligibilityFacts): boolean {
  return cannotRecycleReason(facts) === null
}

/** 能不能归档（终点动作）：置顶与「状态还在动」的会话都不允许。 */
export function canArchive(facts: SessionEligibilityFacts): boolean {
  return cannotArchiveReason(facts) === null
}

/** 不能移入回收站的原因；允许则 null。 */
export function cannotRecycleReason(facts: SessionEligibilityFacts): SessionBlockReason | null {
  return facts.pinned ? 'pinned' : null
}

/**
 * 不能归档的原因；允许则 null。
 * 顺序 = 提示优先级：置顶（用户自己加的锁，最该先说）> 等用户 > 运行中 > 未读。
 */
export function cannotArchiveReason(facts: SessionEligibilityFacts): SessionBlockReason | null {
  if (facts.pinned) return 'pinned'
  if (facts.pendingInteraction !== undefined) return 'pending'
  if (sessionBusy(facts)) return 'running'
  if (facts.unread) return 'unread'
  return null
}

/** 组头三态：未选 / 部分选 / 全选。 */
export type GroupSelectionState = 'none' | 'some' | 'all'

/**
 * 一层（工作区 / 标签组）组头的三态全选判定。
 *
 * 规则（旧侧栏同款）：只在**够格勾选**的成员里数。全部够格成员都被选中、且这一层
 * 没有不够格的成员时才是 `all`；有置顶这类不能勾选的成员时，最满也只能到 `some`
 * ——否则用户会以为「整组都选中了」，而实际会有几条被静默跳过。
 *
 * @param members 这一层的全部成员（顺序无关）
 * @param isSelectable 该成员是否能被勾选（会话行用 `canRecycle`）
 * @param isSelected 该成员当前是否被勾选
 */
export function groupSelectionState<T>(
  members: readonly T[],
  isSelectable: (member: T) => boolean,
  isSelected: (member: T) => boolean,
): GroupSelectionState {
  const selectable = members.filter((member) => isSelectable(member))
  if (selectable.length === 0) return 'none'
  const selected = selectable.filter((member) => isSelected(member)).length
  if (selected === 0) return 'none'
  if (selected === selectable.length && selectable.length === members.length) return 'all'
  return 'some'
}
