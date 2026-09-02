/**
 * Chat webview frontend: renders ChatState snapshots pushed by the host
 * (src/ui/chatView.ts) and posts user actions back (FromWebviewMessage).
 * Runs in the webview's browser context; esbuild bundles it (marked +
 * dompurify inlined) to dist/chatWebview.js. Rendering is a full rebuild per
 * snapshot — the host throttles pushes, so this stays cheap for a skeleton.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { CONTEXT_BROWSE_ICON, FISH_LOGO, MESSAGE_ACTION_ICONS, PANEL_ICONS, THINK_ICON, type IconDef } from './icons.ts'
import type {
  ChatAssistantMessage,
  ChatBlock,
  ChatFile,
  ChatImage,
  ChatMessage,
  ChatState,
  ChatTodoItem,
  ChatToolBlock,
  FromWebviewMessage,
  OutgoingImage,
  PendingApproval,
  PendingQuestion,
  QueuedItem,
  StagedFile,
  SubagentNode,
  ToWebviewMessage,
} from '../../pure/chatContract.ts'
import type { SessionNodeModel, SessionSortOrder, WorkspaceNodeModel } from '../../pure/sessionTree.ts'
import { formatRelativeTime, UNGROUPED_WORKSPACE_ID } from '../../pure/sessionTree.ts'
import { looksLikeSlashCommand } from '../../pure/slashCommand.ts'
import { meterLevel } from '../../pure/contextMeter.ts'
import { isCommandTool, prettyJson, toolAction, truncateLines } from '../../pure/toolLine.ts'
import {
  JSON_TREE_ROOT_KEY,
  flattenJsonTree,
  jsonPathKey,
  jsonTreeCopyText,
  jsonTreeThresholdExceeded,
  jsonValueAtPath,
  tryParseJsonTree,
  type JsonContainer,
  type JsonPath,
  type JsonPrimitiveKind,
  type JsonTreeRow,
} from '../../pure/jsonTree.ts'
import { subagentInTree, subagentIdFromOutput } from '../../pure/subagentCard.ts'
import { codeBlockPreview } from '../../pure/codeBlock.ts'
import {
  formatJobDuration,
  isLiveJob,
  jobDotState,
  jobStatusLabel,
  jobsChipLabel,
  orderJobs,
  type ActivityJob,
} from '../../pure/activityTree.ts'
import { attachmentDataUrl, isImageMediaType } from '../../pure/composerAttachment.ts'
import {
  SETTLE_IDLE_MS,
  USER_SCROLL_INTENT_MS,
  archiveScrollPosition,
  isAtBottom,
  isScrollKey,
  reconcileScrollPinning,
  restoreScrollTarget,
  shouldSettlePinNow,
  type ScrollArchive,
} from '../../pure/scrollFollow.ts'
import { formatDuration } from '../../pure/sessionStats.ts'
import {
  SESSION_REFERENCE_SCHEME,
  decodeSessionReferenceUri,
  expandMentionBindings,
  formatSessionMention,
  mentionDisplayToken,
  splitReadableMentions,
  splitSessionMentions,
} from '../../pure/sessionMention.ts'
import { activeAtToken, formatFileMention, type ActiveAtToken, type FileRefCandidate } from '../../pure/fileReference.ts'
import {
  WORKFLOW_STATUS_TEXT,
  advanceWorkflowDisclosure,
  toggleWorkflowDisclosure,
  workflowDotState,
  workflowPhaseFacts,
  workflowPhaseStatusSummary,
  workflowRunFacts,
  type WorkflowDisclosureState,
  type WorkflowRunMemberView,
  type WorkflowRunPhaseView,
  type WorkflowRunStatus,
  type WorkflowRunView,
} from '../../pure/workflowRun.ts'
import { el, buttonEl, iconButton, iconSvg, strokeSvg, mdCodeBody, presetIconSvg, spinSvg, fishLogoSvg, md, post, FILE_ICON } from './webviewKit.ts'
import { closePopover, getPopover, getPopoverAnchor, menuItem, positionPopover, showPopover, showPopoverAt } from './webviewPopover.ts'
import { applyFileRefResponse, handleSlashKey, hideSlashPopup, isSlashPopupOpen, mentionBindings, moveSlashSelection, pasteSessionMentions, reanchorSlashPopup, updateSlashPopup } from './webviewSlash.ts'
import {
  openAgentPresetMenu,
  openCommandMenu,
  openJobsMenu,
  openModelMenu,
  openPermissionMenu,
  openSubagentMenu,
  PERMISSION_GLYPHS,
  patchContextBar,
  patchStatsRow,
  renderModelMenuRoot,
  statsRow,
  subagentLineageRunning,
} from './webviewMenus.ts'
import {
  attachmentCache,
  attachmentRequested,
  answerDrafts,
  commandNotices,
  detailsOpen,
  detailsSession,
  editingQueueItem,
  jsonTreeOpen,
  modelCatalog,
  modelMenuBody,
  pendingFiles,
  pendingImages,
  pendingPreview,
  queueEditDrafts,
  recall,
  recallDraft,
  sessionsSnapshot,
  setCommandNotices,
  setDetailsSession,
  setEditingQueueItem,
  setModelCatalog,
  setModelMenuBody,
  setPendingFiles,
  setPendingImages,
  setPendingPreview,
  setRecall,
  setRecallDraft,
  setSessionsSnapshot,
  setStagedForSession,
  setState,
  setStashedDraft,
  setTurnStatusStart,
  setTurnStatusTimer,
  stagedForSession,
  state,
  stashedDraft,
  turnStatusStart,
  turnStatusTimer,
  workflowDisclosure,
  type QuestionDraft,
} from './webviewState.ts'

const app = document.getElementById('app') as HTMLElement

// 脚本加载完成即向宿主报到：面板首次打开、以及 tab 切走再切回导致 webview
// 被 VSCode 重载后，宿主都靠这条消息重推当前 ChatState——否则重载后的页面
// 收不到任何 state（宿主只在事件驱动时推送），只剩空白。
post({ type: 'ready' })

marked.setOptions({ gfm: true, breaks: true })

/** Auto-scroll only when the user is already near the bottom. */
let stickToBottom = true
/**
 * ScrollTop the last render left behind. Compared against the live position
 * at the next render to detect user scrolls synchronously — the scroll event
 * dispatches asynchronously and would otherwise race with streaming renders.
 * Only trusted while userScrollIntentActive(); content growth moves scrollTop
 * without any user gesture.
 */
let pinnedScrollTop: number | null = null
/**
 * Per-session 滚动存档：每个会话记住自己最后的位置（贴底记 atBottom，
 * 翻历史记 scrollTop），换会话时先存档旧会话、再按新会话存档恢复——
 * 不再把上个会话容器的 scrollTop 套到新内容上。
 */
const scrollPositions = new Map<string, ScrollArchive>()
/**
 * messages 容器当前内容所属的会话 id；与快照的 state.sessionId 不同即
 * 处于换会话过程（loading 帧容器里还是旧会话内容）。无容器内容时为 null。
 */
let scrollSession: string | null = null
/**
 * User-scroll intent: wheel/touch/keyboard gestures and scrollbar drags mark
 * the moments where a scroll position change is user-driven. Scroll events and
 * the render() head only re-evaluate stickToBottom while intent is active, so
 * content growth and our own programmatic pins are never misread as the user
 * scrolling up.
 */
let scrollIntentUntil = 0
let scrollPointerDown = false
/**
 * 最近一次滚动活动（wheel/scroll/pointerdown/滚动手势）的时间戳。用于「滚动空闲判定」
 * （迭代 3）：原生弹性回归动画期间 scroll 事件持续到达，只要距今 < SETTLE_IDLE_MS 就
 * 认为是「滚动还在动」，禁止写 scrollTop——写会打断回归动画（terminate inertia →
 * 回弹被重置 → 再弹 → 连续碰撞）。
 */
let lastScrollActivityAt = 0
/** 滚动空闲 debounce 定时器：在每次滚动活动上重排，到期跑 maybeSettlePin。 */
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null

function noteUserScrollIntent(): void {
  scrollIntentUntil = Date.now() + USER_SCROLL_INTENT_MS
}

function userScrollIntentActive(): boolean {
  return scrollPointerDown || Date.now() < scrollIntentUntil
}

/** 滚动空闲评价：最近 SETTLE_IDLE_MS 内仍有滚动活动（含回归动画的 scroll 事件流）。 */
function scrollActiveRecently(): boolean {
  return Date.now() - lastScrollActivityAt < SETTLE_IDLE_MS
}

/** 排一次滚动空闲 debounce：滚动活动结束时跑 maybeSettlePin（会被后续活动反复推迟）。 */
function deferSettlePin(): void {
  if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null
    maybeSettlePin()
  }, SETTLE_IDLE_MS)
}

/** 标记一次滚动活动并重排 idle debounce（回归动画期间 scroll 事件流会一直推迟它）。 */
function noteScrollActivity(): void {
  lastScrollActivityAt = Date.now()
  deferSettlePin()
}

/** 用户滚动手势（wheel/touch/keyboard）：既标记意图窗口（200ms），也标记滚动活动。 */
function onScrollGesture(): void {
  noteUserScrollIntent()
  noteScrollActivity()
}

/**
 * 滚动真正停后（debounce 到期、无滚动活动）才允许补一次回底。回归动画期间 scroll
 * 事件持续到来 → debounce 被反复推迟 → 动画真结束时才可能写。滚动停后视口通常已贴底
 * （atBottom，shouldSettlePinNow 为假，零打扰）；脱底漂移（内容增长）写一次吸回。
 */
function maybeSettlePin(): void {
  const messages = document.getElementById('messages')
  if (!messages) return
  if (!shouldSettlePinNow(stickToBottom, userScrollIntentActive(), isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight), scrollActiveRecently())) return
  messages.scrollTop = messages.scrollHeight
  pinnedScrollTop = messages.scrollTop
  const jump = messages.querySelector<HTMLElement>('.jump-latest')
  if (jump) jump.style.display = 'none'
}

/**
 * 程序滚到最新并复位跟随态：发送消息这类"用户要看最新"的动作调用。
 * 无条件滚到底，再按现有 isAtBottom 判定从实际位置重估跟随态（滚到
 * 底距底为 0，必然进入跟随）——与用户滚动判定共用同一套距离语义，不
 * 绕过跟随机制。程序滚动不标记用户意图，scroll 监听里
 * userScrollIntentActive() 为假，不会把跟随态误解掉。
 */
function pinToLatest(): void {
  const messages = document.getElementById('messages')
  if (!messages) return
  messages.scrollTop = messages.scrollHeight
  stickToBottom = isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight)
  pinnedScrollTop = messages.scrollTop
}

// Scrollbar drags dispatch no events to the page between pointerdown and
// pointerup; track the button globally so mid-drag scrolls count as user-driven.
window.addEventListener('pointerup', () => {
  scrollPointerDown = false
})
window.addEventListener('pointercancel', () => {
  scrollPointerDown = false
})
/**
 * 「加载更早」请求挂起时的锚点：发请求时的首条消息 id 与条数。响应落地
 * （loadingEarlier 由 true 翻回 false）那一帧若消息从顶部插入，渲染后按
 * 新增高度补偿 scrollTop，保住用户正在读的位置。
 */
let earlierAnchor: { firstId: string | undefined; count: number; seenLoading: boolean } | null = null
/** Signature of the composer-relevant state at the last render; see render(). */
let lastComposerSig: string | null = null
/** Signature of the header-relevant state at the last render; see render(). */
let lastHeaderSig: string | null = null
/** Signature of the pending-interaction state at the last render; see render(). */
let lastPendingSig: string | null = null
/**
 * 外部链接拦截（捕获阶段）：裸 `<a href="http…">` 的默认行为会让 webview
 * 自身导航到目标页，面板内容被顶掉——表现为「点对话里的链接，原来的 tab 就
 * 没了」。这里统一拦下所有锚点点击：阻止导航与冒泡，http/https/mailto 转交
 * 宿主用系统默认浏览器打开，webview 保持在 chat 界面。捕获阶段先于一切
 * 冒泡处理，mention chip（button）等内部动作不受影响；dsh-session: 锚点只
 * 剩坏 URI 的残留（好的已被 decorateSessionMentions 换成 chip），只拦不跳。
 */
document.addEventListener(
  'click',
  (e) => {
    const target = e.target as HTMLElement | null
    const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    const href = a.getAttribute('href') ?? ''
    if (/^(https?|mailto):/i.test(href)) post({ type: 'openExternal', url: href })
  },
  true,
)

/**
 * 外链右键菜单：单击外链默认用系统浏览器打开（上面的 click 拦截），右键给
 * 「VS Code 内置浏览器打开」的选择。同样拦掉默认行为（浏览器/VS Code 的
 * 原生菜单），弹自绘菜单；非 http(s)/mailto 锚点（dsh-session: 残留）不弹。
 */
document.addEventListener(
  'contextmenu',
  (e) => {
    const target = e.target as HTMLElement | null
    const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    if (!/^(https?|mailto):/i.test(href)) return
    e.preventDefault()
    e.stopPropagation()
    const body = el('div')
    body.appendChild(
      menuItem('在系统浏览器中打开', {
        icon: iconSvg(CONTEXT_BROWSE_ICON),
        onClick: () => {
          closePopover()
          post({ type: 'openExternal', url: href })
        },
      }),
    )
    body.appendChild(
      menuItem('在 VS Code 内置浏览器中打开', {
        icon: iconSvg(CONTEXT_BROWSE_ICON),
        onClick: () => {
          closePopover()
          post({ type: 'openInBuiltinBrowser', url: href })
        },
      }),
    )
    showPopoverAt(e.clientX, e.clientY, body)
  },
  true,
)

/** 请求加载更早的一页历史（按钮点击与上翻到顶共用）；挂起期间防重入。 */
function maybeLoadEarlier(): void {
  if (!state?.hasEarlierHistory || state.loadingEarlier === true || earlierAnchor !== null) return
  earlierAnchor = { firstId: state.messages[0]?.id, count: state.messages.length, seenLoading: false }
  post({ type: 'loadEarlier' })
}

