/**
 * Chat webview 的菜单/下拉构建域（拆分自 webview.ts）：头部与输入区的
 * 弹层菜单（context bar 与 context panel、权限、模型、子代理、后台任务、
 * agent preset、slash 命令菜单）。依赖 webviewPopover（弹层宿主）、
 * webviewState（state 等共享状态）、webviewKit（DOM 工具）。
 *
 * 拆分动机（multi-tab 重构第二层）：webview.ts 原本 3695+ 行单文件，任何
 * 前端新功能（渲染块、弹层、补全）都往里面塞。按域拆出后，新功能落在
 * 对应域文件，不再堆进入口文件。
 */
import {
  isLiveJob,
  jobDotState,
  jobStatusLabel,
  orderJobs,
  formatJobDuration,
  type ActivityJob,
} from '../../pure/activityTree.ts'
import { meterLevel } from '../../pure/contextMeter.ts'
import { formatRelativeTime } from '../../pure/sessionTree.ts'
import type { ChatState, ModelCatalog, SubagentNode } from '../../pure/chatContract.ts'
import { buttonEl, el, post, spinSvg } from './webviewKit.ts'
import { closePopover, getPopover, menuItem, popoverOpenAt, setJobsTicker, showPopover } from './webviewPopover.ts'
import { modelCatalog, modelMenuBody, setModelMenuBody, state } from './webviewState.ts'
import { SLASH_COMMANDS } from './webviewSlash.ts'

type ChatStateContextUsage = ChatState['contextUsage']

function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  if (n < 1e6) return `${scaled(n / 1e3)}K`
  return `${scaled(n / 1e6)}M`
}

/** Breakdown legend, in bar-segment order (dsh-web ContextMeter rows). */
const CONTEXT_ROWS: Array<{ key: 'systemTokens' | 'toolsTokens' | 'messageTokens'; label: string; color: string }> = [
  { key: 'systemTokens', label: '系统提示词', color: '#8b9bb4' },
  { key: 'toolsTokens', label: '工具', color: '#a78bfa' },
  { key: 'messageTokens', label: '对话消息', color: '#5a9cf8' },
]

/** 「窗口未知」占位的悬停说明：说明原因 + 何时恢复。 */
const WINDOW_UNKNOWN_TOOLTIP = '当前窗口用量未知：该模型尚未在当前会话中产生上下文数据，发送下一条消息后将显示窗口占用。'

/** Occupancy bar at the stats row's right end; hidden until the first sample. */
export function contextBar(): HTMLElement {
  const bar = buttonEl('context-bar', '')
  const track = el('span', 'context-bar-track')
  track.appendChild(el('span', 'context-bar-fill'))
  bar.appendChild(track)
  bar.addEventListener('click', () => openContextPanel(bar))
  return bar
}

/** 按模式确保 bar 内容结构：unknown → 灰字占位；known → track+fill（重建仅在切换时）。 */
function setBarContent(bar: HTMLElement, mode: 'unknown' | 'known'): void {
  const isUnknown = !bar.querySelector('.context-bar-fill')
  if (isUnknown === (mode === 'unknown')) return
  if (mode === 'unknown') {
    bar.textContent = '窗口未知'
  } else {
    bar.textContent = ''
    const track = el('span', 'context-bar-track')
    track.appendChild(el('span', 'context-bar-fill'))
    bar.appendChild(track)
  }
}

