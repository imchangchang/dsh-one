/**
 * 消息流 block 层的 Preact 承载（#42, 治 #29）。
 *
 * 为什么用「命令式 shell + Preact 对账」而不是把每个 block 重写成 JSX：
 * block（尤其 tool 卡 / JSON 树 / diff / 代码块折叠 / 复制反馈）的精确 DOM 结构
 * 是 scenarios.js 与沙盒场景的断言依赖（data-path / .json-tree-* / .tool-* /
 * data-flow-key 定位属性），且大量局部状态（detailsOpen / jsonTreeOpen /
 * innerScrollPositions / copyConfirmedAt）跨重建持久化。把这些逐字重写成 JSX
 * 属于 T3（tool 卡 + JSON 树组件化），T2 只把「行骨架」迁到 Preact 托管——
 * 用稳定 key 让 Preact 决定「哪些 block 需要重渲染」。
 *
 * 核心机制（#29 根治）：
 * - BlockList 按稳定 key（`${rowKey}:b${bi}`）渲染 Block；每个 Block 的 DOM 由
 *   既有 `renderBlock` 命令式构建，挂在一个 shell 容器里。
 * - BlockShell 以 `JSON.stringify(block)` 做变更签名：签名不变（流式只追加 text、
 *   tool 卡保持原样）→ useLayoutEffect 不重跑 → shell 容器里已挂的 tool 卡 DOM
 *   原样保活（滚动条拖拽 / <details> 展开态 / JSON 树展开 / CSS 动画相位 / 复制反馈
 *   全部随之存活）；签名变（tool running→done、output 出现）→ 重挂一次。
 * - 行骨架保活由 buildFlowItems 的 `update` 分支承担（见 webview.ts）：assistant
 *   行内容变化时走 reconcile 的 update 路径，只对行内 `.msg-blocks` 做 Preact diff，
 *   不整行重建——这正是 #29「流式重建整行连坐销毁 tool 卡」的解。
 *
 * 与 `smoke.tsx`（Step 0 冒烟）的关系：smoke 验证 esbuild + tsc 能编译 Preact JSX；
 * 本文件是接入真实组件的正式落地。
 */
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { ChatBlock, ChatRetryBlock, ChatToolBlock } from '../../../pure/chatContract.ts'

/** BlockList 渲染所需的宿主注入（来自 webview.ts 的命令式渲染工具）。 */
export interface BlockTools {
  /**
   * 渲染一个 assistant block（text/reasoning/tool/retry 的分派在 webview 的
   * renderBlock 内；shell 只负责「什么时候重建/保活」，构建细节全权交给它）。
   */
  renderBlock: (block: ChatBlock, key: string) => HTMLElement
}

interface BlockShellProps {
  block: ChatBlock
  keyId: string
  tools: BlockTools
}

/**
 * 一个 block 的 shell 容器：用 `JSON.stringify(block)` 做变更签名，签名不变就
 * 不重建 —— 容器里的命令式渲染树（renderBlock 产物）随之保活。签名变才重挂。
 *
 * Preact 对 shell 容器的子节点是「vnode 无子节点」：diff 时不会清掉 ref 里手动
 * append 的树（见 `BlockShell` 里 useLayoutEffect 的 replaceChildren 唯一写入点），
 * 所以保活语义成立。
 */
function BlockShell({ block, keyId, tools }: BlockShellProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // 变更签名：整块 JSON 稳定 → 保活；变化（内容增删/状态流转）→ 重挂。
  const sig = JSON.stringify(block)
  useLayoutEffect(() => {
    if (hostRef.current) hostRef.current.replaceChildren(tools.renderBlock(block, keyId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只随 block 内容变化重渲染
  }, [sig])
  return <div ref={hostRef} className="block-shell" />
}

export interface BlockProps {
  block: ChatBlock
  keyId: string
  tools: BlockTools
}

/**
 * 单个 assistant block（text / reasoning / tool / retry）。类型分派交给
 * `tools.renderBlock`（webview 的 renderBlock），这里只按类型选择渲染壳；
 * 四种类型共用同一个 shell —— shell 的保活/重建语义与类型无关。
 */
export function Block({ block, keyId, tools }: BlockProps) {
  switch (block.type) {
    case 'text':
      return <BlockShell block={block} keyId={keyId} tools={tools} />
    case 'reasoning':
      return <BlockShell block={block} keyId={keyId} tools={tools} />
    case 'tool':
      return <BlockShell block={block} keyId={keyId} tools={tools} />
    case 'retry':
      return <BlockShell block={block} keyId={keyId} tools={tools} />
  }
}

export interface BlockListProps {
  blocks: readonly ChatBlock[]
  rowKey: string
  tools: BlockTools
}

/**
 * 一条 assistant 消息的 block 列表。key 用 `${rowKey}:b${bi}` —— 与既有命令式
 * renderMessage 的 block 位置键一致（detailsOpen/jsonTreeOpen/copy 反馈等状态按
 * 这个 key 持久化），流式追加/稳定时各 block 的 shell 实例保持不变。
 */
export function BlockList({ blocks, rowKey, tools }: BlockListProps) {
  return (
    <>
      {blocks.map((block, bi) => (
        <Block key={`${rowKey}:b${bi}`} block={block} keyId={`${rowKey}:b${bi}`} tools={tools} />
      ))}
    </>
  )
}

// 类型显式导出（供 webview.ts 用类型推导 BlockTools；避免未使用告警）。
export type { ChatRetryBlock, ChatToolBlock }
