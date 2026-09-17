/**
 * `@dsh-one/dsh-git-card`——消息正文里短 commit hash 的可点 + 悬停详情卡
 * （#65 批 1，旧自研聊天区同款功能的装配版；#83 迁移到宿主能力口与可移植挂载点，
 * 命名从 `vscode-*` 改为 `dsh-*`）。
 *
 * ## 为什么是 dsh-*（可移植）
 * 本件原先有两处 VS Code 耦合，都已拆掉：
 * - **数据**：`hostCall('git.show')` → **宿主能力口** `capabilities.gitShow(...)`
 *   （VS Code 侧 = 扩展宿主的能力桥；官方 web 侧 = 宿主半插件的网关 RPC，同一份
 *   安全口径代码，见 `@dsh-one/dsh-plugin-kit/hostCapabilities` 的能力表）；
 * - **外链**：`hostCall('vscode.openExternal')` → `capabilities.openExternal(...)`
 *   （VS Code 侧 = `vscode.env.openExternal`；官方 web 侧 = 页面原生 `window.open`）；
 * - **挂载点**：扫描与事件委托原先挂在自有 frame 根（`[data-shell="dsh-one"]`），
 *   取不到就整个不工作——现在挂**官方对话区容器**（`[data-conversation-scroll]`，
 *   官方 ui-conversation 的会话滚动体），见 `@dsh-one/dsh-plugin-kit/mountPoints` 的出处。
 * 卡片本身渲染进 `shell.overlay` 座位、定位按 CSS 的坐标系算（`positioningContext`），
 * 也不认任何自有标记。三处都通用，故命名 `dsh-*`。
 *
 * ## 机制分层（按 AGENTS.md 的优先序逐层举证，前 3 层都读过官方源码/类型）
 * ① 机制层 1（官方槽位）没有「正文 token 级」的座位：装配线可用的座位里
 *    - `conversation.chat.node`（ui-chat/lib/types/client/contract/slots.d.ts）是
 *      **keyed 座位**，key = ChatNodeKind（assistant-step/tool/turn-tail/turn-process…）
 *      ——登记同一个 kind 只会**顶掉**该行的官方渲染件（等于整行自己重写），
 *      没有「在官方 markdown 里加一个可点 token」的粒度；
 *    - `conversation.chat.turnTail`（chain）、`conversation.chat.assistant-actions`
 *      （list）都挂在回合/消息层级，拿不到正文文本；
 *    - `shell.overlay` 是**官方 AppFrame（ui-layout）声明的** list 座位（`scope: root`，
 *      「悬浮层」语义、默认 pointer-events:none）——本插件的卡片就渲染在这里（见下）；
 *      我们的 VS Code 树 shadow 了 root，所以由自有 frame 插件声明同名子槽
 *      （两侧都是同一个官方座位名，官方 web 里由官方外框提供）。
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
 * 所以走第 4 层：在**官方对话区容器**上做事件委托 + 自己把正文文本节点里的 hash
 * 包成可点 span，卡片渲染进 `shell.overlay` 座位。稳定性风险与对策：
 * - 扫描/委托范围钉在官方语义容器（`[data-conversation-scroll]`）之内，不进官方
 *   组件内部做结构假设；
 * - 官方 DOM 侧只依赖一条**语义属性契约**：对话区容器 `[data-conversation-scroll]`
 *   （官方 ui-conversation 写、官方 ui-chat 也按它取滚动体）；扫描时跳过
 *   `pre/a/button`（代码块、链接、按钮不联动）。
 *
 * 查询目录（#65 批 1 返修）：gitShow 的 cwd 按**当前会话所属的 dsh 工作区路径**
 * 传，不再让宿主用「VS Code 打开的仓库」猜（否则开着 A 项目点开 B 项目的会话时，
 * B 里的提交号全变「未找到」）。取值走官方服务（机制层 2，两处兜底，优先序见
 * src/pure/sessionWorkspace.ts）：
 *   ① `ctx.sessions.list.getSnapshot().byId[current].cwd`——官方 SessionSummary.cwd
 *      （ui-chat 解析会话路径用的同一处）；②兜底读 `ctx.workspaces.list`
 *      注册表里 sessionIds 含当前会话那一行的 path。两处都取不到（空白会话/数据
 *      未就绪）就不传 cwd，交宿主回落到 VS Code 工作区（不报错）。
 *   `workspaces` 是**可选**服务，故不进 inject（缺了会让整插件 park），按需取。
 *
 * ## 有意依赖：两路来源都必须留着（#182 实测定案，别再「收成一路」）
 *
 * #96 审计的 D7 给过一条收敛方向：只留 `workspaces.list` 的 `path` 一路、去掉
 * `byId[current].cwd`。**#182 实测证明收不得**——工作区那一行只覆盖「挂在该工作区
 * 名下」的会话，另有两类会话在那份 `sessionIds` 里根本不存在：
 *   - **子代理会话**（`parentId` 有值）：可以经官方会话头目录打开（官方
 *     `dsh-client-ui-subagent` 的读法就是「browse every subagent conversation beneath a
 *     parent session, open any descendant」），而它们绝大多数不在任何工作区的
 *     `sessionIds` 里（本机 2026-09-18 实测：584 条子会话只有 25 条在册）；
 *   - **未分组会话**（官方 `session/create` 用 `cwd` 而非 `workspaceId` 建的，或我们自己
 *     侧栏「未分组」桶的 ＋ 建的 `sessions.create({})`）：按官方工作区注册表的归属规则，
 *     这类会话不属于任何工作区。
 * 这两类会话收成一路后拿不到 cwd，宿主就回落到 VS Code 工作区目录——**实测**（同一台
 * 临时 `DSH_HOME` 网关 + 真 git）：未分组会话的提交在「会话自己那个目录」里查得到（改前
 * `查到=true`），收成一路后查询根变成 VS Code 打开的另一个仓库（`查到=false`）。
 * 所以这里保留两路，并把这条依赖登记在案：`SessionSummary.cwd` 取的是官方客户端服务的
 * **公开字段**（`@deepseek-ai/dsh-api-session-controller/client` 的 `SessionListState` /
 * `SessionSummary`，契约模块自述「the outward sessions-service face — what `ctx.sessions`
 * exposes to feature packages」），只是仍属 #96 的**三档**（官方字段名）。
 * 常驻护栏 = 实验室 **F-60**（`test/assembly-lab/gitCardCwdSuites.ts`）：未分组会话的
 * `git.show` 必须仍带会话自己的 cwd——谁把来源收成一路，这一条当场红。
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
import { hostCapabilities, type CapabilityContext } from '@dsh-one/dsh-plugin-kit/hostCapabilities'
import { mountOnConversation, positioningContext } from '@dsh-one/dsh-plugin-kit/mountPoints'
import { pickSessionWorkspacePath } from '../../../src/pure/sessionWorkspace.ts'
import type { CommitInfoResult } from '../../../src/pure/chatContract.ts'

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
const CSS_TAG_ID = '@dsh-one/dsh-git-card/Card.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/dsh-git-card'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/**
 * 宿主 git 查询的回执：能力口契约（`CommitInfoResult`，见 pure/chatContract.ts）
 * 加上宿主侧在会话工作区里命中后回传的仓库上下文（能力桥与宿主半都带这几项）。
 */