/** Patch the bar in place (both initial render and kept-composer updates). */
export function patchContextBar(bar: HTMLElement, usage: ChatStateContextUsage): void {
  bar.style.display = usage ? '' : 'none'
  if (!usage) return
  if (usage.windowUnknown) {
    // 切到从未观察过窗口的模型：明示「窗口未知」占位，不沿用旧窗口误导；悬停解释原因。
    setBarContent(bar, 'unknown')
    bar.classList.remove('level-ok', 'level-warn', 'level-danger', 'level-overflow')
    bar.classList.add('level-unknown')
    bar.title = WINDOW_UNKNOWN_TOOLTIP
    return
  }
  setBarContent(bar, 'known')
  // 按剩余轮数分级变色（src/pure/contextMeter.ts）：充足绿 / <10 轮黄 / <5 轮红 / 超窗口红。
  const meter = meterLevel(usage.usedTokens, usage.contextWindow, usage.turns)
  bar.classList.remove('level-ok', 'level-warn', 'level-danger', 'level-overflow')
  bar.classList.add(`level-${meter.level}`)
  bar.title = `上下文已用 ${usage.percent}%（~${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)}）${
    meter.level === 'overflow' ? '；已超出当前模型窗口' : ''
  }`
  const fill = bar.querySelector<HTMLElement>('.context-bar-fill')
  if (fill) fill.style.width = `${usage.percent}%`
}

/** Stats row at the composer's foot: stats line left, occupancy bar right. */
export function statsRow(statsLine: string | undefined, usage: ChatStateContextUsage): HTMLElement {
  const row = el('div', 'stats-row')
  row.appendChild(el('div', 'input-stats', statsLine ?? ''))
  const bar = contextBar()
  patchContextBar(bar, usage)
  row.appendChild(bar)
  return row
}

/** In-place stats-row update for the kept-composer path (no rebuild). */
export function patchStatsRow(composer: HTMLElement, statsLine: string | undefined, usage: ChatStateContextUsage): void {
  let row = composer.querySelector<HTMLElement>('.stats-row')
  if (!statsLine && !usage) {
    row?.remove()
    return
  }
  if (!row) {
    row = statsRow(undefined, undefined)
    composer.appendChild(row)
  }
  const stats = row.querySelector<HTMLElement>('.input-stats')
  if (stats) stats.textContent = statsLine ?? ''
  const bar = row.querySelector<HTMLElement>('.context-bar')
  if (bar) patchContextBar(bar, usage)
}

/** Click-open panel next to the ring: occupancy figure plus the breakdown bars. */
function openContextPanel(anchor: HTMLElement): void {
  const usage = state?.contextUsage
  if (!usage) return
  if (usage.windowUnknown) {
    // 「窗口未知」占位：无比例可给，面板只说明原因与恢复时机（与 bar 的悬停一致）。
    const body = el('div', 'context-panel')
    const header = el('div', 'cp-header')
    header.appendChild(el('span', 'cp-percent', '窗口用量未知'))
    if (usage.usedTokens !== undefined) header.appendChild(el('span', 'cp-figures', `已用 ~${formatTokens(usage.usedTokens)}`))
    body.appendChild(header)
    body.appendChild(
      el('div', 'cp-unknown', '该模型尚未在当前会话中产生上下文数据，无法给出窗口占用比例；发送下一条消息后将显示窗口用量。'),
    )
    showPopover(anchor, body)
    return
  }
  const body = el('div', 'context-panel')
  const header = el('div', 'cp-header')
  header.appendChild(el('span', 'cp-percent', `上下文已用 ${usage.percent}%`))
  header.appendChild(
    el('span', 'cp-figures', `~${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)}`),
  )
  body.appendChild(header)
  const meter = meterLevel(usage.usedTokens, usage.contextWindow, usage.turns)
  if (meter.level === 'overflow') {
    body.appendChild(
      el('div', 'cp-overflow', '上下文已超出当前模型窗口：建议先切回之前的模型执行 /compact 压缩，再切换模型。'),
    )
  }
  const breakdown = usage.breakdown
  if (breakdown) {
    const bar = el('div', 'cp-bar')
    const rows = el('div', 'cp-rows')
    for (const rowDef of CONTEXT_ROWS) {
      const value = breakdown[rowDef.key]
      const segment = el('span', 'cp-seg')
      segment.style.background = rowDef.color
      segment.style.width = `${Math.min(100, (value / usage.contextWindow) * 100)}%`
      bar.appendChild(segment)
      const row = el('div', 'cp-row')
      const swatch = el('span', 'cp-swatch')
      swatch.style.background = rowDef.color
      row.appendChild(swatch)
      row.appendChild(el('span', undefined, rowDef.label))
      row.appendChild(el('span', 'cp-value', `~${formatTokens(value)}`))
      rows.appendChild(row)
    }
    body.appendChild(bar)
    body.appendChild(rows)
  }
  // 实时预估：平均每轮增长 usedTokens/turns，换算剩余轮数（口径见 contextMeter.ts）。
  if (meter.perTurn !== null && meter.turnsLeft !== null) {
    body.appendChild(
      el('div', 'cp-estimate', `预估 ≈${formatTokens(meter.perTurn)}/轮，约还可持续 ${meter.turnsLeft} 轮`),
    )
  }
  showPopover(anchor, body)
}

