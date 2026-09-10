/**
 * 工具调用卡 Preact 组件（#43，治 #29）。
 *
 * 从 webview.ts 的命令式 renderTool 及其专用卡分流（renderSkillRow /
 * renderCordisDefineRow / renderCordisRunRow / renderCordisActionRow）迁来：
 * 渲染逻辑逐字保留（DOM 结构/class/data-scroll-key 与既有场景断言一致），把跨
 * 重建持久化的局部 state 收进组件 useState——展开/收起（旧 detailsOpen）、工具
 * 输出「共 N 行」折叠、diff 行折叠、JSON 树展开与复制反馈（见 json-tree.tsx），
 * 都不再是 webview 全局 Map。
 *
 * 为什么能替代全局 Map：ToolCard 作为 BlockList/Block 树里的稳定 vnode（key =
 * `${rowKey}:b${bi}`），只要组件实例不卸载，其内部 useState 跨父级重渲染存活——
 * 流式重建（tool running→done、行骨架 update 分支）不再销毁卡片自身的展开态与内
 * 滚动条位置（滚动容器是持久 DOM 元素，scrollTop 由浏览器保留）。
 *
 * 组件卸载的场合（**会话切换**、流整体重建）不再重置展开态：展开值同步写进按
 * 会话隔离的展开态帧（见 ../disclosure.ts），重挂载时按帧里的值初始化，切回原
 * 会话照旧展开（#52 W3）；帧随会话整帧换出/换入，不跨会话串味。
 *
 * 内部滚动容器保留 data-scroll-key，供既有 saveInnerScroll/restoreInnerScroll
 * 在「整列重建」这类极端场合兜底；常规流式下容器不重建，位置自然存活。
 */
import { useMemo, useState } from 'preact/hooks'
import { CODE_ICON, PANEL_ICONS, SKILL_ICON, STOP_ICON, TRASH_ICON, type IconDef } from '../icons.ts'
import { iconSvg } from '../dom.ts'
import { disclosureFrame } from '../disclosure.ts'
import type { ChatToolBlock, SubagentNode } from '../../../pure/chatContract.ts'
import { isCommandTool, prettyJson, toolAction, truncateLines } from '../../../pure/toolLine.ts'
import { cordisActionCardModel, cordisDefineCardModel, cordisRunCardModel, skillCardModel } from '../../../pure/toolCards.ts'
import { subagentInTree, subagentIdFromOutput } from '../../../pure/subagentCard.ts'
import { alignDiffLines, type DiffPair } from '../../../pure/diffAlign.ts'
import { jsonTreeThresholdExceeded, tryParseJsonTree } from '../../../pure/jsonTree.ts'
import { JsonTree, type TreeTools } from './json-tree.tsx'

/** ToolCard 渲染所需的宿主注入（来自 webview.ts）。 */
export interface ToolTools extends TreeTools {
  /** 当前会话的子代理血缘树（subagentSnapshotNote 需要）。 */
  subagents: readonly SubagentNode[] | undefined
}

export interface ToolCardProps {
  block: ChatToolBlock
  keyId: string
  tools: ToolTools
}

const DIFF_PREVIEW_LINES = 8

/**
 * 展开态布尔：值落在按会话隔离的展开态帧里（见 ../disclosure.ts），组件重挂载
 * （会话切走再切回）时按帧里的值初始化，不再是每次挂载都折叠。
 */
function useFrameFlag(
  map: Map<string, boolean>,
  key: string,
): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(() => map.get(key) ?? false)
  const update = (value: boolean | ((prev: boolean) => boolean)): void => {
    const next = typeof value === 'function' ? value(map.get(key) ?? false) : value
    map.set(key, next)
    setOpen(next)
  }
  return [open, update]
}

/** 运行中 spinner（对齐 animPhase.spinnerEl：负 animation-delay 对齐相位）。 */
function Spinner() {
  const delay = useMemo(() => `${-(performance.now() % 900)}ms`, [])
  return <span className="spinner" style={{ animationDelay: delay }} />
}

