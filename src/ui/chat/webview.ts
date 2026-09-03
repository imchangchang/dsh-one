/**
 * Chat webview frontend: renders ChatState snapshots pushed by the host
 * (src/ui/chatView.ts) and posts user actions back (FromWebviewMessage).
 * Runs in the webview's browser context; esbuild bundles it (marked +
 * dompurify inlined) to dist/chatWebview.js. Rendering is a full rebuild per
 * snapshot — the host throttles pushes, so this stays cheap for a skeleton.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ACCOUNT_ICON, AGENT_PRESET_ICON, CHECK_ICON, CONTEXT_BROWSE_ICON, COPY_ICON, CODE_ICON, DSH_ONE_MARK, GIT_COMMIT_ICON, GITHUB_ICON, GOAL_ICONS, HISTORY_ICON, MESSAGE_ACTION_ICONS, PANEL_ICONS, SEND_ICON, SKILL_ICON, STOP_ICON, STOP_PRIMARY_ICON, THINK_ICON, TRASH_ICON, type IconDef } from './icons.ts'
import type {
  ChatAssistantMessage,
  ChatBlock,
  ChatContext,
  ChatFile,
  ChatGoal,
  ChatImage,
  ChatMessage,
  ChatRetryBlock,
  ChatState,
  ChatTodoItem,
  ChatToolBlock,
  CommitInfoResult,
  FromWebviewMessage,
  ModelCatalog,
  OutgoingImage,
  PendingApproval,
  PendingQuestion,
  PendingRequest,
  QueuedItem,
  SessionsSnapshot,
  StagedFile,
  SubagentNode,
  ToWebviewMessage,
} from '../../pure/chatContract.ts'
import { questionInteractionStatus } from '../../pure/chatContract.ts'
import type { SessionNodeModel, SessionSortOrder, WorkspaceNodeModel } from '../../pure/sessionTree.ts'
import { formatRelativeTime, UNGROUPED_WORKSPACE_ID } from '../../pure/sessionTree.ts'
import {
  INSTALL_SCRIPT_OS_ORDER,
  installCommandFor,
  type HostOs,
} from '../../pure/installScript.ts'
import { looksLikeSlashCommand } from '../../pure/slashCommand.ts'
import { isFilePathHref } from '../../pure/linkPath.ts'
import { meterLevel } from '../../pure/contextMeter.ts'
import { isCommandTool, prettyJson, toolAction, truncateLines } from '../../pure/toolLine.ts'
import { cordisActionCardModel, cordisDefineCardModel, cordisRunCardModel, skillCardModel } from '../../pure/toolCards.ts'
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
import { alignDiffLines } from '../../pure/diffAlign.ts'
import { producedBasename } from '../../pure/producedFiles.ts'
import {
  formatJobDuration,
  isLiveJob,
  jobDotState,
  jobStatusLabel,
  jobsChipLabel,
  orderJobs,
  type ActivityJob,
} from '../../pure/activityTree.ts'
import { attachmentBaseName, attachmentDataUrl, isImageMediaType, isImagePath, splitAttachmentLines } from '../../pure/composerAttachment.ts'
import {
  SETTLE_IDLE_MS,
  USER_SCROLL_INTENT_MS,
  archiveScrollPosition,
  isAtBottom,
  isProgramScrollEcho,
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
  parseSessionMentions,
  splitSessionMentions,
} from '../../pure/sessionMention.ts'
import { splitUserBubble, type UserBubbleSegment } from '../../pure/userBubble.ts'
import { activeAtToken, fileMentionToken, formatFileMention, type ActiveAtToken, type FileRefCandidate } from '../../pure/fileReference.ts'
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

interface VsCodeApi {
  postMessage(message: FromWebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}
declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app') as HTMLElement

// i18n：宿主把当前 locale 的译文 map 经 HTML 注入为 window.__DSH_L10N__
// （key = 英文默认串，对齐 vscode.l10n 的「默认串即 key」约定）。英文 locale
// 不注入，webview 直接用 key 本身；缺 key 时同样回退 key 本身。
const L10N: Readonly<Record<string, string>> = (globalThis as { __DSH_L10N__?: Record<string, string> }).__DSH_L10N__ ?? {}

/** 取当前 locale 的文案；支持 vscode.l10n 同款 {0}/{name} 占位。 */
function t(template: string, ...args: Array<string | number | Record<string, unknown>>): string {
  const text = L10N[template] ?? template
  if (args.length === 0) return text
  return text.replace(
    /\{(\d+)\}|\{(\w+)\}/g,
    (m: string, num: string | undefined, name: string | undefined): string => {
      if (num !== undefined) {
        const v = args[Number(num)]
        return typeof v === 'string' || typeof v === 'number' ? String(v) : m
      }
      const argsObj = args.find((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      if (name !== undefined && argsObj && typeof argsObj[name] === 'string') return argsObj[name] as string
      return m
    },
  )
}

// 窗口 reload 恢复凭据：把宿主注入的 tabId 存为面板 state（reload 后
// serializer 按它查 host 的映射重建 tab）。tabId 创建后不变，只管保存不读回。
const tabId = app.getAttribute('data-tab-id')
if (tabId) vscode.setState({ tabId })

// 脚本加载完成即向宿主报到：面板首次打开、以及 tab 切走再切回导致 webview
// 被 VSCode 重载后，宿主都靠这条消息重推当前 ChatState——否则重载后的页面
// 收不到任何 state（宿主只在事件驱动时推送），只剩空白。
post({ type: 'ready' })

marked.setOptions({ gfm: true, breaks: true })

let state: ChatState | null = null
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
/** 最近一次程序写 `messages.scrollTop` 的时间戳（performance.now() 单调时钟）。
 *  写后更新，scroll 监听用它把「自己写出来的回声事件」从滚动活动锁里剔除——
 *  否则程序 pin 的 scroll 事件把 lastScrollActivityAt 刷新，锁掉下次补 pin，
 *  视口脱底 → 120ms 后 settle 吸回，形成周期脉冲。 */
let programPinAt = 0
function markProgramPin(): void {
  programPinAt = performance.now()
}
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
  markProgramPin()
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
  markProgramPin()
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
/** Signature of the todo list at the last render; see render(). */
let lastTodosSig: string | null = null
/** Images staged in the composer, sent with the next `send`. */
let pendingImages: OutgoingImage[] = []
/** Non-image files staged as chips; their paths join the prompt text on send. */
let pendingFiles: StagedFile[] = []
/** Session the staged images belong to; a switch drops them. */
let stagedForSession: string | null = null
/** Per-session composer text drafts: sessionId → 未发送文本。切走时存旧、切回时取新，
 *  不再让旧会话的草稿「跟着搬到」下一个会话的输入框。空态（未附着会话）用
 *  EMPTY_SESSION_KEY 占位——有草稿的空态 tab 不会被宿主替换（dirty 保护），
 *  存档留给将来可能的恢复入口，也避免切走时清掉 stashedDraft。 */
const composerDrafts = new Map<string, string>()
/** Per-session staged attachments: sessionId → { images, files }。与文本同款：按会话
 *  各存一份，切走时存档、切回时恢复（原来切换即清空）。 */
const stagedPerSession = new Map<string, { images: OutgoingImage[]; files: StagedFile[] }>()
/** 空态 tab（sessionId 为 null）在草稿归档里的占位 key；与 chatView 的 EMPTY_TAB_KEY 同值。 */
const EMPTY_SESSION_KEY = '\u0000empty'
/** 会话切换后待落入 composer 的草稿来源会话：message handler 存档/恢复后置为新会话
 *  id，render 消费帧用它从 composerDrafts 取草稿。用标志而非「sessionId ≠ scrollSession」
 *  判断切换帧——hero 布局每帧把 scrollSession 置 null，同会话的 hero 帧会被误判成
 *  切换帧而覆盖当前输入。消费后置回 null；pending 接管等不消费 draft 的帧保留标志，
 *  pending 结束后恢复 composer 时仍能按新会话草稿还原。 */
let draftRestoreFor: string | null = null
/** Latest model catalog reply; dropped on session switch, refetched on menu open. */
let modelCatalog: ModelCatalog | null = null
/** 最近一次模型目录拉取是否失败（modelCatalogError）；打开菜单时重置。有旧目录
 *  时失败不打断（保留旧数据），无目录时菜单显示 error/Retry 行。 */
let modelCatalogFailed = false
/** Attachment id → data URL, filled by attachmentData replies; lives for the webview's lifetime. */
const attachmentCache = new Map<string, string>()
/** Attachment ids already requested, so re-renders don't repost while a fetch is in flight. */
const attachmentRequested = new Set<string>()
/** File-path → data URL for image-file chips (message history), filled by fileThumb replies. */
const fileThumbCache = new Map<string, string>()
/** File paths already thumb-requested; a failed read is cached as a miss to avoid retry loops. */
const fileThumbRequested = new Set<string>()
/** Half-answered pending questions: rpcId → question index → draft. */
const answerDrafts = new Map<string, Map<number, QuestionDraft>>()
/** Composer-takeover panel per pending rpcId: current page (question index), minimized state, skipped pages and a transient notice. */
const panelState = new Map<string, { page: number; minimized: boolean; skipped: Set<number>; notice: string }>()

/** Lazy panel-state accessor: defaults page 0 / expanded. */
function panelStateFor(rpcId: string): { page: number; minimized: boolean; skipped: Set<number>; notice: string } {
  let s = panelState.get(rpcId)
  if (!s) {
    s = { page: 0, minimized: false, skipped: new Set(), notice: '' }
    panelState.set(rpcId, s)
  }
  return s
}

/**
 * Static mirror of dsh's built-in slash commands (the host's commands/list RPC
 * serves the same six; `model` below is our own submenu entry — the host has
 * no /model command). Commands execute via commands/execute, not session.prompt.
 * `hint` mirrors the host's input hint and drives the composer's arg hints.
 */
const SLASH_COMMANDS: Array<{ name: string; description: string; hint?: string }> = [
  { name: 'compact', description: t('Compact older session history') },
  { name: 'export', description: t('Export this session log (ZIP)') },
  { name: 'feedback', description: t('Record feedback for this session'), hint: '<text>' },
  { name: 'goal', description: t('Set or view the long-task goal'), hint: '[<objective>|clear|edit <objective>|pause|resume]' },
  { name: 'permission', description: t('Switch permission preset'), hint: '<preset>' },
  { name: 'plan', description: t('Enter or leave plan mode'), hint: '[off|message]' },
  { name: 'model', description: t('Select the model for this session') },
]
/** Commands the composer's slash completion offers; `/model` is client-side (the send path intercepts it and opens the model menu, like the official web client). */
const COMPLETABLE_COMMANDS = SLASH_COMMANDS

/** Shield glyphs copied verbatim from dsh-client-ui-conversation's PermissionSelect. */
const SHIELD_OUTLINE =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'
const PERMISSION_GLYPHS: Record<string, string> = {
  'read-only': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor"/></svg>`,
  'workspace-write': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor"/><path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor"/><path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor"/><path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor"/><path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor"/></svg>`,
  'danger-full-access': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor"/><path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor"/></svg>`,
}

function post(message: FromWebviewMessage): void {
  vscode.postMessage(message)
}

/** 最近一次上报的 composer 脏位（比较用：值不变不发消息，避免流式渲染刷屏）。 */
let lastReportedDirty: boolean | null = null

/**
 * 把本 tab composer 的脏位（有未发送文本/附件）同步给宿主。宿主用它在点击
 * 其他会话时决定「复用本 tab 还是新开 tab」：脏位为 true 时绝不覆盖本 tab。
 * 文本从还挂在 DOM 里的输入框读；pending 面板接管（无输入框）时读停驻的
 * stashedDraft。`force` 用于会话切换帧——宿主在替换 tab 时会把脏位归零，
 * 这里必须无条件重报一次真实状态，否则同值变化会被比较短路漏报。
 */
function reportComposerDirty(force = false): void {
  const input = document.getElementById('input') as HTMLTextAreaElement | null
  const text = input ? input.value : (stashedDraft ?? '')
  const dirty = text.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0
  if (!force && dirty === lastReportedDirty) return
  lastReportedDirty = dirty
  post({ type: 'composerDirty', dirty })
}

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
    // 文件链接（绝对/相对/~/file:，含工作区外文件）：转交宿主在编辑器打开。
    // 外链之外能走到这里的非 http 锚点只剩文件路径与 dsh-session: 坏 URI 残留
    // （后者 isFilePathHref 为 false，此处不响应，与之前一致）。
    else if (isFilePathHref(href)) post({ type: 'openPath', path: href })
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
      menuItem(t('Open in system browser'), {
        icon: iconSvg(CONTEXT_BROWSE_ICON),
        onClick: () => {
          closePopover()
          post({ type: 'openExternal', url: href })
        },
      }),
    )
    body.appendChild(
      menuItem(t('Open in VS Code built-in browser'), {
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

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function buttonEl(className: string | undefined, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  if (className) b.className = className
  b.textContent = text
  return b
}

/** Icon-only ghost button matching the dsh web UI's message action style. */
function iconButton(icon: IconDef, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-action'
  b.title = title
  b.setAttribute('aria-label', title)
  b.appendChild(iconSvg(icon))
  return b
}

function iconSvg(icon: IconDef, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', icon.viewBox ?? '0 0 16 16')
  svg.setAttribute('fill', 'none')
  for (const p of icon.paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    if (typeof p === 'string') {
      path.setAttribute('d', p)
    } else {
      path.setAttribute('d', p.d)
      if (p.transform) path.setAttribute('transform', p.transform)
      if (p.opacity) path.setAttribute('opacity', p.opacity)
    }
    path.setAttribute('fill', 'currentColor')
    if (icon.fillRule) {
      path.setAttribute('fill-rule', icon.fillRule)
      path.setAttribute('clip-rule', icon.fillRule)
    }
    svg.appendChild(path)
  }
  return svg
}

/** 描边小图标：dsh web 无对应物的本地扩展图标保留描边风格。 */
function strokeSvg(paths: string[], size = 14): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.3')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
  }
  return svg
}

/** 文档描边图标（待发送文件 chip 的类型小图标，本地扩展）。 */
const FILE_ICON = ['M4.2 2h4.6L12 5.2V14H4.2z', 'M8.8 2v3.2H12']

/**
 * 运行中像素环：复刻官方 dsh web StateDot(ongoing)——10×10 画布上 8 个
 * 2×2 方块沿环排布，各自带负的 animationDelay 错相，配合 .session-spin 的
 * chase keyframes（chatView.ts）形成转圈追逐效果。
 */
const SPIN_CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4, 0],
  [8, 0],
  [8, 4],
  [8, 8],
  [4, 8],
  [0, 8],
  [0, 4],
]

/**
 * 官方 IconAgentPresetOutline16（dsh-client-ui-primitives）的逐元素复刻：
 * 圆环路径用 mask 在三个节点处镂空。IconDef 不支持 mask，故单独构建。
 */
/** Agent preset 三环图标（官方 IconAgentPresetOutline16，14px）。 */
function presetIconSvg(): SVGSVGElement {
  return iconSvg(AGENT_PRESET_ICON, 14)
}

/**
 * 无限周期 CSS 动画的「相位续播」：render() 随快照全量重建消息区 DOM，新建元素
 * 会让 animation 从 0 重新开始——流式期间快照 ~100ms 一帧，转圈/闪烁动画每帧被
 * 打回起点，视觉上就是疯狂刷新。给新建元素补一个负 animation-delay（= 当前时刻
 * 在周期里的相位），新元素从旧元素的相位继续，观感即连续（周期 animation 相位
 * 对齐等价于节点保活，且能覆盖元素被重建的任意场景）。
 */
function syncAnimPhase(el: HTMLElement | SVGElement, periodMs: number): void {
  el.style.animationDelay = `${-(performance.now() % periodMs)}ms`
}

/** 转圈 spinner（.spinner，0.9s/圈）：创建即对齐相位，见 syncAnimPhase。 */
function spinnerEl(): HTMLSpanElement {
  const s = el('span', 'spinner')
  syncAnimPhase(s, 900)
  return s
}

function spinSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '10')
  svg.setAttribute('height', '10')
  svg.setAttribute('viewBox', '0 0 10 10')
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.classList.add('session-spin')
  const phase = -(performance.now() % 1000)
  SPIN_CELLS.forEach(([x, y], i) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', '2')
    rect.setAttribute('height', '2')
    // 原有错相（-N..-1 步 × 125ms）保留，叠加全局相位：每格从自己该在的
    // 相位续播（周期 1s），快照重建不再从头闪。
    rect.style.animationDelay = `${phase + (i - SPIN_CELLS.length) * 125}ms`
    svg.appendChild(rect)
  })
  return svg
}

function md(text: string): string {
  // 默认 URI 白名单之外放行 dsh-session:，mention 链接才能活到 decorate 那步；
  // 文件路径类 href 经下面的 uponSanitizeAttribute 钩子 forceKeep（见钩子注释）。
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|dsh-session):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  })
}

/**
 * 文件路径类 href 放行：DOMPurify 的 URI 白名单只认 scheme，绝对/相对路径
 * （/Users/…、docs/foo.md、file:…）会被剥成纯文本，模型写出的文件链接就点不
 * 了。钩子里只对「文件路径形状」的 href 设 forceKeepAttr，http(s)/mailto 等
 * 外链与 javascript:/data: 等危险 scheme 不匹配路径形状，仍走默认拦截。
 */
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'href' && isFilePathHref(data.attrValue)) {
    data.forceKeepAttr = true
  }
})

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
  chip.title = t('Referenced session {0}, click to open', sessionId)
  chip.appendChild(iconSvg(SESSION_REF_ICON, 14))
  chip.appendChild(el('span', undefined, label))
  chip.addEventListener('click', () => post({ type: 'sessionOpen', sessionId }))
  return chip
}

/**
 * 文件/文件夹/命令引用 chip（对齐 dsh web 的 refChip）：文件/文件夹可点击在
 * 编辑器打开（path 是 @token 原文，点击时去 @ 与引号），命令无图标。
 * 悬停 title 显示完整引用 token。展示名（basename）由 tokenizer 算好，这里只
 * 拼 DOM。
 */
function referenceChip(seg: Extract<UserBubbleSegment, { kind: 'file' | 'folder' | 'skill' }>): HTMLElement {
  const chip = el('span', 'ref-chip')
  if (seg.kind === 'file' || seg.kind === 'folder') {
    chip.title = seg.path
    chip.appendChild(iconSvg(seg.kind === 'file' ? CONTEXT_BROWSE_ICON : PANEL_ICONS.folder, 14))
    chip.appendChild(el('span', undefined, seg.label))
    // @token 原文（@"/a b/x.md" / @docs/foo.md）：去 @ 与引号得到路径。
    const target = seg.path.replace(/^@/, '').replace(/^"|"$/g, '')
    chip.classList.add('ref-chip-link')
    chip.setAttribute('role', 'button')
    chip.tabIndex = 0
    chip.addEventListener('click', () => post({ type: 'openPath', path: target }))
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        post({ type: 'openPath', path: target })
      }
    })
  } else {
    chip.title = seg.label
    chip.appendChild(el('span', undefined, seg.label))
  }
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

// ---- 消息正文 commit hash 联动（点击打开 git 提交视图 / 悬浮显示提交信息） ----

/** 消息正文里的 commit hash：7–40 位 hex，两端不能相邻 hex（避免切开长 hex 串/英文词）。 */
const COMMIT_SHA_RE = /(?<![0-9a-fA-F])([0-9a-fA-F]{7,40})(?![0-9a-fA-F])/g

/**
 * 查询结果缓存（sha → info）。流式每帧全量重建 DOM，不缓存会在每帧重复查询同一批
 * hash；in-flight 去重靠 commitInfoInflight，避免并发重复请求（决策 2 先查后亮）。
 */
const commitInfoCache = new Map<string, CommitInfoResult>()
/** 已发出请求、尚未回传的 sha（回传后从缓存落地并从这里移除）。 */
const commitInfoInflight = new Set<string>()
/** 本次 render 新发现的 sha，攒一批在 appendMessageFlow 后统一 post（批量查询）。 */
const pendingCommitInfoShas = new Set<string>()

/** 把一次 render 内收集到的 commit hash 批量上报（去重见 noteCommitInfoRequest）。 */
function flushCommitInfoRequests(): void {
  if (pendingCommitInfoShas.size === 0) return
  const shas = [...pendingCommitInfoShas]
  pendingCommitInfoShas.clear()
  for (const sha of shas) commitInfoInflight.add(sha)
  post({ type: 'commitInfo', shas })
}

/** 记录一个待查询的 sha（缓存命中或已 in-flight 则跳过，不重复请求）。 */
function noteCommitInfoRequest(sha: string): void {
  if (commitInfoCache.has(sha) || commitInfoInflight.has(sha)) return
  pendingCommitInfoShas.add(sha)
}

/** 悬浮卡主体：仿 VS Code 内置 Git 的 commit 详情卡（historyItem hover）。
 *  按 vscode extensions/git/src/hover.ts 的 getHistoryItemHover 结构复刻为一节一节：
 *   1) 作者行：作者名（mailto 链接，有 email 时）+ 相对/绝对时间
 *   2) message 全文（首行 subject，body 保留换行）
 *   3) 分隔线
 *   4) 变更统计：N files changed, X insertions(+), Y deletions(-)（增减各自颜色）
 *   5) 分隔线 + 命令行：短 hash（点击=commitOpen）+ 复制图标 + Open on GitHub
 *  openExternal 走既有消息通道；缺失数据时对应节跳过。 */
function commitInfoCard(info: CommitInfoResult): HTMLElement[] {
  const parts: HTMLElement[] = []

  // 1) 作者行：图标 + 作者名（mailto 链接）+ $(history) 相对时间 (绝对时间)
  const authorRow = el('div', 'commit-card-author')
  authorRow.appendChild(iconSvg(ACCOUNT_ICON, 16))
  if (info.authorName) {
    if (info.authorEmail) {
      const a = el('a', 'commit-card-author-link', info.authorName) as HTMLAnchorElement
      a.href = `mailto:${info.authorEmail}`
      a.addEventListener('click', (e) => {
        e.preventDefault()
        post({ type: 'openExternal', url: a.href })
      })
      authorRow.appendChild(a)
    } else {
      authorRow.appendChild(el('span', 'commit-card-author-name', info.authorName))
    }
  }
  if (info.commitDate) {
    const time = el('span', 'commit-card-time')
    time.appendChild(iconSvg(HISTORY_ICON, 16))
    time.appendChild(document.createTextNode(` ${relativeCommitTime(info)} (${info.commitDate?.replace('T', ' ') ?? ''})`))
    authorRow.appendChild(time)
  }
  if (authorRow.childElementCount > 0) parts.push(authorRow)

  // 2) message 全文
  if (info.fullMessage) {
    const msg = el('div', 'commit-card-msg')
    const lines = info.fullMessage.split('\n')
    msg.appendChild(el('div', 'commit-card-subject', lines[0] ?? ''))
    const body = lines.slice(1).join('\n').trim()
    if (body) msg.appendChild(el('div', 'commit-card-body', body))
    parts.push(msg)
  } else if (info.message) {
    parts.push(el('div', 'commit-card-msg', info.message))
  }

  // 3) 分隔线（有统计或命令行时要）
  const hasFooter = info.files !== undefined || info.commitHash
  if (hasFooter) parts.push(el('div', 'commit-card-sep'))

  // 4) 变更统计
  if (info.files !== undefined) {
    const stat = el('div', 'commit-card-stat')
    stat.appendChild(el('span', '', t('{0} files changed', info.files)))
    if (info.insertions) {
      stat.appendChild(document.createTextNode(', '))
      stat.appendChild(el('span', 'commit-card-stat-add', t('{0} insertions(+)', info.insertions)))
    }
    if (info.deletions) {
      stat.appendChild(document.createTextNode(', '))
      stat.appendChild(el('span', 'commit-card-stat-del', t('{0} deletions(-)', info.deletions)))
    }
    parts.push(stat)
  }

  // 5) 命令行：短 hash（点开 commit）+ 复制 + Open on GitHub
  if (info.commitHash) {
    const cmdRow = el('div', 'commit-card-commands')
    const openBtn = buttonEl('commit-card-cmd', '')
    openBtn.title = t('Open Commit')
    openBtn.appendChild(iconSvg(GIT_COMMIT_ICON, 16))
    openBtn.appendChild(el('span', '', info.commitHash.slice(0, 7)))
    openBtn.addEventListener('click', () => post({ type: 'commitOpen', sha: info.sha }))
    cmdRow.appendChild(openBtn)
    const copy = buttonEl('commit-card-copy', '')
    copy.title = t('Copy commit hash')
    copy.appendChild(iconSvg(COPY_ICON, 16))
    const showCopied = () => {
      copy.textContent = ''
      copy.appendChild(iconSvg(CHECK_ICON, 16))
      copy.classList.add('commit-card-copied')
    }
    const restore = () => {
      copy.textContent = ''
      copy.appendChild(iconSvg(COPY_ICON, 16))
      copy.classList.remove('commit-card-copied')
    }
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(info.commitHash ?? '').then(() => showCopyFeedback(`commit:${info.sha}`, showCopied, restore))
    })
    cmdRow.appendChild(copy)
    if (info.githubUrl) {
      const gh = buttonEl('commit-card-cmd', '')
      gh.title = t('Open on GitHub')
      gh.appendChild(iconSvg(GITHUB_ICON, 16))
      gh.appendChild(el('span', '', t('Open on GitHub')))
      gh.addEventListener('click', () => post({ type: 'openExternal', url: info.githubUrl ?? '' }))
      cmdRow.appendChild(gh)
    }
    parts.push(cmdRow)
  }
  return parts
}

/** 相对时间文案（「30 minutes ago」式，对齐 VS Code 卡的 fromNow），补在绝对日期前。 */
function relativeCommitTime(info: CommitInfoResult): string {
  if (!info.commitDate) return ''
  const d = new Date(info.commitDate)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const MINUTE_MS = 60_000
  const HOUR_MS = 60 * MINUTE_MS
  const DAY_MS = 24 * HOUR_MS
  if (diff < MINUTE_MS) return t('just now')
  if (diff < HOUR_MS) return t('{0} minutes ago', Math.floor(diff / MINUTE_MS))
  if (diff < DAY_MS) return t('{0} hours ago', Math.floor(diff / HOUR_MS))
  return t('{0} days ago', Math.floor(diff / DAY_MS))
}

/** 按缓存里该 sha 的状态点亮/灰显 chip：found 用自定义悬浮卡（无原生 title），
 *  未确认/未命中保留原生 title 兜底（先查后亮，决策 2）。 */
function applyCommitHashState(span: HTMLElement): void {
  const sha = span.dataset.sha ?? ''
  const info = commitInfoCache.get(sha)
  span.classList.remove('commit-hash-found', 'commit-hash-unknown')
  if (!info) {
    // 未确认：灰显（悬停提示正在查询），点击仍可触发——宿主兜底「未找到该提交」。
    span.title = t('Checking commit info…')
    return
  }
  if (info.found) {
    span.classList.add('commit-hash-found')
    // 不设原生 title：found 有自定义悬浮卡（信息更全），原生 tooltip 会在指针
    // 离开 chip 后延迟弹出，跟卡片叠着显示（用户反馈的「老悬浮窗」）。title 留空。
    span.removeAttribute('title')
  } else {
    span.classList.add('commit-hash-unknown')
    span.title = t('Commit not found')
  }
}

/** chip 悬浮时弹出 commit 详情卡（仿 VS Code git commit 详情卡）；未确认态显示
 *  「正在查询」提示，未命中显示「未找到」提示。复用全局 popover 机制（定位/外点关闭）。
 *  离开 chip 延迟 120ms 关闭（指针移向卡片留缓冲），进卡片即取消。 */
let commitCardHoverTimer: ReturnType<typeof setTimeout> | null = null

function onCommitHashHover(span: HTMLElement, show: boolean): void {
  if (!show) {
    if (!popover) return
    if (commitCardHoverTimer !== null) return
    commitCardHoverTimer = setTimeout(() => {
      commitCardHoverTimer = null
      closePopover()
    }, 120)
    return
  }
  if (commitCardHoverTimer !== null) {
    clearTimeout(commitCardHoverTimer)
    commitCardHoverTimer = null
  }
  if (popover && popoverAnchor === span) return // 同一 chip 已有卡片，不重建
  const sha = span.dataset.sha ?? ''
  const info = commitInfoCache.get(sha)
  if (!info) return // 未确认：不弹卡，走原生 title「正在查询」
  const body = el('div', 'commit-card')
  if (info.found) {
    for (const part of commitInfoCard(info)) body.appendChild(part)
  } else {
    body.appendChild(el('div', 'commit-card-meta', t('Commit not found')))
  }
  showPopover(span, body, 'below')
  // 指针在卡片内时不关（mouseenter 卡片时取消 pending 关闭）
  body.addEventListener('mouseenter', () => {
    if (commitCardHoverTimer !== null) {
      clearTimeout(commitCardHoverTimer)
      commitCardHoverTimer = null
    }
  })
  body.addEventListener('mouseleave', () => {
    commitCardHoverTimer = setTimeout(() => {
      commitCardHoverTimer = null
      closePopover()
    }, 120)
  })
}

/** 认出的 commit hash 换成可点击 span（悬停 title 由缓存状态定，点击走 commitOpen）。 */
function commitHashEl(sha: string): HTMLElement {
  const span = el('span', 'commit-hash')
  span.dataset.sha = sha
  span.textContent = sha
  span.setAttribute('role', 'button')
  span.tabIndex = 0
  span.addEventListener('click', () => post({ type: 'commitOpen', sha }))
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      post({ type: 'commitOpen', sha })
    }
  })
  span.addEventListener('mouseenter', () => onCommitHashHover(span, true))
  span.addEventListener('mouseleave', () => onCommitHashHover(span, false))
  applyCommitHashState(span)
  noteCommitInfoRequest(sha)
  return span
}

/**
 * md 块渲染后扫描正文文本节点里的 commit hash 并替换为可点击 span。跳过代码块
 * （pre）与链接文本——hash 作为代码块/链接内容时不联动；行内 code（反引号包裹）
 * 里的 hash 也联动（用户反馈：markdown 表格/行内码里的 commit hash 期望可点）。
 */
function decorateCommitHashes(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // 只跳过 pre（围栏/工具输出）与 a（链接文本）；行内 <code> 允许联动，
      // hash 替换为 span 后 textContent 保持原样，不影响行内码外观。
      if (parent.closest('pre, a')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)
  for (const node of textNodes) {
    const value = node.nodeValue ?? ''
    COMMIT_SHA_RE.lastIndex = 0
    if (!COMMIT_SHA_RE.test(value)) continue
    const frag = document.createDocumentFragment()
    let last = 0
    COMMIT_SHA_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = COMMIT_SHA_RE.exec(value)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)))
      frag.appendChild(commitHashEl(m[0]))
      last = m.index + m[0].length
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }
}

/** commitInfo 回传后就地更新 DOM 里的 chip 样式与 title（不整页重渲——流式期间
 *  render 本身就在频繁重建，避免再叠加一轮）。 */
function refreshCommitHashSpans(shas: string[]): void {
  const set = new Set(shas)
  document.querySelectorAll<HTMLElement>('.commit-hash').forEach((span) => {
    const sha = span.dataset.sha ?? ''
    if (set.has(sha)) applyCommitHashState(span)
  })
}

/** 一个代码块主体（<pre><code>，文本走 textContent 防注入）。 */
function mdCodeBody(text: string): HTMLPreElement {
  const pre = el('pre') as HTMLPreElement
  const code = el('code')
  code.textContent = text
  pre.appendChild(code)
  return pre
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
    const copy = buttonEl('md-code-copy', t('Copy'))
    copy.title = t('Copy code')
    const showCopied = () => {
      copy.textContent = t('Copied')
      copy.title = t('Copied')
    }
    const restore = () => {
      copy.textContent = t('Copy')
      copy.title = t('Copy code')
    }
    copy.addEventListener('click', () => {
      if (!text) return
      void navigator.clipboard.writeText(text).then(
        () => showCopyFeedback(key, showCopied, restore),
        () => {
          copy.title = t('Copy failed')
        },
      )
    })
    initCopyFeedback(key, showCopied, restore)
    bar.appendChild(copy)

    // 折叠/展开按钮：折叠态给「… 其余 N 行」，展开态给「收起」。
    const toggle = (collapsed: boolean, label: string): HTMLButtonElement => {
      const b = buttonEl('md-code-toggle', label)
      b.setAttribute('aria-expanded', String(!collapsed))
      b.setAttribute('aria-label', collapsed ? t('Expand {0} more lines', hidden) : t('Collapse'))
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
      if (hidden > 0) wrap.appendChild(toggle(false, t('Collapse')))
    } else {
      wrap.appendChild(mdCodeBody(head.join('\n')))
      wrap.appendChild(toggle(true, t('… {0} more lines', hidden)))
      wrap.appendChild(mdCodeBody(tail.join('\n')))
    }
    pre.replaceWith(wrap)
  })
}

// 布局骨架：拆分后侧栏会话列表为原生 tree，本 webview（editor WebviewPanel）
// 只渲染聊天列。聊天快照走 render()，会话快照仅留作 @ 补全的数据源（不再渲染面板）。
const chatCol = el('div', 'chat-col')
app.appendChild(chatCol)

/** 最新 sessions 快照；null = 尚未收到。仅作 @ 提及补全的数据源。 */
let sessionsSnapshot: SessionsSnapshot | null = null

window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'state' && msg.state) {
    state = msg.state
    const switched = state.sessionId !== stagedForSession
    if (switched) {
      // 换会话：先存档旧会话的 composer 草稿（文本 + 附件），再恢复新会话的
      // ——文本不再跟着搬到下一个会话，附件不再切换即丢。
      // 文本从还挂在 DOM 里的旧输入框读；面板被 pending 接管（无输入框、
      // restoreDraft 暂存进 stashedDraft）时把暂存一并归档。空态（无附着
      // 会话）同样存档，占位 key 为 EMPTY_SESSION_KEY。
      const oldInput = document.getElementById('input') as HTMLTextAreaElement | null
      const oldKey = stagedForSession ?? EMPTY_SESSION_KEY
      composerDrafts.set(oldKey, oldInput ? oldInput.value : stashedDraft ?? '')
      stagedPerSession.set(oldKey, { images: pendingImages, files: pendingFiles })
      stashedDraft = undefined
      // 数组浅拷贝：归档持有原数组，恢复出的 pending* 之后会被用户在 composer
      // 里 splice 编辑，不能直接引用归档数组（否则删附件会污染归档）。
      const restored = stagedPerSession.get(state.sessionId ?? EMPTY_SESSION_KEY)
      pendingImages = [...(restored?.images ?? [])]
      pendingFiles = [...(restored?.files ?? [])]
      modelCatalog = null
      commandNotices = []
      recall = null
      recallDraft = ''
      earlierAnchor = null
      // commit hash 查询缓存按会话隔离：同一短 hash 在不同仓库可能指向不同提交，
      // 换会话后旧缓存里的 title 会误导，需重查（先查后亮保证点击行为仍准确）。
      commitInfoCache.clear()
      commitInfoInflight.clear()
      pendingCommitInfoShas.clear()
      stagedForSession = state.sessionId
      draftRestoreFor = state.sessionId
    }
    render()
    // 切换帧强制重报脏位（host 替换 tab 时会把脏位归零，同值比较会漏报）。
    if (switched) reportComposerDirty(true)
  } else if (msg?.type === 'sessions' && msg.snapshot) {
    // 拆分后侧栏为原生 tree；这里只更新 @ 提及补全的会话数据源。
    sessionsSnapshot = msg.snapshot
  } else if (msg?.type === 'commandResult' && typeof msg.text === 'string' && msg.text.trim()) {
    commandNotices = [...commandNotices, msg.text]
    render()
  } else if (msg?.type === 'commitInfo' && Array.isArray(msg.results)) {
    // commit hash 查询回传：落地缓存（清 in-flight），就地更新 chip 样式与悬浮 title。
    const shas: string[] = []
    for (const r of msg.results) {
      if (!r || typeof r.sha !== 'string' || typeof r.found !== 'boolean') continue
      commitInfoInflight.delete(r.sha)
      commitInfoCache.set(r.sha, r)
      shas.push(r.sha)
    }
    if (shas.length > 0) refreshCommitHashSpans(shas)
  } else if (msg?.type === 'filesPicked' && Array.isArray(msg.files)) {
    pendingFiles = [...pendingFiles, ...msg.files]
    render()
  } else if (msg?.type === 'fileThumb' && typeof msg.path === 'string' && typeof msg.data === 'string') {
    // 消息里图片文件 chip 的缩略图回执：缓存后重渲染（占位变真图）。
    fileThumbCache.set(msg.path, `data:${msg.mediaType};base64,${msg.data}`)
    render()
  } else if (msg?.type === 'modelCatalog' && msg.catalog) {
    modelCatalog = msg.catalog
    modelCatalogFailed = false
    if (modelMenuBody) renderModelMenuRoot(modelMenuBody, msg.catalog)
  } else if (msg?.type === 'modelCatalogError') {
    // 有旧目录时保留旧数据不打断；无目录时菜单切到 error/Retry 行。
    modelCatalogFailed = true
    if (modelMenuBody && !modelCatalog) renderModelMenuError(modelMenuBody)
  } else if (msg?.type === 'attachmentData' && typeof msg.attachmentId === 'string') {
    const dataUrl = `data:${msg.mediaType};base64,${msg.data}`
    attachmentCache.set(msg.attachmentId, dataUrl)
    if (pendingPreview === msg.attachmentId) {
      pendingPreview = null
      openLightbox(dataUrl)
    }
    // 消息缩略图可能正挂着这张图的占位方块，重渲染换成真图。
    render()
  } else if (msg?.type === 'restoreDraft' && typeof msg.text === 'string') {
    // 还原回 composer：stop 抽干队列的草稿文本，或发送失败的消息（图片/文件
    // chips 一并恢复，不让输入被吞）。
    const input = document.getElementById('input') as HTMLTextAreaElement | null
    if (input) {
      input.value = input.value.trim() ? `${input.value.trimEnd()}\n${msg.text}` : msg.text
      input.dispatchEvent(new Event('input'))
      input.focus()
    } else {
      stashedDraft = stashedDraft ? `${stashedDraft}\n${msg.text}` : msg.text
    }
    let stagedRestore = false
    if (Array.isArray(msg.images) && msg.images.length > 0) {
      pendingImages = [...pendingImages, ...msg.images]
      stagedRestore = true
    }
    if (Array.isArray(msg.files) && msg.files.length > 0) {
      pendingFiles = [...pendingFiles, ...msg.files]
      stagedRestore = true
    }
    if (stagedRestore && input) render()
  } else if (msg?.type === 'fileRefList') {
    // 乱序/过期响应丢弃；token 没变才存结果并重算弹窗（token 已消失时
    // updateSlashPopup 自己算不出行，弹窗保持关闭）。
    if (msg.requestId !== fileRefSeq) return
    fileRefResult = { key: fileRefRequestKey, items: Array.isArray(msg.items) ? msg.items : [] }
    const input = document.getElementById('input') as HTMLTextAreaElement | null
    if (input) updateSlashPopup(input)
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

/** Open composer popover; attached to document.body so it survives render(). */
let popover: HTMLElement | null = null
/** Anchor the open popover tracks; renders re-anchor or close on disconnect. */
let popoverAnchor: HTMLElement | null = null
let popoverPlacement: 'above' | 'below' = 'above'
/** Body of the open model menu awaiting the catalog reply. */
let modelMenuBody: HTMLElement | null = null
/** 菜单打开期间保持 hover 背景的来源行（会话行的 ⋯ 菜单/右键菜单）。 */
let menuOpenRow: HTMLElement | null = null
/** 后台任务下拉的耗时 tick（打开且有运行中行时挂上，关闭弹层时清理）。 */
let jobsTick: ReturnType<typeof setInterval> | null = null

function markMenuRow(row: HTMLElement | null): void {
  menuOpenRow?.classList.remove('menu-open')
  menuOpenRow = row
  menuOpenRow?.classList.add('menu-open')
}

function onPopoverOutside(e: MouseEvent): void {
  // 锚点（触发按钮）不算外部：官方 useDismissOnOutsidePointer 同样排除
  // trigger 子树——点已打开菜单的 trigger 应走自身的 toggle 逻辑，而不是
  // 先被 mousedown 关掉再被 click 重新打开。
  if (
    popover &&
    !popover.contains(e.target as Node) &&
    !(popoverAnchor !== null && popoverAnchor.contains(e.target as Node))
  ) {
    closePopover()
  }
}

function onPopoverKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // 消费掉这次 Esc：弹层优先于全局「Esc 打断 turn」（后者按 defaultPrevented 让路）。
    e.preventDefault()
    closePopover()
  }
}

function closePopover(): void {
  popover?.remove()
  popover = null
  popoverAnchor = null
  modelMenuBody = null
  markMenuRow(null)
  if (jobsTick !== null) {
    clearInterval(jobsTick)
    jobsTick = null
  }
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
}

/** (Re)position the open popover from its anchor's live rect. */
function positionPopover(): void {
  if (!popover || !popoverAnchor) return
  const rect = popoverAnchor.getBoundingClientRect()
  // Keep the popover inside the viewport: anchors near the right edge (e.g.
  // the context bar at the end of the stats row) would otherwise clip the
  // panel's right-hand figures off-screen.
  const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - 4)
  popover.style.left = `${Math.max(4, left)}px`
  // 垂直方向同样钳制在视口内（此前只钳水平）：锚点贴视口上/下缘时弹层会溢出
  // webview 视口，被 iframe 边界裁掉——commit 悬浮卡固定 below 展开、锚点在面板
  // 底部时卡片下半截不可见（用户反馈「被 VS Code 界面挡住」）；'above' 菜单在
  // 面板顶部有对称缺陷。原侧放不下时优先翻到另一侧，两侧都不够再钳到视口边缘。
  // 翻侧后记回 popoverPlacement，后续 reposition 沿用实际侧，避免来回抖动。
  const GAP = 6
  const MARGIN = 4
  const vh = window.innerHeight
  const h = popover.offsetHeight
  const fitsBelow = rect.bottom + GAP + h <= vh - MARGIN
  const fitsAbove = rect.top - GAP - h >= MARGIN
  let below = popoverPlacement === 'below' ? fitsBelow : !fitsAbove
  if (!fitsBelow && !fitsAbove) below = popoverPlacement === 'below' // 两侧都不够：保持请求侧，下面钳制
  if (below) {
    const top = Math.min(rect.bottom + GAP, vh - h - MARGIN)
    popover.style.top = `${Math.max(MARGIN, top)}px`
    popover.style.bottom = ''
  } else {
    const bottom = Math.min(vh - rect.top + GAP, vh - h - MARGIN)
    popover.style.bottom = `${Math.max(MARGIN, bottom)}px`
    popover.style.top = ''
  }
  popoverPlacement = below ? 'below' : 'above'
}

function showPopover(anchor: HTMLElement, body: HTMLElement, placement: 'above' | 'below' = 'above'): void {
  closePopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p)
  popover = p
  popoverAnchor = anchor
  popoverPlacement = placement
  positionPopover()
  document.addEventListener('mousedown', onPopoverOutside, true)
  document.addEventListener('keydown', onPopoverKey, true)
}

/**
 * 坐标定位的弹层（右键菜单）：固定在鼠标位置并钳制在视口内。
 * popoverAnchor 置为 null —— render() 的存活检查
 * 对无锚点弹层保持不动（不关闭、不 reposition）。
 */
function showPopoverAt(x: number, y: number, body: HTMLElement): void {
  closePopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p) // 先挂到 DOM 才能量尺寸
  popover = p
  popoverAnchor = null
  const left = Math.min(x, window.innerWidth - p.offsetWidth - 4)
  const top = Math.min(y, window.innerHeight - p.offsetHeight - 4)
  p.style.left = `${Math.max(4, left)}px`
  p.style.top = `${Math.max(4, top)}px`
  document.addEventListener('mousedown', onPopoverOutside, true)
  document.addEventListener('keydown', onPopoverKey, true)
}

/**
 * Slash-command completion popup (kimi-code / Claude Code style): while the
 * composer value starts with '/', lists matching commands above the input,
 * then argument completions (/permission presets) or the host's arg hint.
 * Distinct from the shared menu popover: it survives renders that keep the
 * composer and is refreshed by the input event instead of clicks.
 */
interface SlashRow {
  label: string
  right?: string
  /** Complete the line; absent on pure hint rows. */
  apply?: (input: HTMLTextAreaElement) => void
  /** 分组小标题行（不可选、无 hover），行间带分割线，如 @ 补全的「文件」「会话」。 */
  header?: true
}

let slashPopupEl: HTMLElement | null = null
let slashRows: SlashRow[] = []
let slashIndex = 0

/**
 * @ 文件候选的请求/响应状态：requestId 递增防乱序，key 是触发时的完整
 * token（`@sub/que`），响应只在 token 没变时上屏。host 端失败回空列表。
 */
let fileRefSeq = 0
let fileRefRequestKey = ''
let fileRefResult: { key: string; items: FileRefCandidate[] } | null = null

/**
 * 显示 token（`@标题`）→ canonical mention 的映射，发送时由
 * expandMentionBindings 展开（src/pure/sessionMention.ts）。@ 补全和
 * mention 粘贴都会登记。常驻不清理：token 指向的是固定会话，之后的
 * 消息里再写同一 token 也应展开成同一引用。
 */
const mentionBindings = new Map<string, string>()

function hideSlashPopup(): void {
  slashPopupEl?.remove()
  slashPopupEl = null
  slashRows = []
  slashIndex = 0
  // 下次再触发 @ 时重新取文件候选，避免上屏陈旧目录。
  fileRefResult = null
}

function positionSlashPopup(input: HTMLTextAreaElement): void {
  if (!slashPopupEl) return
  const rect = input.getBoundingClientRect()
  slashPopupEl.style.left = `${Math.max(4, rect.left)}px`
  slashPopupEl.style.width = `${rect.width}px`
  slashPopupEl.style.bottom = `${window.innerHeight - rect.top + 6}px`
}

/** Recompute the rows from the current value; hide when nothing applies. */
function updateSlashPopup(input: HTMLTextAreaElement): void {
  // 斜杠命令整行匹配优先；不匹配时退到光标处的 @ 补全（文件 + 会话）。
  slashRows = computeSlashRows(input)
  if (slashRows.length === 0) slashRows = computeRefRows(input)
  if (slashRows.length === 0) {
    hideSlashPopup()
    return
  }
  slashIndex = slashRows.findIndex((r) => r.apply !== undefined)
  if (!slashPopupEl) {
    slashPopupEl = el('div', 'popover slash-popup')
    document.body.appendChild(slashPopupEl)
  }
  slashPopupEl.textContent = ''
  slashRows.forEach((row, i) => {
    if (row.header) {
      // 每行恰好一个子元素，moveSlashSelection 按子下标对齐 slashRows。
      slashPopupEl?.appendChild(el('div', 'menu-group', row.label))
      return
    }
    const item = el('div', i === slashIndex ? 'menu-item selected' : 'menu-item')
    item.appendChild(el('span', undefined, row.label))
    if (row.right) item.appendChild(el('span', 'menu-right', row.right))
    if (row.apply) {
      // mousedown + preventDefault: completing must not blur the textarea.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        row.apply?.(input)
      })
    } else {
      item.classList.add('hint-row')
    }
    slashPopupEl?.appendChild(item)
  })
  positionSlashPopup(input)
}

function moveSlashSelection(dir: number): void {
  if (!slashPopupEl || slashRows.length === 0) return
  const selectable = slashRows.map((r, i) => (r.apply ? i : -1)).filter((i) => i >= 0)
  if (selectable.length === 0) return
  const at = selectable.indexOf(slashIndex)
  slashIndex = selectable[(at + dir + selectable.length) % selectable.length]
  // header 行也是子元素，按子下标（而非 .menu-item 过滤后的下标）对齐 slashRows。
  const children = Array.from(slashPopupEl.querySelectorAll(':scope > *'))
  children.forEach((item, i) => {
    item.classList.toggle('selected', i === slashIndex)
  })
  // 键盘翻动时让选中项滚进可视区（弹窗 overflow-y 是独立的滚动容器）。
  children[slashIndex]?.scrollIntoView({ block: 'nearest' })
}

/** Rows for the current composer value: command names, preset args, or one hint row. */
function computeSlashRows(input: HTMLTextAreaElement): SlashRow[] {
  const value = input.value
  if (!looksLikeSlashCommand(value) || value.includes('\n')) return []
  /** Filling the value and dispatching `input` re-enters updateSlashPopup. */
  const complete = (text: string) => () => {
    input.value = text
    input.focus()
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new Event('input'))
  }
  const sp = value.indexOf(' ')
  if (sp === -1) {
    const filter = value.slice(1).toLowerCase()
    if (filter.includes(' ')) return []
    return COMPLETABLE_COMMANDS.filter((c) => c.name.startsWith(filter)).map((c) => ({
      label: `/${c.name}`,
      right: c.description,
      apply: complete(`/${c.name} `),
    }))
  }
  const name = value.slice(1, sp)
  const argPrefix = value.slice(sp + 1)
  if (name === 'permission') {
    const options = state?.permissions?.options ?? []
    return options
      .filter((o) => o.value !== argPrefix && (o.value.startsWith(argPrefix) || o.label.toLowerCase().includes(argPrefix.toLowerCase())))
      .map((o) => ({ label: o.label, right: o.value, apply: complete(`/permission ${o.value}`) }))
  }
  const cmd = COMPLETABLE_COMMANDS.find((c) => c.name === name)
  if (cmd?.hint) return [{ label: t('Arguments: {0}', cmd.hint) }]
  return []
}

/**
 * @ 补全（对齐 dsh web）：光标前的 `@query`（或未闭合 `@"query`）触发，
 * 候选分三组（各有小标题 + 分割线）：附件（当前 composer 已附加的）、
 * 工作区文件（宿主 fileReferences/list 异步返回，cwd 浅层）、当前会话所属
 * 工作区的会话。引号 token 只出文件。
 * 引用其它会话主要靠会话面板的"复制引用"，这里只补本工作区的会话。
 */
function computeRefRows(input: HTMLTextAreaElement): SlashRow[] {
  if (input.selectionStart !== input.selectionEnd) return []
  const at = activeAtToken(input.value.slice(0, input.selectionStart))
  if (!at) return []
  // token 变了才发新请求；响应到达后由消息处理分支重算本函数上屏。
  if (fileRefResult?.key !== at.prefix) {
    fileRefSeq += 1
    fileRefRequestKey = at.prefix
    fileRefResult = null
    post({ type: 'fileRefList', requestId: fileRefSeq, query: at.query })
  }
  const { attachments, workspace } = fileRows(input, at)
  const sessions = at.quoted ? [] : sessionRows(input, at)
  return [
    ...(attachments.length > 0 ? [{ label: t('Attachments'), header: true } as SlashRow, ...attachments] : []),
    ...(workspace.length > 0 ? [{ label: t('Files'), header: true } as SlashRow, ...workspace] : []),
    ...(sessions.length > 0 ? [{ label: t('Sessions'), header: true } as SlashRow, ...sessions] : []),
  ]
}

/**
 * 文件/文件夹候选行：**附件组**（本地即时，当前 composer 已附加的）与
 * **工作区组**（宿主异步返回）分开返回。选中后输入框插入 `@短名` 显示 token，
 * canonical 路径引用（`@/abs/path` 或 `@"..."`）记入 mentionBindings、发送时
 * 才展开——textarea 里看不到长路径；选中的若正是已附加的图片，对应 chip 高亮。
 */
function fileRows(input: HTMLTextAreaElement, at: ActiveAtToken): { attachments: SlashRow[]; workspace: SlashRow[] } {
  const cursor = input.selectionStart
  const tokenStart = cursor - at.prefix.length
  const rowOf = (c: FileRefCandidate): SlashRow[] => {
    const mention = formatFileMention(c, at.quoted)
    if (mention === undefined) return [] // 编辑器语法无法安全表示的路径不出候选
    const name = attachmentBaseName(c.path)
    return [{
      label: `@${name}`,
      right: c.path,
      apply: () => {
        const token = fileMentionToken(name, mention, mentionBindings)
        mentionBindings.set(token, mention)
        const tail = ' '
        input.value = `${input.value.slice(0, tokenStart)}${token}${tail}${input.value.slice(cursor)}`
        input.focus()
        const caret = tokenStart + token.length + tail.length
        input.setSelectionRange(caret, caret)
        input.dispatchEvent(new Event('input'))
        // 重建 chips 让「已被 @ 引用」的高亮生效；焦点/光标由 render 恢复。
        render()
      },
    }]
  }
  return {
    attachments: attachedFileCandidates(at.query).flatMap(rowOf),
    // 宿主工作区候选（异步）：响应未到达或已过期时为空（附件组先顶着）。
    workspace: fileRefResult !== null && fileRefResult.key === at.prefix ? fileRefResult.items.flatMap(rowOf) : [],
  }
}

/**
 * 本地附件候选：**只列当前 composer 已附加（staged）的附件文件**，按 path
 * 去重。历史消息里出现过的附件/截图不进 @ 列表（用户拍板：只出现附件内的
 * 照片文件，不出现所有历史截图）——想引用旧附件就重新附加一次。
 */
function attachedFileCandidates(query: string): FileRefCandidate[] {
  const byPath = new Map<string, FileRefCandidate>()
  for (const f of pendingFiles) {
    if (!byPath.has(f.path)) byPath.set(f.path, { path: f.path, kind: 'file' })
  }
  const q = query.trim().toLowerCase()
  return [...byPath.values()].filter((c) => q === '' || attachmentBaseName(c.path).toLowerCase().includes(q))
}

/**
 * 当前会话所属工作区的会话候选行（不含当前会话——引用自己没有意义）。
 * 注意不是 isCurrent 组：isCurrent 跟的是 VS Code 打开的文件夹，当前会话
 * 可能属于别的工作区。空会话不在任何组的可见列表里，退回 workspaceLabel
 * 匹配。选中后输入框只留 `@标题` 显示 token，canonical mention 记在
 * mentionBindings 里，发送时才展开（textarea 做不到官方 contenteditable
 * 的原子引用，这是拍板的 b) 路线）。
 */
function sessionRows(input: HTMLTextAreaElement, at: ActiveAtToken): SlashRow[] {
  const snap = sessionsSnapshot
  if (!snap) return []
  const query = at.query.toLowerCase()
  const tokenStart = input.selectionStart - at.prefix.length
  const cursor = input.selectionStart
  const own =
    snap.workspaces.find((w) => w.sessions.some((s) => s.sessionId === state?.sessionId)) ??
    snap.workspaces.find((w) => state?.workspaceLabel !== undefined && w.label === state.workspaceLabel)
  if (!own) return []
  return own.sessions
    .filter((s) => s.sessionId !== state?.sessionId)
    .filter((s) => s.label.toLowerCase().includes(query) || s.sessionId.toLowerCase().includes(query))
    .slice(0, 10)
    .map((s) => ({
      label: `@${s.label}`,
      right: own.label,
      apply: () => {
        const token = mentionDisplayToken(s.label, s.sessionId, mentionBindings)
        mentionBindings.set(token, formatSessionMention(s.label, s.sessionId))
        input.value = `${input.value.slice(0, tokenStart)}${token} ${input.value.slice(cursor)}`
        input.focus()
        const caret = tokenStart + token.length + 1
        input.setSelectionRange(caret, caret)
        input.dispatchEvent(new Event('input'))
      },
    }))
}

/**
 * 粘贴板文本含 canonical 会话 mention（"复制引用"的产物 `@[标题](dsh-session:...)`）
 * 时接管粘贴：mention 换成 @ 补全同款的显示 token 并登记 mentionBindings
 * （发送时才展开）；光标前正在输入的 @query 触发词一并吃掉，先打 @ 再粘贴
 * 不会变成 `@@标题`。末尾是 mention 时补一个空格，与接着输入的文字隔开。
 * 返回是否已处理；普通文本粘贴返回 false，走默认行为。
 */
function pasteSessionMentions(input: HTMLTextAreaElement, e: ClipboardEvent): boolean {
  const pasted = e.clipboardData?.getData('text/plain')
  if (!pasted || !pasted.includes(SESSION_REFERENCE_SCHEME)) return false
  const segments = splitSessionMentions(pasted)
  if (!segments.some((seg) => typeof seg !== 'string')) return false
  e.preventDefault()
  const inserted = segments
    .map((seg) => {
      if (typeof seg === 'string') return seg
      const token = mentionDisplayToken(seg.label, seg.sessionId, mentionBindings)
      mentionBindings.set(token, formatSessionMention(seg.label, seg.sessionId))
      return token
    })
    .join('')
  let before = input.value.slice(0, input.selectionStart)
  if (inserted.startsWith('@')) {
    const trigger = /(^|\s)@[^\s@]{0,30}$/.exec(before)
    if (trigger) before = before.slice(0, before.length - trigger[0].length) + trigger[1]
  }
  const after = input.value.slice(input.selectionEnd)
  const endsWithMention = typeof segments[segments.length - 1] !== 'string'
  const pad = endsWithMention && !/^\s/.test(after) ? ' ' : ''
  input.value = before + inserted + pad + after
  const caret = before.length + inserted.length + pad.length
  input.setSelectionRange(caret, caret)
  input.dispatchEvent(new Event('input'))
  return true
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M (dsh-web's formatTokens). */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  if (n < 1e6) return `${scaled(n / 1e3)}K`
  return `${scaled(n / 1e6)}M`
}

/** Breakdown legend, in bar-segment order (dsh-web ContextMeter rows). */
const CONTEXT_ROWS: Array<{ key: 'systemTokens' | 'toolsTokens' | 'messageTokens'; label: string; color: string }> = [
  { key: 'systemTokens', label: t('System prompt'), color: '#8b9bb4' },
  { key: 'toolsTokens', label: t('Tools'), color: '#a78bfa' },
  { key: 'messageTokens', label: t('Messages'), color: '#5a9cf8' },
]

/** 「窗口未知」占位的悬停说明：说明原因 + 何时恢复。 */
const WINDOW_UNKNOWN_TOOLTIP = t('Window usage unknown: this model has produced no context data in this session yet; occupancy will show after the next message.')

/** Occupancy bar at the stats row's right end; hidden until the first sample. */
function contextBar(): HTMLElement {
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
    bar.textContent = t('Unknown window')
  } else {
    bar.textContent = ''
    const track = el('span', 'context-bar-track')
    track.appendChild(el('span', 'context-bar-fill'))
    bar.appendChild(track)
  }
}

/**
 * 「窗口未知」占位有没有内容可显示。占位必须带最后一次采样的已用量（有采样才
 * 值得标示未知）——数据层（contextUsageUnknown）已保证不产生缺已用量的占位；
 * 渲染层防御畸形/历史状态：无采样的未知态按无数据显示，绝不把空占位画出来。
 */
function contextBarHasValue(usage: NonNullable<ChatState['contextUsage']>): boolean {
  return !(usage.windowUnknown && typeof usage.usedTokens !== 'number')
}

/** Patch the bar in place (both initial render and kept-composer updates). */
function patchContextBar(bar: HTMLElement, usage: ChatState['contextUsage']): void {
  const show = !!usage && contextBarHasValue(usage)
  bar.style.display = show ? '' : 'none'
  if (!show) return
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
  bar.title = `${t('Context {0}% used (~{1} / {2})', usage.percent, formatTokens(usage.usedTokens), formatTokens(usage.contextWindow))}${
    meter.level === 'overflow' ? t('; exceeds the current model window') : ''
  }`
  const fill = bar.querySelector<HTMLElement>('.context-bar-fill')
  if (fill) fill.style.width = `${usage.percent}%`
}

/** Stats row at the composer's foot: stats line left, occupancy bar right. */
function statsRow(statsLine: string | undefined, usage: ChatState['contextUsage']): HTMLElement {
  const row = el('div', 'stats-row')
  row.appendChild(el('div', 'input-stats', statsLine ?? ''))
  const bar = contextBar()
  patchContextBar(bar, usage)
  row.appendChild(bar)
  return row
}

/** In-place stats-row update for the kept-composer path (no rebuild). */
function patchStatsRow(composer: HTMLElement, statsLine: string | undefined, usage: ChatState['contextUsage']): void {
  let row = composer.querySelector<HTMLElement>('.stats-row')
  if (!statsLine && !(usage && contextBarHasValue(usage))) {
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

/** 懒切换选中帧的就地 patch：hero preset chip 的文字随 pending 更新。 */
function patchHeroPresetChip(
  hero: HTMLElement,
  agentPreset: ChatState['agentPreset'],
): void {
  const chips = hero.querySelector<HTMLElement>('.hero-chips')
  if (!chips || !agentPreset) return
  const current = agentPreset.options.find((o) => o.id === agentPreset.current)
  let chip = chips.querySelector<HTMLButtonElement>('.hero-chip-preset')
  if (!chip) {
    // roster 就绪帧：之前渲染时 agentPreset 缺失（roster 未回）没建 chip，
    // 签名不含 agentPreset 触发的是保活分支，这里补建（对齐 renderHero 的
    // 渲染：图标 + label + chevron + 点击弹菜单）。
    const fresh = buttonEl('hero-chip hero-chip-preset', '')
    fresh.appendChild(presetIconSvg())
    fresh.appendChild(el('span', 'label', current?.label ?? agentPreset.current))
    const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
    chev.classList.add('chevron')
    fresh.appendChild(chev)
    fresh.title = current?.description ?? t('Agent mode')
    fresh.disabled = !state?.canSend
    fresh.addEventListener('click', () => openAgentPresetMenu(fresh, 'below'))
    chips.appendChild(fresh)
    chip = fresh
    return
  }
  const label = chip.querySelector<HTMLElement>('.label')
  if (label) {
    const text = current?.label ?? agentPreset.current
    if (label.innerText !== text) label.innerText = text
  }
  chip.title = current?.description ?? t('Agent mode')
}

/** 懒切换选中帧的就地 patch：composer 权限 pill 的图标与文字随 pending 更新。 */
function patchPermissionPill(
  composer: HTMLElement,
  permissions: ChatState['permissions'],
): void {
  if (!permissions) return
  const pill = composer.querySelector<HTMLElement>('.input-footer .pill[data-role="perm"]')
  if (!pill) return
  const current = permissions.options.find((o) => o.value === permissions.current)
  if (!current) return
  const glyph = pill.querySelector<HTMLElement>('.glyph')
  if (glyph) {
    const g = PERMISSION_GLYPHS[current.value]
    glyph.innerHTML = g ?? glyph.innerHTML // build-time constant, not user input
  }
  const label = pill.querySelector<HTMLElement>('span:not(.glyph)')
  if (label && label.textContent !== current.label) label.textContent = current.label
}

/** Click-open panel next to the ring: occupancy figure plus the breakdown bars. */
function openContextPanel(anchor: HTMLElement): void {
  const usage = state?.contextUsage
  if (!usage) return
  if (usage.windowUnknown) {
    // 「窗口未知」占位：无比例可给，面板只说明原因与恢复时机（与 bar 的悬停一致）。
    const body = el('div', 'context-panel')
    const header = el('div', 'cp-header')
    header.appendChild(el('span', 'cp-percent', t('Unknown window')))
    header.appendChild(el('span', 'cp-figures', t('Used ~{0}', formatTokens(usage.usedTokens))))
    body.appendChild(header)
    body.appendChild(
      el('div', 'cp-unknown', t('This model has produced no context data in this session yet, so no occupancy ratio is available; it will show after the next message.')),
    )
    showPopover(anchor, body)
    return
  }
  const body = el('div', 'context-panel')
  const header = el('div', 'cp-header')
  header.appendChild(el('span', 'cp-percent', t('Context {0}% used', usage.percent)))
  header.appendChild(
    el('span', 'cp-figures', t('~{0} / {1}', formatTokens(usage.usedTokens), formatTokens(usage.contextWindow))),
  )
  body.appendChild(header)
  const meter = meterLevel(usage.usedTokens, usage.contextWindow, usage.turns)
  if (meter.level === 'overflow') {
    body.appendChild(
      el('div', 'cp-overflow', t('Context exceeds the current model window: switch back to the previous model and run /compact, then switch again.')),
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
      el('div', 'cp-estimate', t('Est. ≈{0}/turn, about {1} turns left', formatTokens(meter.perTurn), meter.turnsLeft)),
    )
  }
  showPopover(anchor, body)
}

function menuItem(
  label: string,
  opts: {
    sub?: string
    right?: string
    checked?: boolean
    glyph?: string
    icon?: SVGSVGElement
    /** 禁用态：加 .menu-item.disabled（置灰、不响应点击），onClick 不绑定（与侧栏菜单一致）。 */
    disabled?: boolean
    /** 禁用原因的悬停提示（原生 title tooltip）；仅 disabled 时设置。 */
    disabledTip?: string
    onClick: () => void
  },
): HTMLElement {
  const item = el('div', opts.checked ? 'menu-item checked' : 'menu-item')
  if (opts.disabled) item.classList.add('disabled')
  if (opts.disabled && opts.disabledTip) item.title = opts.disabledTip
  if (opts.glyph) {
    const g = el('span', 'glyph')
    g.innerHTML = opts.glyph // build-time constant strings, not user input
    item.appendChild(g)
  }
  // 左侧图标位（dsh web 菜单模式）：调用方预先渲染好 SVG。
  if (opts.icon) {
    const ic = el('span', 'menu-item-icon')
    ic.appendChild(opts.icon)
    item.appendChild(ic)
  }
  // 带描述（sub）时渲染成名称 + 描述小字两行（.has-desc 行高自适应）。
  if (opts.sub) {
    item.classList.add('has-desc')
    const main = el('div', 'menu-item-main')
    main.appendChild(el('div', undefined, label))
    main.appendChild(el('div', 'menu-item-desc', opts.sub))
    item.appendChild(main)
  } else {
    item.appendChild(el('span', undefined, label))
  }
  if (opts.right) item.appendChild(el('span', 'menu-right', opts.right))
  // 选中态 check 放尾部（dsh web 模式），未选中不渲染。
  if (opts.checked) item.appendChild(el('span', 'check', '✓'))
  if (!opts.disabled) item.addEventListener('click', opts.onClick)
  return item
}

function openPermissionMenu(anchor: HTMLElement): void {
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

function openModelMenu(anchor: HTMLElement): void {
  const body = el('div')
  showPopover(anchor, body)
  modelMenuBody = body
  // 新一轮请求，清掉上一次的失败标志；失败由 modelCatalogError 再置回。
  modelCatalogFailed = false
  if (modelCatalog) {
    renderModelMenuRoot(body, modelCatalog)
  } else {
    body.appendChild(el('div', 'menu-hint', t('Loading…')))
  }
  // Always refetch so the menu reflects the server's current selection.
  post({ type: 'requestModels' })
}

/** 模型目录拉取失败且无旧目录可用：error hint + Retry 行（点击重发请求）。 */
function renderModelMenuError(body: HTMLElement): void {
  body.textContent = ''
  body.appendChild(el('div', 'menu-hint', t('Failed to load the model list')))
  body.appendChild(
    menuItem(t('Retry'), {
      onClick: () => {
        modelCatalogFailed = false
        body.textContent = ''
        body.appendChild(el('div', 'menu-hint', t('Loading…')))
        post({ type: 'requestModels' })
      },
    }),
  )
}

function renderModelMenuRoot(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  body.appendChild(
    menuItem(t('Model'), {
      right: `${model?.name ?? catalog.current.model} ›`,
      onClick: () => renderModelMenuModels(body, catalog),
    }),
  )
  const efforts = model?.efforts ?? []
  if (efforts.length > 0) {
    const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
    const effort = efforts.find((e) => e.id === effortId)
    body.appendChild(
      menuItem(t('Reasoning effort'), {
        right: `${effort?.name ?? effortId ?? t('Default')} ›`,
        onClick: () => renderModelMenuEfforts(body, catalog),
      }),
    )
  }
}

function renderModelMenuModels(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem(t('‹ Back'), { onClick: () => renderModelMenuRoot(body, catalog) }))
  for (const g of catalog.groups) {
    body.appendChild(el('div', 'menu-group', g.name))
    for (const m of g.models) {
      const isCurrent = catalog.current.provider === g.id && catalog.current.model === m.id
      body.appendChild(
        menuItem(m.name, {
          sub: m.description,
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
  body.appendChild(menuItem(t('‹ Back'), { onClick: () => renderModelMenuRoot(body, catalog) }))
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
function openSubagentMenu(anchor: HTMLElement): void {
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
    sub.running ? t('Running') : t('Done'),
    formatRelativeTime(sub.updatedAt, Date.now(), t),
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
function openJobsMenu(anchor: HTMLElement): void {
  // 点 trigger 切换开合（对齐官方 JobListAction 的 onClick toggle）：
  // 弹层已挂在这个 chip 上时再点一下是关闭，而不是重建重开。
  if (popover !== null && popoverAnchor === anchor) {
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
    jobsTick = setInterval(() => {
      popover?.querySelectorAll<HTMLElement>('[data-job-live-start]').forEach((live) => {
        live.textContent = formatJobDuration(Date.now() - Number(live.dataset.jobLiveStart), t)
      })
    }, 1000)
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
  const statusText = job.detail ?? jobStatusLabel(job.status, t)
  const status = el('span', 'job-status', statusText)
  status.title = statusText
  row.appendChild(status)
  const duration = el('span', 'job-duration')
  if (live) {
    duration.dataset.jobLiveStart = String(job.startedAt)
    duration.textContent = formatJobDuration(now - job.startedAt, t)
    duration.title = t('Running for {0}', duration.textContent)
  } else {
    duration.textContent = formatJobDuration((job.finishedAt ?? job.startedAt) - job.startedAt, t)
    duration.title = t('Took {0}', duration.textContent)
  }
  row.appendChild(duration)
  return row
}

/** Agent preset 下拉：一行一个选项（名称 + 描述），当前选中打勾；风格沿用权限/模型选择器。 */
function openAgentPresetMenu(anchor: HTMLElement, placement: 'above' | 'below' = 'above'): void {
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

/**
 * 空会话 hero 的 workspace 选择器（对齐官方 WorkspacePicker 的 Menu 形态）：
 * 行 = 文件夹图标 + 标题（悬停 tooltip 显示完整路径）+ 当前项尾部对勾；footer
 * 分隔线下是「添加已有文件夹…」「创建工作区…」两个添加入口（与侧栏一致，都走
 * VSCode 原生对话框，见 chatView.ts 的处理）。列表为空时只显示添加入口——
 * 官方此时直接进目录流程，我们把「弹下拉」换成「只弹添加入口」，不自动弹系统
 * 对话框（模态框不应无提示出现）。选中行由宿主切换 blank 会话，不在此处关闭
 * 弹层前做任何网络调用。
 */
function openWorkspacePicker(anchor: HTMLElement): void {
  if (!state) return
  const body = el('div')
  const currentId = state.workspaceId
  for (const ws of state.workspaces ?? []) {
    const checked = ws.workspaceId === currentId
    const item = el('div', checked ? 'menu-item checked workspace-item' : 'menu-item workspace-item')
    const ic = el('span', 'menu-item-icon')
    ic.appendChild(iconSvg(PANEL_ICONS.folder, 14))
    item.appendChild(ic)
    item.appendChild(el('span', 'workspace-item-label', ws.title))
    if (checked) item.appendChild(el('span', 'check', '✓'))
    item.title = ws.path
    item.addEventListener('click', () => {
      closePopover()
      // 当前显示项也 post（含 pending 目标）：宿主若发现目标等于当前会话所属
      // workspace 即取消懒切换（点当前显示项 = 取消手势）。
      post({ type: 'workspacePick', workspaceId: ws.workspaceId })
    })
    body.appendChild(item)
  }
  // footer 添加入口无条件显示：有 workspace 时列表下方的分隔区（对齐官方
  // Menu footer），列表为空时是唯一内容。
  const footer = el('div', 'workspace-picker-footer')
  footer.appendChild(
    menuItem(t('Add existing folder…'), {
      icon: iconSvg(PANEL_ICONS.folderOpen, 14),
      onClick: () => {
        closePopover()
        post({ type: 'workspacePickAdd' })
      },
    }),
  )
  footer.appendChild(
    menuItem(t('Create workspace…'), {
      icon: iconSvg(PANEL_ICONS.plus, 14),
      onClick: () => {
        closePopover()
        post({ type: 'workspacePickCreate' })
      },
    }),
  )
  body.appendChild(footer)
  showPopover(anchor, body, 'below')
}

function openCommandMenu(anchor: HTMLElement): void {  const body = el('div')
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

// ---- 头部会话 ⋯ 菜单（与侧栏 session 右键同款动作） ----

/** 置顶图钉/未读圆点描边图标（与侧栏同款 stroke 风格，见 sessionsWebview.ts）。 */
const PIN_ICON = ['M5.9 2.5h4.2l.6 3.8 1.8 1.7v1.5h-9V8l1.8-1.7.6-3.8z', 'M8 9.5v4']
const UNREAD_ICON = ['M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z']

/** 从 sessions 快照里找附着会话的行模型（菜单的 pinned/unread/hasCompletedTurn 数据源）。 */
function sessionNodeFor(sessionId: string | null): SessionNodeModel | undefined {
  if (!sessionId || !sessionsSnapshot) return undefined
  for (const w of sessionsSnapshot.workspaces) {
    const node = w.sessions.find((s) => s.sessionId === sessionId)
    if (node) return node
  }
  return undefined
}

/**
 * 头部 ⋯ 会话菜单：与侧栏会话右键同款动作，去掉「在新 tab 中打开」——当前
 * tab 就是该会话。禁用逻辑同侧栏（运行中/待处理/未读/无已完成轮次）。无
 * 头部（空会话 hero 布局）时该入口不出现，由侧栏兜底。
 */
function buildHeaderSessionMenu(header: HTMLElement): HTMLElement {
  const body = el('div')
  if (!state?.sessionId) return body
  const sid = state.sessionId
  const node = sessionNodeFor(sid)
  const pinned = sessionsSnapshot?.pinned.includes(sid) ?? false
  const unread = sessionsSnapshot?.unread.includes(sid) ?? false
  const running = state.running
  const pending = state.pending.length > 0
  body.appendChild(
    menuItem(t('Rename'), {
      icon: iconSvg(PANEL_ICONS.edit),
      onClick: () => {
        closePopover()
        // 与标题单击改名同款行内交互（本地增强，不用宿主弹窗）。
        startInlineRename(header)
      },
    }),
  )
  body.appendChild(
    menuItem(pinned ? t('Unpin') : t('Pin'), {
      icon: strokeSvg(PIN_ICON),
      checked: pinned,
      onClick: () => {
        closePopover()
        post({ type: 'sessionPin', sessionId: sid, pin: !pinned })
      },
    }),
  )
  body.appendChild(
    menuItem(unread ? t('Mark as read') : t('Mark as unread'), {
      icon: strokeSvg(UNREAD_ICON),
      checked: unread,
      disabled: running,
      disabledTip: t('Running sessions cannot be marked read/unread manually'),
      onClick: () => {
        closePopover()
        post({ type: 'sessionUnread', sessionId: sid, unread: !unread })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Fork session'), {
      icon: iconSvg(MESSAGE_ACTION_ICONS.branch),
      disabled: !(node?.hasCompletedTurn ?? false),
      disabledTip: t('The session has no completed turn; cannot fork'),
      onClick: () => {
        closePopover()
        post({ type: 'sessionFork', sessionId: sid })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Copy reference'), {
      icon: iconSvg(MESSAGE_ACTION_ICONS.copy),
      onClick: () => {
        closePopover()
        post({ type: 'sessionCopyReference', sessionId: sid, title: state?.sessionTitle ?? '' })
      },
    }),
  )
  body.appendChild(
    menuItem(t('Archive session'), {
      icon: iconSvg(PANEL_ICONS.archive),
      disabled: running || unread || pending,
      disabledTip: pending
        ? t('Sessions with pending items cannot be archived')
        : running
          ? t('Running sessions cannot be archived')
          : t('Unread sessions cannot be archived'),
      onClick: () => {
        closePopover()
        post({ type: 'sessionArchive', sessionId: sid, title: state?.sessionTitle ?? '' })
      },
    }),
  )
  return body
}

function render(): void {
  // The turn-status clock interval is owned by the row it updates; the rebuild
  // below discards that row, so drop the timer first and re-arm it later if
  // the turn is still open. Never leave an interval pointing at detached DOM.
  clearTurnStatusTimer()
  // 重试行倒计时计时器同样按行持有：重建会把行丢掉，先统一清掉。
  clearRetryTimers()
  // <details> 展开状态按会话隔离：换会话时清空（key 是位置序号，跨会话无意义）。
  // workflow 卡片状态同样按会话隔离（runId 全局唯一但换会话仍清空，防泄漏）。
  const detailsSid = state?.sessionId ?? null
  if (detailsSid !== detailsSession) {
    detailsOpen.clear()
    detailsSession = detailsSid
    workflowDisclosure.clear()
    jsonTreeOpen.clear()
    innerScrollPositions.clear()
    producedOpen.clear()
    copyConfirmedAt.clear()
  }
  const oldInput = document.getElementById('input') as HTMLTextAreaElement | null
  const hadFocus = oldInput !== null && document.activeElement === oldInput
  // 换会话后的首个消费帧：草稿按会话从 composerDrafts 恢复（message handler
  // 已把旧会话的文本归档）；其余帧仍从 DOM 读，流式重建时正在输入的内容不丢。
  const draft =
    draftRestoreFor === state?.sessionId && state.sessionId !== null
      ? composerDrafts.get(state.sessionId)
      : oldInput?.value
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
  // 内部滚动容器（IN/OUT、指令卡、JSON 树、todo 清单）要在重建前存档位置：
  // 流式每帧 textContent='' 会销毁它们，不恢复的话展开着的卡内滚动直接回到顶部。
  // 根节点用 chatCol（todo 卡在输入区上方，不在 messages 容器里）。
  saveInnerScroll(chatCol)
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
  // Goal bar 编辑 input 同款保活（快照每帧重建，draft 靠 goalDraft 恢复）。
  const oldGoalInput = document.querySelector<HTMLInputElement>('.goal-bar-input')
  const goalFocus =
    oldGoalInput && document.activeElement === oldGoalInput
      ? { start: oldGoalInput.selectionStart, end: oldGoalInput.selectionEnd }
      : null
  // Pending 面板（approval/question/plan-review 接管 composer 区）保活：与
  // composer/header 同款策略。流式快照每帧重建面板，正在输入回答的输入框
  // 被销毁重造（draft 文本靠 answerDrafts 恢复，但焦点/光标/进行中的 IME
  // 组合全丢）。焦点在面板内且 pending 内容未变时保留原元素。
  const oldPending = chatCol.querySelector<HTMLElement>(':scope > .pending-panel')
  const pendingFocus = oldPending !== null && oldPending.contains(document.activeElement)
  // 签名带 sessionId：换会话时旧会话的 pending 卡必须移除，不能因内容
  // 恰好相同（rpcId 全局唯一，理论不会，但防御起见）被保活成跨会话残留。
  // 签名含面板本地状态（分页/最小化）：翻页、收起、去聊天里说等就地状态
  // 变化必须打破保活触发重建，否则焦点在面板内时新状态不会上屏。
  const pendingSig =
    state && state.pending.length > 0
      ? JSON.stringify([
          state.sessionId,
          state.pending,
          state.pending.map((p) => {
            const s = panelState.get(p.rpcId)
            return [p.rpcId, s?.page ?? 0, s?.minimized ?? false]
          }),
        ])
      : null
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
    recall = null
    recallDraft = ''
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
    state?.modelLabel ?? null,
    // agentPreset / permissions 刻意不进签名：懒切换的 pending 帧只改
    // chip/pill 显示，composer 内容不变——进签名会整页重建 hero，焦点/IME
    // 全断且鱼标动画重播（见 hero 保活分支与 keepComposer 的就地 patch）。
    state?.plan ?? null,
    recall ? (recall.kind === 'queue' ? `queue:${recall.itemId}` : recall.kind) : null,
    pendingImages.map((i) => i.name ?? ''),
    pendingFiles.map((f) => f.path),
  ])
  // An open popover anchored inside the composer (permission/model menu) or the
  // hero chip row (blank-session preset picker) also pins the layout: rebuilding
  // would destroy the anchor and kill the menu mid-stream.
  const popoverInComposer =
    popover !== null &&
    popoverAnchor !== null &&
    ((oldComposer?.contains(popoverAnchor) ?? false) || (oldHero?.contains(popoverAnchor) ?? false))
  // 两种布局下 composer 的挂载位置不同（hero 内 / chatCol 直接子级），保留
  // 策略只在布局不变时生效，避免把已随旧布局拆除的 composer 当成存活锚点。
  const keepComposer =
    oldComposer !== null &&
    (hadFocus || popoverInComposer) &&
    stashedDraft === undefined &&
    composerSig === lastComposerSig &&
    (oldHero !== null && oldHero.contains(oldComposer)) === blankHero &&
    // Pending 接管面板（approval/question/plan-review）存在时不保留 composer：
    // 输入区整个换成面板，原输入框被移除（draft 内容仍保留，pending 结束后
    // 恢复普通 composer 时按 draft 还原）。
    (state?.pending.length ?? 0) === 0
  // 空会话 hero 保活不要求焦点/菜单：hero 内容只由 composer 签名描述，签名
  // 没变（懒切换 pending 帧只改 workspace chip 文字等）时 DOM 不动——重建会
  // 让鱼标 CSS 动画重播（视觉上图标「重置」）且打断输入状态。keepComposer 的
  // 焦点条件保留给消息流布局（那里重建是常态）。仅当前帧是 hero 布局时生效
  // （pending 接管等其他布局切换一律走重建）。清理循环与 blankHero 分支共用。
  const keepBlankHero =
    blankHero &&
    oldHero !== null &&
    oldComposer !== null &&
    stashedDraft === undefined &&
    composerSig === lastComposerSig &&
    oldHero.contains(oldComposer)
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
  // 任务清单 todo 卡保活（与 composer/pending 同款 keep）：todos 内容没变时保留
  // 原元素。流式快照每帧重建 chatCol，in_progress 行首的转圈弧环是新建 SVG——
  // CSS 动画随节点替换从 0° 重启，~100ms 一帧的快照下转圈永远走不完，看起来像
  // 疯狂刷新。保活后动画连续；todos 真变了才重建，重启动画本就是期望行为。
  const oldTodoPanel = chatCol.querySelector<HTMLElement>(':scope > .todo-panel')
  const todosSig = state?.todos ? JSON.stringify(state.todos) : null
  const keepTodoPanel =
    oldTodoPanel !== null &&
    state !== null &&
    state.sessionId !== null &&
    state.loading !== true &&
    !switchingSession &&
    !blankHero &&
    todosSig !== null &&
    todosSig === lastTodosSig
  // loading 帧（换会话的历史基线加载中）不动现有 DOM：整页保留到新状态落地
  // 再一次性切换——否则 hero 布局切换（blank→blank 切 workspace 尤甚）会先被
  // 清成「加载会话…」空占位再重建，观感像整页刷新。keep* 布尔照常计算（无
  // 副作用），落地帧仍按签名决定重建。
  if (state?.loading !== true) {
    for (const child of Array.from(chatCol.children)) {
      if (keepMessages && child === oldMessages) continue
      if (keepHeader && child === oldHeader) continue
      if (keepBlankHero && (child === oldComposer || child === oldHero)) continue
      if (keepComposer && (child === oldComposer || (blankHero && child === oldHero))) continue
      if (keepPending && child === oldPending) continue
      if (keepTodoPanel && child === oldTodoPanel) continue
      child.remove()
    }
  }
  // Menus anchored to surviving elements (kept composer, sessions header)
  // stay open across snapshot renders — re-anchor in case the layout shifted
  // under them; only close when the rebuild above actually removed the anchor.
  // popoverAnchor === null：坐标定位菜单（会话右键），没有锚点，保持原样。
  if (popover) {
    if (popoverAnchor === null) {
      // 坐标定位：不关闭、不 reposition。
    } else if (popoverAnchor.isConnected) positionPopover()
    else closePopover()
  }
  if (!state || !state.sessionId) {
    lastComposerSig = null
    lastHeaderSig = null
    lastPendingSig = null
    lastTodosSig = null
    turnStatusStart = null
    scrollSession = null
    chatCol.appendChild(renderEmpty(state))
    return
  }
  // 历史基线加载中：旧视图已被上面跳过清理而保留，这里只在确实没有任何
  // 内容（面板首开/重载后在等基线）时才给一行加载提示。
  if (state.loading === true) {
    turnStatusStart = null
    if (chatCol.childNodes.length === 0) {
      chatCol.appendChild(el('div', 'muted-hint loading-hint', t('Loading session…')))
    }
    return
  }
  if (blankHero) {
    turnStatusStart = null
    scrollSession = null
    if (keepBlankHero) {
      // 整个 hero（含 composer）保持不动：焦点、光标、进行中的 IME 组合都
      // 不中断；只有跟踪数据流的 stats 行就地修补。
      patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
      // 懒切换的 pending 帧：workspaceLabel 变了但 composer 没变（不在
      // composerSig 里），hero 保持不动，只就地更新 workspace chip 文字——
      // 否则每次点 chip 切换都会重建整页。workspace chip 恒为 chips 行第一个。
      const wsLabel = oldHero
        .querySelector<HTMLElement>('.hero-chips .hero-chip')
        ?.querySelector<HTMLElement>('.label')
      if (wsLabel && wsLabel.innerText !== state.workspaceLabel) {
        wsLabel.innerText = state.workspaceLabel ?? ''
      }
      // 同款就地 patch：preset chip（懒切换选中帧）与权限 pill（懒切换选中帧）
      // 的文字；swap 不改签名，面板指针稳定（chip 是 popover 锚点）。
      patchHeroPresetChip(oldHero, state.agentPreset)
      patchPermissionPill(oldComposer, state.permissions)
      if (slashPopupEl && oldInput) positionSlashPopup(oldInput)
    } else {
      chatCol.appendChild(renderHero(state, draft))
      // 本帧消费了恢复草稿，标志清零；loading 帧/pending 帧不走这里，标志保留。
      draftRestoreFor = null
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
    lastTodosSig = todosSig
    return
  }
  // Regions above the composer; insert before the preserved composer when kept.
  // Pending 面板同样充当 anchor：保活面板时消息流/todo/queue 重建要插到它
  // 前面，否则追加到 chatCol 末尾会把面板挤到中间去。
  const anchor = keepPending ? oldPending : keepComposer ? oldComposer : null
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
      chip.appendChild(el('span', undefined, t('{0} subagents', state.subagents.length)))
      chip.appendChild(iconSvg(PANEL_ICONS.chevronDown, 14))
      chip.title = t('Subagents')
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
      chip.title = t('Background jobs')
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
    // 会话操作 ⋯ 按钮（右端）：弹层与侧栏 session 右键同款（去掉「在新 tab
    // 中打开」）。锚点随 header 保活（keepHeader），流式快照重建不杀弹层。
    const sessionMenuBtn = buttonEl('header-chip session-menu-btn', '')
    sessionMenuBtn.title = t('Session actions')
    sessionMenuBtn.setAttribute('aria-label', t('Session actions'))
    sessionMenuBtn.appendChild(iconSvg(PANEL_ICONS.ellipsis, 16))
    sessionMenuBtn.addEventListener('click', () => {
      showPopover(sessionMenuBtn, buildHeaderSessionMenu(header), 'below')
    })
    header.appendChild(sessionMenuBtn)
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
      // 程序 pin 写的回声 scroll 事件：距上次程序写 ≤ SETTLE_IDLE_MS、无用户滚动意图、
      // 且实际位置与程序写后的目标一致（±1 抵消取整），判为「自己写出来的回声」——
      // 直接忽略，别让它进滚动活动锁。否则程序 pin 的 scroll 事件刷新了滚动活动时间戳，
      // 锁掉 SETTLE_IDLE_MS 内的下次补 pin → 视口脱底一帧增量 → 120ms 后 settle 吸回，
      // 形成「脱底→吸回」周期脉冲。用户滚动的 scroll 事件位置 ≠ pinnedScrollTop 或
      // 意图活跃（wheel/touch/键盘意图窗口内），不会命中，照常记账。
      if (
        isProgramScrollEcho(
          performance.now(),
          programPinAt,
          pinnedScrollTop,
          messages.scrollTop,
          userScrollIntentActive(),
          SETTLE_IDLE_MS,
        )
      ) {
        return
      }
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
    const btn = buttonEl(undefined, state.loadingEarlier === true ? t('Loading…') : t('Load earlier'))
    btn.disabled = state.loadingEarlier === true
    btn.addEventListener('click', maybeLoadEarlier)
    olderWrap.appendChild(btn)
    messages.appendChild(olderWrap)
  }
  appendMessageFlow(messages, state)
  // 正文 commit hash 的「先查后亮」：把本次 render 发现的新 hash 批量上报宿主查询。
  flushCommitInfoRequests()
  for (const notice of commandNotices) messages.appendChild(el('div', 'command-notice', notice))
  if (state.messages.length === 0 && steeringItems.length === 0) {
    messages.appendChild(el('div', 'muted-hint', t('No messages yet — start typing below.')))
  }
  // Turn-status row: last item of the conversation flow while a turn is open
  // (official-client parity), gone the moment the turn ends.
  if (state.running) {
    messages.appendChild(renderTurnStatus())
  } else {
    turnStatusStart = null
  }
  // Pending steering bubbles sit at the tail of the transcript, after the
  // turn status — the spot their durable user message lands once claimed
  // (official PendingSteeringBubble). Snapshot order = send order.
  for (const item of steeringItems) messages.appendChild(renderSteeringItem(item))
  // "Back to latest" floater: sticky at the scroller's bottom while the user
  // reads history; hidden while pinned to the tail.
  const jump = buttonEl('jump-latest', t('↓ Back to latest'))
  jump.style.display = stickToBottom ? 'none' : ''
  jump.addEventListener('click', () => {
    stickToBottom = true
    messages.scrollTop = messages.scrollHeight
    pinnedScrollTop = messages.scrollTop
    markProgramPin()
    jump.style.display = 'none'
  })
  messages.appendChild(jump)
  if (!keepMessages) add(messages)

  // 任务清单卡（对齐官方 input.dock id=todo order 0，排在排队消息之前）：
  // 缺省/null（首写前 / turn/start 后）与 [] 空数组都不渲染。
  if (state.todos && state.todos.length > 0) {
    if (keepTodoPanel && oldTodoPanel !== null) add(oldTodoPanel)
    else add(renderTodoPanel(state.todos))
  }

  // 目标条幅（对齐官方 input.dock id=goal order 10：todo 之后、queue 之前）：
  // 缺省/null（无投影 / create 前 / clear 后）与 complete 目标都不渲染。
  if (state.goal) {
    const goalBar = renderGoalBar(state.goal)
    if (goalBar) add(goalBar)
  }

  if (queuedItems.length > 0) {
    if (editingQueueItem && !queuedItems.some((item) => item.id === editingQueueItem)) editingQueueItem = null
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
      summary.appendChild(el('span', 'queue-dock-count', t('{0} queued messages', queuedItems.length)))
      const list = el('div', 'queue-dock-list')
      for (const item of queuedItems) list.appendChild(renderQueueItem(item))
      det.appendChild(list)
      queue.appendChild(det)
    }
    add(queue)
  } else {
    editingQueueItem = null
  }

  // Live-jobs 内联横条已移除（对齐官方 dsh web：只留头部「N 个后台任务」chip）：
  // 任务信息由 state.backgroundJobs → 头部 chip / openJobsMenu 菜单承担。
  // state.jobs 仍被上方 blankHero 空态判断消费，链路保留。

  if (state.pending.length > 0) {
    // Pending 接管 composer 区：消息流尾部不再渲染 pending 卡（对齐 dsh web
    // 的 QuestionFlow / PlanReviewPanel 挂 conversation.composer 的形态）。
    if (!keepPending) chatCol.appendChild(renderPendingPanel(state.pending))
  } else if (keepComposer && oldComposer) {
    // The composer element was never detached, so focus, caret, and any
    // in-flight IME composition survive; only patch the stats line in place.
    patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
    // 权限 pill 懒切换选中帧的就地 patch（permissions 不在 composerSig 里）。
    patchPermissionPill(oldComposer, state.permissions)
  } else {
    chatCol.appendChild(renderInput(draft))
    // 本帧消费了恢复草稿，标志清零（pending 接管帧走不到这里，标志保留到
    // pending 结束恢复普通 composer 时）。
    draftRestoreFor = null
  }
  lastComposerSig = composerSig
  lastHeaderSig = headerSig
  lastPendingSig = pendingSig
  lastTodosSig = todosSig
  // 「加载更早」的锚定配对：先记下 loadingEarlier 曾为 true（请求确实被
  // 接受），它翻回 false 的这一帧若消息从顶部插入（首条变了或条数多了），
  // 按新增高度补偿 scrollTop；无论是否插入都解除锚点（空页/失败同样落地）。
  const earlier = earlierAnchor
  if (earlier !== null && state.loadingEarlier === true) earlier.seenLoading = true
  const landed = earlier !== null && earlier.seenLoading && state.loadingEarlier !== true ? earlier : null
  const prepended =
    landed !== null && (state.messages.length > landed.count || state.messages[0]?.id !== landed.firstId)
  // 恢复/补偿路径（换会话恢复历史位置、加载更早、非贴底跳转）同步写：它们是
  // 用户明确动作，不涉及「抢原生惯性动画」，也无需等布局 settle。写 scrollTop 的
  // 分支同样标记程序 pin，让滚动监听把它的回声事件从活动锁里剔除。
  if (restoreScrollTop !== null) {
    messages.scrollTop = restoreScrollTop
    markProgramPin()
  } else if (!switchingSession && prevScrollTop !== null && prepended && prevScrollHeight !== null) {
    messages.scrollTop = prevScrollTop + (messages.scrollHeight - prevScrollHeight)
    markProgramPin()
  } else if (!switchingSession && prevScrollTop !== null) {
    messages.scrollTop = prevScrollTop
    markProgramPin()
  }
  // 内部滚动容器（展开的 IN/OUT、指令卡、JSON 树、todo 清单）在新 DOM 上恢复位置。
  // 换会话时不恢复：存档已随 detailsOpen 一起清空，旧会话位置对新内容无意义。
  if (!switchingSession) restoreInnerScroll(chatCol)
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
      // pin 得靠它避免自己被误判为用户滚离。同时记录程序 pin 时间戳，滚动监听
      // 据此把本次写触发的回声 scroll 事件从活动锁里剔除。
      pinnedScrollTop = m.scrollTop
      markProgramPin()
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
  const goalInput = document.querySelector<HTMLInputElement>('.goal-bar-input')
  if (goalInput && (goalFocus !== null || goalAutoFocus)) {
    goalInput.focus()
    goalInput.setSelectionRange(
      goalFocus !== null ? goalFocus.start : goalInput.value.length,
      goalFocus !== null ? goalFocus.end : goalInput.value.length,
    )
    goalAutoFocus = false
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
  } else if (slashPopupEl && oldInput) {
    positionSlashPopup(oldInput)
  }
  // 脏位跟随渲染结果上报：切换会话恢复草稿、发送清空、附件增删都经这里。
  reportComposerDirty()
}

/**
 * 空会话 hero（官方 dsh web 空态 HeroShell 的本地变体）：整列水平居中——
 * DSH One 像素鲸鱼 logo（品牌蓝，游动动画），其下 workspace 选择 chip
 * （点击弹 WorkspacePicker）与 preset 选择 chip 行，再下是包成
 * 大圆角卡片的 composer（样式见 chatView.ts 的 .hero）。不渲染官方
 * hero 的「探索未至之境」标题与「预览版」徽章（用户要求去掉）。
 */
function renderHero(state: ChatState, draft: string | undefined): HTMLElement {
  const hero = el('div', 'hero')
  const stack = el('div', 'hero-stack')
  // 品牌：DSH One 像素鲸鱼 logo + 轻量游动动画（纯 CSS transform，样式见
  // chatView.ts 的 .hero-fish）。
  const brand = el('div', 'hero-brand hero-fish')
  brand.appendChild(iconSvg(DSH_ONE_MARK, 64))
  stack.appendChild(brand)
  const chips = el('div', 'hero-chips')
  if (state.workspaceLabel) {
    // 官方此 chip 是 workspace 选择器（WorkspacePicker）：点击弹下拉——全部
    // workspace 列表（当前项对勾）+ 「添加已有文件夹…」「创建工作区…」两个
    // 添加入口；选择/添加后由宿主在目标 workspace 复用/新建 blank 会话并切换。
    const ws = buttonEl('hero-chip', '')
    ws.appendChild(iconSvg(PANEL_ICONS.folder, 16))
    ws.appendChild(el('span', 'label', state.workspaceLabel))
    const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
    chev.classList.add('chevron')
    ws.appendChild(chev)
    ws.title = t('Select workspace')
    ws.setAttribute('aria-haspopup', 'menu')
    ws.addEventListener('click', () => openWorkspacePicker(ws))
    chips.appendChild(ws)
  }
  if (state.agentPreset) {
    // 从 composer 底部挪到 hero 的 preset 选择 chip（交互不变，仍弹下拉）。
    const ap = state.agentPreset
    const current = ap.options.find((o) => o.id === ap.current)
    const preset = buttonEl('hero-chip hero-chip-preset', '')
    preset.appendChild(presetIconSvg())
    preset.appendChild(el('span', 'label', current?.label ?? ap.current))
    const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
    chev.classList.add('chevron')
    preset.appendChild(chev)
    preset.title = current?.description ?? t('Agent mode')
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
    wrap.appendChild(el('div', 'empty-title', t('dsh not found')))
    wrap.appendChild(
      el('div', 'empty-hint', t('DSH One requires a local dsh installation. Install it and come back here to start automatically.')),
    )
    const btn = buttonEl(undefined, t('View install guide'))
    btn.addEventListener('click', () => post({ type: 'openInstallPage' }))
    wrap.appendChild(btn)
    wrap.appendChild(renderInstallScriptBlock(state.hostOs))
    return wrap
  }
  wrap.appendChild(el('div', 'empty-title', t('dsh chat')))
  wrap.appendChild(
    el('div', 'empty-hint', t('Click a session in the list to start chatting. If the list is empty, start the dsh service first.')),
  )
  return wrap
}

/* ---- 非官方一键安装脚本块（dshNotFound 空态，kimi 同款体验） ---- */

/** 用户手动选中的平台（跨重建保留；未选过 = 跟随宿主平台）。 */
let selectedInstallOs: HostOs | null = null

/**
 * kimi 式安装引导：平台下拉按钮 + 单行省略的命令条（无横向滚动）+ 复制按钮；
 * 平台按钮与命令条同排 flex-wrap——容器够宽左右排（kimi 一行），侧栏窄时
 * 命令条自动换到下一行上下排。默认选中宿主平台（hostOs 由 host 端
 * process.platform 映射），未知平台回退第一项；平台切换经全局 popover 弹层。
 */
function renderInstallScriptBlock(hostOs: HostOs | undefined): HTMLElement {
  const block = el('div', 'install-script')
  block.appendChild(
    el('div', 'install-script-hint', t('Or use the community one-liner script below (unofficial):')),
  )
  let active = selectedInstallOs ?? hostOs ?? INSTALL_SCRIPT_OS_ORDER[0]
  if (!INSTALL_SCRIPT_OS_ORDER.includes(active)) active = INSTALL_SCRIPT_OS_ORDER[0]

  const row = el('div', 'install-script-row')
  const platform = buttonEl('install-script-platform', '')
  const label = el('span', 'install-script-platform-label', INSTALL_SCRIPT_OS_LABEL[active])
  platform.appendChild(label)
  platform.appendChild(iconSvg(PANEL_ICONS.chevronDown, 12))
  const code = el('code', 'install-script-code')
  const apply = (os: HostOs): void => {
    selectedInstallOs = os
    active = os
    label.textContent = INSTALL_SCRIPT_OS_LABEL[os]
    const text = installCommandFor(os)
    code.textContent = text
    code.title = text
  }
  apply(active)
  platform.addEventListener('click', () => {
    const menu = el('div', 'install-script-menu')
    for (const os of INSTALL_SCRIPT_OS_ORDER) {
      const item = el('div', 'install-script-menu-item' + (os === active ? ' active' : ''), INSTALL_SCRIPT_OS_LABEL[os])
      item.addEventListener('click', () => {
        apply(os)
        closePopover()
      })
      menu.appendChild(item)
    }
    showPopover(platform, menu, 'below')
  })

  const copy = buttonEl('install-script-copy', '')
  copy.title = t('Copy')
  copy.appendChild(iconSvg(COPY_ICON, 14))
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(code.textContent ?? '').then(
      () => flashCopyLabel(copy, t('Copied')),
      () => flashCopyLabel(copy, t('Copy failed')),
    )
  })
  const cmd = el('div', 'install-script-cmd')
  cmd.appendChild(code)
  cmd.appendChild(copy)
  row.appendChild(platform)
  row.appendChild(cmd)
  block.appendChild(row)
  return block
}

/** 复制反馈：按钮文字短暂替换为已复制状态，2s 后恢复图标。 */
function flashCopyLabel(button: HTMLButtonElement, label: string): void {
  const original = button.title
  button.title = label
  button.textContent = ''
  button.appendChild(el('span', undefined, label))
  setTimeout(() => {
    button.title = original
    button.textContent = ''
    button.appendChild(iconSvg(COPY_ICON, 14))
  }, 2000)
}

/** 平台名：不随 locale 翻译（对齐 kimi 的 Win/macOS/Linux）。 */
const INSTALL_SCRIPT_OS_LABEL: Record<HostOs, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

function contextLabel(kind: string): string {
  if (kind === 'agent-instructions' || kind === 'legacy-instructions') return t('Workspace instructions')
  if (kind === 'plugin') return t('Runtime context')
  if (kind === 'session-reference') return t('Cross-session recall')
  return t('Context injection')
}

/** Normalize a (possibly legacy string) context value into the structured shape. */
function contextOf(value: ChatContext | string): ChatContext {
  return typeof value === 'string' ? { kind: value } : value
}

/**
 * 注入上下文折叠卡（对齐 dsh web ContextInjectionRow）：折叠头 = 图标 + label
 * （recall/会话引用用 ReferenceIcon）+ notice 的 summary；展开 body 按 form
 * 渲染结构（见 structuredContextBody），未知 form 退化为原始正文。body 在
 * 141px 内滚动（截断）。
 */
function renderInjectedContext(ctx: ChatContext, text: string, key: string): HTMLElement {
  const det = el('details', 'msg context') as HTMLDetailsElement
  det.open = detailsOpen.get(`${key}:ctx`) ?? false
  det.addEventListener('toggle', () => detailsOpen.set(`${key}:ctx`, det.open))
  const isRecall = ctx.kind === 'session-reference' || ctx.form === 'recall'
  const summary = el('summary')
  summary.appendChild(isRecall ? iconSvg(SESSION_REF_ICON, 14) : iconSvg(CONTEXT_BROWSE_ICON, 14))
  summary.appendChild(el('span', undefined, t('{0} (injected with the message)', contextLabel(ctx.kind))))
  if (ctx.form === 'notice' && ctx.summary) summary.appendChild(el('span', 'context-summary', ctx.summary))
  det.appendChild(summary)
  det.appendChild(markScrollable(contextBodyOf(ctx, text), `${key}:ctx`))
  return det
}

/** 141px 滚动容器：结构优先（form 渲染），无结构/未知 form 时退化为原始正文。 */
function contextBodyOf(ctx: ChatContext, text: string): HTMLElement {
  const body = el('div', 'context-body')
  const structure = structuredContextBody(ctx)
  if (structure) {
    // 顶注（catalog 替换提示 / snapshot 取代说明），对齐 dsh web 的提示行。
    if (ctx.form === 'catalog' && ctx.update) body.appendChild(el('div', 'context-note', t('Catalog replaced')))
    if (ctx.form === 'snapshot') body.appendChild(el('div', 'context-note', t('This snapshot supersedes the previous version')))
    body.appendChild(structure)
    // 模型正文（注入文本）在结构下方保留（notice/relay 等无结构字段的正文）。
    if (text) body.appendChild(el('pre', 'context-model-body', text))
  } else {
    body.textContent = text
  }
  return body
}

/** 按 form 渲染结构体；notice（summary 在折叠行）与未知 form 返回 null。 */
function structuredContextBody(ctx: ChatContext): HTMLElement | null {
  switch (ctx.form) {
    case 'instructions': {
      const wrap = el('div', 'ctx-changes')
      for (const ch of ctx.changes ?? []) {
        const row = el('div', 'ctx-change')
        row.appendChild(el('span', 'ctx-change-action', contextActionLabel(ch.action)))
        row.appendChild(el('span', 'ctx-change-path', ch.path))
        wrap.appendChild(row)
      }
      return wrap
    }
    case 'catalog': {
      const wrap = el('div', 'ctx-entries')
      for (const entry of ctx.entries ?? []) {
        const row = el('div', 'ctx-entry')
        row.appendChild(el('span', 'ctx-entry-name', entry.name))
        if (entry.description) row.appendChild(el('span', 'ctx-entry-desc', entry.description))
        wrap.appendChild(row)
      }
      return wrap
    }
    case 'snapshot': {
      const wrap = el('div', 'ctx-sections')
      for (const section of ctx.sections ?? []) {
        const sec = el('div', 'ctx-section')
        sec.appendChild(el('div', 'ctx-section-name', section.name))
        sec.appendChild(el('div', 'ctx-section-text', section.text))
        wrap.appendChild(sec)
      }
      return wrap
    }
    case 'relay': {
      const wrap = el('div', 'ctx-relay')
      wrap.appendChild(el('div', 'ctx-relay-from', t('From session {0}', ctx.senderSessionId ?? '')))
      return wrap
    }
    case 'recall': {
      const wrap = el('div', 'ctx-recall')
      for (const ref of ctx.references ?? []) {
        const row = el('div', 'ctx-recall-row')
        const parts = [ref.label]
        if (ref.retainedMessages !== undefined || ref.omittedMessages !== undefined) {
          parts.push(t('retain {0} / omit {1}', String(ref.retainedMessages ?? '?'), String(ref.omittedMessages ?? '?')))
        }
        row.appendChild(el('span', 'ctx-recall-label', parts.join(' · ')))
        if (ref.truncated) row.appendChild(el('span', 'ctx-recall-truncated', t('truncated')))
        wrap.appendChild(row)
      }
      return wrap
    }
    default:
      // notice（summary 已在折叠行）与未知 form：正文只保留注入文本。
      return null
  }
}

function contextActionLabel(action: 'set' | 'replace' | 'remove'): string {
  if (action === 'set') return t('Set')
  if (action === 'replace') return t('Replace')
  return t('Remove')
}

/** Attachment id whose bytes are being fetched to open a preview on arrival. */
let pendingPreview: string | null = null
/** Queue item currently being edited inline, null when none. */
let editingQueueItem: string | null = null
/**
 * Composer recall mode entered by ArrowUp: 'queue' loads the last queued
 * message into the composer and send saves it back; 'history' recalls the
 * last genuine user message and send re-sends it as a new prompt.
 */
let recall: { kind: 'queue'; itemId: string } | { kind: 'history' } | null = null
/** Draft stashed when a recall replaced it; restored by Escape. */
let recallDraft = ''
/** Unsaved queue-editor text by item id; survives the rebuild-per-snapshot rendering. */
const queueEditDrafts = new Map<string, string>()
/** Composer draft arriving while no input element exists yet (restoreDraft before first render). */
let stashedDraft: string | undefined
/** Slash-command receipt texts shown at the message tail; cleared on session switch. */
let commandNotices: string[] = []

/** One queued inbox row: tag + preview, plus steer/edit/remove actions. */
function renderQueueItem(item: QueuedItem): HTMLElement {
  const row = el('div', 'queue-item')
  row.appendChild(el('span', 'queue-tag', t('Queued')))

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
    const save = buttonEl('', t('Save'))
    save.addEventListener('click', () => {
      const text = queueEditDrafts.get(item.id) ?? editor.value
      editingQueueItem = null
      queueEditDrafts.delete(item.id)
      post({ type: 'queueEdit', itemId: item.id, text })
    })
    const cancel = buttonEl('secondary', t('Cancel'))
    cancel.addEventListener('click', () => {
      editingQueueItem = null
      queueEditDrafts.delete(item.id)
      render()
    })
    actions.appendChild(save)
    actions.appendChild(cancel)
    row.appendChild(actions)
    return row
  }

  row.appendChild(el('span', 'queue-text', item.text || t('(empty message)')))
  const actions = el('div', 'queue-actions')
  const steer = buttonEl('link', t('Steer'))
  steer.title = t('Interrupt the current turn and steer with this message')
  steer.addEventListener('click', () => post({ type: 'queueSteer', itemId: item.id }))
  const edit = buttonEl('link', t('Edit'))
  edit.addEventListener('click', () => {
    editingQueueItem = item.id
    render()
  })
  const remove = buttonEl('link', t('Delete'))
  remove.addEventListener('click', () => post({ type: 'queueRemove', itemId: item.id }))
  actions.appendChild(steer)
  actions.appendChild(edit)
  actions.appendChild(remove)
  row.appendChild(actions)
  return row
}

/**
 * 等待插话的 steering 消息：和正常用户消息一样的气泡（附件、引用 chip、
 * 引用摘要行同款），只在气泡左侧加一个处理中圆圈表示插话还没落地（插话
 * 落地后由正式用户消息原位替换，圆圈随之消失）。
 * 流式输出期间 render() 每快照全量重建消息区，新建节点会让 spinner 的 CSS
 * 动画从 0° 重新启动——转圈每帧被打回起点，看起来就是疯狂刷新。给新建元素补
 * 一个负 animation-delay（= 当前时刻在 0.9s 周期里的相位），新节点从旧节点的
 * 相位继续转，观感连续（与 todo/命令卡 spinner 的 syncAnimPhase 同机制）。
 */
function renderSteeringItem(item: QueuedItem): HTMLElement {
  const row = el('div', 'msg user steering-pending')
  const spin = el('span', 'spinner')
  spin.style.animationDelay = `${-(performance.now() % 900)}ms`
  row.appendChild(spin)
  // row 是横向 flex（[spinner][内容]），内容包一层纵向容器复用 .msg.user 的
  // 堆叠布局：附件区在上、气泡居中、引用摘要行在下（与正式用户消息一致）。
  const body = el('div', 'msg user')
  // 附件与正式用户消息同款：图片缩略图（字节懒取）+ 文件名称 chip；
  // @ 文件引用同样提升到附件区（fileRefs）。
  const { text: readable, references } = parseSessionMentions(splitAttachmentLines(item.editText).text)
  const parts = readable.length > 0 ? renderUserBubbleParts(readable, references) : null
  const attachments = renderUserAttachments(item.images, mergedAttachments(parts?.files ?? [], item.files))
  if (attachments) body.appendChild(attachments)
  // 文本与正式用户消息同款：剥离 <attachment> 文件行，canonical mention
  // （@[标题](dsh-session:…)）展开成可读 @label + references——与 host 解析
  // 后落盘的形态一致，气泡据此拼可点击的会话 chip 与引用摘要行。
  if (parts) {
    body.appendChild(parts.bubble)
    if (parts.summary) body.appendChild(parts.summary)
  } else if (!attachments) {
    body.appendChild(el('div', 'bubble', t('(empty message)')))
  }
  row.appendChild(body)
  return row
}

/**
 * 消息里的图片：和待发送图片同款的方形小缩略图（复用 attach-thumb，点击
 * 放大）。字节走 session.attachment 懒取——渲染时未缓存就发
 * requestAttachment 并先画占位方块，attachmentData 到达后 render() 换成
 * 真图；加载失败回退为文件名 chip（保留点击预览）。
 */
function messageImageThumb(image: ChatImage): HTMLElement {
  const name = image.name ?? t('Image')
  const dataUrl = attachmentCache.get(image.attachmentId)
  if (!dataUrl) {
    if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
    const ph = el('span', 'attach-thumb msg-thumb-loading', '…')
    ph.title = t('{0} (loading…)', name)
    return ph
  }
  const item = el('span', 'attach-thumb')
  item.title = t('{0} (click to preview)', name)
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
  chip.appendChild(el('span', 'chip-name', image.name ?? t('Image')))
  chip.title = t('Click to preview')
  chip.addEventListener('click', () => {
    const dataUrl = attachmentCache.get(image.attachmentId)
    if (dataUrl) {
      openLightbox(dataUrl)
      return
    }
    pendingPreview = image.attachmentId
    if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
  })
  return chip
}

/** Compact chip for one attached file; click opens the path in the VS Code editor. */
function fileChip(file: ChatFile): HTMLElement {
  // 图片文件：先画图标 chip 并懒请求缩略图（回执后整卡换成缩略图，失败保持图标）。
  if (file.image && !fileThumbCache.has(file.path) && !fileThumbRequested.has(file.path)) {
    fileThumbRequested.add(file.path)
    post({ type: 'requestFileThumb', path: file.path })
  }
  if (file.image) {
    const dataUrl = fileThumbCache.get(file.path)
    if (dataUrl) return fileThumbItem(file, dataUrl)
  }
  const chip = el('span', 'file-chip')
  const icon = el('span', 'file-chip-icon')
  icon.appendChild(strokeSvg(FILE_ICON))
  chip.appendChild(icon)
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  chip.title = t('Open {0} in VS Code', file.path)
  chip.addEventListener('click', () => post({ type: 'openAttachmentFile', path: file.path }))
  return chip
}

/** 图片文件的缩略图 chip（历史消息）：点击放大（复用 attach-thumb 样式，底部名称横幅）。 */
function fileThumbItem(file: ChatFile, dataUrl: string): HTMLElement {
  const item = el('span', 'attach-thumb')
  item.title = t('{0} (click to preview)', file.name)
  const img = document.createElement('img')
  img.src = dataUrl
  img.alt = file.name
  img.addEventListener('error', () => item.replaceWith(fileIconChip(file)))
  item.addEventListener('click', () => openLightbox(dataUrl))
  item.appendChild(img)
  item.appendChild(el('span', 'thumb-name', file.name))
  return item
}

/** 缩略图加载失败/未取到时的纯图标 chip（点击打开文件）。 */
function fileIconChip(file: ChatFile): HTMLElement {
  const chip = el('span', 'file-chip')
  const icon = el('span', 'file-chip-icon')
  icon.appendChild(strokeSvg(FILE_ICON))
  chip.appendChild(icon)
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  chip.title = t('Open {0} in VS Code', file.path)
  chip.addEventListener('click', () => post({ type: 'openAttachmentFile', path: file.path }))
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
const detailsOpen = new Map<string, boolean>()

/**
 * 消息流里内部滚动容器（工具卡 IN/OUT、skill 指令卡、JSON 树等）的滚动位置
 * 存档（key 按渲染 key，同 detailsOpen 机制）：流式输出每帧全量重建消息 DOM，
 * 这些容器是新建元素、scrollTop 归零——用户正在滚动读内容会被顶回起点。
 * 重建前扫描 [data-scroll-key] 存下，重建后按 key 恢复。
 */
const innerScrollPositions = new Map<string, number>()

/** 给内部滚动容器打上重建后恢复滚动位置的锚（key 必须跨帧稳定）。 */
function markScrollable(el: HTMLElement, key: string): HTMLElement {
  el.dataset.scrollKey = key
  return el
}

/** 保存消息流里所有内部滚动容器的滚动位置（重建前调用）。 */
function saveInnerScroll(root: HTMLElement | null): void {
  if (!root) return
  const nodes = root.querySelectorAll<HTMLElement>('[data-scroll-key]')
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    const key = el.dataset.scrollKey
    if (key) innerScrollPositions.set(key, el.scrollTop)
  }
}

/** 恢复消息流里所有内部滚动容器的滚动位置（重建后调用）。 */
function restoreInnerScroll(root: HTMLElement | null): void {
  if (!root) return
  const nodes = root.querySelectorAll<HTMLElement>('[data-scroll-key]')
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    const key = el.dataset.scrollKey
    if (!key) continue
    const top = innerScrollPositions.get(key)
    if (top !== undefined && top > 0) el.scrollTop = top
  }
}
let detailsSession: string | null = null

/**
 * JSON tree node expand state. Key = `${outputKey}:${jsonPathKey}` (the output
 * key disambiguates colliding path spaces across tool blocks). Absent = the
 * default (root open, nested closed); present = the user's toggle. Cleared with
 * the other per-session disclosure state on session switch.
 */
const jsonTreeOpen = new Map<string, boolean>()

/**
 * 产物行「+N 个文件」的展开态（key = 消息位置键，同 detailsOpen 约定）：
 * 命中 = 展开显示全部 chip；换会话清空。
 */
const producedOpen = new Set<string>()

/**
 * workflow 运行卡片的展开/折叠状态，按 runId（run 级）/ `${runId}:${phase.key}`
 * （phase 级）持久化——runId 跨分页稳定，loadEarlier 补页不会错位；与 detailsOpen
 * 一样在换会话时清空。
 */
const workflowDisclosure = new Map<string, WorkflowDisclosureState>()

const COPY_FEEDBACK_MS = 1000

/**
 * 复制按钮「已复制」反馈的成功时刻（key 按复制入口的位置/路径）。流式输出每帧
 * 全量重建消息 DOM，新建的复制按钮初始文案都是「复制」，会把 1s 的「已复制」
 * 反馈冲掉。这里记下成功时刻：重建后距成功不足 1s 就初始渲染成「已复制」并按
 * 剩余时间恢复（同 detailsOpen/jsonTreeOpen 的跨重建持久化）。换会话时清空
 * （key 是位置键，跨会话无意义）。
 */
const copyConfirmedAt = new Map<string, number>()

/**
 * 复制成功：记下时刻并立即显示「已复制」，1s 后恢复。恢复带 guard——仅当距
 * 最近一次复制满 1s 才恢复，防止连点/旧 timer 在第二次复制未满 1s 时过早归位。
 * 若期间发生重建，旧按钮被丢弃，新按钮由 initCopyFeedback 补初始状态。
 */
function showCopyFeedback(key: string, showCopied: () => void, restore: () => void): void {
  copyConfirmedAt.set(key, Date.now())
  showCopied()
  setTimeout(() => {
    const at = copyConfirmedAt.get(key)
    if (at !== undefined && Date.now() - at >= COPY_FEEDBACK_MS) restore()
  }, COPY_FEEDBACK_MS)
}

/** 重建后给新按钮补初始「已复制」状态：距成功不足 1s 则按剩余时间渲染并恢复。 */
function initCopyFeedback(key: string, showCopied: () => void, restore: () => void): void {
  const at = copyConfirmedAt.get(key)
  if (at === undefined) return
  const elapsed = Date.now() - at
  if (elapsed >= COPY_FEEDBACK_MS) return
  showCopied()
  setTimeout(restore, COPY_FEEDBACK_MS - elapsed)
}

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
    done > 0 ? t('{0} done', done) : '',
    active > 0 ? t('{0} running', active) : '',
    pending > 0 ? t('{0} pending', pending) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 目标条幅编辑态（对齐官方 dsh-client-ui-goal GoalBar）：快照每帧重建 DOM，
 * draft 用模块级状态跨帧保留，焦点选区由 render() 恢复（见 goalFocus）。
 * goalEditingId 记着进入编辑态时的 goal id——换目标/换会话时自动退出编辑。
 */
let goalEditingId: string | null = null
let goalDraft = ''
/** 刚进入编辑态（点编辑按钮后的一次 render）：自动聚焦 input（对齐 web autoFocus）。 */
let goalAutoFocus = false

/** 目标条幅的图标按钮（28px 圆形、14px 图标，对齐 web GoalBar 的 iconBtn）。 */
function goalIconButton(icon: IconDef, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'goal-bar-btn'
  b.title = title
  b.setAttribute('aria-label', title)
  b.appendChild(iconSvg(icon, 14))
  return b
}

/** phase 标签文案（官方 zh 字典原样）。 */
const GOAL_PHASE_LABELS: Record<ChatGoal['phase'], string> = {
  active: t('Active goal'),
  paused: t('Paused goal'),
  blocked: t('Blocked goal'),
  complete: '',
}

/**
 * Goal 条幅（对齐官方 GoalBar：输入区上方、todo 之后 queue 之前的一条横带）：
 * 图标 + phase 标签 + 截断的 objective + 操作按钮。active 显示暂停、paused
 * 显示恢复、恒有编辑（条内内联 input，Enter 保存 / Escape 取消）与清除；
 * complete 返回 null 不渲染。blocked 时整条 title 显示受阻原因。
 */
function renderGoalBar(goal: ChatGoal): HTMLElement | null {
  if (goal.phase === 'complete') return null
  // 换目标（含 clear 后重开、切会话）时退出残留编辑态。
  if (goalEditingId !== null && goalEditingId !== goal.id) {
    goalEditingId = null
    goalDraft = ''
  }
  const dock = el('div', 'goal-bar-dock')
  const bar = el('div', 'goal-bar')
  bar.setAttribute('data-goal-bar', '')
  if (goal.phase === 'blocked') bar.title = goal.blockedReason?.message ?? ''

  if (goalEditingId === goal.id) {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'goal-bar-input'
    input.value = goalDraft
    input.setAttribute('aria-label', t('Goal content'))
    input.addEventListener('input', () => {
      goalDraft = input.value
      save.disabled = goalDraft.trim() === ''
    })
    input.addEventListener('keydown', (e) => {
      // isComposing: IME 候选窗打开时不保存（与 queue 编辑器同款）。
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        save.click()
      } else if (e.key === 'Escape') {
        goalEditingId = null
        goalDraft = ''
        render()
      }
    })
    bar.appendChild(input)
    const actions = el('div', 'goal-bar-actions')
    const save = goalIconButton(MESSAGE_ACTION_ICONS.check, t('Save goal'))
    save.disabled = goalDraft.trim() === ''
    save.addEventListener('click', () => {
      const text = goalDraft.trim()
      if (text === '') return
      goalEditingId = null
      goalDraft = ''
      post({ type: 'goalEdit', objective: text })
    })
    const cancel = goalIconButton(GOAL_ICONS.close, t('Cancel edit'))
    cancel.addEventListener('click', () => {
      goalEditingId = null
      goalDraft = ''
      render()
    })
    actions.appendChild(save)
    actions.appendChild(cancel)
    bar.appendChild(actions)
    dock.appendChild(bar)
    return dock
  }

  const glyph = el('span', 'goal-bar-glyph')
  glyph.appendChild(iconSvg(GOAL_ICONS.goal, 14))
  bar.appendChild(glyph)
  bar.appendChild(el('span', 'goal-bar-label', GOAL_PHASE_LABELS[goal.phase]))
  bar.appendChild(el('span', 'goal-bar-objective', goal.objective))
  const actions = el('div', 'goal-bar-actions')
  if (goal.phase === 'active') {
    const pause = goalIconButton(GOAL_ICONS.pause, t('Pause goal'))
    pause.addEventListener('click', () => post({ type: 'goalPause' }))
    actions.appendChild(pause)
  } else if (goal.phase === 'paused') {
    const resume = goalIconButton(GOAL_ICONS.play, t('Resume goal'))
    resume.addEventListener('click', () => post({ type: 'goalResume' }))
    actions.appendChild(resume)
  }
  const edit = goalIconButton(PANEL_ICONS.edit, t('Edit goal'))
  edit.addEventListener('click', () => {
    goalDraft = goal.objective
    goalEditingId = goal.id
    goalAutoFocus = true
    render()
  })
  const clear = goalIconButton(GOAL_ICONS.trash, t('Clear goal'))
  clear.addEventListener('click', () => post({ type: 'goalClear' }))
  actions.appendChild(edit)
  actions.appendChild(clear)
  bar.appendChild(actions)
  dock.appendChild(bar)
  return dock
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
  summary.appendChild(el('span', 'todo-panel-title', t('Tasks')))
  const progress = todoProgressLabel(todos)
  summary.appendChild(el('span', 'todo-panel-progress', progress))
  const chev = iconSvg(PANEL_ICONS.chevronUp, 14)
  chev.classList.add('todo-chevron')
  summary.appendChild(chev)
  det.appendChild(summary)
  const list = markScrollable(el('ul', 'todo-list'), 'todos')
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
let turnStatusStart: number | null = null
let turnStatusTimer: ReturnType<typeof setInterval> | null = null

/** Drop the clock interval; every render calls this before rebuilding. */
function clearTurnStatusTimer(): void {
  if (turnStatusTimer !== null) {
    clearInterval(turnStatusTimer)
    turnStatusTimer = null
  }
}

function renderTurnStatus(): HTMLElement {
  if (turnStatusStart === null) turnStatusStart = Date.now()
  const start = turnStatusStart
  const row = el('div', 'turn-status')
  row.setAttribute('role', 'status')
  row.setAttribute('aria-live', 'polite')
  const statusText = el('span', 'turn-status-text', 'Deep diving...')
  // 1.8s shimmer 相位续播：流式每帧重建该行，不补进度会每帧从头闪。
  syncAnimPhase(statusText, 1800)
  row.appendChild(statusText)
  const clock = el('span', 'turn-status-clock')
  const tick = (): void => {
    const elapsed = Date.now() - start
    clock.textContent = elapsed >= 15000 ? formatDuration(elapsed) : ''
  }
  tick()
  row.appendChild(clock)
  turnStatusTimer = setInterval(tick, 1000)
  return row
}

/**
 * 用户消息附件区（在文字气泡上方，对齐 dsh web）：图片显示方形缩略图，
 * 文件仍是名称 chip。无附件时返回 null。正式用户消息与等待插话气泡共用。
 */
function renderUserAttachments(
  images: readonly ChatImage[] | undefined,
  files: readonly ChatFile[] | undefined,
): HTMLElement | null {
  const attachments = el('div', 'msg-images')
  if (images) for (const image of images) attachments.appendChild(messageImageThumb(image))
  if (files) for (const file of files) attachments.appendChild(fileChip(file))
  return attachments.childElementCount > 0 ? attachments : null
}

/**
 * 用户气泡（纯文本不走 markdown，引用按段拼成 chip，对齐 dsh web 的
 * projectUserText）：会话 chip 可点击（host 解析过的引用落盘为可读
 * @label 文本，URI 由 fold 回挂在 m.references 里优先切；未解析的
 * 原始 mention 如引用失败残留走 URI 匹配），@file/@folder 与 /command
 * 按文本形态推断成纯展示 chip（官方同款，无 host 结构化数据）。
 * 返回 [气泡, 引用摘要行?]；摘要行只含会话（对齐 dsh web referenceSummary
 * 「引用会话 · A、B」）。正式用户消息与等待插话气泡共用。
 */
function renderUserBubbleParts(
  text: string,
  references?: readonly { sessionId: string; label: string }[],
): { bubble: HTMLElement; summary: HTMLElement | null; files: ChatFile[] } {
  const bubble = el('div', 'bubble')
  const fileRefs: ChatFile[] = []
  for (const seg of splitUserBubble(text, references)) {
    if (seg.kind === 'text') bubble.appendChild(document.createTextNode(seg.text))
    else if (seg.kind === 'session') bubble.appendChild(sessionMentionChip(seg.label, seg.sessionId))
    else if (seg.kind === 'file') {
      // @ 文件引用不在行内渲染：提升到附件区（与 <attachment> 折叠同款）——
      // 图片显示缩略图（懒加载），其他文件显示图标 chip，点击打开。
      const target = seg.path.replace(/^@/, '').replace(/^"|"$/g, '')
      fileRefs.push({
        name: seg.label,
        path: target,
        ...(isImagePath(target) ? { image: true } : {}),
      })
    } else bubble.appendChild(referenceChip(seg))
  }
  const summary = references?.length
    ? el('div', 'ref-summary', t('Referenced sessions: {0}', references.map((r) => r.label).join(t(', '))))
    : null
  return { bubble, summary, files: fileRefs }
}

/** 合并消息内既有附件与 @ 文件引用（按 path 去重）后的附件渲染列表。 */
function mergedAttachments(fileRefs: ChatFile[], existing: readonly ChatFile[] | undefined): ChatFile[] {
  const byPath = new Map<string, ChatFile>()
  for (const f of existing ?? []) byPath.set(f.path, f)
  for (const f of fileRefs) if (!byPath.has(f.path)) byPath.set(f.path, f)
  return [...byPath.values()]
}

function renderMessage(m: ChatMessage, key: string): HTMLElement {
  if (m.kind === 'user') {
    // Host-injected context renders collapsed; only real human input bubbles.
    if (m.context) {
      return renderInjectedContext(contextOf(m.context), m.text, key)
    }
    const row = el('div', 'msg user')
    // 附件在文字气泡上方（对齐 dsh web）：图片显示方形缩略图，文件仍是名称 chip。
    const parts = m.text ? renderUserBubbleParts(m.text, m.references) : null
    const attachments = renderUserAttachments(m.images, mergedAttachments(parts?.files ?? [], m.files))
    if (attachments) row.appendChild(attachments)
    if (parts) {
      row.appendChild(parts.bubble)
      if (parts.summary) row.appendChild(parts.summary)
    }
    return row
  }
  if (m.kind === 'command') {
    // 手动 /compact 完成后，命令卡渲染成压缩摘要卡（对齐官方
    // CompactionCommandCard → CompactionItem）：checkpoint 的
    // sourceCommandId 命中本卡时挂上 compaction 数据。
    if (m.compaction) {
      return renderCompactionCard(key, {
        title: `/${m.name}${m.args ? ` ${m.args}` : ''}`,
        summary: m.compaction.summary,
        items: m.compaction.items,
        tokens: m.compaction.tokens,
        fallback: m.text,
      })
    }
    // Slash-command lifecycle flow node (dsh command/run + command/done).
    // 多行输出可展开（对齐 dsh web GenericCommandCard：含换行才算有正文）：
    // 折叠态显示命令名 + 输出首行，展开显示全文。
    const row = el('div', `msg command-row ${m.status}`)
    const text = m.text ?? ''
    if (text.includes('\n')) {
      const det = detailsEl(`${key}:cmd`, 'command-detail', '')
      const summary = det.querySelector('summary') as HTMLElement
      summary.appendChild(el('span', 'command-line', `/${m.name}${m.args ? ` ${m.args}` : ''}`))
      if (m.status === 'running') summary.appendChild(spinnerEl())
      summary.appendChild(el('span', 'command-text', text.split('\n')[0]))
      det.appendChild(el('pre', 'command-body', text))
      row.appendChild(det)
    } else {
      row.appendChild(el('span', 'command-line', `/${m.name}${m.args ? ` ${m.args}` : ''}`))
      if (m.status === 'running') row.appendChild(spinnerEl())
      if (text) row.appendChild(el('span', 'command-text', text))
    }
    return row
  }
  if (m.kind === 'compaction') {
    // 自动压缩的独立标记卡（对齐官方 CompactionItem）：默认折叠，有摘要才可展开。
    return renderCompactionCard(key, {
      title: t('Context compacted'),
      summary: m.summary,
      items: m.items,
      tokens: m.tokens,
    })
  }
  const row = el('div', 'msg assistant')
  m.blocks.forEach((block, bi) => row.appendChild(renderBlock(block, `${key}:b${bi}`)))
  if (!m.complete) row.appendChild(el('div', 'streaming', '▍'))
  if (m.interrupted) row.appendChild(el('div', 'interrupted', t('Interrupted')))
  if (m.turnError) row.appendChild(renderTurnError(m.turnError))
  if (m.maxTokens) row.appendChild(renderMaxTokensNotice())
  // 产物行（对齐 dsh web ProducedFiles 的 turn-tail 槽位）：在操作栏之前。
  if (m.producedFiles && m.producedFiles.length > 0) {
    row.appendChild(renderProducedFiles(m.producedFiles, `${key}:produced`))
  }
  // Copy/feedback/fork attach only to the turn's final message (turnEnd): a
  // turn split by mid-turn injected user/messages folds into several complete
  // messages, and the bar must not repeat on each. Also meaningless on an
  // empty marker-only message (turn failed / was interrupted / hit the token
  // cap before any content).
  if (m.turnEnd && !(m.blocks.length === 0 && (m.turnError || m.interrupted || m.maxTokens))) {
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
    root.appendChild(el('div', 'workflow-empty', t('No members started')))
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
    row.appendChild(el('span', 'workflow-run-count', t('{0} members', disp.activityCount)))
    row.appendChild(renderWorkflowStatusTail(run.status))
  }
  return row
}

/** 状态点 + 状态词（dsh web statusTail）。 */
function renderWorkflowStatusTail(status: WorkflowRunStatus): HTMLElement {
  const tail = el('span', 'workflow-status-tail')
  tail.appendChild(workflowStateDot(status))
  tail.appendChild(el('span', undefined, t(WORKFLOW_STATUS_TEXT[status])))
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
    header.appendChild(el('span', 'workflow-phase-count', t('{0} members', phase.members.length)))
    header.appendChild(el('span', 'workflow-phase-status', workflowPhaseStatusSummary(phase.members, t)))
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
  row.appendChild(el('span', 'workflow-member-label', m.label || t('(unnamed member)')))
  row.appendChild(el('span', 'workflow-member-status', t(WORKFLOW_STATUS_TEXT[m.status])))
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
  row.appendChild(el('span', 'turn-error-title', t('This turn failed')))
  row.appendChild(el('span', 'turn-error-message', err.message))
  if (err.code) row.appendChild(el('span', 'turn-error-code', err.code))
  return row
}

/**
 * Max-tokens notice row, mirroring the official web client's TurnMaxTokensItem:
 * warning StateDot + 「已达到输出 token 上限」+ hint；与 TurnErrorItem 同构
 * （官方同用 turnErrorRow 布局），仅配色换 warning。
 */
function renderMaxTokensNotice(): HTMLElement {
  const row = el('div', 'turn-error max-tokens')
  row.appendChild(el('span', 'turn-error-dot'))
  row.appendChild(el('span', 'turn-error-title', t('Output token limit reached')))
  row.appendChild(
    el('span', 'turn-error-message', t('The answer was truncated; existing output stays in the conversation. Send “continue” to let the model continue.')),
  )
  return row
}

/**
 * 压缩摘要卡（对齐官方 CompactionItem）：默认折叠；折叠态一行 = 标题 + 分隔点
 * + 摘要（计数齐时「已压缩 N 条历史记录（约 M tokens）」，否则 fallback 或
 * 「点击查看压缩摘要」）；summary 为 null 时不可展开（无摘要按钮，纯展示行）。
 * 展开态 body 渲染摘要全文（markdown）。展开状态按 key 持久化在 detailsOpen。
 */
function renderCompactionCard(
  key: string,
  opts: { title: string; summary: string | null; items: number | null; tokens: number | null; fallback?: string },
): HTMLElement {
  const expandable = opts.summary !== null
  const summaryText =
    opts.items !== null && opts.tokens !== null
      ? t('Compacted {0} history messages (about {1} tokens)', opts.items, opts.tokens)
      : opts.fallback ?? (expandable ? t('Click to view the compacted summary') : t('Compaction summary unavailable'))
  if (!expandable) {
    // 无摘要（compaction/summary 落在窗口外）：纯展示行，disabled。
    const row = el('div', 'compaction-row')
    row.appendChild(el('span', 'compaction-title', opts.title))
    row.appendChild(el('span', 'compaction-sep'))
    row.appendChild(el('span', 'compaction-summary', summaryText))
    return row
  }
  const det = detailsEl(`${key}:compact`, 'compaction', '')
  const summary = det.querySelector('summary') as HTMLElement
  const chevron = iconSvg(PANEL_ICONS.chevronDown, 14)
  chevron.classList.add('compaction-chevron', det.open ? 'open' : 'collapsed')
  summary.appendChild(chevron)
  summary.appendChild(el('span', 'compaction-title', opts.title))
  summary.appendChild(el('span', 'compaction-sep'))
  summary.appendChild(el('span', 'compaction-summary', summaryText))
  det.addEventListener('toggle', () => {
    chevron.classList.toggle('open', det.open)
    chevron.classList.toggle('collapsed', !det.open)
  })
  const body = el('div', 'md compaction-body')
  body.innerHTML = md(opts.summary as string)
  enhanceCodeBlocks(body, `${key}:compact`)
  det.appendChild(body)
  return det
}

/**
 * 模型重试行（对齐官方 ModelRetryItem）：折叠行 = 状态文本（含倒计时），展开
 * 显示重试延迟 + 失败原因。scheduled 等待期行上每秒刷新剩余秒数（只改自己
 * 的文本节点，不触发列表重渲染；render 重建时会先清掉所有重试行计时器）。
 */
const RETRY_LABELS: Record<ChatRetryBlock['retryState'], string> = {
  scheduled: t('Retrying model request'),
  started: t('Model request retried'),
  cancelled: t('Model request retry cancelled'),
}

let retryTimers = new Set<ReturnType<typeof setInterval>>()

function clearRetryTimers(): void {
  for (const t of retryTimers) clearInterval(t)
  retryTimers = new Set()
}

function retrySeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

function renderRetryRow(block: ChatRetryBlock, key: string): HTMLElement {
  const det = detailsEl(`${key}:retry`, 'retry-row', '')
  if (block.retryState === 'scheduled') det.setAttribute('data-active', '')
  const maximum = block.mode === 'normal' ? String(block.maxRetries ?? '?') : '∞'
  const status = el('span', 'retry-text')
  // 1.6s retry-shimmer 相位续播：快照重建该行时不再从头闪。
  syncAnimPhase(status, 1600)
  const scheduledSeconds = retrySeconds(block.delayMs)
  const setStatus = (): void => {
    const seconds =
      block.retryState === 'scheduled'
        ? retrySeconds((block.time ?? Date.now()) + block.delayMs - Date.now())
        : scheduledSeconds
    status.textContent = `${RETRY_LABELS[block.retryState]}（${block.retry}/${maximum}） · ${seconds}s`
  }
  setStatus()
  if (block.retryState === 'scheduled') {
    // 倒计时：每秒刷新自己的文本节点；到 0 后停表（剩余显示 1s，等下一个
    // 快照把状态推进到 started）。
    const timer = setInterval(() => {
      setStatus()
      if ((block.time ?? Date.now()) + block.delayMs - Date.now() <= 0) {
        clearInterval(timer)
        retryTimers.delete(timer)
      }
    }, 1000)
    retryTimers.add(timer)
  }
  det.querySelector('summary')?.appendChild(status)
  const details = el('div', 'retry-details')
  const delay = el('div')
  delay.appendChild(el('span', 'retry-detail-label', t('Retry delay: ')))
  delay.appendChild(document.createTextNode(`${Math.round(block.delayMs)}ms`))
  details.appendChild(delay)
  const failure = el('div')
  failure.appendChild(el('span', 'retry-detail-label', t('Failure reason: ')))
  failure.appendChild(document.createTextNode(block.failure.message))
  details.appendChild(failure)
  det.appendChild(details)
  return det
}

/** Plain-text content of one assistant message (text + reasoning blocks). */
function assistantText(m: ChatAssistantMessage): string {
  return m.blocks
    .filter((b) => b.type === 'text' || b.type === 'reasoning')
    .map((b) => (b as { text: string }).text)
    .filter(Boolean)
    .join('\n\n')
}

/** 最多六个 chip 竞争一行展示；其余路径只保留在计数里（对齐官方 SHOWN_LIMIT）。 */
const PRODUCED_SHOWN_LIMIT = 6

/**
 * 产物行（对齐 dsh web ProducedFiles，比官方多一个展开交互）：label + 最多
 * 6 个文件 chip（点击在 VSCode 编辑器打开该文件）；超出的部分折叠成
 * 「+N 个文件」——点击展开全部 chip，展开后变「收起」（官方 web 是静态
 * 计数不可展开，这里按用户验收反馈补上）。宽度自适应测量简化为固定上限。
 */
function renderProducedFiles(paths: string[], key: string): HTMLElement {
  const expanded = producedOpen.has(key)
  const row = el('div', 'produced-files')
  row.appendChild(el('span', 'produced-label', t('Outputs')))
  const lane = el('div', 'produced-lane')
  const shown = paths.slice(0, expanded ? paths.length : PRODUCED_SHOWN_LIMIT)
  for (const path of shown) {
    const chip = el('button', 'produced-file') as HTMLButtonElement
    chip.type = 'button'
    chip.title = path
    chip.textContent = producedBasename(path)
    chip.addEventListener('click', () => post({ type: 'producedOpenFile', path }))
    lane.appendChild(chip)
  }
  if (paths.length > PRODUCED_SHOWN_LIMIT) {
    // 折叠态显示「+N 个文件」，展开态显示「收起」；click 只更新持久化状态，
    // 再同步 render() 按新状态重画（同 workflow 卡 toggle 的模式——终态
    // snapshot 不再来，不补一次点击会像没反应）。
    const toggle = el('button', 'produced-more') as HTMLButtonElement
    toggle.type = 'button'
    toggle.textContent = expanded ? t('Collapse') : t('+ {0} files', paths.length - shown.length)
    toggle.title = expanded ? t('Collapse all output chips') : t('Expand all output files')
    toggle.addEventListener('click', () => {
      if (expanded) producedOpen.delete(key)
      else producedOpen.add(key)
      render()
    })
    lane.appendChild(toggle)
  }
  row.appendChild(lane)
  return row
}

/** Action row under a completed assistant message: copy / feedback / fork. */
function renderAssistantActions(m: ChatAssistantMessage): HTMLElement {
  const actions = el('div', 'msg-actions')
  const copy = iconButton(MESSAGE_ACTION_ICONS.copy, t('Copy'))
  const copyIcon = copy.firstChild as SVGSVGElement
  const checkIcon = iconSvg(MESSAGE_ACTION_ICONS.check)
  copy.addEventListener('click', () => {
    const text = assistantText(m)
    if (!text) return
    // Top-level document: the async clipboard API is available.
    void navigator.clipboard.writeText(text).then(
      () => {
        copy.replaceChild(checkIcon, copyIcon)
        copy.title = t('Copied')
        setTimeout(() => {
          copy.replaceChild(copyIcon, checkIcon)
          copy.title = t('Copy')
        }, 1000)
      },
      () => {
        copy.title = t('Copy failed')
      },
    )
  })
  actions.appendChild(copy)

  const messageId = m.messageId
  const ratings: Array<{ rating: 'positive' | 'negative'; icon: IconDef; hint: string }> = [
    { rating: 'positive', icon: MESSAGE_ACTION_ICONS.like, hint: t('Helpful') },
    { rating: 'negative', icon: MESSAGE_ACTION_ICONS.dislike, hint: t('Not helpful') },
  ]
  for (const { rating, icon, hint } of ratings) {
    const btn = iconButton(icon, hint)
    if (m.feedbackRating === rating) btn.classList.add('active')
    if (!messageId) {
      // The host never persisted an id for this message: feedback RPCs need it.
      btn.disabled = true
      btn.title = t('Feedback is not available for this message')
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
    const fork = iconButton(MESSAGE_ACTION_ICONS.branch, t('Fork'))
    fork.title = t('Create a branch session from this message')
    fork.addEventListener('click', () => {
      fork.disabled = true
      post({ type: 'fork', atSeq })
    })
    actions.appendChild(fork)
  }

  // Turn-level timing rides the action row's tail (web parity: TurnTailNodeView
  // renders 时钟 + 用时/首 token/吞吐 after the icons with clock="end").
  if (m.timing) actions.appendChild(renderTurnTiming(m.timing))
  return actions
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 操作栏行尾的 turn 级计时（对齐官方 formatMessageClock + zh 文案）：
 * 同日 HH:MM，更早显示日期前缀；指标只有存在时才显示，用 · 分隔。
 */
function renderTurnTiming(timing: NonNullable<ChatAssistantMessage['timing']>): HTMLElement {
  const wrap = el('span', 'msg-timing')
  const d = new Date(timing.time)
  const now = new Date()
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    wrap.appendChild(document.createTextNode(clock))
  } else if (d.getFullYear() === now.getFullYear()) {
    wrap.appendChild(document.createTextNode(t('{0}/{1} {2}', d.getMonth() + 1, d.getDate(), clock)))
  } else {
    wrap.appendChild(document.createTextNode(t('{0}/{1}/{2} {3}', d.getFullYear(), d.getMonth() + 1, d.getDate(), clock)))
  }
  const parts: string[] = []
  if (timing.runMs !== undefined) parts.push(t("Duration {0}", formatRunDuration(timing.runMs)))
  if (timing.ttftMs !== undefined) parts.push(t('First token {0}s', formatLatencySeconds(timing.ttftMs)))
  if (timing.tokensPerSecond !== undefined) parts.push(`${formatTokensPerSecond(timing.tokensPerSecond)} tok/s`)
  for (const part of parts) {
    wrap.appendChild(el('span', 'msg-timing-dot', '·'))
    wrap.appendChild(document.createTextNode(part))
  }
  return wrap
}

/** 官方 formatRunDuration：分钟级「2分42秒」，秒级「12秒」。 */
function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? t('{0}m {1}s', minutes, pad2(seconds)) : t('{0}s', seconds)
}

/** 官方 formatLatencySeconds：10 秒内一位小数，其余取整（不带单位）。 */
function formatLatencySeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s))
}

/** 官方 formatTokensPerSecond：≥10 取整，其余一位小数。 */
function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
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
      decorateCommitHashes(div)
      return div
    }
    case 'reasoning': {
      // 折叠态摘要带推理首行预览（对齐 dsh web ReasoningRow：Think · 首行），
      // 首行包 span 用 CSS ellipsis 截断，不撑开行宽；流式时每次重建取当前首行。
      const firstLine = block.text.split('\n')[0]?.trim() ?? ''
      const det = detailsEl(`${key}:reason`, 'reasoning', '')
      const summary = det.querySelector('summary') as HTMLElement
      summary.appendChild(iconSvg(THINK_ICON, 14))
      summary.appendChild(el('span', 'reasoning-summary', firstLine ? t('Thoughts · {0}', firstLine) : t('Thoughts')))
      det.appendChild(el('div', 'reasoning-body', block.text))
      return det
    }
    case 'tool':
      return renderTool(block, key)
    case 'retry':
      // 模型重试行（对齐官方 ModelRetryItem）：倒计时 + 失败原因 + 最大次数。
      return renderRetryRow(block, key)
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
  return el('div', 'tool-snapshot-note', t('Snapshot copy: the subagent is no longer in this session'))
}

/**
 * 专用工具卡的行首状态位（对齐 dsh web 各专用卡 leadingFor）：running →
 * spinner（dsh-one 惯例），error → StateDot 红点，其余 → 专用图标。
 */
function toolLeading(icon: IconDef, status: ChatToolBlock['status']): HTMLElement {
  if (status === 'running') return spinnerEl()
  if (status === 'error') {
    const dot = el('span', 'tool-state-dot')
    dot.setAttribute('data-state', 'error')
    return dot
  }
  const ic = el('span', 'tool-leading')
  ic.appendChild(iconSvg(icon, 14))
  return ic
}

/** 专用卡行内的分隔点 + 摘要（errorSummary 红字，其余普通灰字）。 */
function toolCardSummary(errorSummary: string | null, fallback: string): HTMLElement {
  const summary = el('span', errorSummary ? 'tool-title tool-title-error' : 'tool-title', errorSummary ?? fallback)
  return summary
}

/**
 * skill 工具专用卡（对齐 dsh web SkillRow）：行首 Skill 图标（running 时
 * spinner、error 时红点）+ 「Skill」+ 分隔点 + skill 名（error 时输出首行）；
 * 有指令全文（result 输出）才可展开，展开出「说明」指令卡（max-height 260
 * 内滚动）。dsh web 的 Inspect 按钮依赖轨迹面板，dsh-one 没有，省略。
 */
function renderSkillRow(block: ChatToolBlock, key: string): HTMLElement {
  const card = skillCardModel(block)
  const row = el('div', `tool tool-skill tool-${block.status}`)
  const line = el('div', 'tool-line')
  line.appendChild(toolLeading(SKILL_ICON, block.status))
  line.appendChild(el('span', 'tool-action', 'Skill'))
  line.appendChild(el('span', 'tool-sep'))
  line.appendChild(toolCardSummary(card.errorSummary, card.name))
  if (!card.output) {
    // 无指令全文：静态行（running 或 result 无文本）。
    row.appendChild(line)
    return row
  }
  const det = el('details', 'tool-disclosure') as HTMLDetailsElement
  det.open = detailsOpen.get(`${key}:tool`) ?? false
  det.addEventListener('toggle', () => detailsOpen.set(`${key}:tool`, det.open))
  const summary = el('summary')
  const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
  chev.classList.add('tool-chevron')
  line.appendChild(chev)
  summary.appendChild(line)
  det.appendChild(summary)
  const instructions = el('div', 'skill-instructions-card')
  instructions.appendChild(el('div', 'skill-instructions-header', t('Instructions')))
  instructions.appendChild(markScrollable(el('pre', 'skill-instructions', card.output), `${key}:instructions`))
  det.appendChild(instructions)
  row.appendChild(det)
  return row
}

/**
 * cordis_define 专用卡（对齐 dsh web CordisDefineRow）：行首 Code 图标 +
 * 「注册 Cordis 插件」+ 分隔点 + 插件名 + 用途（灰字，缺省「(未填写用途)」）；
 * 有 Host/Client 源码或输出才可展开，展开出两段源码（Host/Client，各
 * max-height 260 内滚动）+ 结果段。dsh web 的插件运行状态 readout 依赖
 * cordis inventory 数据链路，dsh-one 没有，省略（静态版）。
 */
function renderCordisDefineRow(block: ChatToolBlock, key: string): HTMLElement {
  const card = cordisDefineCardModel(block)
  const row = el('div', `tool tool-cordis tool-cordis-define tool-${block.status}`)
  const line = el('div', 'tool-line')
  line.appendChild(toolLeading(CODE_ICON, block.status))
  line.appendChild(el('span', 'tool-action', t('Register Cordis plugin')))
  line.appendChild(el('span', 'tool-sep'))
  line.appendChild(toolCardSummary(card.errorSummary, card.name))
  // error 时只显示错误摘要，purpose 让位（web 同款：purpose 仅在无错误时展示）。
  if (card.errorSummary === null) {
    line.appendChild(el('span', 'tool-purpose', card.purpose ?? t('(no purpose given)')))
  }
  const expandable = card.hostCode !== null || card.clientCode !== null || card.output !== null
  if (!expandable) {
    row.appendChild(line)
    return row
  }
  const det = el('details', 'tool-disclosure') as HTMLDetailsElement
  det.open = detailsOpen.get(`${key}:tool`) ?? false
  det.addEventListener('toggle', () => detailsOpen.set(`${key}:tool`, det.open))
  const summary = el('summary')
  const chev = iconSvg(PANEL_ICONS.chevronDown, 14)
  chev.classList.add('tool-chevron')
  line.appendChild(chev)
  summary.appendChild(line)
  det.appendChild(summary)
  const body = el('div', 'tool-disclosure-body')
  for (const [label, code] of [
    ['Host', card.hostCode],
    ['Client', card.clientCode],
  ] as const) {
    if (code === null) continue
    const section = el('div', 'cordis-source')
    section.appendChild(el('div', 'cordis-source-label', label))
    section.appendChild(markScrollable(el('pre', 'cordis-source-code', code), `${key}:cordis:${label.toLowerCase()}`))
    body.appendChild(section)
  }
  if (card.output !== null) {
    const section = el('div', 'cordis-source')
    section.appendChild(el('div', 'cordis-source-label', t('Result')))
    section.appendChild(markScrollable(el('pre', 'cordis-source-code', card.output), `${key}:cordis:output`))
    body.appendChild(section)
  }
  det.appendChild(body)
  row.appendChild(det)
  return row
}

/**
 * cordis_run 专用卡（对齐 web CordisRunRow 的静态版）：行首 Code 图标 +
 * 「运行/更新 Cordis 插件」（args.mode） + 分隔点 + pluginId · packageId
 * （error 时输出首行）；输出直接平铺在行下（web 同款，非 disclosure）。
 * dsh web 的 inventory 运行状态、awaiting-approval/superseded 提示与
 * 插件自注册业务视图都依赖 cordis 面板数据链路，dsh-one 没有，省略。
 */
function renderCordisRunRow(block: ChatToolBlock, key: string): HTMLElement {
  const card = cordisRunCardModel(block)
  const row = el('div', `tool tool-cordis tool-cordis-run tool-${block.status}`)
  const line = el('div', 'tool-line')
  line.appendChild(toolLeading(CODE_ICON, block.status))
  line.appendChild(el('span', 'tool-action', card.mode === 'update' ? t('Update Cordis plugin') : t('Run Cordis plugin')))
  line.appendChild(el('span', 'tool-sep'))
  const identity = card.pluginId ? `${card.pluginId}${card.packageId ? ` · ${card.packageId}` : ''}` : block.callId
  line.appendChild(toolCardSummary(card.errorSummary, identity))
  row.appendChild(line)
  if (card.output !== null) row.appendChild(renderToolOutput(card.output, `${key}:out`))
  return row
}

/**
 * cordis_stop / cordis_undefine 专用卡（对齐 web CordisActionRow）：行首
 * Stop/Trash 图标 + 「停止/移除 Cordis 插件」 + 分隔点 + pluginId（error 时
 * 输出首行）；输出直接平铺。与 cordis_run 一样无 inventory 依赖，静态版。
 */
function renderCordisActionRow(block: ChatToolBlock, key: string): HTMLElement {
  const card = cordisActionCardModel(block)
  const remove = block.name === 'cordis_undefine'
  const row = el('div', `tool tool-cordis tool-cordis-action tool-${block.status}`)
  const line = el('div', 'tool-line')
  line.appendChild(toolLeading(remove ? TRASH_ICON : STOP_ICON, block.status))
  line.appendChild(el('span', 'tool-action', remove ? t('Remove Cordis plugin') : t('Stop Cordis plugin')))
  line.appendChild(el('span', 'tool-sep'))
  line.appendChild(toolCardSummary(card.errorSummary, card.pluginId ?? block.callId))
  row.appendChild(line)
  if (card.output !== null) row.appendChild(renderToolOutput(card.output, `${key}:out`))
  return row
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
 * skill / cordis_* 走专用卡分流（按工具名，对齐 dsh web tool.call.toolview
 * 插槽的 entryKey 分发）。
 */
function renderTool(block: ChatToolBlock, key: string): HTMLElement {
  switch (block.name) {
    case 'skill':
      return renderSkillRow(block, key)
    case 'cordis_define':
      return renderCordisDefineRow(block, key)
    case 'cordis_run':
      return renderCordisRunRow(block, key)
    case 'cordis_stop':
    case 'cordis_undefine':
      return renderCordisActionRow(block, key)
    default:
      break
  }
  const row = el('div', `tool tool-${block.status}`)
  const line = el('div', 'tool-line')
  const snapshotNote = subagentSnapshotNote(block)
  if (block.status === 'running') {
    line.appendChild(spinnerEl())
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
    const head = t('{0}/{1} done', s.done, s.total)
    line.appendChild(el('span', 'tool-action', t('Update task list')))
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
  const body = asJson ? renderJsonOrText(text, key) : el('pre', '', text)
  // 非 JSON 路径才是单个滚动 <pre>；JSON 路径的树由 renderJsonTree 自己打标。
  if (!body.classList.contains('json-tree-shell')) markScrollable(body as HTMLElement, key)
  box.appendChild(body)
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
  box.appendChild(markScrollable(el('pre', '', open ? output : preview), key))
  if (truncated) {
    const toggle = el('div', 'tool-output-toggle', open ? t('Collapse output') : t('… {0} lines, click to expand', totalLines))
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
  const copy = buttonEl('json-tree-copy', t('Copy'))
  copy.title = t('Copy JSON')
  const copyKey = `${outputKey}:tree-copy`
  const showCopied = () => {
    copy.textContent = t('Copied')
    copy.title = t('Copied')
  }
  const restore = () => {
    copy.textContent = t('Copy')
    copy.title = t('Copy JSON')
  }
  copy.addEventListener('click', () => {
    const text = jsonTreeCopyText(value)
    void navigator.clipboard.writeText(text).then(
      () => showCopyFeedback(copyKey, showCopied, restore),
      () => {
        copy.title = t('Copy failed')
      },
    )
  })
  initCopyFeedback(copyKey, showCopied, restore)
  bar.appendChild(copy)
  shell.appendChild(bar)

  const tree = el('div', 'json-tree')
  markScrollable(tree, `${outputKey}:tree`)
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
    if (row.key !== null) line.appendChild(renderJsonNodeCopy(outputKey, rootValue, row.path))
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
  if (row.key !== null) line.appendChild(renderJsonNodeCopy(outputKey, rootValue, row.path))
  return line
}

/**
 * 一行树节点的尾部复制图标（hover 出现，克制样式与容器级按钮一致）：点击复制
 * 该节点（路径解析出的子值）的 pretty JSON。反馈与容器按钮同款——成功把图标短暂
 * 换成勾、title「已复制」1s 后还原，失败改 title；行级空间小，用图标变化而非文案。
 */
function renderJsonNodeCopy(outputKey: string, rootValue: JsonContainer, path: JsonPath): HTMLElement {
  const btn = el('button', 'json-tree-copy-icon') as HTMLButtonElement
  btn.type = 'button'
  btn.title = t('Copy')
  const copyIcon = iconSvg(MESSAGE_ACTION_ICONS.copy, 12)
  const checkIcon = iconSvg(MESSAGE_ACTION_ICONS.check, 12)
  btn.appendChild(copyIcon)
  const copyKey = `${outputKey}:node-copy:${jsonPathKey(path)}`
  const showCopied = () => {
    btn.replaceChild(checkIcon, copyIcon)
    btn.title = t('Copied')
  }
  const restore = () => {
    btn.replaceChild(copyIcon, checkIcon)
    btn.title = t('Copy')
  }
  // 路径解析在 click 时做（流式重建后行可能已失效）；解析不到就不复制。
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const subValue = jsonValueAtPath(rootValue, path)
    if (subValue === undefined) return
    const text = jsonTreeCopyText(subValue)
    void navigator.clipboard.writeText(text).then(
      () => showCopyFeedback(copyKey, showCopied, restore),
      () => {
        btn.title = t('Copy failed')
      },
    )
  })
  initCopyFeedback(copyKey, showCopied, restore)
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
 * diff 块（左右分栏）：左栏 oldText、右栏 newText，行对逐行对齐（LCS，见
 * diffAlign.ts）。默认只渲染前 DIFF_PREVIEW_LINES 行对，其余折叠成「展开其余
 * N 行差异」toggle（对齐 dsh web DiffBlock 的行折叠）。展开状态记在
 * detailsOpen（key 按消息/块位置），流式重建不冲掉。
 */
function renderDiff(diff: { oldText: string; newText: string }, key: string): HTMLElement {
  const box = el('div', 'diff')
  const pairs = alignDiffLines(diff.oldText, diff.newText)
  const grid = el('div', 'diff-grid')
  const open = detailsOpen.get(key) ?? false
  const shown = open ? pairs : pairs.slice(0, DIFF_PREVIEW_LINES)
  for (const p of shown) {
    const row = el('div', 'diff-row')
    const oldCell = el('div', `diff-cell old${p.oldLine === null ? ' empty' : ''}`, p.oldLine ?? '')
    const newCell = el('div', `diff-cell new${p.newLine === null ? ' empty' : ''}`, p.newLine ?? '')
    if (p.kind === 'del' || p.kind === 'modify') oldCell.classList.add('del')
    if (p.kind === 'add' || p.kind === 'modify') newCell.classList.add('add')
    row.appendChild(oldCell)
    row.appendChild(newCell)
    grid.appendChild(row)
  }
  box.appendChild(grid)
  if (pairs.length > DIFF_PREVIEW_LINES) {
    const hidden = pairs.length - DIFF_PREVIEW_LINES
    const toggle = el('div', 'diff-toggle', open ? t('Collapse diff') : t('… show {0} more diff lines', hidden))
    toggle.addEventListener('click', () => {
      detailsOpen.set(key, !open)
      render()
    })
    box.appendChild(toggle)
  }
  return box
}

/**
 * Pending 面板容器：接管 composer 区（对齐 dsh web 的 QuestionFlow /
 * PlanReviewPanel 挂 conversation.composer 的形态）。消息流尾部不再渲染
 * pending 卡；输入区整个被面板替换，普通 composer 在 pending 期间不显示。
 * 面板本地状态（分页/最小化）按 rpcId 存 panelState，随 pending 解析清掉。
 */
function renderPendingPanel(pending: PendingRequest[]): HTMLElement {
  // 清理已解析交互的本地状态（approval 无分页/最小化之外的额外状态，
  // question 的 answerDrafts 在提交时清，这里只清 panelState 残留）。
  const live = new Set(pending.map((p) => p.rpcId))
  for (const rpcId of panelState.keys()) {
    if (!live.has(rpcId)) panelState.delete(rpcId)
  }
  const panel = el('div', 'pending-panel')
  for (const p of pending) {
    panel.appendChild(p.kind === 'approval' ? renderApprovalPanel(p) : renderQuestionPanel(p))
  }
  return panel
}

function renderApprovalPanel(p: PendingApproval): HTMLElement {
  const panel = el('div', 'pending-block')
  panel.appendChild(panelHeader(p.rpcId, t('Permission request')))
  if (panelStateFor(p.rpcId).minimized) return panel
  const body = el('div', 'panel-body')
  body.appendChild(el('div', 'pending-title', p.toolName))
  if (p.reason) body.appendChild(el('div', 'pending-reason', p.reason))
  const actions = el('div', 'pending-actions')
  const allow = buttonEl('', t('Allow once'))
  const deny = buttonEl('secondary', t('Reject'))
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
  body.appendChild(actions)
  panel.appendChild(body)
  return panel
}

/**
 * Pending 面板头部：标题 + 分页器（多题时）+ 最小化/最大化按钮。最小化后
 * 只留这一行，正文隐藏（对齐 dsh web QuestionFlow 的 header 最小化）。
 */
function panelHeader(rpcId: string, title: string, pager: HTMLElement | null = null): HTMLElement {
  const st = panelStateFor(rpcId)
  const header = el('div', 'panel-header')
  header.appendChild(el('span', 'panel-title', title))
  if (pager) header.appendChild(pager)
  const toggle = buttonEl('panel-toggle', '')
  toggle.title = st.minimized ? t('Expand') : t('Minimize')
  toggle.appendChild(iconSvg(PANEL_ICONS.chevronUp, 14))
  toggle.classList.toggle('minimized', st.minimized)
  toggle.addEventListener('click', () => {
    st.minimized = !st.minimized
    render()
  })
  header.appendChild(toggle)
  return header
}

/** 分页器「1/N」+ 上一题/下一题（对齐 dsh web QuestionFlow 分页）。 */
function questionPager(p: PendingQuestion): HTMLElement | null {
  const n = p.questions.length
  if (n <= 1) return null
  const st = panelStateFor(p.rpcId)
  // 题目数可能因 pending 更新而变少：显示前先 clamp（renderQuestionPanel
  // 渲染时也 clamp，两处一致避免「3/2」这类越界显示）。
  if (st.page >= n) st.page = n - 1
  const pager = el('div', 'panel-pager')
  const prev = buttonEl('secondary pager-btn', '‹')
  prev.disabled = st.page <= 0
  prev.addEventListener('click', () => {
    st.page = Math.max(0, st.page - 1)
    st.notice = ''
    render()
  })
  pager.appendChild(prev)
  pager.appendChild(el('span', 'pager-count', `${st.page + 1}/${n}`))
  const next = buttonEl('secondary pager-btn', '›')
  next.disabled = st.page >= n - 1
  next.addEventListener('click', () => {
    st.page = Math.min(n - 1, st.page + 1)
    st.notice = ''
    render()
  })
  pager.appendChild(next)
  return pager
}

/** 最小化态的回答输入行：在聊天里说，Enter 提交为自定义回答。 */
function renderPanelAnswer(p: PendingQuestion, index: number): HTMLElement {
  const row = el('div', 'panel-answer')
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = t('Say it in chat… (Enter submits as the answer)')
  const send = buttonEl('', t('Submit'))
  const submit = (): void => {
    const text = input.value.trim()
    if (!text) return
    if (questionInteractionStatus(p.questions) === 'plan-review') submitPlanReview(p, [], text)
    else submitAnswer(p, { index, text })
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  })
  send.addEventListener('click', submit)
  row.appendChild(input)
  row.appendChild(send)
  return row
}

/** Per-question answer draft: picked option labels plus free-text custom input. */
interface QuestionDraft {
  selected: Set<string>
  custom: string
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

function submitAnswer(p: PendingQuestion, chatOverride?: { index: number; text: string }): void {
  // 对齐 dsh web QuestionFlow：所有题「已答或已跳过」才发送；有缺失（含
  // 「去聊天里说」路径）跳回第一道未完成题并展开面板，避免漏题空答。
  const st = panelStateFor(p.rpcId)
  const answeredAt = (index: number): boolean => {
    if (chatOverride && chatOverride.index === index) return true
    const v = answerDrafts.get(p.rpcId)?.get(index)
    return (v?.selected.size ?? 0) > 0 || (v?.custom.trim() ?? '') !== ''
  }
  const missing = p.questions.findIndex((_, i) => !answeredAt(i) && !st.skipped.has(i))
  if (missing >= 0) {
    st.page = missing
    st.minimized = false
    st.notice = t('Please complete this question first.')
    render()
    return
  }
  const d = answerDrafts.get(p.rpcId)
  // Same encoding as dsh's web QuestionComposer: a custom answer replaces the
  // selection for single-select questions, and accompanies it for multi-select.
  // `chatOverride` 是「去聊天里说」路径：把该题的自定义回答替换成输入框文本。
  const answers = p.questions.map((q, i) => {
    const v = d?.get(i)
    const custom = chatOverride && chatOverride.index === i ? chatOverride.text.trim() : (v?.custom.trim() ?? '')
    const selected = chatOverride && chatOverride.index === i ? [] : [...(v?.selected ?? [])]
    return {
      selected: custom === '' || q.multiSelect ? selected : [],
      ...(custom ? { custom } : {}),
    }
  })
  answerDrafts.delete(p.rpcId)
  panelState.delete(p.rpcId)
  post({ type: 'answer', rpcId: p.rpcId, answers })
  // 提交答案同样延续对话流（回复继续流式输出），滚到底并复位跟随态。
  pinToLatest()
}

/** plan-review 三分按钮的直接提交：确认执行/拒绝走选项，去聊天里说走 custom。 */
function submitPlanReview(p: PendingQuestion, selected: string[], custom = ''): void {
  const answers = p.questions.map((q, i) => {
    const s = i === 0 ? selected : []
    return {
      selected: custom === '' || q.multiSelect ? s : [],
      ...(custom ? { custom } : {}),
    }
  })
  answerDrafts.delete(p.rpcId)
  panelState.delete(p.rpcId)
  post({ type: 'answer', rpcId: p.rpcId, answers })
  pinToLatest()
}

function renderQuestionPanel(p: PendingQuestion): HTMLElement {
  // plan-review 单题走 PlanReviewPanel 形态：warn strip + 计划 Markdown +
  // 确认执行/拒绝/去聊天里说三分结构（对齐 dsh web PlanReviewPanel）。
  if (questionInteractionStatus(p.questions) === 'plan-review') return renderPlanReviewPanel(p)
  const st = panelStateFor(p.rpcId)
  const n = p.questions.length
  const page = Math.min(st.page, n - 1)
  const panel = el('div', 'pending-block')
  panel.appendChild(panelHeader(p.rpcId, t('Waiting for your answer'), questionPager(p)))
  if (st.minimized) {
    panel.appendChild(renderPanelAnswer(p, page))
    return panel
  }
  const body = el('div', 'panel-body')
  if (st.notice) body.appendChild(el('div', 'panel-feedback', st.notice))
  const actions = el('div', 'pending-actions')
  // 主按钮随当前页切换（对齐 dsh web QuestionFlow）：非最后一页只翻页不发送，
  // 最后一页才提交整组；当前页未作答时不可点。
  const ok = buttonEl('', page < n - 1 ? t('Next question') : t('Submit'))
  const answeredAt = (index: number): boolean => {
    const v = answerDrafts.get(p.rpcId)?.get(index)
    return (v?.selected.size ?? 0) > 0 || (v?.custom.trim() ?? '') !== ''
  }
  const updateOkState = () => {
    ok.disabled = !answeredAt(page)
  }
  updateOkState()
  ok.addEventListener('click', () => {
    if (page < n - 1) {
      st.page = page + 1
      st.notice = ''
      render()
      return
    }
    ok.disabled = true
    submitAnswer(p)
  })
  body.appendChild(renderQuestionItem(p, page, updateOkState))
  if (n > 1 && page < n - 1) {
    // 跳过本题（对齐 dsh web QuestionFlow）：此题不答，清空草稿、记为跳过并
    // 翻到下一题；最后一题没有下一题可跳，直接提交即可。
    const skip = buttonEl('secondary', t('Skip this question'))
    skip.addEventListener('click', () => {
      answerDrafts.get(p.rpcId)?.delete(page)
      st.skipped.add(page)
      st.page = page + 1
      st.notice = ''
      render()
    })
    actions.appendChild(skip)
  }
  actions.appendChild(ok)
  body.appendChild(actions)
  panel.appendChild(body)
  return panel
}

/** 单题渲染（当前分页页）：header/question 文本/折叠 detail/选项/自定义输入。 */
function renderQuestionItem(
  p: PendingQuestion,
  index: number,
  updateOkState: () => void,
): HTMLElement {
  const q = p.questions[index]
  const wrap = el('div', 'question')
  if (q.header) wrap.appendChild(el('div', 'question-header', q.header))
  wrap.appendChild(el('div', 'question-text', q.question))
  if (q.detail) {
    // 非 plan-review 的普通问题，detail 保持折叠（plan-review 的计划全文在
    // PlanReviewPanel 里直接展开，不走这里）。
    const det = detailsEl(`q:${p.rpcId}:${index}`, 'question-detail', t('View details'))
    const body = el('div', 'md')
    body.innerHTML = md(q.detail)
    enhanceCodeBlocks(body, `q:${p.rpcId}:${index}`)
    det.appendChild(body)
    wrap.appendChild(det)
  }
  const draft = draftFor(p.rpcId, index)
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
        const btn = buttonEl('secondary option-btn', opt.label)
        if (opt.description) btn.title = opt.description
        if (draft.custom === '' && draft.selected.has(opt.label)) btn.classList.add('selected')
        btn.addEventListener('click', () => {
          // 点击只选中，翻页/提交一律走底部的「下一题/提交」按钮：误触直接提交容易漏题。
          draft.selected = new Set([opt.label])
          draft.custom = ''
          // 保活态下 render() 不会重建面板，选中高亮与自定义输入框必须就地
          // 更新；无保活时下次快照重建也会按 draft 恢复同态。
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
  input.placeholder = q.options?.length ? t('Other (custom answer)') : t('Type your answer')
  input.value = draft.custom
  input.addEventListener('input', () => {
    draft.custom = input.value
    if (input.value && !q.multiSelect) draft.selected.clear()
    updateOkState()
  })
  customRow.appendChild(input)
  wrap.appendChild(customRow)
  return wrap
}

/** PlanReviewPanel：warn strip「计划待审」+ 计划 Markdown + 确认/拒绝/去聊天里说。 */
function renderPlanReviewPanel(p: PendingQuestion): HTMLElement {
  const st = panelStateFor(p.rpcId)
  const q = p.questions[0]
  const panel = el('div', 'pending-block')
  panel.appendChild(panelHeader(p.rpcId, t('Plan review')))
  if (st.minimized) {
    panel.appendChild(renderPanelAnswer(p, 0))
    return panel
  }
  const body = el('div', 'panel-body')
  // Warn strip：计划待审（对齐 dsh web PlanReviewPanel 的警示条）。
  const warn = el('div', 'plan-warn')
  warn.appendChild(el('span', 'plan-warn-icon', '⚠'))
  warn.appendChild(el('span', 'plan-warn-text', t('Plan review')))
  body.appendChild(warn)
  // 计划 Markdown：detail 直接展开全文（不复折叠），限高滚动。
  if (q.detail) {
    const plan = el('div', 'md plan-md')
    plan.innerHTML = md(q.detail)
    enhanceCodeBlocks(plan, `plan:${p.rpcId}`)
    body.appendChild(plan)
  }
  // 三分结构：确认执行（approve 选项，主按钮）/ 拒绝（另一选项）/ 去聊天里说。
  const approve = q.intent?.approve
  const reject = q.options?.find((o) => o.label !== approve)?.label
  const actions = el('div', 'pending-actions plan-actions')
  const ok = buttonEl('option-btn', approve ?? t('Confirm and run'))
  ok.addEventListener('click', () => {
    ok.disabled = true
    submitPlanReview(p, approve ? [approve] : [])
  })
  const no = buttonEl('secondary option-btn', reject ?? t('Reject'))
  no.addEventListener('click', () => {
    no.disabled = true
    submitPlanReview(p, reject ? [reject] : [])
  })
  const chat = buttonEl('secondary option-btn', t('Reply in chat'))
  chat.title = t('Collapse the panel and reply in natural language in the input box')
  chat.addEventListener('click', () => {
    st.minimized = true
    render()
    // 收起后聚焦回答输入行（panel-answer 的首个输入框）。
    const input = chatCol.querySelector<HTMLInputElement>('.pending-panel .panel-answer input')
    input?.focus()
  })
  actions.appendChild(ok)
  actions.appendChild(no)
  actions.appendChild(chat)
  body.appendChild(actions)
  panel.appendChild(body)
  return panel
}

/**
 * 待发送图片：对齐官方 AttachmentRail 的圆角缩略图（点击放大预览，hover
 * 右上角出 × 移除）。字节已在 webview 内存里，直接用 data: URL 渲染（CSP
 * 已允许 img-src data:，无需 objectURL）；加载失败回退为文件名 chip。
 */
function pendingImageThumb(img: OutgoingImage, index: number): HTMLElement {
  const name = img.name ?? t('Image')
  if (!isImageMediaType(img.mediaType)) return pendingImageFallback(img, index)
  const item = el('span', 'attach-thumb')
  item.title = t('{0} (click to preview)', name)
  const dataUrl = attachmentDataUrl(img.mediaType, img.data)
  const image = document.createElement('img')
  image.src = dataUrl
  image.alt = name
  image.addEventListener('error', () => item.replaceWith(pendingImageFallback(img, index)))
  const remove = buttonEl('thumb-remove', '×')
  remove.title = t('Remove image')
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
  const name = el('span', 'chip-name', img.name ?? t('Image'))
  name.style.cursor = 'zoom-in'
  name.title = t('Click to preview')
  name.addEventListener('click', () => {
    openLightbox(attachmentDataUrl(img.mediaType, img.data))
  })
  chip.appendChild(name)
  const remove = buttonEl('chip-remove', '×')
  remove.title = t('Remove image')
  remove.addEventListener('click', () => {
    pendingImages.splice(index, 1)
    render()
  })
  chip.appendChild(remove)
  return chip
}

/** 待发送文件：与图片缩略图同尺寸方框（文档小图标 + 文件名，hover 右上角 ×）；点击在 VS Code 打开。
 *  图片文件（image 标记）：用 host 提供的 previewData 画缩略图（无数据或加载失败回退图标 chip）。
 *  高亮只走 hover 联动（.hovered，见 applyHover）——点击选中不常驻高亮。 */
function pendingFileChip(file: StagedFile, index: number): HTMLElement {
  if (file.image && file.previewData && file.mediaType) {
    const dataUrl = attachmentDataUrl(file.mediaType, file.previewData)
    const item = el('span', 'attach-thumb')
    item.dataset.attachPath = file.path
    item.title = t('{0} (click to preview)', file.name)
    const image = document.createElement('img')
    image.src = dataUrl
    image.alt = file.name
    image.addEventListener('error', () => item.replaceWith(fileIconChip({ name: file.name, path: file.path })))
    const remove = buttonEl('thumb-remove', '×')
    remove.title = t('Remove file')
    remove.addEventListener('click', (e) => {
      e.stopPropagation()
      pendingFiles.splice(index, 1)
      render()
    })
    item.addEventListener('click', () => openLightbox(dataUrl))
    item.appendChild(image)
    // 底部名称横幅：img1.png 这类短名直接可见（截图多时靠它区分）。
    item.appendChild(el('span', 'thumb-name', file.name))
    item.appendChild(remove)
    return item
  }
  const chip = el('span', 'file-chip')
  chip.dataset.attachPath = file.path
  const icon = el('span', 'file-chip-icon')
  icon.appendChild(strokeSvg(FILE_ICON))
  chip.appendChild(icon)
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  chip.title = t('Open {0} in VS Code', file.path)
  chip.addEventListener('click', () => post({ type: 'openAttachmentFile', path: file.path }))
  const remove = buttonEl('thumb-remove', '×')
  remove.title = t('Remove file')
  remove.addEventListener('click', (e) => {
    e.stopPropagation()
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
  // 输入框外包 frame：@ 引用 token 由叠加高亮层绘制（透明文字 + 底色 token），
  // hover token → 联动对应附件 chip 高亮（textarea 无法直接 hover 文本）。
  const frame = el('div', 'composer-frame')
  const input = document.createElement('textarea')
  input.id = 'input'
  input.rows = 1
  // 模型不可用（routable=false）时输入区整体阻塞，文案对齐 dsh web 的
  // 「当前模型不可用，请先选择模型」；与「服务未就绪」是两个独立维度。
  const modelAvailable = state?.modelAvailable !== false
  input.placeholder = !canSend
    ? t('Service is not ready; cannot send right now')
    : !modelAvailable
      ? t('Current model is unavailable; choose a model first')
      : recall?.kind === 'queue'
        ? t('Editing queued message; Enter saves, Esc cancels')
        : state?.running
          ? t('Type a message; Enter queues, ⌘Enter steers now, ↑ edits the queued message, Esc interrupts')
          : hero
            ? t('Describe what you want to build')
            : t('Type a message; Enter sends, Shift+Enter for newline, paste images/files, ↑ recalls the previous one')
  input.disabled = !canSend || !modelAvailable
  if (stashedDraft) {
    input.value = draft?.trim() ? `${draft.trimEnd()}\n${stashedDraft}` : stashedDraft
    stashedDraft = undefined
  } else if (draft) {
    input.value = draft
  }
  frame.appendChild(input)
  const refLayer = el('div', 'ref-token-layer')
  refLayer.setAttribute('aria-hidden', 'true')
  frame.appendChild(refLayer)
  row.appendChild(frame)

  /** 按当前输入渲染高亮层：mentionBindings 里的显示 token 高亮（含路径关联）。 */
  const renderRefLayer = (): void => {
    refLayer.textContent = ''
    const value = input.value
    const tokens = [...mentionBindings.keys()].sort((a, b) => b.length - a.length)
    if (tokens.length === 0) {
      if (value) refLayer.appendChild(document.createTextNode(value))
      refLayer.style.transform = `translateY(${-input.scrollTop}px)`
      return
    }
    let cursor = 0
    while (cursor < value.length) {
      let best: { index: number; token: string } | null = null
      for (const token of tokens) {
        const index = value.indexOf(token, cursor)
        if (index >= 0 && (best === null || index < best.index)) best = { index, token }
      }
      if (best === null) break
      if (best.index > cursor) refLayer.appendChild(document.createTextNode(value.slice(cursor, best.index)))
      const span = el('span', 'ref-token', best.token)
      span.dataset.path = mentionBindings.get(best.token) ?? ''
      refLayer.appendChild(span)
      cursor = best.index + best.token.length
    }
    if (cursor < value.length) refLayer.appendChild(document.createTextNode(value.slice(cursor)))
    refLayer.style.transform = `translateY(${-input.scrollTop}px)`
  }
  renderRefLayer()

  /** hover 联动：token 高亮加深 + 对应附件 chip 高亮（直接 DOM 操作，不整页重渲染）。
   *  span 里存的是 canonical 引用（`@/abs/path` 或 `@"..."`），chip 上存的是
   *  纯路径——匹配前归一化（去 @ 与引号），否则永远对不上。 */
  let hoverTokenPath: string | null = null
  const plainPath = (p: string): string => p.replace(/^@/, '').replace(/^"|"$/g, '')
  const applyHover = (path: string | null): void => {
    if (path === hoverTokenPath) return
    hoverTokenPath = path
    const plain = path === null ? null : plainPath(path)
    for (const span of Array.from(refLayer.querySelectorAll<HTMLElement>('.ref-token'))) {
      span.classList.toggle('active', path !== null && span.dataset.path === path)
    }
    // hover 用独立 class（hovered），不碰点击选中态的 referenced。
    for (const chip of Array.from(document.querySelectorAll<HTMLElement>('[data-attach-path]'))) {
      chip.classList.toggle('hovered', plain !== null && chip.dataset.attachPath === plain)
    }
  }
  input.addEventListener('mousemove', (e) => {
    let hit: string | null = null
    for (const span of Array.from(refLayer.querySelectorAll<HTMLElement>('.ref-token'))) {
      if (!span.dataset.path) continue
      const r = span.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        hit = span.dataset.path
        break
      }
    }
    applyHover(hit)
  })
  input.addEventListener('mouseleave', () => applyHover(null))
  input.addEventListener('scroll', () => {
    refLayer.style.transform = `translateY(${-input.scrollTop}px)`
  })

  // 主按钮（对齐官方 InputBar primary）：无文字图标按钮——非运行显示发送
  // 箭头，运行中同一按钮切换为停止方块（primaryStops），点击即 stop；排队
  // 发送走 Enter（官方同款交互，独立的「停止」文字按钮随之淘汰）。
  const running = !!state?.running
  const button = buttonEl('send-button', '')
  const buttonLabel = running ? t('Stop') : recall?.kind === 'queue' ? t('Save changes') : t('Send')
  button.title = buttonLabel
  button.setAttribute('aria-label', buttonLabel)
  button.appendChild(iconSvg(running ? STOP_PRIMARY_ICON : SEND_ICON, 16))
  const updateButton = (): void => {
    if (running) {
      // 运行中主按钮=停止，stop 无前置条件（官方 disabled: stop === void 0）。
      button.disabled = false
      return
    }
    button.disabled =
      !canSend ||
      !modelAvailable ||
      (input.value.trim().length === 0 && pendingImages.length === 0 && pendingFiles.length === 0)
  }
  const sendCurrent = (steer = false): void => {
    if (!state || !state.canSend || state.modelAvailable === false) return
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
      const pill = document.querySelector<HTMLElement>('.input-footer .pill[data-role="model"]')
      if (pill) openModelMenu(pill)
      return
    }
    if (recall?.kind === 'queue') {
      // Queue edits carry text only (the host rejects non-text content), so
      // staged images stay staged and only the text goes to the queue item.
      const itemId = recall.itemId
      recall = null
      recallDraft = ''
      pendingFiles = []
      post({ type: 'queueEdit', itemId, text: expanded })
      input.value = ''
      render()
      return
    }
    recall = null
    recallDraft = ''
    const images = pendingImages
    const files = pendingFiles
    pendingImages = []
    pendingFiles = []
    post({
      type: 'send',
      text: expanded,
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(steer ? { steer } : {}),
    })
    input.value = ''
    render()
    // 发送是"看最新"信号：本轮 render 之后无条件滚到底并复位跟随态，
    // 后续流式输出继续贴底（host 快照回来后 render 会按跟随态钉住）。
    pinToLatest()
  }
  button.addEventListener('click', () => {
    // 官方交互：运行中主按钮点击 = stop；否则发送。
    if (state?.running) {
      post({ type: 'stop' })
      return
    }
    sendCurrent()
  })
  input.addEventListener('keydown', (e) => {
    // Slash completion owns these keys while open: arrows navigate, Tab/Enter
    // complete, Escape dismisses (an Escape with no popup falls through).
    if (slashPopupEl && !e.isComposing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveSlashSelection(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveSlashSelection(-1)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        slashRows[slashIndex]?.apply?.(input)
        return
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        hideSlashPopup()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const apply = slashRows[slashIndex]?.apply
        if (apply) {
          e.preventDefault()
          apply(input)
          return
        }
        // Hint-only popup: Enter falls through and sends the line as-is.
      }
    }
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
      recall = null
      input.value = recallDraft
      recallDraft = ''
      render()
      return
    }
    // ArrowUp on the first line with no selection recalls: 有等待插话的 steering
    // 气泡时首选撤销它（↑ 第一个可回退编辑的就是它——宿主移除该项并把内容
    // 含附件回填 composer）；否则召回排队消息（改回后 Enter 保存），再否则
    // 召回最后一条真正的用户消息重新发送。进行中的 recall 保持箭头移光标。
    if (e.key === 'ArrowUp' && !e.isComposing && !recall && state?.canSend) {
      if (input.selectionStart !== input.selectionEnd) return
      if (input.value.slice(0, input.selectionStart).includes('\n')) return
      const lastSteer = [...(state.queue ?? [])].reverse().find((q) => q.placement === 'steering')
      if (lastSteer) {
        // 撤销即最终动作（消息从 inbox 移除），不进 recall 状态、无 Esc 取消。
        e.preventDefault()
        post({ type: 'unsteer', itemId: lastSteer.id })
        return
      }
      const lastQueued = [...(state.queue ?? [])].reverse().find((q) => q.placement === 'queued')
      const lastUser = lastQueued
        ? null
        : [...state.messages].reverse().find((m) => m.kind === 'user' && !m.context && m.text.trim())
      if (!lastQueued && !lastUser) return
      e.preventDefault()
      recallDraft = input.value
      if (lastQueued) {
        recall = { kind: 'queue', itemId: lastQueued.id }
        input.value = lastQueued.editText
      } else if (lastUser && lastUser.kind === 'user') {
        recall = { kind: 'history' }
        input.value = lastUser.text
      }
      render()
    }
  })
  input.addEventListener('input', () => {
    autoGrow(input)
    updateButton()
    updateSlashPopup(input)
    renderRefLayer()
    // 纯输入不触发 render，脏位上报单独跟一次（宿主的 dirty 保护决策读它）。
    reportComposerDirty()
  })
  input.addEventListener('blur', () => {
    hideSlashPopup()
    applyHover(null)
  })
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
  row.appendChild(button)
  wrap.appendChild(row)

  const footer = el('div', 'input-footer')
  const addImage = buttonEl('pill', '+')
  addImage.title = t('Add attachment (image or file)')
  addImage.disabled = !canSend
  addImage.addEventListener('click', () => post({ type: 'pickFiles' }))
  footer.appendChild(addImage)
  const commands = buttonEl('pill', '/')
  commands.title = t('Commands')
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
    perm.dataset.role = 'perm'
    perm.title = t('Permission mode')
    perm.disabled = !canSend
    perm.addEventListener('click', () => openPermissionMenu(perm))
    footer.appendChild(perm)
  }
  // Plan-mode chip（对齐官方 dsh web PlanChip）：仅当有效目标态是 plan 模式时
  // 显示（pending 以目标态为准——退出中立即隐藏、进入中立即显示），点击执行
  // /plan off。投影缺失（老版本 dsh 无 dsh-plan-mode）时缺省，不渲染。
  const plan = state?.plan
  if (plan && (plan.pending ? !plan.active : plan.active)) {
    const chip = buttonEl('pill plan-chip', '')
    chip.setAttribute('aria-label', t('Plan mode is on; press to turn it off'))
    chip.title = t('Plan mode is on — click to turn it off (/plan off)')
    chip.disabled = !canSend
    chip.appendChild(el('span', undefined, 'Plan'))
    const close = el('span', 'plan-chip-close')
    close.setAttribute('aria-hidden', 'true')
    close.appendChild(iconSvg(PANEL_ICONS.planClose, 12))
    chip.appendChild(close)
    chip.addEventListener('click', () => {
      if (!state?.canSend) return
      post({ type: 'send', text: '/plan off' })
    })
    footer.appendChild(chip)
  }
  if (state?.agentPreset && !hero) {
    // Agent preset chip：只在空会话出现（state.agentPreset 由宿主按此条件透传）。
    // hero 布局里它挪到标题下的 chip 行（renderHero），footer 不再重复。
    const ap = state.agentPreset
    const current = ap.options.find((o) => o.id === ap.current)
    const preset = buttonEl('pill', '')
    preset.appendChild(presetIconSvg())
    preset.appendChild(el('span', 'label', current?.label ?? ap.current))
    preset.title = current?.description ?? t('Agent mode')
    preset.disabled = !canSend
    preset.addEventListener('click', () => openAgentPresetMenu(preset))
    footer.appendChild(preset)
  }
  const model = buttonEl('pill', state?.modelLabel ?? t('Select model'))
  model.dataset.role = 'model'
  model.title = t('Model')
  model.disabled = !canSend
  model.addEventListener('click', () => openModelMenu(model))
  footer.appendChild(model)
  wrap.appendChild(footer)

  if (state?.statsLine || (state?.contextUsage && contextBarHasValue(state.contextUsage)))
    wrap.appendChild(statsRow(state?.statsLine, state?.contextUsage))
  return wrap
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`
}
