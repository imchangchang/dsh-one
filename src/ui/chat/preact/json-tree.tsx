/**
 * JSON 树 Preact 组件（#43，治 #29）。
 *
 * 从 webview.ts 的命令式 renderJsonTree/renderJsonTreeRow/toggleJsonTree 迁来：
 * 渲染逻辑逐字保留（DOM 结构/class/data-path 与既有场景断言一致），但把跨重建
 * 持久化的局部 state 收进组件 useState——`jsonTreeOpen`（节点展开集）与
 * `copyConfirmedAt`（复制反馈）不再是 webview 全局 Map，而是这个组件实例内部状态。
 *
 * 为什么能替代全局 Map：JsonTree 作为 BlockList/Block 树里的稳定 vnode（key =
 * `${rowKey}:${block.id}`，无 id 时回落位置下标），只要组件实例不卸载，useState
 * 就跨父级重渲染存活——流式
 * 重建（text 增量、tool running→done、行骨架 update 分支）不再销毁树的展开态与
 * 「已复制」反馈。组件卸载的场合（**会话切换**、流整体重建）不再丢展开态：节点
 * 展开集同步写进按会话隔离的展开态帧（见 ../disclosure.ts），重挂载时按帧里的
 * 值初始化，切回原会话照旧展开（#52 W3）。「已复制」反馈仍是瞬态、随卸载丢弃。
 *
 * copy 用 navigator.clipboard，成功短暂显示「已复制」、失败改 title，与 md-code
 * 复制按钮同款反馈。节点级复制在 click 时按当前 value 解析路径（流式后行可能已
 * 失效，解析不到就不复制）。
 */
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { disclosureFrame } from '../disclosure.ts'
import { MESSAGE_ACTION_ICONS } from '../icons.ts'
import { iconSvg } from '../dom.ts'
import {
  defaultJsonTreeExpanded,
  flattenJsonTree,
  jsonPathKey,
  jsonTreeCopyText,
  jsonValueAtPath,
  type JsonContainer,
  type JsonPath,
  type JsonPrimitiveKind,
  type JsonTreeRow,
} from '../../../pure/jsonTree.ts'

/** JsonTree 渲染所需的宿主注入（来自 webview.ts）。 */
export interface TreeTools {
  t: (template: string, ...args: Array<string | number | Record<string, unknown>>) => string
  iconSvg: (icon: (typeof MESSAGE_ACTION_ICONS)[keyof typeof MESSAGE_ACTION_ICONS], size?: number) => SVGSVGElement
}

export interface JsonTreeProps {
  value: JsonContainer
  outputKey: string
  tools: TreeTools
}

const COPY_FEEDBACK_MS = 1000

function copyIconSvg(tools: TreeTools, check: boolean): string {
  return tools.iconSvg(check ? MESSAGE_ACTION_ICONS.check : MESSAGE_ACTION_ICONS.copy, 12).outerHTML
}

/** 原始值的 token 配色（string 玫红 / number 蓝 / null+boolean keyword 蓝）。 */
function primitiveCls(p: JsonPrimitiveKind): string {
  if (p.type === 'string') return 'json-tree-string'
  if (p.type === 'number') return 'json-tree-number'
  return 'json-tree-keyword'
}

/**
 * 一段 JSON 输出渲染成 JsonTree（对齐 dsh web JsonTree：对象/数组逐节点展开、
 * 箭头点击 toggle、逐级缩进、暗色 token 配色）。节点 open 状态记在组件局部
 * openPaths（缺省「根展开、嵌套收起」，同旧 jsonTreeOpen 缺省策略）；复制反馈
 * 记在局部 copied 状态。树上/右上角给一个不喧宾夺主的「复制」按钮。
 */
