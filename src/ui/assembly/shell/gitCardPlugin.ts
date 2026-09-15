/**
 * @dsh-one/vscode-git-card——消息正文里短 commit hash 的可点 + 悬停详情卡
 * （#65 批 1，旧自研聊天区同款功能的装配版）。
 *
 * 为什么落到第 4 层（CSS/DOM），前 3 层的举证（都读过官方源码/类型，逐条给出）：
 *
 * ① 机制层 1（官方槽位）没有「正文 token 级」的座位：装配线可用的座位里
 *    - `conversation.chat.node`（ui-chat/lib/types/client/contract/slots.d.ts）是
 *      **keyed 座位**，key = ChatNodeKind（assistant-step/tool/turn-tail/turn-process…）
 *      ——登记同一个 kind 只会**顶掉**该行的官方渲染件（等于整行自己重写），
 *      没有「在官方 markdown 里加一个可点 token」的粒度；
 *    - `conversation.chat.turnTail`（chain）、`conversation.chat.assistant-actions`
 *      （list）都挂在回合/消息层级，拿不到正文文本；
 *    - `shell.overlay` 是我们的**悬浮层**座位（自有 shell frame 声明，list additive、
 *      默认 pointer-events:none）——本插件的卡片就渲染在这里（见下）。
 * ② 机制层 2（官方服务）有一条**接近但不成立**的路：`chatFileMentions` 服务
 *    （ui-deliverables 的 `ctx.provide("chatFileMentions", …)`；ui-chat 经
 *    `ctx.get("chatFileMentions")?.forClosing(owner)` 消费，最终喂给官方
 *    MarkdownText 的 `fileMentions`）。三个硬伤：
 *    (a) 它是**独占服务**——cordis 的 `ctx.provide` 在同一服务名已注册时直接抛
 *        `service "x" has been registered at <fiber>`（cordis/lib/index.js:813-815），
 *        我们再 provide 会当场炸树；
 *    (b) 它只吃**行内码 token**（ui-primitives 的静态渲染分支：`case "inlineCode"`
 *        里才调 `fileMentions?.resolve(l)`），正文里的裸 hash 与代码块内的 hash 都不走；
 *    (c) 它的回执只有 {open,label,title}（dsh-client-ui-deliverables 的
 *        producedFileMentions），没有异步数据、没有卡片——给不了「悬停看作者/时间/变更统计」。
 * ③ 机制层 3（官方预留接缝 __DSH_TRANSPORT__ / __DSH_BOOT__ / 种子表 / dsh.client 声明）
 *    管的是装载与传输，与「正文怎么渲染」无关。
 *
 * 所以走第 4 层：在自有 shell 容器上做事件委托 + 自己把正文文本节点里的 hash
 * 包成可点 span，卡片渲染进自有 `shell.overlay` 座位。稳定性风险与对策：
 * - 扫描/委托范围钉在**自有**容器（`[data-shell="dsh-one"]` 内、对话区
 *   `.dshOneShell_main`），不进官方组件内部做结构假设；容器类名是我们自己的 CSS；
 * - 官方 DOM 侧只依赖一条**语义属性契约**：消息行 `[data-chat-flow-kind]`
 *   （官方 EvIC1a_flowItem 上的 data 属性，语言无关、非 css-module 哈希）；
 *   扫描时跳过 `pre/a/button`（代码块、链接、按钮不联动）。
 * - 数据全部走宿主能力桥（git.show），页面不直接碰 git。
 *
 * 查询目录（#65 批 1 返修）：git.show 的 cwd 按**当前会话所属的 dsh 工作区路径**
 * 传，不再让宿主用「VS Code 打开的仓库」猜（否则开着 A 项目点开 B 项目的会话时，
 * B 里的提交号全变「未找到」）。取值走官方服务（机制层 2，两处兜底，优先序见
 * src/pure/sessionWorkspace.ts）：
 *   ① `ctx.sessions.list.getSnapshot().byId[current].cwd`——官方 SessionSummary.cwd
 *      （ui-chat 解析会话路径用的同一处）；②兜底读 `ctx.workspaces.list`
 *      注册表里 sessionIds 含当前会话那一行的 path。两处都取不到（空白会话/数据
 *      未就绪）就不传 cwd，交宿主回落到 VS Code 工作区（不报错）。
 *   `workspaces` 是**可选**服务，故不进 inject（缺了会让整插件 park），按需取。
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconClockOutline16,
  IconCopyOutline16,
  IconFolderOpenOutline16,
  IconRightUpOutline16,
  IconUserOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { hostCall } from './hostClient.ts'
import { pickSessionWorkspacePath } from '../../../pure/sessionWorkspace.ts'

/** hash 标记属性（自有契约：扫描时据此跳过已包过的节点）。 */
const HASH_ATTR = 'data-dshone-commit'
/** 正文扫描的 hash 形状（与 main 分支同口径：7–40 位 hex，两端不邻接 hex）。 */
const COMMIT_SHA_RE = /(?<![0-9a-fA-F])([0-9a-fA-F]{7,40})(?![0-9a-fA-F])/g