/** 会话引用图标：dsh web ReferenceIcon 的 session 分支（16x16 聊天气泡 + 两行）。 */
const SESSION_REF_ICON: IconDef = {
  paths: [
    "M8 0.597656C3.91296 0.597656 0.599716 3.91103 0.599609 7.99805C0.599609 9.13171 0.854567 10.2079 1.31152 11.1699L1.59277 11.7607L2.77441 11.1992L2.49414 10.6084L2.36035 10.3076C2.06865 9.59612 1.90723 8.81645 1.90723 7.99805C1.90733 4.63362 4.63554 1.90625 8 1.90625C11.3644 1.90635 14.0917 4.63368 14.0918 7.99805C14.0918 11.3625 11.3644 14.0907 8 14.0908C7.311 14.0908 6.80642 14.0414 6.35938 13.918C5.919 13.7963 5.50105 13.5929 5.00098 13.2441C4.26805 12.7329 3.21756 12.5526 2.35156 13.0996L2.33789 13.1084L2.32422 13.1182L1.74805 13.5234L2.18164 14.8184L3.05957 14.2002C3.37505 14.0068 3.84248 14.0319 4.25195 14.3174C4.84447 14.7307 5.39718 15.009 6.01172 15.1787C6.61963 15.3465 7.25579 15.3984 8 15.3984C12.087 15.3983 15.4004 12.0851 15.4004 7.99805C15.4003 3.9111 12.087 0.59776 8 0.597656ZM4.56836 8.50977V9.80371H8.12402V8.50977H4.56836ZM4.56836 7.30078H11.4619V6.00684H4.56836V7.30078Z",
  ],
}

/** @会话超链接 chip：图标 + 标题（对齐 dsh web 的 refChip），点击打开被引用的会话。 */
function sessionMentionChip(label: string, sessionId: string): HTMLElement {
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'session-mention'
  chip.title = `引用会话 ${sessionId}，点击打开`
  chip.appendChild(iconSvg(SESSION_REF_ICON, 14))
  chip.appendChild(el('span', undefined, label))
  chip.addEventListener('click', () => post({ type: 'sessionOpen', sessionId }))
  return chip
}

/** md 块渲染后，把 mention 链接（@[label](dsh-session:...)）换成可点击 chip。 */
function decorateSessionMentions(container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>('a[href^="dsh-session:"]').forEach((a) => {
    const sessionId = decodeSessionReferenceUri(a.getAttribute('href') ?? '')
    if (!sessionId) return // 坏 URI 保持原样
    a.replaceWith(sessionMentionChip(a.textContent ?? sessionId, sessionId))
  })
}

/**
 * md 渲染后给每个代码块加复制按钮 + 行数折叠（对齐 dsh web，阈值见
 * src/pure/codeBlock.ts 的 CODE_BLOCK_MAX_LINES）：超过阈值行时折叠成
 * 「头部 + … 其余 N 行 + 尾部」，点击展开全部、再点收起；展开态记在
 * detailsOpen（key 按消息/块位置，流式重建不冲掉，同 detailsEl 的持久化
 * 机制）。复制用 navigator.clipboard，成功短暂显示「已复制」，失败改 title
 * 提示。
 */
function enhanceCodeBlocks(container: HTMLElement, prefix: string): void {
  container.querySelectorAll<HTMLPreElement>('pre > code').forEach((code, i) => {
    const pre = code.parentElement as HTMLPreElement
    const text = code.textContent ?? ''
    const key = `${prefix}:code:${i}`
    // 代码块内容恰为整段 JSON → 渲染 JsonTree（复用工具输出的树容器：自带右上角
    // 整树复制按钮、展开态持久化在 jsonTreeOpen）。此时不再套 md-code-bar / 「其余 N
    // 行」折叠——树本身用节点展开/收起控制空间，避免同一段 JSON 两个复制按钮。
    const treeValue = tryParseJsonTree(text)
    // JSON 块：不超过行数阈值渲染成树；超过阈值回退到原 code block（本函数下面的
    // 折叠 + code block 复制按钮兜底，避免超大 JSON 树渲染巨量 DOM 行）。
    if (treeValue && !jsonTreeThresholdExceeded(treeValue)) {
      pre.replaceWith(renderJsonTree(treeValue, key))
      return
    }
    const { head, tail, hidden } = codeBlockPreview(text)
    const open = detailsOpen.get(key) ?? false
    const lang = Array.from(code.classList)
      .find((c) => c.startsWith('language-'))
      ?.slice('language-'.length)

    // 头部条：语言标签（有才显示）+ 复制按钮（始终复制全文，不限折叠态）。
    const bar = el('div', 'md-code-bar')
    if (lang) bar.appendChild(el('span', 'md-code-lang', lang))
    const copy = buttonEl('md-code-copy', '复制')
    copy.title = '复制代码'
    copy.addEventListener('click', () => {
      if (!text) return
      void navigator.clipboard.writeText(text).then(
        () => {
          copy.textContent = '已复制'
          copy.title = '已复制'
          setTimeout(() => {
            copy.textContent = '复制'
            copy.title = '复制代码'
          }, 1000)
        },
        () => {
          copy.title = '复制失败'
        },
      )
    })
    bar.appendChild(copy)

    // 折叠/展开按钮：折叠态给「… 其余 N 行」，展开态给「收起」。
    const toggle = (collapsed: boolean, label: string): HTMLButtonElement => {
      const b = buttonEl('md-code-toggle', label)
      b.setAttribute('aria-expanded', String(!collapsed))
      b.setAttribute('aria-label', collapsed ? `展开其余 ${hidden} 行` : '收起内容')
      b.addEventListener('click', () => {
        detailsOpen.set(key, !collapsed)
        render()
      })
      return b
    }

    const wrap = el('div', 'md-code')
    wrap.appendChild(bar)
    if (hidden === 0 || open) {
      wrap.appendChild(mdCodeBody(text))
      if (hidden > 0) wrap.appendChild(toggle(false, '收起'))
    } else {
      wrap.appendChild(mdCodeBody(head.join('\n')))
      wrap.appendChild(toggle(true, `… 其余 ${hidden} 行`))
      wrap.appendChild(mdCodeBody(tail.join('\n')))
    }
    pre.replaceWith(wrap)
  })
}

// 布局骨架：拆分后侧栏会话列表为原生 tree，本 webview（editor WebviewPanel）
// 只渲染聊天列。聊天快照走 render()，会话快照仅留作 @ 补全的数据源（不再渲染面板）。
const chatCol = el('div', 'chat-col')
app.appendChild(chatCol)

// 宿主消息入口：state/sessions 快照、附件/模型目录等回复。state 由
// webviewState.setState 写入（live binding，各域模块实时读取）。
window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'state' && msg.state) {
    setState(msg.state)
    const next = state
    if (next && next.sessionId !== stagedForSession) {
      setPendingImages([])
      setPendingFiles([])
      setModelCatalog(null)
      setCommandNotices([])
      setRecall(null)
      setRecallDraft('')
      earlierAnchor = null
      setStagedForSession(next.sessionId)
    }
    render()
  } else if (msg?.type === 'sessions' && msg.snapshot) {
    // 拆分后侧栏为原生 tree；这里只更新 @ 提及补全的会话数据源。
    setSessionsSnapshot(msg.snapshot)
  } else if (msg?.type === 'commandResult' && typeof msg.text === 'string' && msg.text.trim()) {
    setCommandNotices([...commandNotices, msg.text])
    render()
  } else if (msg?.type === 'imagesPicked' && Array.isArray(msg.images)) {
    setPendingImages([...pendingImages, ...msg.images])
    render()
  } else if (msg?.type === 'filesPicked' && Array.isArray(msg.files)) {
    setPendingFiles([...pendingFiles, ...msg.files])
    render()
  } else if (msg?.type === 'modelCatalog' && msg.catalog) {
    setModelCatalog(msg.catalog)
    const body = modelMenuBody
    if (body) renderModelMenuRoot(body, msg.catalog)
  } else if (msg?.type === 'attachmentData' && typeof msg.attachmentId === 'string') {
    const dataUrl = `data:${msg.mediaType};base64,${msg.data}`
    attachmentCache.set(msg.attachmentId, dataUrl)
    if (pendingPreview === msg.attachmentId) {
      setPendingPreview(null)
      openLightbox(dataUrl)
    }
    // 消息缩略图可能正挂着这张图的占位方块，重渲染换成真图。
    render()
  } else if (msg?.type === 'restoreDraft' && typeof msg.text === 'string') {
    // Texts of queue items drained by stop: back into the composer as drafts.
    const input = document.getElementById('input') as HTMLTextAreaElement | null
    if (input) {
      input.value = input.value.trim() ? `${input.value.trimEnd()}
${msg.text}` : msg.text
      input.dispatchEvent(new Event('input'))
      input.focus()
    } else {
      setStashedDraft(stashedDraft ? `${stashedDraft}
${msg.text}` : msg.text)
    }
  } else if (msg?.type === 'fileRefList') {
    // 乱序/过期响应丢弃；token 没变才存结果并重算弹窗（token 已消失时
    // updateSlashPopup 自己算不出行，弹窗保持关闭）。
    if (Array.isArray(msg.items)) applyFileRefResponse(msg.requestId, msg.items)
  }
})

/**
 * Esc / Ctrl+C 打断当前 turn，等价于点「停止」按钮。优先级最低：
 * 弹层、图片预览（capture 阶段）与斜杠补全、草稿召回、重命名输入
 * （元素自身的 bubble 阶段）都先消费 Esc 并 preventDefault，这里靠
 * defaultPrevented 让路。本处理器挂在 document 的 bubble 阶段，
 * 保证最后执行。Ctrl+C 在有选区（输入框内或页面上）时保持复制语义。
 */
