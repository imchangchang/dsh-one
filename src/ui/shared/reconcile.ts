/**
 * 通用按 key 子级对账（chat webview 与 sessions webview 共用）。
 *
 * 从 chat webview 的 reconcileFlow 原样提取：容器子级按 `data-flow-key` 与期望
 * 项序列对账——内容未变（same=true）的行整体保活（各自的 details 展开态、内部
 * 滚动位置、异步图片、hover 高亮、行级定时器、CSS 动画相位全部随元素留存）；
 * 只有新增/删除/内容变化的行才动 DOM。容器本身永不销毁，所以容器的滚动位置
 * （scrollTop）天然存活——这是「滚动容器保活」模式的基础件。
 *
 * key 语义由各调用方自定（chat 用 `msg:${id}` / `wf:${runId}` / `steer:${id}`，
 * 侧栏用 `ws:${workspaceId}` / `tag:${tagId}` / `s:${sessionId}`），稳定即可：
 * 不能用位置下标（补页/重排会错位）。
 */
export interface ReconcileItem {
  key: string
  /** 内容未变 → 复用现元素；false → 就地更新或重渲染替换（同 key 原位）。 */
  same: boolean
  create: () => HTMLElement
  /**
   * 内容变化时实时刷新内容区而非整行重建（可选）。提供后 same=false 不再销毁
   * 现元素，而是对它调用 update(el) 就地更新——行骨架（元素本身）保活，只有
   * 内容区被替换。用于「行骨架保活 + 行内声明式对账（Preact diff）」，是修复
   * 流式重建整行连坐销毁行内子块（tool 卡滚动/展开/动画被打断）的机制（#29）。
   * 留空则走默认的 create 替换。update 时元素仍在 DOM，next 指针须随之推进。
   */
  update?: (el: HTMLElement) => void
  /** 元素被移除/替换时的清理（行级定时器等）。 */
  dispose?: (el: HTMLElement) => void
}

export function reconcileChildren(container: HTMLElement, items: ReconcileItem[]): void {
  const byKey = new Map<string, Element>()
  for (const child of Array.from(container.children)) {
    const k = child.getAttribute('data-flow-key')
    if (k && !byKey.has(k)) byKey.set(k, child)
  }
  const itemByKey = new Map<string, ReconcileItem>()
  for (const item of items) itemByKey.set(item.key, item)
  let next: Element | null = container.firstElementChild
  for (const item of items) {
    // 跳过（并移除）指针位置上的残留行——不在期望流里（older 关闭、turn-status
    // 结束、steering 落地等）。不清掉它们，后续每个留在原位之后的元素都会被
    // 「挪一位」处理成 move（低效且制造大量 childList 变更）。
    while (next) {
      const k = next.getAttribute('data-flow-key')
      if (k !== null && itemByKey.has(k)) break
      const victim = next as HTMLElement
      next = victim.nextElementSibling
      victim.remove()
      if (k !== null) itemByKey.get(k)?.dispose?.(victim)
    }
    const el = byKey.get(item.key)
    if (el) {
      if (item.same) {
        // 顺序修正（罕见）：元素在但位置不对 → 挪到正确位置。
        if (el !== next) container.insertBefore(el, next)
        next = el.nextElementSibling
      } else if (item.update) {
        // 就地更新：行骨架（元素本身）保活，只刷新内容区。元素仍在 DOM，
        // next 指针推进到其后继。（行内 Preact diff 用的更新入口，见 #29。）
        item.update(el as HTMLElement)
        next = el.nextElementSibling
      } else {
        const fresh = item.create()
        fresh.setAttribute('data-flow-key', item.key)
        container.insertBefore(fresh, next)
        el.remove()
        item.dispose?.(el as HTMLElement)
        next = fresh.nextElementSibling
      }
    } else {
      const fresh = item.create()
      fresh.setAttribute('data-flow-key', item.key)
      container.insertBefore(fresh, next)
      next = fresh.nextElementSibling
    }
  }
  // 清尾：期望流之外的残留全部移除。
  let rem = next
  while (rem) {
    const victim = rem as HTMLElement
    rem = victim.nextElementSibling
    victim.remove()
    const k = victim.getAttribute('data-flow-key')
    if (k) itemByKey.get(k)?.dispose?.(victim)
  }
}