const iconHtml = (icon: IconDef, size: number): string => iconSvg(icon, size).outerHTML

function toolLeading(icon: IconDef, status: ChatToolBlock['status']) {
  if (status === 'running') return <Spinner />
  if (status === 'error') return <span className="tool-state-dot" data-state="error" />
  return <span className="tool-leading" dangerouslySetInnerHTML={{ __html: iconHtml(icon, 14) }} />
}

function toolCardSummary(errorSummary: string | null, fallback: string) {
  return (
    <span className={errorSummary ? 'tool-title tool-title-error' : 'tool-title'}>{errorSummary ?? fallback}</span>
  )
}

function Chevron() {
  return <span className="tool-chevron" dangerouslySetInnerHTML={{ __html: iconHtml(PANEL_ICONS.chevronDown, 14) }} />
}

/** 展开块内容底部加一个「收起」小按钮（长内容展开后顶部够不着，一键收起）。 */
function CollapseFooter({ onCollapse, t }: { onCollapse: () => void; t: ToolTools['t'] }) {
  return (
    <button className="details-collapse" type="button" title={t('Collapse')} onClick={onCollapse}>
      {t('Collapse')}
    </button>
  )
}

/** 一段工具文本的渲染入口：JSON 对象/数组字面量且不超阈值 → JsonTree；否则纯文本 <pre>。 */
function JsonOrText({ text, scopeKey, treeTools }: { text: string; scopeKey: string; treeTools: TreeTools }) {
  const value = tryParseJsonTree(text)
  if (value && !jsonTreeThresholdExceeded(value)) return <JsonTree value={value} outputKey={scopeKey} tools={treeTools} />
  return <pre data-scroll-key={scopeKey}>{text}</pre>
}

/**
 * 工具卡展开区的一张 IN/OUT 卡片：小标签 + 内容。`asJson` 为 true 时（OUT）内容
 * 是 JSON 对象/数组字面量则渲染 JsonTree，否则回退 150px 内滚动的等宽 <pre>；
 * `asJson` 为 false 时（IN）恒用 prettyJson 的 <pre>。
 */
function ToolInOut({
  label,
  text,
  scopeKey,
  asJson,
  treeTools,
}: {
  label: string
  text: string
  scopeKey: string
  asJson: boolean
  treeTools: TreeTools
}) {
  return (
    <div className="tool-inout">
      <div className="tool-inout-label">{label}</div>
      {asJson ? <JsonOrText text={text} scopeKey={scopeKey} treeTools={treeTools} /> : <pre data-scroll-key={scopeKey}>{text}</pre>}
    </div>
  )
}

/**
 * 工具输出：JSON 先走 JsonTree；否则默认只渲染前 OUTPUT_PREVIEW_LINES 行 +
 * 「… 共 N 行，点击展开」，点击展开全部、再次点击收起。展开状态是组件局部 state。
 */
function ToolOutput({
  output,
  scopeKey,
  t,
  treeTools,
}: {
  output: string
  scopeKey: string
  t: ToolTools['t']
  treeTools: TreeTools
}) {
  const [open, setOpen] = useFrameFlag(disclosureFrame().outputOpen, scopeKey)
  const value = tryParseJsonTree(output)
  if (value && !jsonTreeThresholdExceeded(value)) {
    // JSON → 树，套一层 tool-output 保持与非 JSON 输出一致的 20px 左缩进。
    return (
      <div className="tool-output">
        <JsonTree value={value} outputKey={scopeKey} tools={treeTools} />
      </div>
    )
  }
  const { preview, totalLines, truncated } = truncateLines(output)
  return (
    <div className="tool-output">
      <pre data-scroll-key={scopeKey}>{open ? output : preview}</pre>
      {truncated ? (
        <div className="tool-output-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? t('Collapse output') : t('… {0} lines, click to expand', totalLines)}
        </div>
      ) : null}
    </div>
  )
}