export function JsonTree({ value, outputKey, tools }: JsonTreeProps) {
  const [openPaths, setOpenPaths] = useState<Set<string>>(
    () => disclosureFrame().jsonOpenPaths.get(outputKey) ?? defaultJsonTreeExpanded(value),
  )
  const [treeCopied, setTreeCopied] = useState(false)
  const [treeFailed, setTreeFailed] = useState(false)
  const [nodeCopied, setNodeCopied] = useState<Set<string>>(() => new Set())
  const [nodeFailed, setNodeFailed] = useState<Set<string>>(() => new Set())
  const timerRefs = useRef<number[]>([])
  useEffect(() => () => timerRefs.current.forEach((id) => clearTimeout(id)), [])

  const scheduleReset = (reset: () => void): void => {
    const id = window.setTimeout(reset, COPY_FEEDBACK_MS)
    timerRefs.current.push(id)
  }

  const isOpen = (pathKey: string): boolean => openPaths.has(pathKey)

  const toggle = (pathKey: string): void => {
    const next = new Set(openPaths)
    if (next.has(pathKey)) next.delete(pathKey)
    else next.add(pathKey)
    // 写进展开态帧：会话切走再切回时按它还原（#52 W3）。
    disclosureFrame().jsonOpenPaths.set(outputKey, next)
    setOpenPaths(next)
  }

  const copyTree = (): void => {
    const text = jsonTreeCopyText(value)
    void navigator.clipboard.writeText(text).then(
      () => {
        setTreeCopied(true)
        setTreeFailed(false)
        scheduleReset(() => setTreeCopied(false))
      },
      () => setTreeFailed(true),
    )
  }

  const copyNode = (path: JsonPath, pathKey: string): void => {
    const subValue = jsonValueAtPath(value, path)
    if (subValue === undefined) return
    const text = jsonTreeCopyText(subValue)
    void navigator.clipboard.writeText(text).then(
      () => {
        setNodeCopied((prev) => new Set(prev).add(pathKey))
        setNodeFailed((prev) => {
          const next = new Set(prev)
          next.delete(pathKey)
          return next
        })
        scheduleReset(() =>
          setNodeCopied((prev) => {
            const next = new Set(prev)
            next.delete(pathKey)
            return next
          }),
        )
      },
      () => setNodeFailed((prev) => new Set(prev).add(pathKey)),
    )
  }

  const rows = flattenJsonTree(value, isOpen)
  const copyTitle = treeFailed ? tools.t('Copy failed') : treeCopied ? tools.t('Copied') : tools.t('Copy JSON')

  const renderNodeCopy = (row: Extract<JsonTreeRow, { type: 'primitive' | 'container' }>) => {
    if (row.key === null) return null
    const pathKey = jsonPathKey(row.path)
    const failed = nodeFailed.has(pathKey)
    const copied = nodeCopied.has(pathKey)
    const title = failed ? tools.t('Copy failed') : copied ? tools.t('Copied') : tools.t('Copy')
    return (
      <button
        className="json-tree-copy-icon"
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          copyNode(row.path, pathKey)
        }}
        dangerouslySetInnerHTML={{ __html: copyIconSvg(tools, copied) }}
      />
    )
  }

  const renderRow = (row: JsonTreeRow) => {
    if (row.type === 'close') {
      return (
        <div className="json-tree-row" style={{ paddingLeft: `${row.depth * 14}px` }}>
          <span className="json-tree-punct">{row.kind === 'array' ? ']' : '}'}</span>
        </div>
      )
    }
    const pathKey = jsonPathKey(row.path)
    const expandable = row.type === 'container' && row.entryCount > 0
    return (
      <div className="json-tree-row" style={{ paddingLeft: `${row.depth * 14}px` }} data-path={pathKey}>
        {row.type === 'container' && expandable ? (
          <span
            className={`json-tree-arrow ${row.open ? 'open' : ''}`}
            role="button"
            aria-expanded={row.open ? 'true' : 'false'}
            aria-label={row.open ? 'collapse' : 'expand'}
            onClick={(e) => {
              e.stopPropagation()
              toggle(pathKey)
            }}
          />
        ) : null}
        {row.key !== null && row.key.length > 0 ? (
          <>
            <span
              className={
                row.type === 'container' && expandable ? 'json-tree-key json-tree-label-clickable' : 'json-tree-key'
              }
              onClick={row.type === 'container' && expandable ? () => toggle(pathKey) : undefined}
            >
              {row.key}
            </span>
            <span className="json-tree-punct">:</span>
            <span className="json-tree-gap" />
          </>
        ) : null}
        {row.type === 'primitive' ? (
          <>
            <span className={primitiveCls(row.primitive)}>{row.primitive.display}</span>
            {renderNodeCopy(row)}
          </>
        ) : (
          <>
            {expandable && row.open ? (
              <span className="json-tree-punct">{row.kind === 'array' ? '[' : '{'}</span>
            ) : row.entryCount > 0 ? (
              <>
                <span className="json-tree-punct">{row.kind === 'array' ? '[' : '{'}</span>
                <span className="json-tree-ellipsis">…</span>
                <span className="json-tree-punct">{row.kind === 'array' ? ']' : '}'}</span>
              </>
            ) : (
              <>
                <span className="json-tree-punct">{row.kind === 'array' ? '[' : '{'}</span>
                <span className="json-tree-punct">{row.kind === 'array' ? ']' : '}'}</span>
              </>
            )}
            {renderNodeCopy(row)}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="json-tree-shell">
      <div className="json-tree-bar">
        <button className="json-tree-copy" type="button" title={copyTitle} onClick={copyTree}>
          {treeCopied ? tools.t('Copied') : tools.t('Copy')}
        </button>
      </div>
      <div className="json-tree" data-scroll-key={`${outputKey}:tree`}>
        {rows.map((row, i) => (
          <Fragment key={i}>{renderRow(row)}</Fragment>
        ))}
      </div>
    </div>
  )
}