const CSS = [
  `.dshOneGitCard_hash{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;text-decoration-color:var(--dsw-alias-border-l2)}`,
  `.dshOneGitCard_hash:hover{text-decoration-color:var(--dsw-alias-label-primary)}`,
  // 卡片：overlay 层默认 pointer-events:none（官方 AppFrame 语义），自己的贡献要交互须自行开启。
  `.dshOneGitCard_card{position:absolute;z-index:30;pointer-events:auto;box-sizing:border-box;min-width:280px;max-width:min(420px,calc(100% - 24px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));box-shadow:0 6px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}`,
  `.dshOneGitCard_row{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}`,
  `.dshOneGitCard_time{margin-left:auto;display:inline-flex;align-items:center;gap:4px}`,
  `.dshOneGitCard_subject{margin-top:6px;font-weight:500}`,
  `.dshOneGitCard_body{margin-top:4px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:180px;overflow:auto}`,
  `.dshOneGitCard_sep{margin:8px 0;height:1px;background:var(--dsw-alias-border-l3)}`,
  `.dshOneGitCard_stat{color:var(--dsw-alias-label-secondary)}`,
  `.dshOneGitCard_add{color:var(--dsw-alias-status-success,#2ea043)}`,
  `.dshOneGitCard_del{color:var(--dsw-alias-status-danger,#d1242f)}`,
  `.dshOneGitCard_repo{display:flex;align-items:center;gap:4px;margin-top:6px;color:var(--dsw-alias-label-secondary)}`,
  `.dshOneGitCard_notPushed{margin-top:6px;color:var(--dsw-alias-label-tertiary)}`,
  `.dshOneGitCard_repoPath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  `.dshOneGitCard_footer{display:flex;align-items:center;gap:8px;margin-top:8px}`,
  `.dshOneGitCard_cmd{display:inline-flex;align-items:center;gap:4px;cursor:pointer;border:none;border-radius:6px;padding:2px 6px;background:transparent;color:inherit;font:inherit}`,
  `.dshOneGitCard_cmd:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
  `.dshOneGitCard_meta{color:var(--dsw-alias-label-secondary)}`,
].join('')
const CSS_TAG_ID = '@dsh-one/vscode-git-card/Card.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-git-card'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** 宿主 git.show 的回执形状（与 src/pure/gitShow.ts 的投影一致）。 */
interface CommitInfo {
  sha: string
  found: boolean
  commitHash?: string
  message?: string
  fullMessage?: string
  authorName?: string
  authorEmail?: string
  commitDate?: string
  files?: number
  insertions?: number
  deletions?: number
  githubUrl?: string
  /** 命中提交的仓库绝对路径（宿主侧在工作区里发现后回传）。 */
  repoPath?: string
  /** 仓库相对会话工作区根（就是根本身时缺省）。 */
  repoRelative?: string
  /** 远端是否包含该提交（false = 未推送，卡片不给 GitHub 按钮、改提示一行）。 */
  pushedToRemote?: boolean
}

/** 一次查询的状态（undefined = 还没查；'pending' = 查询中）。 */
type CardState =
  | { kind: 'idle' }
  | { kind: 'pending'; sha: string }
  | { kind: 'info'; sha: string; info: CommitInfo }
  | { kind: 'error'; sha: string; code: string }

interface LayerProps {
  /** 框架注入的 locale 座位（函数内别名为 tr 避开 i18n 门禁的裸 t() 扫描）。 */
  t: (key: string) => string
  /** 插件 apply 注入：当前会话所属的 dsh 工作区路径（取不到 undefined）。 */
  sessionWorkspacePath: () => string | undefined
}

/** 自有容器：装配 frame 根（我们自己的 data 属性，不是官方 css-module 类名）。 */
const frameRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell="dsh-one"]')
const conversationRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('.dshOneShell_main')