document.addEventListener('keydown', (e) => {
  if (!state?.running) return
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return
    e.preventDefault()
    post({ type: 'stop' })
    return
  }
  if (e.key === 'c' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const active = document.activeElement
    const fieldSelection =
      (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
      active.selectionStart !== null &&
      active.selectionStart !== active.selectionEnd
    const sel = window.getSelection()
    const pageSelection = !!sel && !sel.isCollapsed && sel.toString() !== ''
    if (fieldSelection || pageSelection) return
    post({ type: 'stop' })
  }
})
/** Inline rename: swap the header title for an input; Enter commits, Esc/blur cancels. */
function startInlineRename(header: HTMLElement): void {
  const titleEl = header.querySelector('.chat-title')
  if (!titleEl || !state?.sessionId) return
  const original = state.sessionTitle ?? ''
  const input = document.createElement('input')
  input.className = 'rename-input'
  input.value = original
  titleEl.replaceWith(input)
  input.focus()
  input.select()
  let settled = false
  const cancel = (): void => {
    if (settled) return
    settled = true
    render()
  }
  input.addEventListener('keydown', (e) => {
    // isComposing: Enter confirms an IME candidate, not the rename.
    if (e.key === 'Enter' && !e.isComposing) {
      const title = input.value.trim()
      if (title && title !== original) post({ type: 'renameSession', title })
      cancel()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })
  input.addEventListener('blur', cancel)
}

function render(): void {
  // The turn-status clock interval is owned by the row it updates; the rebuild
  // below discards that row, so drop the timer first and re-arm it later if
  // the turn is still open. Never leave an interval pointing at detached DOM.
  clearTurnStatusTimer()
  // <details> 展开状态按会话隔离：换会话时清空（key 是位置序号，跨会话无意义）。
  // workflow 卡片状态同样按会话隔离（runId 全局唯一但换会话仍清空，防泄漏）。
  const detailsSid = state?.sessionId ?? null
  if (detailsSid !== detailsSession) {
    detailsOpen.clear()
    setDetailsSession(detailsSid)
    workflowDisclosure.clear()
    jsonTreeOpen.clear()
  }
  const oldInput = document.getElementById('input') as HTMLTextAreaElement | null
  const hadFocus = oldInput !== null && document.activeElement === oldInput
  const draft = oldInput?.value
  const inputSel = hadFocus ? { start: oldInput.selectionStart, end: oldInput.selectionEnd } : null
  // The rebuild wipes scroll state; remember it so a user reading history
  // mid-stream is not thrown back to the top. Also re-evaluate pinning from
  // the LIVE position whenever it moved away from where the last render left
  // it: scroll events dispatch asynchronously, so a streaming render running
  // on the stale stickToBottom would yank the view back to the bottom while
  // the user is scrolling up. The diff alone used to decide this, but content
  // growth shifts scrollTop too and got misread as a user scroll — now the
  // re-evaluation only runs while a wheel/touch/keyboard/drag gesture is in
  // flight (see userScrollIntentActive).
  const oldMessages = document.getElementById('messages')
  const prevScrollTop = oldMessages?.scrollTop ?? null
  const prevScrollHeight = oldMessages?.scrollHeight ?? null
  if (
    oldMessages &&
    pinnedScrollTop !== null &&
    userScrollIntentActive() &&
    Math.abs(oldMessages.scrollTop - pinnedScrollTop) > 1
  ) {
    stickToBottom = isAtBottom(oldMessages.scrollHeight, oldMessages.scrollTop, oldMessages.clientHeight)
  }
  // Per-session 滚动记忆：容器里还是 scrollSession 的内容（换会话的 loading
  // 帧也如此），每帧按实时位置刷新增档，切走时读到的就是离开时的位置。
  // 换会话帧再取新会话的存档定恢复目标：无存档默认贴底；prevScrollTop 是
  // 旧会话的位置，跨会话绝不复用（落地分支见 render 尾）。
  if (oldMessages && scrollSession !== null) {
    scrollPositions.set(scrollSession, archiveScrollPosition(oldMessages.scrollTop, stickToBottom))
  }
  const newSid = state?.sessionId ?? null
  const switchingSession = newSid !== scrollSession
  let restoreScrollTop: number | null = null
  if (switchingSession) {
    const target = restoreScrollTarget(newSid !== null ? scrollPositions.get(newSid) : undefined)
    stickToBottom = target.stickToBottom
    restoreScrollTop = target.scrollTop
  }
  // Same for the inline queue editor: it is rebuilt per snapshot, so keep
  // its focus and cursor across re-renders.
  const oldQueueEditor = document.querySelector<HTMLTextAreaElement>('.queue-editor')
  const queueFocus =
    oldQueueEditor && document.activeElement === oldQueueEditor
      ? { start: oldQueueEditor.selectionStart, end: oldQueueEditor.selectionEnd }
      : null
  // Pending 卡（approval/question）保活：与 composer/header 同款策略。流式
  // 快照每帧重建 pending 区，正在输入回答的输入框被销毁重造（draft 文本靠
  // answerDrafts 恢复，但焦点/光标/进行中的 IME 组合全丢——用户明明在打
  // 字却每 100ms 被打断一次）。焦点在卡内且 pending 内容未变时保留原元素。
  const oldPending = chatCol.querySelector<HTMLElement>(':scope > .pending')
  const pendingFocus = oldPending !== null && oldPending.contains(document.activeElement)
  // 签名带 sessionId：换会话时旧会话的 pending 卡必须移除，不能因内容
  // 恰好相同（rpcId 全局唯一，理论不会，但防御起见）被保活成跨会话残留。
  const pendingSig =
    state && state.pending.length > 0 ? JSON.stringify([state.sessionId, state.pending]) : null
  const keepPending =
    oldPending !== null &&
    pendingFocus &&
    pendingSig !== null &&
    pendingSig === lastPendingSig &&
    state?.loading !== true
  // A recalled queue item claimed by the agent (or removed) drops the recall;
  // the text stays in the composer as a plain draft.
  const recallQueueId = recall?.kind === 'queue' ? recall.itemId : null
  if (recallQueueId && state && !(state.queue ?? []).some((q) => q.id === recallQueueId)) {
    setRecall(null)
    setRecallDraft('')
  }
  // Composer preservation: detaching the textarea (even re-appending it one
  // line later) aborts an in-flight IME composition and drops the caret, so
  // while the composer is focused we keep the live element in the DOM unless
  // composer-relevant state actually changed. The stats line is excluded from
  // the signature — it tracks the stream and is patched in place instead.
  const oldComposer = chatCol.querySelector<HTMLElement>('.input-area')
  const oldHero = chatCol.querySelector<HTMLElement>(':scope > .hero')
  const oldHeader = chatCol.querySelector<HTMLElement>('.chat-header')
  // 空会话（无消息、无待办/队列/公告/任务清单）按官方 dsh web 空态居中排版
  // （hero 标题 + workspace/preset chip 行 + 大圆角 composer 卡片）；开跑后
  // 回常规流式布局。有任务清单说明会话已在干活，不走 hero。
  const blankHero =
    state !== null &&
    state.sessionId !== null &&
    state.loading !== true &&
    state.messages.length === 0 &&
    !state.running &&
    state.pending.length === 0 &&
    (state.queue?.length ?? 0) === 0 &&
    (state.jobs?.length ?? 0) === 0 &&
    (state.todos?.length ?? 0) === 0 &&
    commandNotices.length === 0
  const composerSig = JSON.stringify([
    state?.sessionId ?? null,
    state?.canSend ?? false,
    state?.running ?? false,
    state?.permissions ?? null,
    state?.modelLabel ?? null,
    state?.agentPreset ?? null,
    state?.workspaceLabel ?? null,
    recall ? (recall.kind === 'queue' ? `queue:${recall.itemId}` : recall.kind) : null,
    pendingImages.map((i) => i.name ?? ''),
    pendingFiles.map((f) => f.path),
  ])
  // An open popover anchored inside the composer (permission/model menu) or the
  // hero chip row (blank-session preset picker) also pins the layout: rebuilding
  // would destroy the anchor and kill the menu mid-stream.
  const popoverInComposer =
    getPopover() !== null &&
    getPopoverAnchor() !== null &&
    ((oldComposer?.contains(getPopoverAnchor() ?? undefined as never) ?? false) || (oldHero?.contains(getPopoverAnchor() ?? undefined as never) ?? false))
  // 两种布局下 composer 的挂载位置不同（hero 内 / chatCol 直接子级），保留
  // 策略只在布局不变时生效，避免把已随旧布局拆除的 composer 当成存活锚点。
  const keepComposer =
    oldComposer !== null &&
    (hadFocus || popoverInComposer) &&
    stashedDraft === undefined &&
    composerSig === lastComposerSig &&
    (oldHero !== null && oldHero.contains(oldComposer)) === blankHero
  // A rebuilt composer gets fresh listeners; the popup re-opens below when the
  // draft still starts with '/'. With a kept composer it only re-anchors.
  if (!keepComposer) hideSlashPopup()
  // The scroller element also persists (whenever a session is on screen):
  // replacing it mid-gesture breaks a native scrollbar drag in flight, so
  // only its children are rebuilt below. (Scrollbar drags dispatch no
  // pointer events to the page, so there is no way to defer renders instead.)
  const keepMessages = oldMessages !== null && !!state?.sessionId && !blankHero
  // Header preservation（与 composer 同款 keep 模式）：子代理/后台任务 chip 是
  // popover 锚点，流式快照每帧重建 header 会把锚点 remove 掉，保活逻辑随即
  // closePopover——弹层刚开就被下一帧杀掉。header 相关状态实质没变时保留
  // 原元素，锚点稳定、弹层存活。耗时/相对时间等渲染期派生值不进签名。
  const headerSig = JSON.stringify([
    state?.sessionId ?? null,
    state?.sessionTitle ?? null,
    state?.parentSession ?? null,
    state?.presetLabel ?? null,
    state?.presetDescription ?? null,
    state?.subagents ?? null,
    state?.backgroundJobs ?? null,
  ])
  // 改名中的 header 不保留：标题 span 已被输入框就地替换，保留会让输入框
  // 在 commit/cancel 后的 render 里残留（重建才会还原成标题）。
  const keepHeader =
    oldHeader !== null &&
    !!state?.sessionId &&
    state.loading !== true &&
    !blankHero &&
    headerSig === lastHeaderSig &&
    oldHeader.querySelector('.rename-input') === null
  for (const child of Array.from(chatCol.children)) {
    if (keepMessages && child === oldMessages) continue
    if (keepHeader && child === oldHeader) continue
    if (keepComposer && (child === oldComposer || (blankHero && child === oldHero))) continue
    if (keepPending && child === oldPending) continue
    child.remove()
  }
  // Menus anchored to surviving elements (kept composer, sessions header)
  // stay open across snapshot renders — re-anchor in case the layout shifted
  // under them; only close when the rebuild above actually removed the anchor.
  // popoverAnchor === null：坐标定位菜单（会话右键），没有锚点，保持原样。
  if (getPopover()) {
    if (getPopoverAnchor() === null) {
      // 坐标定位：不关闭、不 reposition。
    } else if (getPopoverAnchor()?.isConnected) positionPopover()
    else closePopover()
  }
  if (!state || !state.sessionId) {
    lastComposerSig = null
    lastHeaderSig = null
    lastPendingSig = null
    setTurnStatusStart(null)
    scrollSession = null
    chatCol.appendChild(renderEmpty(state))
    return
  }
  // 历史基线加载中：只显示加载占位，hero 和消息流都等基线落地再渲染——
  // 否则切换会话时会先闪一帧空会话 hero（服务未就绪）再跳成消息流。
  if (state.loading === true) {
    setTurnStatusStart(null)
    chatCol.appendChild(el('div', 'muted-hint loading-hint', '加载会话…'))
    return
  }
  if (blankHero) {
    setTurnStatusStart(null)
    scrollSession = null
    if (keepComposer && oldHero && oldComposer) {
      // 整个 hero（含 composer）保持不动：焦点、光标、进行中的 IME 组合都
      // 不中断；只有跟踪数据流的 stats 行就地修补。
      patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
      if (isSlashPopupOpen() && oldInput) reanchorSlashPopup(oldInput)
    } else {
      chatCol.appendChild(renderHero(state, draft))
      const input = document.getElementById('input') as HTMLTextAreaElement
      autoGrow(input)
      if (hadFocus) {
        input.focus()
        // A rebuilt composer at least keeps the caret where it was.
        if (inputSel) input.setSelectionRange(inputSel.start, inputSel.end)
      }
      // 重建后恢复补全弹窗（含 @ 会话补全；无候选时 updateSlashPopup 自行隐藏）
      updateSlashPopup(input)
    }
    lastComposerSig = composerSig
    lastHeaderSig = headerSig
    lastPendingSig = pendingSig
    return
  }
  // Regions above the composer; insert before the preserved composer when kept.
  const anchor = keepComposer ? oldComposer : null
  const add = (node: HTMLElement): void => {
    if (anchor) chatCol.insertBefore(node, anchor)
    else chatCol.appendChild(node)
  }
  const jobsLabel = state.backgroundJobs ? jobsChipLabel(state.backgroundJobs) : null
  const headerWanted = !!(
    state.sessionTitle ||
    state.parentSession ||
    state.presetLabel ||
    (state.subagents?.length ?? 0) > 0 ||
    jobsLabel
  )
  // keepHeader 时旧 header 原位存活且内容实质未变：跳过重建，chip 锚点不断。
  if (headerWanted && !(keepHeader && oldHeader)) {
    const header = el('div', 'chat-header')
    // 面包屑（对齐官方 dsh web 的子代理进入逻辑）：附着子代理会话时标题区
    // 是「父会话标题 / 子会话标题」，点父会话标题回到父会话内容。
    if (state.parentSession) {
      const parentRef = state.parentSession
      const parent = buttonEl('crumb-parent', parentRef.title)
      parent.title = parentRef.title
      parent.addEventListener('click', () => post({ type: 'sessionOpen', sessionId: parentRef.sessionId }))
      header.appendChild(parent)
      header.appendChild(el('span', 'crumb-sep', '/'))
    }
    // 标题 ellipsis 截断但 hover 出完整标题（原生 title tooltip）；
    // 单击标题直接进改名（本地增强，官方无此交互）。面包屑里附着的是
    // 子代理会话时，当前标题用小号字（官方 .crumbSubagent：12px/18px，
    // 与「N 个子代理」chip 同字号），不与父会话标题同级。
    const titleSpan = el('span', state.parentSession ? 'chat-title crumb-subagent' : 'chat-title', state.sessionTitle ?? '')
    if (state.sessionTitle) {
      titleSpan.title = state.sessionTitle
      titleSpan.addEventListener('click', () => startInlineRename(header))
    }
    header.appendChild(titleSpan)
    // 「N 个子代理」chip（对齐官方 SubagentHeader trigger：透明底小字 + chevron）：
    // 点击弹下拉，行点击附着子会话。chip 在有运行中子代理时带像素环。
    if (state.subagents && state.subagents.length > 0) {
      // 面包屑斜杠：官方在会话标题与子代理段之间用「/」分隔。
      if (state.sessionTitle) header.appendChild(el('span', 'crumb-sep', '/'))
      const chip = buttonEl('header-chip', '')
      // 像素环：任意血缘后代（含孙一辈）在跑就点亮——父代理挂载等子代理时
      // 自身 idle，但整组仍在活动。chip 文字计数仍只算直接子代理（顶层项数）。
      if (state.subagents.some((sub) => sub.running || subagentLineageRunning(sub))) {
        chip.appendChild(spinSvg())
      }
      chip.appendChild(el('span', undefined, `${state.subagents.length} 个子代理`))
      chip.appendChild(iconSvg(PANEL_ICONS.chevronDown, 14))
      chip.title = '子代理'
      chip.addEventListener('click', () => openSubagentMenu(chip))
      header.appendChild(chip)
    }
    // 「N 个后台任务运行中」chip（对齐官方 JobListAction）：有运行中 job
    // 时 chip 带像素环；点击弹下拉（状态点 + kind 徽标 + 摘要 + 状态/耗时）。
    if (state.backgroundJobs && jobsLabel) {
      const chip = buttonEl('header-chip', '')
      if (state.backgroundJobs.some(isLiveJob)) chip.appendChild(spinSvg())
      chip.appendChild(el('span', undefined, jobsLabel))
      chip.appendChild(iconSvg(PANEL_ICONS.chevronDown, 14))
      chip.title = '后台任务'
      chip.addEventListener('click', () => openJobsMenu(chip))
      header.appendChild(chip)
    }
    // 只读 preset 标签（对齐官方 AgentPresetLabel：浅底胶囊 + 14px 三环图标；
    // 空会话的选择 chip 在 hero，二者互斥）。悬停 tooltip 显示 roster 描述。
    if (state.presetLabel) {
      const chip = el('span', 'preset-chip')
      chip.appendChild(presetIconSvg())
      chip.appendChild(el('span', undefined, state.presetLabel))
      if (state.presetDescription) chip.title = state.presetDescription
      header.appendChild(chip)
    }
    const headerAnchor = keepMessages ? oldMessages : anchor
    if (headerAnchor) chatCol.insertBefore(header, headerAnchor)
    else chatCol.appendChild(header)
  }

  const messages = oldMessages ?? el('div', 'messages')
  if (!oldMessages) {
    messages.id = 'messages'
    // Only gesture-driven scrolls re-evaluate pinning bidirectionally;
    // programmatic moves (our own pins, restore of saved/prev scrollTop,
    // content-growth clamping during the rebuild) leave stickToBottom alone
    // unless the view actually landed at the bottom: a content shrink or a
    // restore clamped to the new bottom makes the view at-bottom while the
    // follow state was still false — correct that one direction (fixes a
    // stale "回到最新" floater), but never set false on a programmatic scroll.
    messages.addEventListener('scroll', () => {
      // 任何 scroll（含回归动画的 scroll 事件流）都算滚动活动：更新 idle 时间戳并
      // 重排 debounce——动画期间 debounce 被反复推迟，真正停滚动才可能 settle 补 pin。
      noteScrollActivity()
      stickToBottom = reconcileScrollPinning(
        stickToBottom,
        userScrollIntentActive(),
        isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight),
      )
      const jump = messages.querySelector<HTMLElement>('.jump-latest')
      if (jump) jump.style.display = stickToBottom ? 'none' : ''
      // 上翻到顶部附近时按需加载更早一页（按钮之外的第二触发路径）。
      if (messages.scrollTop < 80) maybeLoadEarlier()
    })
    messages.addEventListener('wheel', onScrollGesture, { passive: true })
    messages.addEventListener('touchmove', onScrollGesture, { passive: true })
    messages.addEventListener('keydown', (e) => {
      if (isScrollKey(e.key)) onScrollGesture()
    })
    messages.addEventListener('pointerdown', () => {
      scrollPointerDown = true
      noteScrollActivity()
    })
    // Async height growth (markdown/attachment images finishing loading,
    // <details> toggling) changes scrollHeight without a scroll event, so the
    // view would silently drift off the tail. Neither event bubbles — listen
    // in the capture phase and re-pin while following.
    const repinIfFollowing = (): void => {
      // 图片 load / details toggle 引发的异步高度增长：走「滚动空闲」判定。回归动画期间
      // 不得直接写（加载事件本身不代表滚动已停），交给 maybeSettlePin——仅在滚动真正
      // 停、无意图、仍跟随、已脱底时才补 pin（幂等：已贴底/非跟随/意图内都不写）。
      maybeSettlePin()
    }
    messages.addEventListener(
      'load',
      (e) => {
        if (e.target instanceof HTMLImageElement) repinIfFollowing()
      },
      true,
    )
    messages.addEventListener(
      'toggle',
      (e) => {
        if (e.target instanceof HTMLDetailsElement) repinIfFollowing()
      },
      true,
    )
  }
  // 插话（steering）和排队分开展示，对齐官方 dsh web：等待插话的消息直接
  // 进对话流末尾（用户气泡 + 「等待插话」标记），排队消息留在输入框上方。
  // 混在一个队列区里时，先插话再排队的快照顺序会让两条消息看起来颠倒。
  const steeringItems = (state.queue ?? []).filter((item) => item.placement === 'steering')
  const queuedItems = (state.queue ?? []).filter((item) => item.placement === 'queued')
  messages.textContent = ''
  // 「加载更早」入口（对齐官方 dsh web ChatView 的分页按钮）：还有更早历史
  // 或一页正在加载时显示在消息流顶部。
  if (state.hasEarlierHistory || state.loadingEarlier === true) {
    const olderWrap = el('div', 'older')
    const btn = buttonEl(undefined, state.loadingEarlier === true ? '加载中…' : '加载更早')
    btn.disabled = state.loadingEarlier === true
    btn.addEventListener('click', maybeLoadEarlier)
    olderWrap.appendChild(btn)
    messages.appendChild(olderWrap)
  }
  appendMessageFlow(messages, state)
  for (const notice of commandNotices) messages.appendChild(el('div', 'command-notice', notice))
  if (state.messages.length === 0 && steeringItems.length === 0) {
    messages.appendChild(el('div', 'muted-hint', '会话还没有消息，在下方输入开始。'))
  }
  // Turn-status row: last item of the conversation flow while a turn is open
  // (official-client parity), gone the moment the turn ends.
  if (state.running) {
    messages.appendChild(renderTurnStatus())
  } else {
    setTurnStatusStart(null)
  }
  // Pending steering bubbles sit at the tail of the transcript, after the
  // turn status — the spot their durable user message lands once claimed
  // (official PendingSteeringBubble). Snapshot order = send order.
  for (const item of steeringItems) messages.appendChild(renderSteeringItem(item))
  // "Back to latest" floater: sticky at the scroller's bottom while the user
  // reads history; hidden while pinned to the tail.
  const jump = buttonEl('jump-latest', '↓ 回到最新')
  jump.style.display = stickToBottom ? 'none' : ''
  jump.addEventListener('click', () => {
    stickToBottom = true
    messages.scrollTop = messages.scrollHeight
    jump.style.display = 'none'
  })
  messages.appendChild(jump)
  if (!keepMessages) add(messages)

  if (state.pending.length > 0 && !keepPending) {
    const pending = el('div', 'pending')
    for (const p of state.pending) {
      pending.appendChild(p.kind === 'approval' ? renderApproval(p) : renderQuestion(p))
    }
    add(pending)
  }

  // 任务清单卡（对齐官方 input.dock id=todo order 0，排在排队消息之前）：
  // 缺省/null（首写前 / turn/start 后）与 [] 空数组都不渲染。
  if (state.todos && state.todos.length > 0) {
    add(renderTodoPanel(state.todos))
  }

  if (queuedItems.length > 0) {
    if (editingQueueItem && !queuedItems.some((item) => item.id === editingQueueItem)) setEditingQueueItem(null)
    const queue = el('div', 'queue')
    // 多条排队折叠成计数 header（对齐 dsh web QueueDock：>1 条才出现折叠 header）：
    // 编辑/插话/删除等操作入口随列表一起藏进展开态；单条保持一行内联。
    if (queuedItems.length === 1) {
      queue.appendChild(renderQueueItem(queuedItems[0]))
    } else {
      const det = detailsEl('queue', 'queue-dock', '')
      // 编辑态（编辑器在列表里）必须展开，否则保存/取消入口被折叠藏掉。
      if (editingQueueItem !== null) det.open = true
      const summary = det.querySelector('summary') as HTMLElement
      const chev = iconSvg(PANEL_ICONS.chevronUp, 14)
      chev.classList.add('queue-chevron')
      summary.appendChild(chev)
      summary.appendChild(el('span', 'queue-dock-count', `${queuedItems.length} 条排队消息`))
      const list = el('div', 'queue-dock-list')
      for (const item of queuedItems) list.appendChild(renderQueueItem(item))
      det.appendChild(list)
      queue.appendChild(det)
    }
    add(queue)
  } else {
    setEditingQueueItem(null)
  }

  // Live-jobs 内联横条已移除（对齐官方 dsh web：只留头部「N 个后台任务」chip）：
  // 任务信息由 state.backgroundJobs → 头部 chip / openJobsMenu 菜单承担。
  // state.jobs 仍被上方 blankHero 空态判断消费，链路保留。

  if (keepComposer && oldComposer) {
    // The composer element was never detached, so focus, caret, and any
    // in-flight IME composition survive; only patch the stats line in place.
    patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
  } else {
    chatCol.appendChild(renderInput(draft))
  }
  lastComposerSig = composerSig
  lastHeaderSig = headerSig
  lastPendingSig = pendingSig
  // 「加载更早」的锚定配对：先记下 loadingEarlier 曾为 true（请求确实被
  // 接受），它翻回 false 的这一帧若消息从顶部插入（首条变了或条数多了），
  // 按新增高度补偿 scrollTop；无论是否插入都解除锚点（空页/失败同样落地）。
  const earlier = earlierAnchor
  if (earlier !== null && state.loadingEarlier === true) earlier.seenLoading = true
  const landed = earlier !== null && earlier.seenLoading && state.loadingEarlier !== true ? earlier : null
  const prepended =
    landed !== null && (state.messages.length > landed.count || state.messages[0]?.id !== landed.firstId)
  // 恢复/补偿路径（换会话恢复历史位置、加载更早、非贴底跳转）同步写：它们是
  // 用户明确动作，不涉及「抢原生惯性动画」，也无需等布局 settle。
  if (restoreScrollTop !== null) messages.scrollTop = restoreScrollTop
  else if (!switchingSession && prevScrollTop !== null && prepended && prevScrollHeight !== null) {
    messages.scrollTop = prevScrollTop + (messages.scrollHeight - prevScrollHeight)
  } else if (!switchingSession && prevScrollTop !== null) messages.scrollTop = prevScrollTop
  if (landed !== null) earlierAnchor = null
  // Read back the clamped value: this is the position the next render compares
  // against to tell user scrolls apart from content growth. 若恢复的 scrollTop
  // 被浏览器 clamp 到新的底部（切走期间内容收缩/变短到不足一屏），实际
  // 视口已贴底但跟随态可能仍残留 false——按 clamp 结果单向同步一次，修
  // 「切回后贴底仍显示回到最新」。贴底跟随路径的真实 scrollTop 由下方
  // microtask 写回后覆盖，这里先给个占位值避免依赖上一次渲染的脏值。
  const clampedScrollTop = messages.scrollTop
  pinnedScrollTop = clampedScrollTop
  if (isAtBottom(messages.scrollHeight, clampedScrollTop, messages.clientHeight)) stickToBottom = true
  jump.style.display = stickToBottom ? 'none' : ''
  // 贴底跟随滚底：同步段不写 scrollTop。栈内（textContent='' + 重追加后）读
  // 到的 scrollHeight 是瞬态值（布局批量，尚未 settle 到真实高度），按它写会
  // clamp 到瞬态 max，下一帧 settle 后视口悬空（单帧抖动，与 hermes-webui
  // PR #5685 同构）。改 microtask 在同步栈 unwind、paint 前读 settle 后的
  // 真实高度再写；写时机用「滚动空闲」判定（shouldSettlePinNow）：无滚动活动时
  // 保留 pre-paint 立即写（普通流式无交互，不能丢 pre-paint 语义）；最近
  // SETTLE_IDLE_MS 内有滚动/回归动画则跳过——动画期间写会打断回归（不抢惯性），
  // 交给滚动活动自己排的 idle debounce 在动画真正结束后补 pin。
  if (stickToBottom) {
    queueMicrotask(() => {
      const m = document.getElementById('messages')
      if (!m) return
      if (!shouldSettlePinNow(stickToBottom, userScrollIntentActive(), isAtBottom(m.scrollHeight, m.scrollTop, m.clientHeight), scrollActiveRecently())) return
      m.scrollTop = m.scrollHeight
      // 写回程序滚动锁：下一帧 render 头部拿它跟实时位置对比以区分用户滚动，
      // pin 得靠它避免自己被误判为用户滚离。
      pinnedScrollTop = m.scrollTop
    })
  }
  // 内容已按新会话重建落地，容器归属切换到新会话（loading 帧不动它，
  // 因为容器里还是旧会话内容）。
  scrollSession = newSid
  const queueEditor = document.querySelector<HTMLTextAreaElement>('.queue-editor')
  if (queueEditor && queueFocus) {
    queueEditor.focus()
    queueEditor.setSelectionRange(queueFocus.start, queueFocus.end)
  }
  if (!keepComposer) {
    const input = document.getElementById('input') as HTMLTextAreaElement
    autoGrow(input)
    if (hadFocus) {
      input.focus()
      // A rebuilt composer at least keeps the caret where it was.
      if (inputSel) input.setSelectionRange(inputSel.start, inputSel.end)
    }
    // 同上：重建后恢复补全弹窗（含 @ 会话补全）
    updateSlashPopup(input)
  } else if (isSlashPopupOpen() && oldInput) {
    reanchorSlashPopup(oldInput)
  }
}