/** Shield glyphs copied verbatim from dsh-client-ui-conversation's PermissionSelect. */
const SHIELD_OUTLINE =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'
export const PERMISSION_GLYPHS: Record<string, string> = {
  'read-only': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor"/></svg>`,
  'workspace-write': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor"/><path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor"/><path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor"/><path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor"/><path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor"/></svg>`,
  'danger-full-access': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor"/><path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor"/></svg>`,
}

export function openPermissionMenu(anchor: HTMLElement): void {
  const perms = state?.permissions
  if (!perms) return
  const body = el('div')
  for (const o of perms.options) {
    body.appendChild(
      menuItem(o.label, {
        glyph: PERMISSION_GLYPHS[o.value],
        checked: o.value === perms.current,
        onClick: () => {
          closePopover()
          if (o.value !== perms.current) post({ type: 'setPermission', value: o.value })
        },
      }),
    )
  }
  showPopover(anchor, body)
}

export function openModelMenu(anchor: HTMLElement): void {
  const body = el('div')
  showPopover(anchor, body)
  setModelMenuBody(body)
  const catalog = modelCatalog
  if (catalog) {
    renderModelMenuRoot(body, catalog)
  } else {
    body.appendChild(el('div', 'menu-hint', '加载中…'))
  }
  // Always refetch so the menu reflects the server's current selection.
  post({ type: 'requestModels' })
}

export function renderModelMenuRoot(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  body.appendChild(
    menuItem('模型', {
      right: `${model?.name ?? catalog.current.model} ›`,
      onClick: () => renderModelMenuModels(body, catalog),
    }),
  )
  const efforts = model?.efforts ?? []
  if (efforts.length > 0) {
    const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
    const effort = efforts.find((e) => e.id === effortId)
    body.appendChild(
      menuItem('推理等级', {
        right: `${effort?.name ?? effortId ?? '默认'} ›`,
        onClick: () => renderModelMenuEfforts(body, catalog),
      }),
    )
  }
}

function renderModelMenuModels(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem('‹ 返回', { onClick: () => renderModelMenuRoot(body, catalog) }))
  for (const g of catalog.groups) {
    body.appendChild(el('div', 'menu-group', g.name))
    for (const m of g.models) {
      const isCurrent = catalog.current.provider === g.id && catalog.current.model === m.id
      body.appendChild(
        menuItem(m.name, {
          checked: isCurrent,
          onClick: () => {
            closePopover()
            if (isCurrent) return
            // Keep the current effort only when the new model supports it.
            const keep = m.efforts.some((e) => e.id === catalog.current.reasoningEffort)
            post({
              type: 'setModel',
              provider: g.id,
              model: m.id,
              reasoningEffort: keep ? catalog.current.reasoningEffort : undefined,
            })
          },
        }),
      )
    }
  }
}

function renderModelMenuEfforts(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem('‹ 返回', { onClick: () => renderModelMenuRoot(body, catalog) }))
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
  for (const e of model?.efforts ?? []) {
    body.appendChild(
      menuItem(e.name, {
        right: e.description,
        checked: e.id === effortId,
        onClick: () => {
          closePopover()
          if (e.id !== catalog.current.reasoningEffort) {
            post({
              type: 'setModel',
              provider: catalog.current.provider,
              model: catalog.current.model,
              reasoningEffort: e.id,
            })
          }
        },
      }),
    )
  }
}

/** 头部「N 个子代理」chip 的下拉：树形缩进列表。每行状态点（运行中像素环/
 * 已完成灰点）+ 标题 + 第二行摘要（相对时间 · token 用量）；子代理自己的
 * 子代理（children）按层级缩进展示，行点击附着对应子会话。 */
export function openSubagentMenu(anchor: HTMLElement): void {
  const subs = state?.subagents
  if (!subs || subs.length === 0) return
  const body = el('div')
  for (const sub of subs) appendSubagentRow(body, sub)
  // 锚点在头部，向下展开。
  showPopover(anchor, body, 'below')
}

/** 递归渲染一个子代理节点及其全体后代（children）：每个节点包一层
 * .subagent-node，后代装进 .subagent-children 嵌套容器——缩进与层级引导线
 * （竖轨 + 横向支线，对齐 dsh web SubagentHeader 成员树）都由容器承担，
 * 行本身不再按 depth 算绝对 padding。 */
function appendSubagentRow(container: HTMLElement, sub: SubagentNode): void {
  const node = el('div', 'subagent-node')
  const item = el('div', 'menu-item preset-item')
  const slot = el('span', 'job-dot-slot')
  if (sub.running) slot.appendChild(spinSvg())
  else slot.appendChild(el('span', 'job-dot settled-dot'))
  item.appendChild(slot)
  const main = el('div', 'preset-item-main')
  main.appendChild(el('div', 'preset-item-name', sub.title))
  const summary = [
    sub.running ? '进行中' : '已完成',
    formatRelativeTime(sub.updatedAt, Date.now()),
    sub.totalTokens !== undefined ? `${formatTokens(sub.totalTokens)} tok` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  main.appendChild(el('div', 'preset-item-desc', summary))
  item.appendChild(main)
  item.addEventListener('click', () => {
    closePopover()
    post({ type: 'sessionOpen', sessionId: sub.sessionId })
  })
  node.appendChild(item)
  container.appendChild(node)
  // 后代挂进嵌套容器：每层 16px 相对缩进 + 引导线，层级一眼可辨。
  const kids = sub.children ?? []
  if (kids.length > 0) {
    const childWrap = el('div', 'subagent-children')
    for (const child of kids) appendSubagentRow(childWrap, child)
    node.appendChild(childWrap)
  }
}

/** 该子代理的血缘树里是否有任一节点在跑（含孙一辈及以下）。 */
function subagentLineageRunning(sub: SubagentNode): boolean {
  return (sub.children ?? []).some((c) => c.running || subagentLineageRunning(c))
}

/**
 * 头部「N 个后台任务运行中」chip 的下拉（对齐官方 JobListAction 菜单）：
 * 每行 状态点（运行中像素环/完成绿/取消琥珀/失败红）+ kind 徽标 + 命令摘要
 * + 状态文案（detail 优先，如 "exit code: 0"）+ 耗时；已结束行淡化。
 */
export function openJobsMenu(anchor: HTMLElement): void {
  // 点 trigger 切换开合（对齐官方 JobListAction 的 onClick toggle）：
  // 弹层已挂在这个 chip 上时再点一下是关闭，而不是重建重开。
  if (popoverOpenAt(anchor)) {
    closePopover()
    return
  }
  const jobs = state?.backgroundJobs
  if (!jobs || jobs.length === 0) return
  const now = Date.now()
  const body = el('div', 'jobs-menu')
  // 官方 ordered()：live 前按 startedAt 升序，settled 按 finishedAt 降序
  // （activityTree.orderJobs 已按官方语义实现并有单测）。
  for (const job of orderJobs(jobs)) body.appendChild(renderJobsMenuRow(job, now))
  showPopover(anchor, body, 'below')
  // 有运行中的行时挂 1s tick，只改写耗时文本节点（closePopover 统一清理）。
  if (jobs.some(isLiveJob)) {
    setJobsTicker(
      setInterval(() => {
        getPopover()?.querySelectorAll<HTMLElement>('[data-job-live-start]').forEach((t) => {
          t.textContent = formatJobDuration(Date.now() - Number(t.dataset.jobLiveStart))
        })
      }, 1000),
    )
  }
}

/** 下拉里的一行 job；now 由调用方取一次，保证同一帧渲染的行耗时一致。 */
function renderJobsMenuRow(job: ActivityJob, now: number): HTMLElement {
  const live = isLiveJob(job)
  const row = el('div', live ? 'jobs-menu-row' : 'jobs-menu-row settled')
  const slot = el('span', 'job-dot-slot')
  const dot = jobDotState(job.status)
  if (dot === 'ongoing') slot.appendChild(spinSvg())
  else slot.appendChild(el('span', `job-dot ${dot}`))
  row.appendChild(slot)
  row.appendChild(el('span', 'job-kind', job.kind))
  const label = el('span', 'job-label', job.label)
  label.title = job.label
  row.appendChild(label)
  const statusText = job.detail ?? jobStatusLabel(job.status)
  const status = el('span', 'job-status', statusText)
  status.title = statusText
  row.appendChild(status)
  const duration = el('span', 'job-duration')
  if (live) {
    duration.dataset.jobLiveStart = String(job.startedAt)
    duration.textContent = formatJobDuration(now - job.startedAt)
    duration.title = `已运行 ${duration.textContent}`
  } else {
    duration.textContent = formatJobDuration((job.finishedAt ?? job.startedAt) - job.startedAt)
    duration.title = `耗时 ${duration.textContent}`
  }
  row.appendChild(duration)
  return row
}

/** Agent preset 下拉：一行一个选项（名称 + 描述），当前选中打勾；风格沿用权限/模型选择器。 */
export function openAgentPresetMenu(anchor: HTMLElement, placement: 'above' | 'below' = 'above'): void {
  const ap = state?.agentPreset
  if (!ap) return
  const body = el('div')
  for (const opt of ap.options) {
    const checked = opt.id === ap.current
    const item = el('div', checked ? 'menu-item checked preset-item' : 'menu-item preset-item')
    const main = el('div', 'preset-item-main')
    main.appendChild(el('div', 'preset-item-name', opt.label))
    if (opt.description) main.appendChild(el('div', 'preset-item-desc', opt.description))
    item.appendChild(main)
    // 选中态 check 放尾部（dsh web 模式），仅 checked 时渲染。
    if (checked) item.appendChild(el('span', 'check', '✓'))
    item.addEventListener('click', () => {
      closePopover()
      if (!checked) post({ type: 'setAgentPreset', id: opt.id })
    })
    body.appendChild(item)
  }
  showPopover(anchor, body, placement)
}

export function openCommandMenu(anchor: HTMLElement): void {
  const body = el('div')
  for (const c of SLASH_COMMANDS) {
    body.appendChild(
      menuItem(`/${c.name}`, {
        right: c.description,
        onClick: () => {
          if (c.name === 'model') {
            openModelMenu(anchor)
            return
          }
          if (c.name === 'permission') {
            openPermissionMenu(anchor)
            return
          }
          closePopover()
          if (c.hint) {
            // Takes arguments: seed the composer token (the completion popup
            // then shows the arg hint) instead of firing a bare line.
            insertSlashCommand(c.name)
          } else {
            // No-argument commands execute right away, like the web client's
            // menu picks. The send path routes leading-slash lines to the
            // command channel.
            post({ type: 'send', text: `/${c.name}` })
          }
        },
      }),
    )
  }
  showPopover(anchor, body)
}

function insertSlashCommand(name: string): void {
  const input = document.getElementById('input') as HTMLTextAreaElement | null
  if (!input || input.disabled) return
  // Slash commands must lead the prompt; prepend ahead of any draft (its args).
  input.value = `/${name} ` + input.value
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  // The input event refreshes the send button, auto-grow, and the arg hint popup.
  input.dispatchEvent(new Event('input'))
}

/** 菜单打开期间保持来源行 hover 背景的导出（sessionsWebview 无需，webview 内使用）。 */
export { subagentLineageRunning }