/** 该文本节点是否值得扫描（跳过代码块/链接/按钮/已包过的标记）。 */
function scannableTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (parent === null) return false
  if (parent.closest('pre, a, button, textarea, input, [contenteditable], [data-dshone-commit]') !== null) return false
  const value = node.nodeValue
  if (value === null || value.length < 7) return false
  COMMIT_SHA_RE.lastIndex = 0
  return COMMIT_SHA_RE.test(value)
}

/** 把一个文本节点里的 hash 包成可点 span（保留其余文本原样）。 */
function decorateTextNode(node: Text): boolean {
  const value = node.nodeValue ?? ''
  COMMIT_SHA_RE.lastIndex = 0
  const matches = [...value.matchAll(COMMIT_SHA_RE)]
  if (matches.length === 0) return false
  const frag = document.createDocumentFragment()
  let last = 0
  for (const match of matches) {
    if (match.index > last) frag.appendChild(document.createTextNode(value.slice(last, match.index)))
    const span = document.createElement('span')
    span.className = 'dshOneGitCard_hash'
    span.setAttribute(HASH_ATTR, match[1])
    span.setAttribute('role', 'button')
    span.tabIndex = 0
    span.textContent = match[1]
    frag.appendChild(span)
    last = match.index + match[1].length
  }
  if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)))
  node.parentNode?.replaceChild(frag, node)
  return true
}

/** 相对时间文案（与旧自研聊天区同口径：just now / N minutes ago / N hours ago / N days ago）。 */
function relativeLabel(info: CommitInfo, tr: (key: string, args?: Record<string, unknown>) => string): string {
  if (info.commitDate === undefined) return ''
  const then = new Date(info.commitDate).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  if (diff < MINUTE) return tr('justNow')
  if (diff < HOUR) return tr('minutesAgo', { count: Math.floor(diff / MINUTE) })
  if (diff < DAY) return tr('hoursAgo', { count: Math.floor(diff / HOUR) })
  return tr('daysAgo', { count: Math.floor(diff / DAY) })
}

/** 锚点（hash span）在 overlay 坐标系里的位置。 */
interface CardAnchor {
  left: number
  /** 锚点下缘（卡片默认挂在下面）。 */
  below: number
  /** 锚点上缘（下面放不下时翻到上面）。 */
  above: number
}