/**
 * 空会话 hero（官方 dsh web 空态 HeroShell）：整列水平居中——品牌鱼标，
 * 标题「探索未至之境」+「预览版」徽章，其下 workspace 名（只读）与 preset
 * 选择 chip 行，再下是包成大圆角卡片的 composer（样式见 chatView.ts 的 .hero）。
 */
function renderHero(state: ChatState, draft: string | undefined): HTMLElement {
  const hero = el('div', 'hero')
  const stack = el('div', 'hero-stack')
  // 品牌鱼标（官方 FishLogo SVG path，见 icons.ts 的 FISH_LOGO）+ 轻量
  // 游动动画（纯 CSS transform，样式见 chatView.ts 的 .hero-fish）。
  stack.appendChild(fishLogoSvg(56, 'hero-fish'))
  const headline = el('div', 'hero-headline')
  headline.appendChild(el('span', 'hero-headline-text', '探索未至之境'))
  headline.appendChild(el('span', 'hero-badge', '预览版'))
  stack.appendChild(headline)
  const chips = el('div', 'hero-chips')
  if (state.workspaceLabel) {
    // 官方此 chip 是 workspace 选择器；我们没有更换 blank 会话所属 workspace
    // 的链路，只做只读展示（文件夹图标 + 名称，无 chevron）。
    const ws = el('span', 'hero-chip')
    ws.appendChild(iconSvg(PANEL_ICONS.folder, 16))
    ws.appendChild(el('span', 'label', state.workspaceLabel))
    chips.appendChild(ws)
  }
  if (state.agentPreset) {
    // 从 composer 底部挪到 hero 的 preset 选择 chip（交互不变，仍弹下拉）。
    const ap = state.agentPreset
    const current = ap.options.find((o) => o.id === ap.current)
    const preset = buttonEl('hero-chip', '')
    preset.appendChild(presetIconSvg())
    preset.appendChild(el('span', 'label', current?.label ?? ap.current))
    const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
    chev.classList.add('chevron')
    preset.appendChild(chev)
    preset.title = current?.description ?? 'Agent 模式'
    preset.disabled = !state.canSend
    preset.addEventListener('click', () => openAgentPresetMenu(preset, 'below'))
    chips.appendChild(preset)
  }
  if (chips.hasChildNodes()) stack.appendChild(chips)
  stack.appendChild(renderInput(draft, true))
  hero.appendChild(stack)
  return hero
}

function renderEmpty(state: ChatState | null): HTMLElement {
  const wrap = el('div', 'empty')
  if (state?.serverError === 'dshNotFound') {
    wrap.appendChild(el('div', 'empty-title', '未检测到 dsh 安装'))
    wrap.appendChild(
      el('div', 'empty-hint', 'DSH One 需要本机安装 dsh 才能使用。安装完成后回到这里即可自动启动。'),
    )
    const btn = buttonEl(undefined, '查看安装指南')
    btn.addEventListener('click', () => post({ type: 'openInstallPage' }))
    wrap.appendChild(btn)
    return wrap
  }
  wrap.appendChild(el('div', 'empty-title', 'dsh 聊天'))
  wrap.appendChild(
    el('div', 'empty-hint', '在会话列表中点击一个会话开始聊天。若列表为空，请先启动 dsh 服务。'),
  )
  return wrap
}

function contextLabel(kind: string): string {
  if (kind === 'agent-instructions' || kind === 'legacy-instructions') return '工作区指令'
  if (kind === 'plugin') return '运行时上下文'
  if (kind === 'session-reference') return '跨会话召回'
  return '上下文注入'
}

/** One queued inbox row: tag + preview, plus steer/edit/remove actions. */
function renderQueueItem(item: QueuedItem): HTMLElement {
  const row = el('div', 'queue-item')
  row.appendChild(el('span', 'queue-tag', '排队中'))

  if (editingQueueItem === item.id) {
    const editor = document.createElement('textarea')
    editor.className = 'queue-editor'
    editor.value = queueEditDrafts.get(item.id) ?? item.editText
    editor.rows = Math.min(6, Math.max(1, item.editText.split('\n').length))
    editor.addEventListener('input', () => queueEditDrafts.set(item.id, editor.value))
    editor.addEventListener('keydown', (e) => {
      // isComposing: don't save while an IME candidate window is open.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        save.click()
      } else if (e.key === 'Escape') {
        cancel.click()
      }
    })
    row.appendChild(editor)
    const actions = el('div', 'queue-actions')
    const save = buttonEl('', '保存')
    save.addEventListener('click', () => {
      const text = queueEditDrafts.get(item.id) ?? editor.value
      setEditingQueueItem(null)
      queueEditDrafts.delete(item.id)
      post({ type: 'queueEdit', itemId: item.id, text })
    })
    const cancel = buttonEl('secondary', '取消')
    cancel.addEventListener('click', () => {
      setEditingQueueItem(null)
      queueEditDrafts.delete(item.id)
      render()
    })
    actions.appendChild(save)
    actions.appendChild(cancel)
    row.appendChild(actions)
    return row
  }

  row.appendChild(el('span', 'queue-text', item.text || '（空消息）'))
  const actions = el('div', 'queue-actions')
  const steer = buttonEl('link', '插话')
  steer.title = '立即打断当前轮，用这条消息插话'
  steer.addEventListener('click', () => post({ type: 'queueSteer', itemId: item.id }))
  const edit = buttonEl('link', '编辑')
  edit.addEventListener('click', () => {
    setEditingQueueItem(item.id)
    render()
  })
  const remove = buttonEl('link', '删除')
  remove.addEventListener('click', () => post({ type: 'queueRemove', itemId: item.id }))
  actions.appendChild(steer)
  actions.appendChild(edit)
  actions.appendChild(remove)
  row.appendChild(actions)
  return row
}

/**
 * 等待插话的 steering 消息：渲染成对话流末尾的用户气泡（官方
 * PendingSteeringBubble 的视觉语言），插话落地后原位变成正式用户消息。
 */
function renderSteeringItem(item: QueuedItem): HTMLElement {
  const row = el('div', 'msg user steering-pending')
  row.appendChild(el('div', 'bubble', item.text || '（空消息）'))
  row.appendChild(el('span', 'queue-tag', '等待插话'))
  return row
}