interface CommitInfo extends CommitInfoResult {
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
  /** 插件 apply 注入的宿主能力口（git 查询与开外链都走它）。 */
  capabilities: ReturnType<typeof hostCapabilities>
}

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

function GitCardLayer({ t, sessionWorkspacePath, capabilities }: LayerProps) {
  const tr = t as (key: string, args?: Record<string, unknown>) => string
  const [state, setState] = useState<CardState>({ kind: 'idle' })
  /** 触发卡片的 hash 标记元素（卡片位置的锚点）。 */
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
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
   * 会话工作区路径取不到就不传 cwd（宿主回落 VS Code 工作区；官方侧回落 dsh 家目录）。
   */
  const lookup = (sha: string): Promise<CommitInfo> => {
    const cwd = sessionWorkspacePath()
    const key = `${cwd ?? ''}\u0000${sha}`
    const cached = cache.current.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = inflight.current.get(key)
    if (pending !== undefined) return pending
    const args = cwd === undefined ? { hash: sha } : { hash: sha, cwd }
    const asked = capabilities.gitShow(args).then(
      (info) => {
        const resolved = info as CommitInfo
        cache.current.set(key, resolved)
        inflight.current.delete(key)
        return resolved
      },
      (err: unknown) => {
        inflight.current.delete(key)
        throw err
      },
    )
    inflight.current.set(key, asked)
    return asked
  }

  // 卡片高度/宽度要渲染后才知道：按 CSS 的坐标系（最近的可定位祖先盒，官方的
  // 槽位包装层会被跳过）把卡片摆到锚点下方，越出下缘就翻到上方，再夹进可视范围。
  // 布局副作用在绘制前跑完，所以不会闪一帧错位置。
  useLayoutEffect(() => {
    const card = cardRef.current
    if (state.kind === 'idle' || anchor === null || card === null) return
    const space = positioningContext(card).getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    const left = Math.min(
      Math.max(rect.left - space.left, 8),
      Math.max(8, space.width - card.offsetWidth - 8),
    )
    const below = rect.bottom - space.top + 6
    const above = rect.top - space.top - 6
    const top = below + card.offsetHeight > space.height - 8 ? Math.max(8, above - card.offsetHeight) : below
    setPosition((prev) => (prev !== null && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [state, anchor])

  /** 展示某个 hash 的卡片（锚点是那个已装饰的 span）。 */
  const show = (span: HTMLElement, sha: string): void => {
    currentSha.current = sha
    setAnchor(span)
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

  // 扫描 + 事件委托：挂到**官方对话区容器**（`[data-conversation-scroll]`，见
  // mountPoints.ts 的出处；容器晚出现会等、被换掉会重装）。卸载时整体拆除
  //（含观察器与去抖定时器）。
  useEffect(() => {
    return mountOnConversation((conversation) => {
      let scheduled = false
      let timer: number | null = null
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
        timer = window.setTimeout(() => {
          scheduled = false
          timer = null
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
      conversation.addEventListener('pointerover', onPointerOver, true)
      conversation.addEventListener('pointerout', onPointerOut, true)
      conversation.addEventListener('click', onClick, true)
      document.addEventListener('pointerdown', onPointerDownOutside, true)
      return () => {
        observer.disconnect()
        if (timer !== null) clearTimeout(timer)
        conversation.removeEventListener('pointerover', onPointerOver, true)
        conversation.removeEventListener('pointerout', onPointerOut, true)
        conversation.removeEventListener('click', onClick, true)
        document.removeEventListener('pointerdown', onPointerDownOutside, true)
        if (closeTimer.current !== null) clearTimeout(closeTimer.current)
      }
    })
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
                void capabilities.openExternal(info.githubUrl ?? '')
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
      // 首帧（还没算位置）先放坐标系原点，绘制前由 useLayoutEffect 摆正
      style: {
        left: `${String(position?.left ?? 0)}px`,
        top: `${String(position?.top ?? 0)}px`,
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

interface GitCardContext extends CapabilityContext {
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
  const capabilities = hostCapabilities(ctx)

  /**
   * 当前会话所属的 dsh 工作区路径（机制层 2 官方服务）：
   * ① sessions list 当前行的 cwd；②兜底 workspaces 注册表里含该会话那一行的
   * path；都取不到返回 undefined（调用方不传 cwd，交宿主回落）。
   *
   * 两条来源**都必须留**：工作区那一行的 `sessionIds` 不含子代理会话与未分组会话
   * （实测读数和理由见文件头「有意依赖」那一段，护栏是实验室 F-60）。
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
          inject: () => ({ sessionWorkspacePath, capabilities }),
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