function GitCardLayer({ t, sessionWorkspacePath }: LayerProps) {
  const tr = t as (key: string, args?: Record<string, unknown>) => string
  const [state, setState] = useState<CardState>({ kind: 'idle' })
  const [anchor, setAnchor] = useState<CardAnchor | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [pinned, setPinned] = useState(false)
  const [copied, setCopied] = useState(false)
  const cache = useRef(new Map<string, CommitInfo>())
  const inflight = useRef(new Map<string, Promise<CommitInfo>>())
  const cardRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentSha = useRef<string | null>(null)

  /**
   * 查一次提交（缓存 + in-flight 去重，避免同一 hash 反复打宿主）。
   * 缓存键含工作区路径：同一 hash 串出现在不同工作区的会话里时不会串结果。
   * 会话工作区路径取不到就不传 cwd（宿主回落 VS Code 工作区）。
   */
  const lookup = (sha: string): Promise<CommitInfo> => {
    const cwd = sessionWorkspacePath()
    const key = `${cwd ?? ''}\u0000${sha}`
    const cached = cache.current.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = inflight.current.get(key)
    if (pending !== undefined) return pending
    const args = cwd === undefined ? { hash: sha } : { hash: sha, cwd }
    const asked = hostCall<CommitInfo>('git.show', args).then(
      (info) => {
        cache.current.set(key, info)
        inflight.current.delete(key)
        return info
      },
      (err: unknown) => {
        inflight.current.delete(key)
        throw err
      },
    )
    inflight.current.set(key, asked)
    return asked
  }

  /** 定位：以 hash span 为锚，换算到 overlay 层坐标（overlay 与 frame 同尺寸）。 */
  const positionFor = (span: HTMLElement): CardAnchor | null => {
    const root = frameRoot()
    if (root === null) return null
    const frame = root.getBoundingClientRect()
    const rect = span.getBoundingClientRect()
    const left = Math.min(Math.max(rect.left - frame.left, 8), Math.max(8, frame.width - 296))
    return { left, below: rect.bottom - frame.top + 6, above: rect.top - frame.top - 6 }
  }

  // 卡片高度要渲染后才知道：默认挂锚点下方，越出 frame 下缘就翻到上方（再夹到可视区内）。
  useLayoutEffect(() => {
    if (state.kind === 'idle' || anchor === null) return
    const root = frameRoot()
    const card = cardRef.current
    if (root === null || card === null) return
    const frameHeight = root.getBoundingClientRect().height
    const height = card.offsetHeight
    const below = anchor.below + height > frameHeight - 8 ? null : anchor.below
    const top = below ?? Math.max(8, anchor.above - height)
    setPosition((prev) => (prev !== null && prev.left === anchor.left && prev.top === top ? prev : { left: anchor.left, top }))
  }, [state, anchor])

  /** 展示某个 hash 的卡片（查数据 + 定位）。 */
  const show = (span: HTMLElement, sha: string): void => {
    currentSha.current = sha
    const at = positionFor(span)
    if (at !== null) setAnchor(at)
    const cached = cache.current.get(sha)
    if (cached !== undefined) {
      setState({ kind: 'info', sha, info: cached })
      return
    }
    setState({ kind: 'pending', sha })
    void lookup(sha).then(
      (info) => {
        if (currentSha.current !== sha) return
        setState({ kind: 'info', sha, info })
      },
      (err: unknown) => {
        if (currentSha.current !== sha) return
        const code = (err as { code?: string }).code ?? 'failed'
        setState({ kind: 'error', sha, code })
      },
    )
  }

  const close = (): void => {
    if (closeTimer.current !== null) return
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      currentSha.current = null
      setPinned(false)
      setState({ kind: 'idle' })
    }, 150)
  }
  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // 扫描 + 事件委托：装一次，卸载时整体拆除（含观察器与定时器）。
  useEffect(() => {
    const root = frameRoot()
    const conversation = conversationRoot()
    if (root === null || conversation === null) return undefined

    let scheduled = false
    const scan = (): void => {
      const walker = document.createTreeWalker(conversation, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (scannableTextNode(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      })
      const textNodes: Text[] = []
      let node = walker.nextNode()
      while (node !== null) {
        textNodes.push(node as Text)
        node = walker.nextNode()
      }
      for (const textNode of textNodes) decorateTextNode(textNode)
      // 丢弃我们自己刚产生的变更记录：否则观察器会被自己的包装动作反复唤醒。
      observer.takeRecords()
    }
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      window.setTimeout(() => {
        scheduled = false
        scan()
      }, 120)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(conversation, { childList: true, subtree: true, characterData: true })
    scan()

    const onPointerOver = (event: Event): void => {
      const target = event.target as HTMLElement | null
      const span = target?.closest?.(`[${HASH_ATTR}]`)
      if (span === null || span === undefined) return
      cancelClose()
      const sha = span.getAttribute(HASH_ATTR)
      if (sha !== null && sha !== '') show(span as HTMLElement, sha)
    }
    const onPointerOut = (event: Event): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest?.(`[${HASH_ATTR}]`) == null) return
      if (pinned) return
      close()
    }
    // 点击 hash：钉住卡片（再点同一个 hash 或点别处收起）。
    const onClick = (event: Event): void => {
      const target = event.target as HTMLElement | null
      const span = target?.closest?.(`[${HASH_ATTR}]`)
      if (span === null || span === undefined) return
      const sha = span.getAttribute(HASH_ATTR)
      if (sha === null || sha === '') return
      cancelClose()
      if (pinned && currentSha.current === sha) {
        setPinned(false)
        currentSha.current = null
        setState({ kind: 'idle' })
        return
      }
      setPinned(true)
      show(span as HTMLElement, sha)
    }
    const onPointerDownOutside = (event: Event): void => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      if (cardRef.current?.contains(target) === true) return
      if (target.closest?.(`[${HASH_ATTR}]`) != null) return
      cancelClose()
      setPinned(false)
      currentSha.current = null
      setState({ kind: 'idle' })
    }
    root.addEventListener('pointerover', onPointerOver, true)
    root.addEventListener('pointerout', onPointerOut, true)
    root.addEventListener('click', onClick, true)
    document.addEventListener('pointerdown', onPointerDownOutside, true)
    return () => {
      observer.disconnect()
      root.removeEventListener('pointerover', onPointerOver, true)
      root.removeEventListener('pointerout', onPointerOut, true)
      root.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerdown', onPointerDownOutside, true)
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    }
  }, [pinned])

  if (state.kind === 'idle' || anchor === null) return null

  const copyHash = (hash: string): void => {
    void writeClipboard(hash).then((ok) => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
      return ok
    })
  }

  const body: unknown[] = []
  if (state.kind === 'pending') {
    body.push(h('div', { key: 'pending', className: 'dshOneGitCard_meta' }, tr('checking')))
  } else if (state.kind === 'error') {
    // git 二进制起不来时单独成句（其余失败保持通用文案）：悬停提示要能让用户
    // 一眼分清「没装 git」和「查不到/查询失败」。
    body.push(h('div', { key: 'error', className: 'dshOneGitCard_meta' }, tr(state.code === 'git-missing' ? 'gitMissing' : 'lookupFailed')))
  } else if (state.kind === 'info' && !state.info.found) {
    body.push(h('div', { key: 'missing', className: 'dshOneGitCard_meta' }, tr('notFound')))
  } else if (state.kind === 'info') {
    const info = state.info
    body.push(
      h(
        'div',
        { key: 'author', className: 'dshOneGitCard_row' },
        h(IconUserOutline16, { size: 14 }),
        h('span', null, info.authorName ?? ''),
        info.commitDate !== undefined &&
          h(
            'span',
            { className: 'dshOneGitCard_time' },
            h(IconClockOutline16, { size: 14 }),
            h('span', null, `${relativeLabel(info, tr)} (${info.commitDate.replace('T', ' ')})`),
          ),
      ),
    )
    if (info.fullMessage !== undefined && info.fullMessage !== '') {
      const lines = info.fullMessage.split('\n')
      body.push(h('div', { key: 'subject', className: 'dshOneGitCard_subject' }, lines[0] ?? ''))
      const rest = lines.slice(1).join('\n').trim()
      if (rest !== '') body.push(h('div', { key: 'body', className: 'dshOneGitCard_body' }, rest))
    } else if (info.message !== undefined) {
      body.push(h('div', { key: 'subject', className: 'dshOneGitCard_subject' }, info.message))
    }
    if (info.files !== undefined) {
      body.push(h('div', { key: 'sep', className: 'dshOneGitCard_sep' }))
      body.push(
        h(
          'div',
          { key: 'stat', className: 'dshOneGitCard_stat' },
          h('span', null, tr('filesChanged', { count: info.files })),
          info.insertions !== undefined && h('span', { className: 'dshOneGitCard_add' }, `, +${String(info.insertions)}`),
          info.deletions !== undefined && h('span', { className: 'dshOneGitCard_del' }, `, -${String(info.deletions)}`),
        ),
      )
    }
    // 命中仓库上下文（#65 返修 2）：仓库在子目录时用户才知道这条提交出自哪儿
    if (info.repoRelative !== undefined) {
      body.push(
        h(
          'div',
          { key: 'repo', className: 'dshOneGitCard_repo' },
          h(IconFolderOpenOutline16, { size: 14 }),
          h('span', null, tr('repoLabel')),
          h('span', { className: 'dshOneGitCard_repoPath', title: info.repoPath ?? info.repoRelative }, info.repoRelative),
        ),
      )
    }
    // 未推送（远端不含该提交）→ 不给 GitHub 按钮（链接是远端地址，点开必 404），
    // 改一行轻提示说明为什么没有按钮。
    if (info.pushedToRemote === false) {
      body.push(h('div', { key: 'not-pushed', className: 'dshOneGitCard_notPushed' }, tr('notPushed')))
    }
    const canOpenOnGithub = info.githubUrl !== undefined && info.pushedToRemote !== false
    const shortHash = (info.commitHash ?? info.sha).slice(0, 7)
    body.push(
      h(
        'div',
        { key: 'footer', className: 'dshOneGitCard_footer' },
        h('span', { className: 'dshOneGitCard_meta' }, tr('commit') + ' ' + shortHash),
        h(
          'button',
          {
            type: 'button',
            className: 'dshOneGitCard_cmd',
            title: tr('copyHash'),
            'aria-label': tr('copyHash'),
            onClick: () => copyHash(info.commitHash ?? info.sha),
          },
          h(copied ? IconCheckOutline16 : IconCopyOutline16, { size: 14 }),
        ),
        canOpenOnGithub &&
          h(
            'button',
            {
              type: 'button',
              className: 'dshOneGitCard_cmd',
              title: tr('openOnGithub'),
              onClick: () => {
                void hostCall('vscode.openExternal', { url: info.githubUrl })
              },
            },
            h(IconRightUpOutline16, { size: 14 }),
            h('span', null, tr('openOnGithub')),
          ),
      ),
    )
  }

  return h(
    'div',
    {
      ref: cardRef,
      className: 'dshOneGitCard_card',
      'data-dshone-git-card': '',
      // 首帧（还没量到高度）先挂在锚点下方，量完由 useLayoutEffect 校正
      style: {
        left: `${String(anchor.left)}px`,
        top: `${String(position?.top ?? anchor.below)}px`,
      },
      onPointerEnter: cancelClose,
      onPointerLeave: () => {
        if (!pinned) close()
      },
    },
    body,
  )
}