/** diff 块（左右分栏）：默认渲染前 DIFF_PREVIEW_LINES 行对，其余折叠成展开 toggle。 */
function DiffBlock({ diff, scopeKey, t }: { diff: { oldText: string; newText: string }; scopeKey: string; t: ToolTools['t'] }) {
  const [open, setOpen] = useFrameFlag(disclosureFrame().outputOpen, scopeKey)
  const pairs = alignDiffLines(diff.oldText, diff.newText)
  const shown = open ? pairs : pairs.slice(0, DIFF_PREVIEW_LINES)
  return (
    <div className="diff">
      <div className="diff-grid">
        {shown.map((p: DiffPair, i) => (
          <div className="diff-row" key={i}>
            <div
              className={`diff-cell old${p.oldLine === null ? ' empty' : ''}${p.kind === 'del' || p.kind === 'modify' ? ' del' : ''}`}
            >
              {p.oldLine ?? ''}
            </div>
            <div
              className={`diff-cell new${p.newLine === null ? ' empty' : ''}${p.kind === 'add' || p.kind === 'modify' ? ' add' : ''}`}
            >
              {p.newLine ?? ''}
            </div>
          </div>
        ))}
      </div>
      {pairs.length > DIFF_PREVIEW_LINES ? (
        <div className="diff-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? t('Collapse diff') : t('… show {0} more diff lines', pairs.length - DIFF_PREVIEW_LINES)}
        </div>
      ) : null}
    </div>
  )
}

function subagentSnapshotNote(block: ChatToolBlock, subagents: readonly SubagentNode[] | undefined): string | null {
  if (block.name !== 'subagent' || block.status === 'running') return null
  const id = subagentIdFromOutput(block.output)
  if (!id) return null
  if (subagentInTree(subagents, id)) return null
  return 'Snapshot copy: the subagent is no longer in this session'
}

function SkillCard({ block, keyId, t, treeTools }: { block: ChatToolBlock; keyId: string; t: ToolTools['t']; treeTools: TreeTools }) {
  const card = skillCardModel(block)
  const [open, setOpen] = useFrameFlag(disclosureFrame().toolOpen, keyId)
  const lineBody = (
    <>
      {toolLeading(SKILL_ICON, block.status)}
      <span className="tool-action">Skill</span>
      <span className="tool-sep" />
      {toolCardSummary(card.errorSummary, card.name)}
    </>
  )
  if (!card.output) {
    return (
      <div className={`tool tool-skill tool-${block.status}`}>
        <div className="tool-line">{lineBody}</div>
      </div>
    )
  }
  return (
    <div className={`tool tool-skill tool-${block.status}`}>
      <details className="tool-disclosure" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <div className="tool-line">
            {lineBody}
            <Chevron />
          </div>
        </summary>
        <div className="skill-instructions-card">
          <div className="skill-instructions-header">{t('Instructions')}</div>
          <pre className="skill-instructions" data-scroll-key={`${keyId}:instructions`}>
            {card.output}
          </pre>
        </div>
        <CollapseFooter onCollapse={() => setOpen(false)} t={t} />
      </details>
    </div>
  )
}

function cordisDefineLine(card: ReturnType<typeof cordisDefineCardModel>, block: ChatToolBlock, t: ToolTools['t']) {
  return (
    <>
      {toolLeading(CODE_ICON, block.status)}
      <span className="tool-action">{t('Register Cordis plugin')}</span>
      <span className="tool-sep" />
      {toolCardSummary(card.errorSummary, card.name)}
      {card.errorSummary === null ? <span className="tool-purpose">{card.purpose ?? t('(no purpose given)')}</span> : null}
    </>
  )
}

