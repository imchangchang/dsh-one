import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileChildren, type ReconcileItem } from '../src/ui/shared/reconcile.ts'

/**
 * reconcileChildren 的最小 DOM 替身：只实现该函数用到的 API（children /
 * firstElementChild / nextElementSibling / getAttribute / setAttribute /
 * insertBefore / remove），跑在 node --test 里不需要浏览器。
 */
class FakeElement {
  readonly tag: string
  parent: FakeElement | null = null
  children: FakeElement[] = []
  attrs = new Map<string, string>()

  constructor(tag: string) {
    this.tag = tag
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null
  }

  get nextElementSibling(): FakeElement | null {
    const siblings = this.parent?.children ?? []
    const index = siblings.indexOf(this)
    return index >= 0 ? (siblings[index + 1] ?? null) : null
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  insertBefore(node: FakeElement, ref: FakeElement | null): FakeElement {
    const from = node.parent
    if (from) from.children.splice(from.children.indexOf(node), 1)
    const index = ref ? this.children.indexOf(ref) : -1
    if (index < 0) this.children.push(node)
    else this.children.splice(index, 0, node)
    node.parent = this
    return node
  }

  remove(): void {
    const from = this.parent
    if (!from) return
    from.children.splice(from.children.indexOf(this), 1)
    this.parent = null
  }
}

const asContainer = (el: FakeElement): HTMLElement => el as unknown as HTMLElement

/** 一个期望行：内容未变时 same=true（复用现元素），变了才 false（重建/update）。 */
function row(key: string, same = true, hooks: Partial<ReconcileItem> = {}): ReconcileItem {
  return {
    key,
    same,
    create: () => {
      const el = new FakeElement('div')
      el.attrs.set('data-row-key', key)
      return el as unknown as HTMLElement
    },
    ...hooks,
  }
}

/** 容器里每行的 `data-flow-key:data-row-key`（断言用，避免对象图比较）。 */
function snapshot(container: FakeElement): string[] {
  return container.children.map(
    (child) => `${child.getAttribute('data-flow-key')}:${child.getAttribute('data-row-key')}`,
  )
}

test('reconcileChildren 按稳定 key 复用行、内容变化走 update、残留被清除', () => {
  const container = new FakeElement('div')
  let updated: string[] = []
  let disposed: string[] = []
  reconcileChildren(asContainer(container), [
    row('a'),
    row('b', false, { update: () => updated.push('b'), dispose: () => disposed.push('b') }),
  ])
  assert.deepEqual(snapshot(container), ['a:a', 'b:b'])
  const firstA = container.children[0]
  const firstB = container.children[1]

  // 第二帧：a 未变（same）→ 同一元素；b 内容变化 → 走 update 就地更新，不重建。
  reconcileChildren(asContainer(container), [
    row('a'),
    row('b', false, { update: () => updated.push('b'), dispose: () => disposed.push('b') }),
  ])
  assert.equal(container.children[0], firstA, 'same 行整元素复用')
  assert.equal(container.children[1], firstB, 'update 路径不销毁现元素')
  assert.deepEqual(updated, ['b'])
  // 用 length 断言而不是 deepEqual(x, [])：@types/node 的 deepEqual 带
  // `asserts actual is T` 谓词，会把数组窄化成 never[]，后面再 push 就报错。
  assert.equal(disposed.length, 0)

  // 第三帧：b 内容变化、没有 update 入口（如 user 行）→ 新建元素原位替换 +
  // dispose 旧元素。提供了 update 的行则走上面的保活路径，不重建。
  reconcileChildren(asContainer(container), [row('a'), row('b', false, { dispose: () => disposed.push('b') })])
  assert.deepEqual(snapshot(container), ['a:a', 'b:b'])
  assert.notEqual(container.children[1], firstB)
  assert.deepEqual(disposed, ['b'])

  // 第四帧：b 从期望流消失 → 该行被尾部清理移除（残留行不留 DOM）。
  reconcileChildren(asContainer(container), [row('a')])
  assert.deepEqual(snapshot(container), ['a:a'])
})

test('reconcileChildren 对重复 key 加后缀：两项都留行，不静默丢内容', () => {
  const container = new FakeElement('div')
  // 上游给了两条同 id 的消息（#11 R1 的 id 撞车场景）：旧实现两项映射到同一个
  // `data-flow-key`，DOM 里只剩第一个孩子，第二项被尾部清理删掉——整行内容静默
  // 消失。
  reconcileChildren(asContainer(container), [row('msg:dup'), row('msg:dup')])
  assert.deepEqual(snapshot(container), ['msg:dup:msg:dup', 'msg:dup#1:msg:dup'])

  // 同一期望序列再跑一帧：解析结果一致 → 两行都按 key 复用，不重建不丢行。
  const before = [container.children[0], container.children[1]]
  reconcileChildren(asContainer(container), [row('msg:dup'), row('msg:dup')])
  assert.equal(container.children[0], before[0])
  assert.equal(container.children[1], before[1])

  // 重复项只剩一个时：第一行留着，带后缀的那行按残留清除。
  reconcileChildren(asContainer(container), [row('msg:dup')])
  assert.deepEqual(snapshot(container), ['msg:dup:msg:dup'])
  assert.equal(container.children[0], before[0])
})

test('reconcileChildren 三元重复 key 各自留行且后缀稳定', () => {
  const container = new FakeElement('div')
  reconcileChildren(asContainer(container), [row('k'), row('k'), row('k')])
  assert.deepEqual(snapshot(container), ['k:k', 'k#1:k', 'k#2:k'])
  const before = [...container.children]
  reconcileChildren(asContainer(container), [row('k'), row('k'), row('k')])
  assert.deepEqual(snapshot(container), ['k:k', 'k#1:k', 'k#2:k'])
  for (const [index, el] of before.entries()) assert.equal(container.children[index], el)
})
