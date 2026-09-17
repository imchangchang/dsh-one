/** 官方同款文案格式化（时间 / 标题）。 */
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionNode } from '../../../../src/pure/workspaceTreeView.ts'
import type { Translate } from './types.ts'

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 官方 `timeLabel`：紧凑相对时间（「刚刚」「5分钟」）。 */
export function timeLabel(updatedAt: number, now: number, tr: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? tr('time.now') : tr(`time.${unit}`, { n })
}

/** 官方 `hoverTimeLabel`：悬停卡里包一层「…前」模板（now 档不包）。 */
export function hoverTimeLabel(updatedAt: number, now: number, tr: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? tr('time.now') : tr('time.ago', { t: tr(`time.${unit}`, { n }) })
}

/** 官方 `createdLabel`：绝对创建时刻走词典日期模板（不用 toLocaleString，避免跟浏览器语言跑）。 */
export function createdLabel(createdAt: number, tr: Translate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  return tr('hover.created', {
    time: `${tr('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  })
}

/** 官方 `displayTitle`：空白会话显示「新会话」。 */
export function displayTitle(node: SessionNode, tr: Translate): string {
  return node.blank ? tr('session.new') : node.title
}