function CordisDefineCard({ block, keyId, t, treeTools }: { block: ChatToolBlock; keyId: string; t: ToolTools['t']; treeTools: TreeTools }) {
  const card = cordisDefineCardModel(block)
  const [open, setOpen] = useFrameFlag(disclosureFrame().toolOpen, keyId)
  const expandable = card.hostCode !== null || card.clientCode !== null || card.output !== null
  const lineBody = cordisDefineLine(card, block, t)
  if (!expandable) {
    return (
      <div className={`tool tool-cordis tool-cordis-define tool-${block.status}`}>
        <div className="tool-line">{lineBody}</div>
      </div>
    )
  }
  return (
    <div className={`tool tool-cordis tool-cordis-define tool-${block.status}`}>
      <details className="tool-disclosure" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <div className="tool-line">
            {lineBody}
            <Chevron />
          </div>
        </summary>
        <div className="tool-disclosure-body">
          {(
            [
              ['Host', card.hostCode],
              ['Client', card.clientCode],
            ] as const
          )
            .filter(([, code]) => code !== null)
            .map(([label, code]) => (
              <div className="cordis-source" key={label}>
                <div className="cordis-source-label">{label}</div>
                <pre className="cordis-source-code" data-scroll-key={`${keyId}:cordis:${label.toLowerCase()}`}>
                  {code}
                </pre>
              </div>
            ))}
          {card.output !== null ? (
            <div className="cordis-source">
              <div className="cordis-source-label">{t('Result')}</div>
              <pre className="cordis-source-code" data-scroll-key={`${keyId}:cordis:output`}>
                {card.output}
              </pre>
            </div>
          ) : null}
        </div>
        <CollapseFooter onCollapse={() => setOpen(false)} t={t} />
      </details>
    </div>
  )
}

function CordisRunCard({ block, keyId, t, treeTools }: { block: ChatToolBlock; keyId: string; t: ToolTools['t']; treeTools: TreeTools }) {
  const card = cordisRunCardModel(block)
  const identity = card.pluginId ? `${card.pluginId}${card.packageId ? ` · ${card.packageId}` : ''}` : block.callId
  return (
    <div className={`tool tool-cordis tool-cordis-run tool-${block.status}`}>
      <div className="tool-line">
        {toolLeading(CODE_ICON, block.status)}
        <span className="tool-action">{card.mode === 'update' ? t('Update Cordis plugin') : t('Run Cordis plugin')}</span>
        <span className="tool-sep" />
        {toolCardSummary(card.errorSummary, identity)}
      </div>
      {card.output !== null ? <ToolOutput output={card.output} scopeKey={`${keyId}:out`} t={t} treeTools={treeTools} /> : null}
    </div>
  )
}

function CordisActionCard({ block, keyId, t, treeTools }: { block: ChatToolBlock; keyId: string; t: ToolTools['t']; treeTools: TreeTools }) {
  const card = cordisActionCardModel(block)
  const remove = block.name === 'cordis_undefine'
  return (
    <div className={`tool tool-cordis tool-cordis-action tool-${block.status}`}>
      <div className="tool-line">
        {toolLeading(remove ? TRASH_ICON : STOP_ICON, block.status)}
        <span className="tool-action">{remove ? t('Remove Cordis plugin') : t('Stop Cordis plugin')}</span>
        <span className="tool-sep" />
        {toolCardSummary(card.errorSummary, card.pluginId ?? block.callId)}
      </div>
      {card.output !== null ? <ToolOutput output={card.output} scopeKey={`${keyId}:out`} t={t} treeTools={treeTools} /> : null}
    </div>
  )
}

/**
 * 通用工具调用行（kimi-cli / dsh web 行式排版）：状态图标 + 英文动作短语 +
 * host 计算的标题（如文件路径），命令类工具另起一行等宽预览。带输入参数
 * （args）或输出（output）时整行可点展开（对齐 dsh web DisclosureRow）。
 */