/**
 * 消息里的图片：和待发送图片同款的方形小缩略图（复用 attach-thumb，点击
 * 放大）。字节走 session.attachment 懒取——渲染时未缓存就发
 * requestAttachment 并先画占位方块，attachmentData 到达后 render() 换成
 * 真图；加载失败回退为文件名 chip（保留点击预览）。
 */
function messageImageThumb(image: ChatImage): HTMLElement {
  const name = image.name ?? '图片'
  const dataUrl = attachmentCache.get(image.attachmentId)
  if (!dataUrl) {
    if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
    const ph = el('span', 'attach-thumb msg-thumb-loading', '…')
    ph.title = `${name}（加载中…）`
    return ph
  }
  const item = el('span', 'attach-thumb')
  item.title = `${name}（点击预览）`
  const img = document.createElement('img')
  img.src = dataUrl
  img.alt = name
  img.addEventListener('error', () => item.replaceWith(imageChip(image)))
  item.addEventListener('click', () => openLightbox(dataUrl))
  item.appendChild(img)
  return item
}

/** Compact chip for one attached image; click fetches bytes (once) and previews. */
function imageChip(image: ChatImage): HTMLElement {
  const chip = el('span', 'image-chip msg-image-chip')
  chip.appendChild(el('span', 'chip-name', image.name ?? '图片'))
  chip.title = '点击预览'
  chip.addEventListener('click', () => {
    const dataUrl = attachmentCache.get(image.attachmentId)
    if (dataUrl) {
      openLightbox(dataUrl)
      return
    }
    setPendingPreview(image.attachmentId)
    if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
  })
  return chip
}

/** Compact chip for one attached file; the path is the payload, no preview. */
function fileChip(file: ChatFile): HTMLElement {
  const chip = el('span', 'image-chip')
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  return chip
}

/** Full-screen preview overlay for one image; click or Escape closes. */
function openLightbox(dataUrl: string): void {
  const overlay = el('div', 'lightbox')
  const img = document.createElement('img')
  img.src = dataUrl
  overlay.appendChild(img)
  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey, true)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // 同弹层：消费掉 Esc，全局「Esc 打断 turn」按 defaultPrevented 让路。
      e.preventDefault()
      close()
    }
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(overlay)
}

/**
 * Expanded state of <details> blocks, keyed by message/block position so
 * streaming snapshot rebuilds don't collapse what the user opened.
 * Cleared on session switch (keys are positional, only valid per session).
 */

/**
 * JSON tree node expand state. Key = `${outputKey}:${jsonPathKey}` (the output
 * key disambiguates colliding path spaces across tool blocks). Absent = the
 * default (root open, nested closed); present = the user's toggle. Cleared with
 * the other per-session disclosure state on session switch.
 */

/**
 * workflow 运行卡片的展开/折叠状态，按 runId（run 级）/ `${runId}:${phase.key}`
 * （phase 级）持久化——runId 跨分页稳定，loadEarlier 补页不会错位；与 detailsOpen
 * 一样在换会话时清空。
 */

/** <details> whose open state persists across re-renders under `key`. */
function detailsEl(key: string, className: string, summaryText: string): HTMLDetailsElement {
  const det = el('details', className) as HTMLDetailsElement
  det.open = detailsOpen.get(key) ?? false
  det.addEventListener('toggle', () => detailsOpen.set(key, det.open))
  det.appendChild(el('summary', '', summaryText))
  return det
}

/* ---------------- 任务清单卡（输入区上方，对齐官方 TodoPanel/TodoDock） ---------------- */

/**
 * 头部进度摘要（照搬 web 端 progressLabel）：按状态各计一条，计数为 0 的段
 * 省略，非零段以「 · 」连接 →「3 进行中 · 1 待处理」。列表非空时至少一段。
 */