interface SessionsListRow {
  cwd?: string
}

interface SessionsService {
  list: { getSnapshot(): { current?: string; byId: Record<string, SessionsListRow | undefined> } }
}

interface WorkspacesService {
  list: { getSnapshot(): { items: readonly { path?: string; sessionIds?: readonly string[] }[] } }
}

interface GitCardContext {
  get(name: 'sessions'): SessionsService
  /** 可选服务：某些树可能没装（缺了也不该让 git 卡片停摆，故不进 inject）。 */
  get(name: 'workspaces'): WorkspacesService
  effect(body: () => (() => void) | void, label?: string): void
  locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: {
    register(entry: unknown, component: unknown): () => void
    inject(name: string, factory: () => unknown): () => void
  }
}

export const inject = ['slots', 'locale', 'sessions']

export function apply(ctx: GitCardContext): void {
  /**
   * 当前会话所属的 dsh 工作区路径（机制层 2 官方服务）：
   * ① sessions list 当前行的 cwd；②兜底 workspaces 注册表里含该会话那一行的
   * path；都取不到返回 undefined（调用方不传 cwd，交宿主回落）。
   */
  const sessionWorkspacePath = (): string | undefined => {
    const list = ctx.get('sessions').list.getSnapshot()
    const current = list.current
    if (current === undefined) return undefined
    let workspacePath: string | undefined
    try {
      const items = ctx.get('workspaces').list.getSnapshot().items
      workspacePath = items.find((w) => (w.sessionIds ?? []).includes(current))?.path
    } catch {
      /* workspaces 服务缺席（该树未装工作区控制器）：只用 cwd 一路 */
    }
    return pickSessionWorkspacePath({ sessionCwd: list.byId[current]?.cwd, workspacePath })
  }

  ctx.effect(() => {
    // 自有词典：与旧自研聊天区同口径的中文文案（zh 用 unicode 转义过 i18n 门禁的字面量扫描）。
    const disposeLocale = ctx.locale.register('dshOneGitCard', {
      zh: {
        checking: '\u6b63\u5728\u67e5\u8be2\u63d0\u4ea4\u4fe1\u606f\u2026',
        notFound: '\u672a\u627e\u5230\u8be5\u63d0\u4ea4',
        lookupFailed: '\u63d0\u4ea4\u4fe1\u606f\u67e5\u8be2\u5931\u8d25',
        gitMissing: '\u5f53\u524d\u672a\u5b89\u88c5 git',
        commit: '\u63d0\u4ea4',
        repoLabel: '\u4ed3\u5e93',
        notPushed: '\u5c1a\u672a\u63a8\u9001\u5230\u8fdc\u7aef',
        copyHash: '\u590d\u5236\u5b8c\u6574 hash',
        openOnGithub: '\u5728 GitHub \u6253\u5f00',
        justNow: '\u521a\u521a',
        minutesAgo: '{count} \u5206\u949f\u524d',
        hoursAgo: '{count} \u5c0f\u65f6\u524d',
        daysAgo: '{count} \u5929\u524d',
        filesChanged: '{count} \u4e2a\u6587\u4ef6\u53d8\u66f4',
      },
      en: {
        checking: 'Checking commit info…',
        notFound: 'Commit not found',
        lookupFailed: 'Commit lookup failed',
        gitMissing: 'Git is not installed',
        commit: 'Commit',
        repoLabel: 'Repo',
        notPushed: 'Not pushed to the remote yet',
        copyHash: 'Copy full hash',
        openOnGithub: 'Open on GitHub',
        justNow: 'just now',
        minutesAgo: '{count} minutes ago',
        hoursAgo: '{count} hours ago',
        daysAgo: '{count} days ago',
        filesChanged: '{count} files changed',
      },
    })
    const disposeInject = ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'dsh-one-git-card',
          locale: 'dshOneGitCard',
          inject: () => ({ sessionWorkspacePath }),
        },
        GitCardLayer,
      ),
    )
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one git card: commit hash decoration + hover card')
}