function GenericToolCard({ block, keyId, t, treeTools, subagents }: { block: ChatToolBlock; keyId: string; t: ToolTools['t']; treeTools: TreeTools; subagents: readonly SubagentNode[] | undefined }) {
  const [open, setOpen] = useFrameFlag(disclosureFrame().toolOpen, keyId)
  const snapshotNote = subagentSnapshotNote(block, subagents)
  const snapshotEl = snapshotNote !== null ? <div className="tool-snapshot-note">{t(snapshotNote)}</div> : null
  const detailText = block.detail ? (isCommandTool(block.name) ? `$ ${block.detail}` : block.detail) : null
  const statusDot = block.status === 'running' ? <Spinner /> : block.status === 'error' ? <span className="tool-state-dot" data-state="error" /> : null
  const title = block.title ? <span className="tool-title">{block.title}</span> : null

  if (block.todos) {
    const s = block.todos
    const head = t('{0}/{1} done', s.done, s.total)
    return (
      <div className={`tool tool-${block.status}`}>
        <div className="tool-line">
          {statusDot}
          <span className="tool-action">{t('Update task list')}</span>
          <span className="tool-title">{s.activeContent ? `${head} · ${s.activeContent}` : head}</span>
          {s.activeExtra > 0 ? <span className="tool-todo-extra">{`+${s.activeExtra}`}</span> : null}
        </div>
        {block.output ? <ToolOutput output={block.output} scopeKey={`${keyId}:out`} t={t} treeTools={treeTools} /> : null}
        {snapshotEl}
      </div>
    )
  }

  const hasArgs = typeof block.args === 'string' && block.args.length > 0
  const hasOutput = typeof block.output === 'string' && block.output.length > 0

  if (!hasArgs && !hasOutput) {
    return (
      <div className={`tool tool-${block.status}`}>
        <div className="tool-line">
          {statusDot}
          <span className="tool-action">{toolAction(block.name)}</span>
          {title}
        </div>
        {detailText !== null ? <div className="tool-detail">{detailText}</div> : null}
        {block.diff ? <DiffBlock diff={block.diff} scopeKey={`${keyId}:diff`} t={t} /> : null}
        {snapshotEl}
      </div>
    )
  }

  return (
    <div className={`tool tool-${block.status}`}>
      <details className="tool-disclosure" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <div className="tool-line">
            {statusDot}
            <span className="tool-action">{toolAction(block.name)}</span>
            {title}
            <Chevron />
          </div>
          {detailText !== null ? <div className="tool-detail">{detailText}</div> : null}
        </summary>
        <div className="tool-disclosure-body">
          {hasArgs ? <ToolInOut label="IN" text={prettyJson(block.args as string)} scopeKey={`${keyId}:in`} asJson={false} treeTools={treeTools} /> : null}
          {hasOutput ? <ToolInOut label="OUT" text={block.output as string} scopeKey={`${keyId}:out`} asJson={true} treeTools={treeTools} /> : null}
        </div>
        <CollapseFooter onCollapse={() => setOpen(false)} t={t} />
      </details>
      {block.diff ? <DiffBlock diff={block.diff} scopeKey={`${keyId}:diff`} t={t} /> : null}
      {snapshotEl}
    </div>
  )
}

/** 工具调用卡（按工具名分流 skill / cordis_* / 通用行式卡）。 */
export function ToolCard({ block, keyId, tools }: ToolCardProps) {
  const t = tools.t
  const treeTools: TreeTools = { t, iconSvg }
  switch (block.name) {
    case 'skill':
      return <SkillCard block={block} keyId={keyId} t={t} treeTools={treeTools} />
    case 'cordis_define':
      return <CordisDefineCard block={block} keyId={keyId} t={t} treeTools={treeTools} />
    case 'cordis_run':
      return <CordisRunCard block={block} keyId={keyId} t={t} treeTools={treeTools} />
    case 'cordis_stop':
    case 'cordis_undefine':
      return <CordisActionCard block={block} keyId={keyId} t={t} treeTools={treeTools} />
    default:
      return <GenericToolCard block={block} keyId={keyId} t={t} treeTools={treeTools} subagents={tools.subagents} />
  }
}