function todoProgressLabel(todos: ChatTodoItem[]): string {
  const done = todos.filter((t) => t.status === 'completed').length
  const active = todos.filter((t) => t.status === 'in_progress').length
  const pending = todos.length - done - active
  return [
    done > 0 ? `${done} 已完成` : '',
    active > 0 ? `${active} 进行中` : '',
    pending > 0 ? `${pending} 待处理` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 任务清单可折叠卡：默认折叠，头部「任务 + 进度摘要 + chevron」，展开列出
 * todo 项。chevron 方向照搬 figma 字面（折叠=向上、展开=向下，用 CSS rotate
 * 翻转，别"修正"）；展开态持久化在 detailsOpen（key 'todos'，换会话时清空）。
 */
function renderTodoPanel(todos: ChatTodoItem[]): HTMLElement {
  const det = el('details', 'todo-panel') as HTMLDetailsElement
  det.open = detailsOpen.get('todos') ?? false
  det.addEventListener('toggle', () => detailsOpen.set('todos', det.open))
  const summary = el('summary')
  summary.appendChild(el('span', 'todo-panel-title', '任务'))
  const progress = todoProgressLabel(todos)
  summary.appendChild(el('span', 'todo-panel-progress', progress))
  const chev = iconSvg(PANEL_ICONS.chevronUp, 14)
  chev.classList.add('todo-chevron')
  summary.appendChild(chev)
  det.appendChild(summary)
  const list = el('ul', 'todo-list')
  for (const item of todos) list.appendChild(renderTodoItem(item))
  det.appendChild(list)
  return det
}

function renderTodoItem(item: ChatTodoItem): HTMLElement {
  const li = el('li', 'todo-item')
  li.setAttribute('data-status', item.status)
  li.appendChild(todoStatusGlyph(item.status))
  li.appendChild(el('span', 'todo-content', item.content))
  return li
}

/** 14×14 状态字形（对齐 web StatusGlyph）：completed 对勾环 / in_progress
 *  转圈弧环 / pending 虚线未开始环。颜色由 CSS 类取（.todo-glyph-*）。 */
function todoStatusGlyph(status: ChatTodoItem['status']): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 14 14')
  svg.setAttribute('fill', 'none')
  const ring = document.createElementNS(NS, 'circle')
  ring.setAttribute('cx', '7')
  ring.setAttribute('cy', '7')
  ring.setAttribute('r', '5.2')
  ring.setAttribute('stroke', 'currentColor')
  svg.appendChild(ring)
  if (status === 'completed') {
    svg.classList.add('todo-glyph-completed')
    const check = document.createElementNS(NS, 'path')
    check.setAttribute('d', 'M4.2 7.3l1.9 1.9 3.7-4')
    check.setAttribute('stroke', 'currentColor')
    check.setAttribute('stroke-width', '1.5')
    check.setAttribute('stroke-linecap', 'round')
    check.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(check)
  } else if (status === 'in_progress') {
    // 一段可见弧 + CSS 旋转（对齐 web 的 todo-progress-spin）。
    svg.classList.add('todo-glyph-progress', 'todo-progress-spin')
    ring.setAttribute('stroke-dasharray', '9 24')
    ring.setAttribute('stroke-linecap', 'round')
  } else {
    svg.classList.add('todo-glyph-pending')
    ring.setAttribute('stroke-dasharray', '2.4 2.4')
  }
  return svg
}

/**
 * Turn-status row, mirroring the official web client's TurnStatus: while a
 * turn is open, a shimmering "Deep diving..." sits at the tail of the message
 * flow; from 15s on, an elapsed clock ticks to its right. The clock's
 * interval rewrites only its own text node, so it never forces a list
 * re-render (which would disturb scroll/collapse state). The start timestamp
 * survives snapshot re-renders for the whole open turn; it is reset when
 * running flips back to false.
 */

/** Drop the clock interval; every render calls this before rebuilding. */
function clearTurnStatusTimer(): void {
  if (turnStatusTimer !== null) {
    clearInterval(turnStatusTimer)
    setTurnStatusTimer(null)
  }
}

function renderTurnStatus(): HTMLElement {
  if (turnStatusStart === null) setTurnStatusStart(Date.now())
  const start = turnStatusStart ?? Date.now()
  const row = el('div', 'turn-status')
  row.setAttribute('role', 'status')
  row.setAttribute('aria-live', 'polite')
  row.appendChild(el('span', 'turn-status-text', 'Deep diving...'))
  const clock = el('span', 'turn-status-clock')
  const tick = (): void => {
    const elapsed = Date.now() - start
    clock.textContent = elapsed >= 15000 ? formatDuration(elapsed) : ''
  }
  tick()
  row.appendChild(clock)
  setTurnStatusTimer(setInterval(tick, 1000))
  return row
}

function renderMessage(m: ChatMessage, key: string): HTMLElement {
  if (m.kind === 'user') {
    // Host-injected context renders collapsed; only real human input bubbles.
    if (m.context) {
      // 会话引用上下文用 dsh web 的 ReferenceIcon session 分支，其余用 IconBrowseOutline16。
      const det = el('details', 'msg context') as HTMLDetailsElement
      det.open = detailsOpen.get(`${key}:ctx`) ?? false
      det.addEventListener('toggle', () => detailsOpen.set(`${key}:ctx`, det.open))
      const summary = el('summary')
      summary.appendChild(m.context === 'session-reference' ? iconSvg(SESSION_REF_ICON, 14) : iconSvg(CONTEXT_BROWSE_ICON, 14))
      summary.appendChild(el('span', undefined, ` ${contextLabel(m.context)}（已随消息注入）`))
      det.appendChild(summary)
      det.appendChild(el('div', 'context-body', m.text))
      return det
    }
    const row = el('div', 'msg user')
    // 附件在文字气泡上方（对齐 dsh web）：图片显示方形缩略图，文件仍是名称 chip。
    const attachments = el('div', 'msg-images')
    if (m.images) for (const image of m.images) attachments.appendChild(messageImageThumb(image))
    if (m.files) for (const file of m.files) attachments.appendChild(fileChip(file))
    if (attachments.childElementCount > 0) row.appendChild(attachments)
    if (m.text) {
      // 气泡是纯文本（不走 markdown），mention 按段拼成可点击链接。host
      // 解析过的引用落盘为可读 @label 文本，URI 由 fold 回挂在 m.references
      // 里，优先用它切；未解析的原始 mention（如引用失败残留）走 URI 匹配。
      const bubble = el('div', 'bubble')
      const segments = m.references?.length ? splitReadableMentions(m.text, m.references) : splitSessionMentions(m.text)
      for (const seg of segments) {
        if (typeof seg === 'string') bubble.appendChild(document.createTextNode(seg))
        else bubble.appendChild(sessionMentionChip(seg.label, seg.sessionId))
      }
      row.appendChild(bubble)
    }
    return row
  }
  if (m.kind === 'command') {
    // Slash-command lifecycle flow node (dsh command/run + command/done).
    // 多行输出可展开（对齐 dsh web GenericCommandCard：含换行才算有正文）：
    // 折叠态显示命令名 + 输出首行，展开显示全文。
    const row = el('div', `msg command-row ${m.status}`)
    const text = m.text ?? ''
    if (text.includes('\n')) {
      const det = detailsEl(`${key}:cmd`, 'command-detail', '')
      const summary = det.querySelector('summary') as HTMLElement
      summary.appendChild(el('span', 'command-line', `/${m.name}${m.args ? ` ${m.args}` : ''}`))
      if (m.status === 'running') summary.appendChild(el('span', 'spinner'))
      summary.appendChild(el('span', 'command-text', text.split('\n')[0]))
      det.appendChild(el('pre', 'command-body', text))
      row.appendChild(det)
    } else {
      row.appendChild(el('span', 'command-line', `/${m.name}${m.args ? ` ${m.args}` : ''}`))
      if (m.status === 'running') row.appendChild(el('span', 'spinner'))
      if (text) row.appendChild(el('span', 'command-text', text))
    }
    return row
  }
  const row = el('div', 'msg assistant')
  m.blocks.forEach((block, bi) => row.appendChild(renderBlock(block, `${key}:b${bi}`)))
  if (!m.complete) row.appendChild(el('div', 'streaming', '▍'))
  if (m.interrupted) row.appendChild(el('div', 'interrupted', '已中断'))
  if (m.turnError) row.appendChild(renderTurnError(m.turnError))
  // Copy/feedback/fork attach only to the turn's final message (turnEnd): a
  // turn split by mid-turn injected user/messages folds into several complete
  // messages, and the bar must not repeat on each. Also meaningless on an
  // empty marker-only message (turn failed or was interrupted before any
  // content).
  if (m.turnEnd && !(m.blocks.length === 0 && (m.turnError || m.interrupted))) {
    row.appendChild(renderAssistantActions(m))
  }
  return row
}

/**
 * 消息流渲染：workflow 运行卡片按 anchorSeq 插进聊天流（对齐官方把 durable
 * workflow-run 节点放在 chat 流里的位置语义）。run 的全部事件都落在承载它的
 * tool 卡所在 turn 内，assistant 消息的 seq 会随 turn 内事件涨到 ≥ anchorSeq，
 * 所以「第一条 seq ≥ anchorSeq 的消息之后」就是该 run 的插位；没有配对消息
 * （窗口起点切在 run 之后）时统一排在流尾。runs 已按 anchorSeq 升序。
 */
function appendMessageFlow(messages: HTMLElement, state: ChatState): void {
  const runs = state.workflowRuns ?? []
  let ri = 0
  const emitThrough = (seq: number | undefined): void => {
    if (seq === undefined) return
    while (ri < runs.length && runs[ri].anchorSeq <= seq) {
      messages.appendChild(renderWorkflowRun(runs[ri]))
      ri += 1
    }
  }
  state.messages.forEach((m, mi) => {
    messages.appendChild(renderMessage(m, `m${mi}`))
    emitThrough(m.kind === 'assistant' ? m.seq : undefined)
  })
  emitThrough(Number.POSITIVE_INFINITY)
}

/**
 * workflow 运行卡片（对齐 dsh web WorkflowRunPanel）：run 级折叠行 + 展开后
 * phase 列表，phase 再套一层折叠行展开出成员。展开/折叠由 facts 状态机驱动
 * （见 src/pure/workflowRun.ts 的 advanceWorkflowDisclosure），用户手动 toggle
 * 只在 facts 不变或运行中更新时保留。
 */
function renderWorkflowRun(run: WorkflowRunView): HTMLElement {
  const root = el('div', 'workflow-run')
  root.setAttribute('data-workflow-run', run.runId)
  root.setAttribute('data-run-status', run.status)
  const disp = advanceWorkflowDisclosure(workflowDisclosure.get(run.runId), workflowRunFacts(run))
  workflowDisclosure.set(run.runId, disp)
  root.appendChild(renderWorkflowRunHeader(run, disp))
  if (!disp.open) return root
  if (run.phases.length === 0) {
    root.appendChild(el('div', 'workflow-empty', '没有启动成员'))
    return root
  }
  const list = el('div', 'workflow-phase-list')
  for (const phase of run.phases) list.appendChild(renderWorkflowPhase(run, phase))
  root.appendChild(list)
  return root
}

function workflowChevron(open: boolean): SVGSVGElement {
  const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
  chev.classList.add('workflow-chevron', open ? 'open' : 'collapsed')
  return chev
}

/** Run 级折叠行：chevron + 名称；折叠态尾部 = 分隔点 · N 个成员 · 状态点+状态词。 */
function renderWorkflowRunHeader(run: WorkflowRunView, disp: WorkflowDisclosureState): HTMLElement {
  const row = el('button', 'workflow-run-header') as HTMLButtonElement
  row.type = 'button'
  row.setAttribute('aria-expanded', String(disp.open))
  row.title = run.name
  row.addEventListener('click', () => {
    // 立刻重渲染：click 只更新了 workflowDisclosure Map，DOM 要等下一个 state
    // snapshot 才会按新状态重画；运行中且事件稀疏/停顿的卡（或已收尾不再有新
    // snapshot 的终态卡）点了会像没反应，所以这里同步触发一次 render()。
    workflowDisclosure.set(run.runId, toggleWorkflowDisclosure(workflowDisclosure.get(run.runId) ?? disp))
    render()
  })
  row.appendChild(workflowChevron(disp.open))
  row.appendChild(el('span', 'workflow-run-title', run.name))
  if (!disp.open) {
    row.appendChild(el('span', 'workflow-sep'))
    row.appendChild(el('span', 'workflow-run-count', `${disp.activityCount} 个成员`))
    row.appendChild(renderWorkflowStatusTail(run.status))
  }
  return row
}

/** 状态点 + 状态词（dsh web statusTail）。 */
function renderWorkflowStatusTail(status: WorkflowRunStatus): HTMLElement {
  const tail = el('span', 'workflow-status-tail')
  tail.appendChild(workflowStateDot(status))
  tail.appendChild(el('span', undefined, WORKFLOW_STATUS_TEXT[status]))
  return tail
}

/** Phase 级折叠行：chevron + 阶段名；折叠态尾部 = N 个成员 + 聚合状态（运行中 2 · 已完成 1）。 */
function renderWorkflowPhase(run: WorkflowRunView, phase: WorkflowRunPhaseView): HTMLElement {
  const key = `${run.runId}:${phase.key}`
  const section = el('div', 'workflow-phase')
  const disp = advanceWorkflowDisclosure(workflowDisclosure.get(key), workflowPhaseFacts(phase))
  workflowDisclosure.set(key, disp)
  const header = el('button', 'workflow-phase-header') as HTMLButtonElement
  header.type = 'button'
  header.setAttribute('aria-expanded', String(disp.open))
  header.addEventListener('click', () => {
    // 同上：phase 级折叠也要点击立即生效，不等下一个 snapshot。
    workflowDisclosure.set(key, toggleWorkflowDisclosure(workflowDisclosure.get(key) ?? disp))
    render()
  })
  header.appendChild(workflowChevron(disp.open))
  header.appendChild(el('span', 'workflow-phase-title', phase.phase ?? ''))
  if (!disp.open) {
    header.appendChild(el('span', 'workflow-sep'))
    header.appendChild(el('span', 'workflow-phase-count', `${phase.members.length} 个成员`))
    header.appendChild(el('span', 'workflow-phase-status', workflowPhaseStatusSummary(phase.members)))
  }
  section.appendChild(header)
  if (disp.open) {
    const list = el('div', 'workflow-members')
    for (const m of phase.members) list.appendChild(renderWorkflowMember(m))
    section.appendChild(list)
  }
  return section
}

/** 成员行：状态点槽 + 成员名 + 状态文字（dsh web MemberRow，纯展示）。 */
function renderWorkflowMember(m: WorkflowRunMemberView): HTMLElement {
  const row = el('div', 'workflow-member')
  const slot = el('span', 'workflow-dot-slot')
  slot.appendChild(workflowStateDot(m.status))
  row.appendChild(slot)
  row.appendChild(el('span', 'workflow-member-label', m.label || '空成员名'))
  row.appendChild(el('span', 'workflow-member-status', WORKFLOW_STATUS_TEXT[m.status]))
  return row
}

/** 状态徽标点（官方 StateDot）：running 用转圈像素环（spinSvg，与会话「正在运行」一致），终态是发光圆点。 */
function workflowStateDot(status: WorkflowRunStatus): Node {
  if (workflowDotState(status) === 'ongoing') return spinSvg()
  const dot = el('span', 'workflow-dot')
  dot.setAttribute('data-state', workflowDotState(status))
  return dot
}

/** Turn failure row, mirroring the official web client's TurnErrorItem. */
function renderTurnError(err: { message: string; code?: string }): HTMLElement {
  const row = el('div', 'turn-error')
  row.appendChild(el('span', 'turn-error-dot'))
  row.appendChild(el('span', 'turn-error-title', '本轮运行失败'))
  row.appendChild(el('span', 'turn-error-message', err.message))
  if (err.code) row.appendChild(el('span', 'turn-error-code', err.code))
  return row
}

/** Plain-text content of one assistant message (text + reasoning blocks). */
function assistantText(m: ChatAssistantMessage): string {
  return m.blocks
    .filter((b) => b.type === 'text' || b.type === 'reasoning')
    .map((b) => (b as { text: string }).text)
    .filter(Boolean)
    .join('\n\n')
}

/** Action row under a completed assistant message: copy / feedback / fork. */
function renderAssistantActions(m: ChatAssistantMessage): HTMLElement {
  const actions = el('div', 'msg-actions')
  const copy = iconButton(MESSAGE_ACTION_ICONS.copy, '复制')
  const copyIcon = copy.firstChild as SVGSVGElement
  const checkIcon = iconSvg(MESSAGE_ACTION_ICONS.check)
  copy.addEventListener('click', () => {
    const text = assistantText(m)
    if (!text) return
    // Top-level document: the async clipboard API is available.
    void navigator.clipboard.writeText(text).then(
      () => {
        copy.replaceChild(checkIcon, copyIcon)
        copy.title = '已复制'
        setTimeout(() => {
          copy.replaceChild(copyIcon, checkIcon)
          copy.title = '复制'
        }, 1000)
      },
      () => {
        copy.title = '复制失败'
      },
    )
  })
  actions.appendChild(copy)

  const messageId = m.messageId
  const ratings: Array<{ rating: 'positive' | 'negative'; icon: IconDef; hint: string }> = [
    { rating: 'positive', icon: MESSAGE_ACTION_ICONS.like, hint: '有用' },
    { rating: 'negative', icon: MESSAGE_ACTION_ICONS.dislike, hint: '没用' },
  ]
  for (const { rating, icon, hint } of ratings) {
    const btn = iconButton(icon, hint)
    if (m.feedbackRating === rating) btn.classList.add('active')
    if (!messageId) {
      // The host never persisted an id for this message: feedback RPCs need it.
      btn.disabled = true
      btn.title = '这条消息暂不支持反馈'
    } else {
      btn.addEventListener('click', () => {
        btn.disabled = true
        // Clicking the active rating again clears it.
        post({ type: 'feedback', messageId, rating: m.feedbackRating === rating ? null : rating })
      })
    }
    actions.appendChild(btn)
  }

  // Fork rule (web parity): only from a completed, non-interrupted turn.
  if (m.seq !== undefined && !m.interrupted) {
    const atSeq = m.seq
    const fork = iconButton(MESSAGE_ACTION_ICONS.branch, '分支')
    fork.title = '从这条消息创建一个分支会话'
    fork.addEventListener('click', () => {
      fork.disabled = true
      post({ type: 'fork', atSeq })
    })
    actions.appendChild(fork)
  }
  return actions
}

function renderBlock(block: ChatBlock, key: string): HTMLElement {
  switch (block.type) {
    case 'text': {
      // 整段正文恰为 JSON 对象/数组字面量 → 直接渲染 JsonTree（不再走 markdown / code
      // block 折叠）。超过行数阈值（jsonTreeThresholdExceeded，2 空格 pretty 行数）则回退
      // code block 渲染（含「其余 N 行」折叠 + 复制按钮），避免超大 JSON 渲染大量 DOM 行。
      // 混合正文仍走 markdown（其中 ```json 围栏块经 enhanceCodeBlocks 逐块接入树）。
      // 检测保守（tryParseJsonTree：只认整段合法对象/数组，裸标量/prose 不误判）。
      const treeValue = tryParseJsonTree(block.text)
      if (treeValue) {
        return jsonTreeThresholdExceeded(treeValue) ? renderJsonCodeBlock(block.text, key) : renderJsonTree(treeValue, key)
      }
      const div = el('div', 'md')
      div.innerHTML = md(block.text)
      decorateSessionMentions(div)
      enhanceCodeBlocks(div, key)
      return div
    }
    case 'reasoning': {
      // 折叠态摘要带推理首行预览（对齐 dsh web ReasoningRow：Think · 首行），
      // 首行包 span 用 CSS ellipsis 截断，不撑开行宽；流式时每次重建取当前首行。
      const firstLine = block.text.split('\n')[0]?.trim() ?? ''
      const det = detailsEl(`${key}:reason`, 'reasoning', '')
      const summary = det.querySelector('summary') as HTMLElement
      summary.appendChild(iconSvg(THINK_ICON, 14))
      summary.appendChild(el('span', 'reasoning-summary', firstLine ? `思考过程 · ${firstLine}` : '思考过程'))
      det.appendChild(el('div', 'reasoning-body', block.text))
      return det
    }
    case 'tool':
      return renderTool(block, key)
  }
}

/**
 * 「快照副本」标注：当一条 `subagent` 工具调用卡对应的子代理不在本会话的
 * 血缘树里（该次调用是 fork 快照复制来的历史，子代理仍挂在原父会话下），
 * 在卡片上追加一行醒目但克制的说明——提示点击不会跳到仍在跑的子代理。
 * 已完结（非 running）才算：快照里的调用是占位结果；运行中的调用等它先
 * 落血缘，避免把 in-flight 误标。后台 job / 前台结果不产出 lineage id，
 * 解析不到就不标。
 */
function subagentSnapshotNote(block: ChatToolBlock): HTMLElement | null {
  if (block.name !== 'subagent' || block.status === 'running') return null
  const id = subagentIdFromOutput(block.output)
  if (!id) return null
  if (subagentInTree(state?.subagents, id)) return null
  return el('div', 'tool-snapshot-note', '快照副本：原子代理已不在本会话')
}

/**
 * 工具调用行（kimi-cli / dsh web 行式排版）：状态图标 + 英文动作短语 +
 * host 计算的标题（如文件路径），命令类工具另起一行等宽预览（$ 前缀、
 * 截断省略）。不再是带边框的卡片容器。
 * todo_write 调用带 planSummary 时换成任务卡（对齐 web TodoRow）：动作短语
 * 用「更新任务清单」，摘要 =「0/4 已完成 · 首个进行中项」，+N 挂尾部。
 * 其他工具带输入参数（args）或输出（output）时整行可点展开（对齐 dsh web
 * DisclosureRow）：折叠态保留摘要，展开出 IN（参数 JSON）+ OUT（结果）卡片，
 * 各 150px 内滚动。
 */
function renderTool(block: ChatToolBlock, key: string): HTMLElement {
  const row = el('div', `tool tool-${block.status}`)
  const line = el('div', 'tool-line')
  const snapshotNote = subagentSnapshotNote(block)
  if (block.status === 'running') {
    line.appendChild(el('span', 'spinner'))
  } else if (block.status === 'error') {
    // 失败用 dsh web 的 StateDot（error 红点）；done 不挂状态标（dsh web 里
    // settled 工具行只显示工具自身图标，无额外状态覆盖）。
    const dot = el('span', 'tool-state-dot')
    dot.setAttribute('data-state', 'error')
    line.appendChild(dot)
  }
  if (block.todos) {
    // 数字来自该次调用 args 快照，不是当前投影；被拒绝/失败同样照实展示
    // （web 注释：被取消的调用没写 todo/write，不能读成一次成功的清单更新）。
    const s = block.todos
    const head = `${s.done}/${s.total} 已完成`
    line.appendChild(el('span', 'tool-action', '更新任务清单'))
    line.appendChild(el('span', 'tool-title', s.activeContent ? `${head} · ${s.activeContent}` : head))
    if (s.activeExtra > 0) line.appendChild(el('span', 'tool-todo-extra', `+${s.activeExtra}`))
    row.appendChild(line)
    if (block.output) row.appendChild(renderToolOutput(block.output, `${key}:out`))
    if (snapshotNote) row.appendChild(snapshotNote)
    return row
  }
  line.appendChild(el('span', 'tool-action', toolAction(block.name)))
  if (block.title) line.appendChild(el('span', 'tool-title', block.title))

  const hasArgs = typeof block.args === 'string' && block.args.length > 0
  const hasOutput = typeof block.output === 'string' && block.output.length > 0
  if (!hasArgs && !hasOutput) {
    // 无 IN 也无 OUT：保持原单行，不套展开容器。
    row.appendChild(line)
    if (block.detail) {
      row.appendChild(
        el('div', 'tool-detail', isCommandTool(block.name) ? `$ ${block.detail}` : block.detail),
      )
    }
    if (block.diff) row.appendChild(renderDiff(block.diff, `${key}:diff`))
    if (snapshotNote) row.appendChild(snapshotNote)
    return row
  }

  // 可展开：整行（含 chevron）即摘要，点击展开出 IN/OUT；展开态持久化在
  // detailsOpen（key 按消息/块位置），流式重建不冲掉。
  const det = el('details', 'tool-disclosure') as HTMLDetailsElement
  det.open = detailsOpen.get(`${key}:tool`) ?? false
  det.addEventListener('toggle', () => detailsOpen.set(`${key}:tool`, det.open))
  const summary = el('summary')
  const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
  chev.classList.add('tool-chevron')
  line.appendChild(chev)
  summary.appendChild(line)
  if (block.detail) {
    summary.appendChild(
      el('div', 'tool-detail', isCommandTool(block.name) ? `$ ${block.detail}` : block.detail),
    )
  }
  // IN/OUT 收进展开区（对齐 dsh web DisclosureRow）；diff 卡保持折叠态直接可见，
  // 用带行折叠的 renderDiff（前 8 行 + 展开其余，对齐 dsh web DiffBlock）。
  det.appendChild(summary)
  const body = el('div', 'tool-disclosure-body')
  // IN（输入参数）保持现有 prettyJson 纯文本展示；OUT（结果文本）检测为 JSON 时
  // 渲染 JsonTree（对齐 dsh web）。
  if (hasArgs) body.appendChild(toolInOut('IN', prettyJson(block.args as string), `${key}:in`, false))
  if (hasOutput) body.appendChild(toolInOut('OUT', block.output as string, `${key}:out`, true))
  det.appendChild(body)
  row.appendChild(det)
  if (block.diff) row.appendChild(renderDiff(block.diff, `${key}:diff`))
  if (snapshotNote) row.appendChild(snapshotNote)
  return row
}

/**
 * 工具卡展开区的一张 IN/OUT 卡片：小标签 + 内容。`asJson` 为 true 时（OUT）内容
 * 是 JSON 对象/数组字面量则渲染 JsonTree（对齐 dsh web），否则回退 150px 内滚动的
 * 等宽 <pre>；`asJson` 为 false 时（IN）恒用 prettyJson 的 <pre>。与 dsh web
 * DisclosureRow 的展开形态一致。
 */
function toolInOut(label: string, text: string, key: string, asJson: boolean): HTMLElement {
  const box = el('div', 'tool-inout')
  box.appendChild(el('div', 'tool-inout-label', label))
  box.appendChild(asJson ? renderJsonOrText(text, key) : el('pre', '', text))
  return box
}

/**
 * 一段工具文本的渲染入口：JSON 对象/数组字面量且不超过行数阈值 → JsonTree；否则纯文本
 * <pre>。检测保守（见 jsonTree.ts）——只有整段文本恰为合法 JSON 字面量才建树，误判
 * 会破坏普通文本展示。
 */
function renderJsonOrText(text: string, key: string): HTMLElement {
  const value = tryParseJsonTree(text)
  if (value && !jsonTreeThresholdExceeded(value)) return renderJsonTree(value, key)
  return el('pre', '', text)
}

/**
 * 整段正文恰为 JSON 但超过行数阈值时的兜底：把它包成一个 ```json 代码块（synthesize
 * <pre><code class="language-json">）再走 enhanceCodeBlocks，得到与普通代码块一致的
 * 头部条（语言标签 + code block 复制按钮）与「… 其余 N 行」折叠——超大 JSON 不再
 * 渲染成树的巨量 DOM 行。
 */
function renderJsonCodeBlock(text: string, key: string): HTMLElement {
  const holder = el('div', 'md')
  const pre = el('pre')
  const code = el('code')
  code.classList.add('language-json')
  code.textContent = text
  pre.appendChild(code)
  holder.appendChild(pre)
  enhanceCodeBlocks(holder, key)
  return holder.firstChild as HTMLElement
}

/**
 * 工具输出：JSON 先走 JsonTree；否则默认只渲染前 OUTPUT_PREVIEW_LINES 行 +
 * 「… 共 N 行，点击展开」提示（kimi-cli 的 "… (N more lines)" 对应物），点击展开
 * 全部、再次点击收起。展开状态记在 detailsOpen（key 按消息/块位置），流式重建
 * 不冲掉——同 detailsEl 的持久化机制。
 */
function renderToolOutput(output: string, key: string): HTMLElement {
  const value = tryParseJsonTree(output)
  if (value && !jsonTreeThresholdExceeded(value)) {
    // JSON → 树；套一层 tool-output 保持与非 JSON 输出一致的 20px 左缩进（树容器
    // 自身无左缩进，缩进由上下文提供）。超阈值回退非 JSON 折叠路径（兜底）。
    const box = el('div', 'tool-output')
    box.appendChild(renderJsonTree(value, key))
    return box
  }
  const box = el('div', 'tool-output')
  const { preview, totalLines, truncated } = truncateLines(output)
  const open = detailsOpen.get(key) ?? false
  box.appendChild(el('pre', '', open ? output : preview))
  if (truncated) {
    const toggle = el('div', 'tool-output-toggle', open ? '收起输出' : `… 共 ${totalLines} 行，点击展开`)
    toggle.addEventListener('click', () => {
      detailsOpen.set(key, !open)
      render()
    })
    box.appendChild(toggle)
  }
  return box
}

/**
 * 一段 JSON 输出渲染成 JsonTree（对齐 dsh web JsonTree：对象/数组逐节点展开、
 * 箭头点击 toggle、逐级缩进、暗色 token 配色）。节点 open 状态记在 jsonTreeOpen
 * （key = `${outputKey}:${pathKey}`），缺省用「根展开、嵌套收起」的策略（root 缺省
 * open），流式重建不冲掉——其它 disclosure 状态同款持久化。
 *
 * 树上/右上角给一个不喧宾夺主的「复制」按钮（对齐官方 JsonTree 的 copyPrettyJson）：
 * 复制整棵树的 2 空格 pretty JSON。复制用 navigator.clipboard，成功短暂显示
 * 「已复制」，失败改 title（与 md-code 复制按钮同款反馈）。
 */
function renderJsonTree(value: JsonContainer, outputKey: string): HTMLElement {
  const shell = el('div', 'json-tree-shell')
  const bar = el('div', 'json-tree-bar')
  const copy = buttonEl('json-tree-copy', '复制')
  copy.title = '复制 JSON'
  copy.addEventListener('click', () => {
    const text = jsonTreeCopyText(value)
    void navigator.clipboard.writeText(text).then(
      () => {
        copy.textContent = '已复制'
        copy.title = '已复制'
        setTimeout(() => {
          copy.textContent = '复制'
          copy.title = '复制 JSON'
        }, 1000)
      },
      () => {
        copy.title = '复制失败'
      },
    )
  })
  bar.appendChild(copy)
  shell.appendChild(bar)

  const tree = el('div', 'json-tree')
  const isOpen = (pathKey: string) => jsonTreeOpen.get(`${outputKey}:${pathKey}`) ?? pathKey === JSON_TREE_ROOT_KEY
  const rows = flattenJsonTree(value, isOpen)
  for (const row of rows) tree.appendChild(renderJsonTreeRow(row, outputKey, value))
  shell.appendChild(tree)
  return shell
}

/** 点击某容器节点：翻转它的 open 状态并重建。 */
function toggleJsonTree(outputKey: string, rowPathKey: string, currentOpen: boolean): void {
  jsonTreeOpen.set(`${outputKey}:${rowPathKey}`, !currentOpen)
  render()
}

/** 渲染一行 JSON 树节点（container/primitive/close），缩进按 depth。 */
function renderJsonTreeRow(row: JsonTreeRow, outputKey: string, rootValue: JsonContainer): HTMLElement {
  const line = el('div', 'json-tree-row')
  line.style.paddingLeft = `${row.depth * 14}px`
  if (row.type === 'close') {
    line.appendChild(jsonPunct(row.kind === 'array' ? ']' : '}'))
    return line
  }
  // data-path 供场景脚本 / 测试定位具体节点。
  line.setAttribute('data-path', jsonPathKey(row.path))
  // 非空容器：最左画箭头，点击 toggle；根不显示 key。
  const expandable = row.type === 'container' && row.entryCount > 0
  if (row.type === 'container' && expandable) {
    const arrow = el('span', `json-tree-arrow ${row.open ? 'open' : ''}`)
    arrow.setAttribute('role', 'button')
    arrow.setAttribute('aria-expanded', row.open ? 'true' : 'false')
    arrow.setAttribute('aria-label', row.open ? 'collapse' : 'expand')
    const pathKey = jsonPathKey(row.path)
    arrow.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleJsonTree(outputKey, pathKey, row.open)
    })
    line.appendChild(arrow)
  }
  // key 标签（对象 key / 数组下标，根不显示；容器 key 可点击展开/收起）。
  if (row.key !== null && row.key.length > 0) {
    const keySpan = el('span', 'json-tree-key', row.key)
    if (row.type === 'container' && expandable) {
      keySpan.classList.add('json-tree-label-clickable')
      keySpan.addEventListener('click', () => toggleJsonTree(outputKey, jsonPathKey(row.path), row.open))
    }
    line.appendChild(keySpan)
    line.appendChild(jsonPunct(':'))
    line.appendChild(el('span', 'json-tree-gap'))
  }
  if (row.type === 'primitive') {
    line.appendChild(jsonPrimitiveSpan(row.primitive))
    // 节点级复制：非根行尾部放 hover 出现的复制图标（复制该标量）。
    if (row.key !== null) line.appendChild(renderJsonNodeCopy(rootValue, row.path))
    return line
  }
  // container：展开显示开括号（子行 + 关闭行随后）；收起显示 `{…}` 预览；
  // 空容器显示 `{}`（无箭头、不可点）。
  const open = row.kind === 'array' ? '[' : '{'
  const close = row.kind === 'array' ? ']' : '}'
  if (expandable && row.open) {
    line.appendChild(jsonPunct(open))
  } else if (row.entryCount > 0) {
    line.appendChild(jsonPunct(open))
    line.appendChild(el('span', 'json-tree-ellipsis', '…'))
    line.appendChild(jsonPunct(close))
  } else {
    line.appendChild(jsonPunct(open))
    line.appendChild(jsonPunct(close))
  }
  // 节点级复制：容器行尾部放 hover 出现的复制图标（复制整个容器的值；根行
  // key===null 不放——整树复制已由右上角按钮承担，避免同一值两个复制入口）。
  if (row.key !== null) line.appendChild(renderJsonNodeCopy(rootValue, row.path))
  return line
}

/**
 * 一行树节点的尾部复制图标（hover 出现，克制样式与容器级按钮一致）：点击复制
 * 该节点（路径解析出的子值）的 pretty JSON。反馈与容器按钮同款——成功把图标短暂
 * 换成勾、title「已复制」1s 后还原，失败改 title；行级空间小，用图标变化而非文案。
 */
function renderJsonNodeCopy(rootValue: JsonContainer, path: JsonPath): HTMLElement {
  const btn = el('button', 'json-tree-copy-icon') as HTMLButtonElement
  btn.type = 'button'
  btn.title = '复制'
  const copyIcon = iconSvg(MESSAGE_ACTION_ICONS.copy, 12)
  const checkIcon = iconSvg(MESSAGE_ACTION_ICONS.check, 12)
  btn.appendChild(copyIcon)
  // 路径解析在 click 时做（流式重建后行可能已失效）；解析不到就不复制。
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const subValue = jsonValueAtPath(rootValue, path)
    if (subValue === undefined) return
    const text = jsonTreeCopyText(subValue)
    void navigator.clipboard.writeText(text).then(
      () => {
        btn.replaceChild(checkIcon, copyIcon)
        btn.title = '已复制'
        setTimeout(() => {
          btn.replaceChild(copyIcon, checkIcon)
          btn.title = '复制'
        }, 1000)
      },
      () => {
        btn.title = '复制失败'
      },
    )
  })
  return btn
}

function jsonPunct(text: string): HTMLElement {
  return el('span', 'json-tree-punct', text)
}

function jsonPrimitiveSpan(p: JsonPrimitiveKind): HTMLElement {
  const cls =
    p.type === 'string'
      ? 'json-tree-string'
      : p.type === 'number'
        ? 'json-tree-number'
        : 'json-tree-keyword'
  return el('span', cls, p.display)
}

/** diff 块行折叠上限（对齐 dsh web DiffBlock 的 maxLines: 8）。 */
const DIFF_PREVIEW_LINES = 8

/**
 * diff 块：默认只渲染前 DIFF_PREVIEW_LINES 行（del/add 各算各行），其余行
 * 折叠成「展开其余 N 行差异」toggle（对齐 dsh web DiffBlock）。展开状态记在
 * detailsOpen（key 按消息/块位置），流式重建不冲掉。
 */
function renderDiff(diff: { oldText: string; newText: string }, key: string): HTMLElement {
  const box = el('div', 'diff')
  const lines = [
    ...diff.oldText.split('\n').map((line) => ({ cls: 'del', text: line })),
    ...diff.newText.split('\n').map((line) => ({ cls: 'add', text: line })),
  ]
  const open = detailsOpen.get(key) ?? false
  const shown = open ? lines : lines.slice(0, DIFF_PREVIEW_LINES)
  for (const { cls, text } of shown) box.appendChild(el('div', `diff-line ${cls}`, text))
  if (lines.length > DIFF_PREVIEW_LINES) {
    const hidden = lines.length - DIFF_PREVIEW_LINES
    const toggle = el('div', 'diff-toggle', open ? '收起差异' : `… 展开其余 ${hidden} 行差异`)
    toggle.addEventListener('click', () => {
      detailsOpen.set(key, !open)
      render()
    })
    box.appendChild(toggle)
  }
  return box
}

function renderApproval(p: PendingApproval): HTMLElement {
  const card = el('div', 'pending-card')
  card.appendChild(el('div', 'pending-title', `权限请求：${p.toolName}`))
  if (p.reason) card.appendChild(el('div', 'pending-reason', p.reason))
  const actions = el('div', 'pending-actions')
  const allow = buttonEl('', '允许一次')
  const deny = buttonEl('secondary', '拒绝')
  // Disable both on click so a slow host can't be answered twice.
  allow.addEventListener('click', () => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome: 'allowed-once' })
  })
  deny.addEventListener('click', () => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome: 'rejected' })
  })
  actions.appendChild(allow)
  actions.appendChild(deny)
  card.appendChild(actions)
  return card
}

function questionDraft(rpcId: string): Map<number, QuestionDraft> {
  let d = answerDrafts.get(rpcId)
  if (!d) {
    d = new Map()
    answerDrafts.set(rpcId, d)
  }
  return d
}

function draftFor(rpcId: string, index: number): QuestionDraft {
  const d = questionDraft(rpcId)
  let v = d.get(index)
  if (!v) {
    v = { selected: new Set(), custom: '' }
    d.set(index, v)
  }
  return v
}

function submitAnswer(p: PendingQuestion): void {
  const d = answerDrafts.get(p.rpcId)
  // Same encoding as dsh's web QuestionComposer: a custom answer replaces the
  // selection for single-select questions, and accompanies it for multi-select.
  const answers = p.questions.map((q, i) => {
    const v = d?.get(i)
    const custom = v?.custom.trim() ?? ''
    const selected = [...(v?.selected ?? [])]
    return {
      selected: custom === '' || q.multiSelect ? selected : [],
      ...(custom ? { custom } : {}),
    }
  })
  answerDrafts.delete(p.rpcId)
  post({ type: 'answer', rpcId: p.rpcId, answers })
  // 提交答案同样延续对话流（回复继续流式输出），滚到底并复位跟随态。
  pinToLatest()
}

function renderQuestion(p: PendingQuestion): HTMLElement {
  const card = el('div', 'pending-card')
  p.questions.forEach((q, i) => {
    const wrap = el('div', 'question')
    if (q.header) wrap.appendChild(el('div', 'question-header', q.header))
    wrap.appendChild(el('div', 'question-text', q.question))
    if (q.detail) {
      // Plan reviews carry the full plan markdown here; keep it collapsible.
      const det = detailsEl(`q:${p.rpcId}:${i}`, 'question-detail', '查看详情')
      const body = el('div', 'md')
      body.innerHTML = md(q.detail)
      enhanceCodeBlocks(body, `q:${p.rpcId}:${i}`)
      det.appendChild(body)
      wrap.appendChild(det)
    }
    const draft = draftFor(p.rpcId, i)
    if (q.options && q.options.length > 0) {
      if (q.multiSelect) {
        for (const opt of q.options) {
          const label = el('label', 'checkbox')
          const box = document.createElement('input')
          box.type = 'checkbox'
          box.checked = draft.selected.has(opt.label)
          box.addEventListener('change', () => {
            if (box.checked) draft.selected.add(opt.label)
            else draft.selected.delete(opt.label)
            updateOkState()
          })
          label.appendChild(box)
          label.appendChild(el('span', '', opt.description ? `${opt.label} — ${opt.description}` : opt.label))
          wrap.appendChild(label)
        }
      } else {
        const group = el('div', 'question-options')
        for (const opt of q.options) {
          // A plan-review intent names its approve option; render it primary.
          const isApprove = q.intent?.kind === 'plan-review' && q.intent.approve === opt.label
          const btn = buttonEl(isApprove ? 'option-btn' : 'secondary option-btn', opt.label)
          if (opt.description) btn.title = opt.description
          if (draft.custom === '' && draft.selected.has(opt.label)) btn.classList.add('selected')
          btn.addEventListener('click', () => {
            // 点击只选中，提交一律走底部的「确认」按钮：直接提交容易误触。
            draft.selected = new Set([opt.label])
            draft.custom = ''
            // 保活态下 render() 不会重建 pending 卡，选中高亮与自定义输入
            // 框必须就地更新；无保活时下次快照重建也会按 draft 恢复同态。
            group.querySelectorAll('.option-btn').forEach((b) => b.classList.toggle('selected', b === btn))
            const customInput = wrap.querySelector<HTMLInputElement>('.question-custom input')
            if (customInput) customInput.value = ''
            updateOkState()
          })
          group.appendChild(btn)
        }
        wrap.appendChild(group)
      }
    }
    // Every question also takes a free-text "Other" answer, like the web UI.
    const customRow = el('div', 'question-custom')
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = q.options?.length ? '其他（自定义回答）' : '输入回答'
    input.value = draft.custom
    input.addEventListener('input', () => {
      draft.custom = input.value
      if (input.value && !q.multiSelect) draft.selected.clear()
      updateOkState()
    })
    customRow.appendChild(input)
    wrap.appendChild(customRow)
    card.appendChild(wrap)
  })
  // 所有问题（含单选）都显式点「确认」才提交，避免点选即继续的误触。
  // 没有任何选择/输入时确认不可点：必须「选择了之后」才允许确认。
  const actions = el('div', 'pending-actions')
  const ok = buttonEl('', '确认')
  const hasAnswer = () =>
    p.questions.some((_, i) => {
      const v = answerDrafts.get(p.rpcId)?.get(i)
      return (v?.selected.size ?? 0) > 0 || (v?.custom.trim() ?? '') !== ''
    })
  const updateOkState = () => {
    ok.disabled = !hasAnswer()
  }
  updateOkState()
  ok.addEventListener('click', () => {
    ok.disabled = true
    submitAnswer(p)
  })
  actions.appendChild(ok)
  card.appendChild(actions)
  return card
}

/**
 * 待发送图片：对齐官方 AttachmentRail 的圆角缩略图（点击放大预览，hover
 * 右上角出 × 移除）。字节已在 webview 内存里，直接用 data: URL 渲染（CSP
 * 已允许 img-src data:，无需 objectURL）；加载失败回退为文件名 chip。
 */
function pendingImageThumb(img: OutgoingImage, index: number): HTMLElement {
  const name = img.name ?? '图片'
  if (!isImageMediaType(img.mediaType)) return pendingImageFallback(img, index)
  const item = el('span', 'attach-thumb')
  item.title = `${name}（点击预览）`
  const dataUrl = attachmentDataUrl(img.mediaType, img.data)
  const image = document.createElement('img')
  image.src = dataUrl
  image.alt = name
  image.addEventListener('error', () => item.replaceWith(pendingImageFallback(img, index)))
  const remove = buttonEl('thumb-remove', '×')
  remove.title = '移除图片'
  remove.addEventListener('click', (e) => {
    e.stopPropagation()
    pendingImages.splice(index, 1)
    render()
  })
  item.addEventListener('click', () => openLightbox(dataUrl))
  item.appendChild(image)
  item.appendChild(remove)
  return item
}

/** 缩略图不可用时的回退：原来的文件名 chip（保留点击预览与移除）。 */
function pendingImageFallback(img: OutgoingImage, index: number): HTMLElement {
  const chip = el('span', 'image-chip')
  const name = el('span', 'chip-name', img.name ?? '图片')
  name.style.cursor = 'zoom-in'
  name.title = '点击预览'
  name.addEventListener('click', () => {
    openLightbox(attachmentDataUrl(img.mediaType, img.data))
  })
  chip.appendChild(name)
  const remove = buttonEl('chip-remove', '×')
  remove.title = '移除图片'
  remove.addEventListener('click', () => {
    pendingImages.splice(index, 1)
    render()
  })
  chip.appendChild(remove)
  return chip
}

/** 待发送文件：文件名 chip + 文档小图标；path 是 payload，无预览。 */
function pendingFileChip(file: StagedFile, index: number): HTMLElement {
  const chip = el('span', 'image-chip')
  const icon = el('span', 'file-chip-icon')
  icon.appendChild(strokeSvg(FILE_ICON))
  chip.appendChild(icon)
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  const remove = buttonEl('chip-remove', '×')
  remove.title = '移除文件'
  remove.addEventListener('click', () => {
    pendingFiles.splice(index, 1)
    render()
  })
  chip.appendChild(remove)
  return chip
}

function renderInput(draft: string | undefined, hero = false): HTMLElement {
  const wrap = el('div', 'input-area')
  const canSend = !!state?.canSend

  if (pendingImages.length > 0 || pendingFiles.length > 0) {
    const chips = el('div', 'image-chips')
    pendingImages.forEach((img, i) => chips.appendChild(pendingImageThumb(img, i)))
    pendingFiles.forEach((file, i) => chips.appendChild(pendingFileChip(file, i)))
    wrap.appendChild(chips)
  }

  const row = el('div', 'input-row')
  const input = document.createElement('textarea')
  input.id = 'input'
  input.rows = 1
  input.placeholder = !canSend
    ? '服务未就绪，暂时无法发送'
    : recall?.kind === 'queue'
      ? '正在修改排队消息，Enter 保存，Esc 取消'
      : state?.running
        ? '输入消息，Enter 排队发送，⌘Enter 立即插话，↑ 修改排队消息，Esc 打断'
        : hero
          ? '描述你想要构建的内容'
          : '输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片/文件，↑ 召回上一条'
  input.disabled = !canSend
  if (stashedDraft) {
    input.value = draft?.trim() ? `${draft.trimEnd()}\n${stashedDraft}` : stashedDraft
    setStashedDraft(undefined)
  } else if (draft) {
    input.value = draft
  }

  const button = buttonEl('send-button', recall?.kind === 'queue' ? '保存' : '发送')
  const updateButton = (): void => {
    button.disabled =
      !canSend || (input.value.trim().length === 0 && pendingImages.length === 0 && pendingFiles.length === 0)
  }
  const sendCurrent = (steer = false): void => {
    if (!state || !state.canSend) return
    hideSlashPopup()
    // Staged file chips travel as <attachment> path lines appended to the
    // prompt text (dsh has no file content part); the folder parses them
    // back into chips for history rendering.
    const text = [input.value.trim(), ...pendingFiles.map((f) => `<attachment>${f.path}</attachment>`)]
      .filter(Boolean)
      .join('\n')
    if (!text && pendingImages.length === 0) return
    // @ 补全插入的显示 token 在这里展开成 canonical mention（host 按 mention
    // 注入被引用会话的只读快照）；用户手动删改过的 token 不匹配，原样发送。
    const expanded = expandMentionBindings(text, mentionBindings)
    // `/model` is a client-side command (dsh-client-ui-model-selection): the
    // host has no such command, so open the model menu instead of sending.
    if (text === '/model' && !recall) {
      input.value = ''
      render()
      const pill = document.querySelector<HTMLElement>('.input-footer .pill[title="模型"]')
      if (pill) openModelMenu(pill)
      return
    }
    if (recall?.kind === 'queue') {
      // Queue edits carry text only (the host rejects non-text content), so
      // staged images stay staged and only the text goes to the queue item.
      const itemId = recall.itemId
      setRecall(null)
      setRecallDraft('')
      setPendingFiles([])
      post({ type: 'queueEdit', itemId, text: expanded })
      input.value = ''
      render()
      return
    }
    setRecall(null)
    setRecallDraft('')
    const images = pendingImages
    setPendingImages([])
    setPendingFiles([])
    post({ type: 'send', text: expanded, ...(images.length > 0 ? { images } : {}), ...(steer ? { steer } : {}) })
    input.value = ''
    render()
    // 发送是"看最新"信号：本轮 render 之后无条件滚到底并复位跟随态，
    // 后续流式输出继续贴底（host 快照回来后 render 会按跟随态钉住）。
    pinToLatest()
  }
  button.addEventListener('click', () => sendCurrent())
  button.title = state?.running ? 'Enter 排队发送，⌘/Ctrl+Enter 立即插话' : ''
  input.addEventListener('keydown', (e) => {
    // Slash completion owns these keys while open: arrows navigate, Tab/Enter
    // complete, Escape dismisses (an Escape with no popup falls through).
    if (handleSlashKey(e, input)) return
    // isComposing: don't send while an IME candidate window is open.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      // ⌘/Ctrl+Enter steers: interrupt the active turn instead of queueing.
      sendCurrent(e.metaKey || e.ctrlKey)
      return
    }
    if (e.key === 'Escape' && !e.defaultPrevented && recall) {
      // Cancel the recall: the recalled text goes away, the stashed draft returns.
      e.preventDefault()
      setRecall(null)
      input.value = recallDraft
      setRecallDraft('')
      render()
      return
    }
    // ArrowUp on the first line with no selection recalls: the last queued
    // message for editing when the inbox has one, else the last genuine user
    // message for re-sending. A recall in progress keeps ArrowUp as caret move.
    if (e.key === 'ArrowUp' && !e.isComposing && !recall && state?.canSend) {
      if (input.selectionStart !== input.selectionEnd) return
      if (input.value.slice(0, input.selectionStart).includes('\n')) return
      const lastQueued = [...(state.queue ?? [])].reverse().find((q) => q.placement === 'queued')
      const lastUser = lastQueued
        ? null
        : [...state.messages].reverse().find((m) => m.kind === 'user' && !m.context && m.text.trim())
      if (!lastQueued && !lastUser) return
      e.preventDefault()
      setRecallDraft(input.value)
      if (lastQueued) {
        setRecall({ kind: 'queue', itemId: lastQueued.id })
        input.value = lastQueued.editText
      } else if (lastUser && lastUser.kind === 'user') {
        setRecall({ kind: 'history' })
        input.value = lastUser.text
      }
      render()
    }
  })
  input.addEventListener('input', () => {
    autoGrow(input)
    updateButton()
    updateSlashPopup(input)
  })
  input.addEventListener('blur', () => hideSlashPopup())
  input.addEventListener('paste', (e) => {
    // Every clipboard file becomes an attachment, images or not — the host
    // sniffs the bytes, so a missing declared type (macOS file promises) is fine.
    const items = Array.from(e.clipboardData?.items ?? []).filter((item) => item.kind === 'file')
    if (items.length === 0) {
      pasteSessionMentions(input, e)
      return
    }
    e.preventDefault()
    void (async () => {
      const files: OutgoingImage[] = []
      for (const [i, item] of items.entries()) {
        const file = item.getAsFile()
        if (!file) continue
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          })
          const comma = dataUrl.indexOf(',')
          files.push({
            mediaType: file.type || item.type,
            data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
            name: file.name || `pasted-${Date.now()}-${i + 1}`,
          })
        } catch {
          // Unreadable clipboard item: skip it, keep the rest.
        }
      }
      if (files.length > 0) post({ type: 'filesPasted', files })
    })()
  })
  updateButton()
  row.appendChild(input)
  // While a turn runs, stop gets its own button; send stays available and
  // queues the prompt (dsh mode 'queue').
  if (state?.running) {
    const stop = buttonEl('secondary stop-button', '停止')
    stop.addEventListener('click', () => post({ type: 'stop' }))
    row.appendChild(stop)
  }
  row.appendChild(button)
  wrap.appendChild(row)

  const footer = el('div', 'input-footer')
  const addImage = buttonEl('pill', '+')
  addImage.title = '添加附件（图片或文件）'
  addImage.disabled = !canSend
  addImage.addEventListener('click', () => post({ type: 'pickFiles' }))
  footer.appendChild(addImage)
  const commands = buttonEl('pill', '/')
  commands.title = '命令'
  commands.disabled = !canSend
  commands.addEventListener('click', () => openCommandMenu(commands))
  footer.appendChild(commands)
  if (state?.permissions) {
    const perms = state.permissions
    const current = perms.options.find((o) => o.value === perms.current)
    const perm = buttonEl('pill', '')
    const glyph = current ? PERMISSION_GLYPHS[current.value] : undefined
    if (glyph) {
      const g = el('span', 'glyph')
      g.innerHTML = glyph // build-time constant, not user input
      perm.appendChild(g)
    }
    perm.appendChild(el('span', undefined, current?.label ?? perms.current))
    perm.title = '权限模式'
    perm.disabled = !canSend
    perm.addEventListener('click', () => openPermissionMenu(perm))
    footer.appendChild(perm)
  }
  if (state?.agentPreset && !hero) {
    // Agent preset chip：只在空会话出现（state.agentPreset 由宿主按此条件透传）。
    // hero 布局里它挪到标题下的 chip 行（renderHero），footer 不再重复。
    const ap = state.agentPreset
    const current = ap.options.find((o) => o.id === ap.current)
    const preset = buttonEl('pill', '')
    preset.appendChild(presetIconSvg())
    preset.appendChild(el('span', 'label', current?.label ?? ap.current))
    preset.title = current?.description ?? 'Agent 模式'
    preset.disabled = !canSend
    preset.addEventListener('click', () => openAgentPresetMenu(preset))
    footer.appendChild(preset)
  }
  const model = buttonEl('pill', state?.modelLabel ?? '选择模型')
  model.title = '模型'
  model.disabled = !canSend
  model.addEventListener('click', () => openModelMenu(model))
  footer.appendChild(model)
  wrap.appendChild(footer)

  if (state?.statsLine || state?.contextUsage) wrap.appendChild(statsRow(state?.statsLine, state?.contextUsage))
  return wrap
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`
}
