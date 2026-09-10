/**
 * Chat webview frontend: renders ChatState snapshots pushed by the host
 * (src/ui/chatView.ts) and posts user actions back (FromWebviewMessage).
 * Runs in the webview's browser context; esbuild bundles it (marked +
 * dompurify inlined) to dist/chatWebview.js. Rendering is a full rebuild per
 * snapshot — the host throttles pushes, so this stays cheap for a skeleton.
 */
import { ACCOUNT_ICON, ALARM_CLOCK_ICON, CHECK_ICON, CONTEXT_BROWSE_ICON, COPY_ICON, DSH_ONE_MARK, GIT_COMMIT_ICON, GITHUB_ICON, GOAL_ICONS, HISTORY_ICON, MESSAGE_ACTION_ICONS, PANEL_ICONS, SEND_ICON, STOP_PRIMARY_ICON, THINK_ICON, type IconDef } from './icons.ts'
import { el, buttonEl, iconButton, iconSvg, strokeSvg, presetIconSvg } from './dom.ts'
import { md, createMarkdownTools, SESSION_REF_ICON, type MarkdownCtx } from './markdown.ts'
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
  ChatTurnOutlineEntry,
  ChatTurnProcess,
  ChatTurnUsage,
  ChatUserMessage,
  ChatScheduleEntry,
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
import type { SessionNodeModel, WorkspaceNodeModel } from '../../pure/sessionTree.ts'
import { formatRelativeTime, UNGROUPED_WORKSPACE_ID } from '../../pure/sessionTree.ts'
import {
  INSTALL_SCRIPT_OS_ORDER,
  installCommandFor,
  type HostOs,
} from '../../pure/installScript.ts'
import { isComposerClearChord, steerModifierLabel, undoChordLabel } from '../../pure/steerShortcut.ts'
import { interleaveSteering, orderBySeq } from '../../pure/steeringOrder.ts'
import {
  claimableSlashCommand,
  fuzzyCandidates,
  looksLikeSlashCommand,
  slashClaimHolds,
  slashClaimToken,
} from '../../pure/slashCommand.ts'
import { isFilePathHref } from '../../pure/linkPath.ts'
import { meterLevel } from '../../pure/contextMeter.ts'
import {
  isScheduleOverdue,
  orderScheduleRecords,
  scheduleEveryUnit,
  scheduleRelativeDelta,
  type ScheduleTimeUnit,
} from '../../pure/schedule.ts'
import {
  jsonTreeThresholdExceeded,
  tryParseJsonTree,
  type JsonContainer,
} from '../../pure/jsonTree.ts'
import { codeBlockPreview } from '../../pure/codeBlock.ts'
import { commandOfToolArgs } from '../../pure/toolCards.ts'
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
import { attachmentBaseName, attachmentDataUrl, fileAttachmentLine, isImageMediaType, isImagePath, shouldFoldPastText, splitAttachmentLines } from '../../pure/composerAttachment.ts'
import { atTokenName } from '../../pure/tokenScan.ts'
import {
  base64Bytes,
  formatBytes,
  imageIntakeRejection,
  type ImageIntakeRejection,
} from '../../pure/imageIntake.ts'
import {
  SETTLE_IDLE_MS,
  anchoredScrollTop,
  archiveScrollPosition,
  forwardedWheelDelta,
  isAtBottom,
  isReaderMoved,
  isScrollKey,
  nextStickToBottom,
  restoreScrollTarget,
  shouldSettlePinNow,
  type ScrollAnchor,
  type ScrollArchive,
} from '../../pure/scrollFollow.ts'
import { formatCacheHitPercent, formatCompactTokens, formatDuration } from '../../pure/sessionStats.ts'
import {
  SESSION_REFERENCE_SCHEME,
  formatSessionMention,
  mentionDisplayToken,
  parseSessionMentions,
  restoreSessionMentionTokens,
  splitSessionMentions,
} from '../../pure/sessionMention.ts'
import { splitUserBubble, type UserBubbleSegment } from '../../pure/userBubble.ts'
import {
  activeAtToken,
  directoryCrumbs,
  fileMentionToken,
  formatFileMention,
  restoreFileMentionTokens,
  type ActiveAtToken,
  type FileCrumb,
  type FileRefCandidate,
} from '../../pure/fileReference.ts'
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
import { reconcileChildren, type ReconcileItem } from '../shared/reconcile.ts'
import { activateSession, disclosureFrame } from './disclosure.ts'
import { syncAnimPhase, spinnerEl, spinSvg } from '../shared/animPhase.ts'
import { composingInside, initComposeGuard } from '../shared/composeGuard.ts'
import { h, render as renderPreact } from 'preact'
import { BlockList, type BlockTools } from './preact/blocks.tsx'
import { createComposerEditor, type ComposerEditor, type MentionBindings } from './composerEditor.ts'
import { JsonTree, type TreeTools } from './preact/json-tree.tsx'
import type { ToolTools } from './preact/tool.tsx'

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

let state: ChatState | null = null
/** Auto-scroll only when the user is already near the bottom. */
let stickToBottom = true
/**
 * ScrollTop the last program write/read left behind（对齐官方 observedTopRef）。
 * render 头部与 scroll 监听都拿它跟实时位置做位移比对（isReaderMoved，>0.5px=用户动），
 * 区分用户滚动与程序滚动/内容增长。程序写后经 writeMessagesScrollTop 同步到 clamp 落点，
 * 自回声位移为 0、不误判为用户滚离。
 */
let pinnedScrollTop: number | null = null
/**
 * 写 `.messages.scrollTop` 的唯一原语（写路径收口）：写后立即读回 clamp 落点
 * 赋 pinnedScrollTop——scroll 监听与 render 头部据此跟实时位置做位移比对，区分
 * 用户滚动与程序 pin（程序写后该位同步，自回声位移 0）。任何新写路径都必须经
 * 这里（漏同步 = 程序 pin 被误判为用户滚离）。
 */
function writeMessagesScrollTop(m: HTMLElement, target: number): void {
  m.scrollTop = target
  pinnedScrollTop = m.scrollTop
}
/**
 * Per-session 滚动存档：每个会话记住自己最后的位置（贴底记 atBottom，
 * 翻历史记 scrollTop + 视口锚），换会话时先存档旧会话、再按新会话存档恢复——
 * 不再把上个会话容器的 scrollTop 套到新内容上（#52 W2）。
 */
const scrollPositions = new Map<string, ScrollArchive>()

/**
 * 取滚动容器的视口锚：DOM 顺序上第一条「底边还在视口内」的消息行，外加它在
 * 视口内的偏移（行顶部滚出视口时为负）。切走期间内容增长/收缩后，按它回到
 * 同一条消息的同一位置；空会话（没有行）返回 null，恢复回退原始 scrollTop。
 */
function scrollAnchorOf(scroller: HTMLElement): ScrollAnchor | null {
  const containerTop = scroller.getBoundingClientRect().top
  const rows = scroller.querySelectorAll<HTMLElement>('[data-flow-key]')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const key = row.getAttribute('data-flow-key')
    if (!key) continue
    const offset = row.getBoundingClientRect().top - containerTop
    // 已完全滚出视口顶的行不是首条可见行，继续往下找。
    if (offset + row.offsetHeight <= 0) continue
    return { key, offset }
  }
  return null
}

/** 按存档锚换算恢复位置；锚行不在新 DOM 里（已删除/还没渲染）时返回 null。 */
function anchoredRestoreTop(messages: HTMLElement, anchor: ScrollAnchor | null): number | null {
  if (anchor === null) return null
  const row = messages.querySelector<HTMLElement>(`[data-flow-key="${CSS.escape(anchor.key)}"]`)
  if (row === null) return null
  const rowOffset = row.getBoundingClientRect().top - messages.getBoundingClientRect().top
  return anchoredScrollTop(messages.scrollTop, rowOffset, anchor)
}
/**
 * messages 容器当前内容所属的会话 id；与快照的 state.sessionId 不同即
 * 处于换会话过程（loading 帧容器里还是旧会话内容）。无容器内容时为 null。
 */
let scrollSession: string | null = null
/**
 * 最近一次滚动活动（wheel/scroll/pointerdown/滚动手势）的时间戳。用于「滚动空闲判定」
 * （迭代 3）：原生弹性回归动画期间 scroll 事件持续到达，只要距今 < SETTLE_IDLE_MS 就
 * 认为是「滚动还在动」，禁止写 scrollTop——写会打断回归动画（terminate inertia →
 * 回弹被重置 → 再弹 → 连续碰撞）。
 */
let lastScrollActivityAt = 0
/** 滚动空闲 debounce 定时器：在每次滚动活动上重排，到期跑 maybeSettlePin。 */
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null

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

/**
 * 滚动真正停后（debounce 到期、无滚动活动）才允许补一次回底。回归动画期间 scroll
 * 事件持续到来 → debounce 被反复推迟 → 动画真结束时才可能写。滚动停后视口通常已贴底
 * （atBottom，shouldSettlePinNow 为假，零打扰）；脱底漂移（内容增长）写一次吸回。
 */
function maybeSettlePin(): void {
  const messages = document.getElementById('messages')
  if (!messages) return
  if (!shouldSettlePinNow(stickToBottom, isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight), scrollActiveRecently())) return
  writeMessagesScrollTop(messages, messages.scrollHeight)
  const jump = messages.querySelector<HTMLElement>('.jump-latest')
  if (jump) jump.style.display = 'none'
}

/**
 * 程序滚到最新并复位跟随态：发送消息这类"用户要看最新"的动作调用。
 * 无条件滚到底，再按现有 isAtBottom 判定从实际位置重估跟随态（滚到
 * 底距底为 0，必然进入跟随）——与用户滚动判定共用同一套距离语义，不
 * 绕过跟随机制。程序滚动写后由 writeMessagesScrollTop 同步 pinnedScrollTop，
 * scroll 监听位移比对里自回声位移 0，不会把跟随态误解掉。
 */
function pinToLatest(): void {
  const messages = document.getElementById('messages')
  if (!messages) return
  writeMessagesScrollTop(messages, messages.scrollHeight)
  stickToBottom = isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight)
}

/**
 * 「加载更早」的阅读锚（对齐官方 dsh-client-ui-chat 的 anchorRef）：锚定一
 * 条已渲染的内容行（flow key）+ 该行在滚动口内的期望偏移。补页每落一帧就按
 * 锚行重算一次 scrollTop——一页分多帧到达、或页内图片/懒加载缩略图稍后才撑高
 * 时同样跟着校正，而不是只在落地那一帧补一次。请求期间用户自己滚动会重取锚
 * （跟随新的阅读位，不与手势较劲）。
 */
let earlierAnchor: { key: string; top: number; until: number; height: number } | null = null

/**
 * 锚的稳定窗口：每次观察到内容高度变化（补页/图片撑高）或真的校正了位置就
 * 续期；窗口到期（内容不再变）即解除，避免锚无限长驻。
 */
const EARLIER_ANCHOR_SETTLE_MS = 1000

/**
 * 最近一次「加载更早」请求的时间戳（0 = 无挂起请求）。宿主接单后会推
 * loadingEarlier=true；兜底 500ms 后也放行——重入判定不能依赖某一帧的
 * loadingEarlier 一定被观测到。锚在落地后还会活一段（见上），不能拿它当
 * 防重入位，否则上翻连续补页会被挡住。
 */
let earlierRequestAt = 0
const EARLIER_REQUEST_GUARD_MS = 500

/** 内容行（消息/插话/工作流/命令卡）的 flow key：轨道与加载更早入口不是内容。 */
function isContentFlowKey(key: string): boolean {
  return key.startsWith('msg:') || key.startsWith('steer:') || key.startsWith('wf:') || key.startsWith('cmd:')
}

/** 取「滚动口顶边往下第一条内容行」作锚（官方 pagingAnchor 的可见行语义）。 */
function captureEarlierAnchor(messages: HTMLElement): { key: string; top: number } | null {
  const box = messages.getBoundingClientRect()
  for (const row of Array.from(messages.querySelectorAll<HTMLElement>('[data-flow-key]'))) {
    const key = row.getAttribute('data-flow-key') ?? ''
    if (!isContentFlowKey(key)) continue
    const rect = row.getBoundingClientRect()
    if (rect.bottom <= box.top) continue
    return { key, top: rect.top - box.top }
  }
  return null
}

/**
 * 按锚行校正滚动位置（渲染后/异步撑高后调用）。返回 true = 锚生效并已写好
 * scrollTop（本帧的位置归它管，调用方不要再用旧值覆盖）；锚行不在新窗口里
 * 返回 false，由调用方走原有回写路径。
 */
function reanchorEarlier(messages: HTMLElement): boolean {
  const anchor = earlierAnchor
  if (anchor === null) return false
  const row = messages.querySelector<HTMLElement>(`[data-flow-key="${CSS.escape(anchor.key)}"]`)
  if (row === null) {
    // 锚行不在新窗口里（窗口收缩/换页把它挤出去了）：无法校正，解除锚避免
    // 每帧空转，位置交回原有回写路径。
    earlierAnchor = null
    return false
  }
  const now = performance.now()
  // 内容高度变了（补页落地、页内图片/缩略图撑高）就续期：这些变化之后还要
  // 按锚行校正，窗口不能在它们之前到期。
  if (messages.scrollHeight !== anchor.height) {
    anchor.height = messages.scrollHeight
    anchor.until = now + EARLIER_ANCHOR_SETTLE_MS
  }
  const top = row.getBoundingClientRect().top - messages.getBoundingClientRect().top
  const delta = top - anchor.top
  if (Math.abs(delta) > 0.5) {
    writeMessagesScrollTop(messages, messages.scrollTop + delta)
    anchor.until = now + EARLIER_ANCHOR_SETTLE_MS
  }
  return true
}

/**
 * 锚的生命周期收尾：用户回到最新（贴底）立即解除；加载已结束且内容过了
 * settle 稳定窗口也解除——否则锚会长驻，此后每帧都按锚行校正，跟程序滚动
 * （回合跳转等）打架。
 */
function releaseEarlierAnchorWhenSettled(): void {
  const anchor = earlierAnchor
  if (anchor === null) return
  if (stickToBottom) {
    earlierAnchor = null
    return
  }
  if (state?.loadingEarlier !== true && performance.now() > anchor.until) earlierAnchor = null
}

/** Signature of the composer-relevant state at the last render; see render(). */
let lastComposerSig: string | null = null
/** Signature of the header-relevant state at the last render; see render(). */
let lastHeaderSig: string | null = null
/** Signature of the pending-interaction state at the last render; see render(). */
let lastPendingSig: string | null = null
/** Signature of the todo list at the last render; see render(). */
let lastTodosSig: string | null = null
/** Signature of the queued-inbox dock at the last render; see render(). */
let lastQueueSig: string | null = null
/** Signature of the goal bar at the last render; see render(). */
let lastGoalSig: string | null = null
/**
 * 正在 IME 组合中的元素（document 级捕获，所有输入点共用）。保活兜底：焦点
 * 所在区域签名变了也不重建，推迟到 compositionend 再落地——元素销毁会中止
 * 浏览器 composition 会话，拼音组合直接断，这是「恢复焦点/文本」救不了的。
 * （document 级跟踪与 composingInside 判定由共享模块 ui/shared/composeGuard 承担。）
 */
initComposeGuard(render)
/** Images staged in the composer, sent with the next `send`. */
let pendingImages: OutgoingImage[] = []
/** Non-image files staged as chips; their paths join the prompt text on send. */
let pendingFiles: StagedFile[] = []
/**
 * 长文本粘贴折叠挂起态：宿主写盘失败/无回执时通过超时兜底——把原文重新插回
 * 光标处（不丢数据）并复位，避免卡死导致后续正常附件回投被误插 token。
 * 回执核对走文件名协议（pasted-*），见 filesPicked 分支。
 */
let pendingTextPaste: { timer: ReturnType<typeof setTimeout>; text: string } | null = null
/** Session the staged images belong to; a switch drops them. */
let stagedForSession: string | null = null
/** Per-session composer text drafts: sessionId → 未发送文本。切走时存旧、切回时取新，
 *  不再让旧会话的草稿「跟着搬到」下一个会话的输入框。空态（未附着会话）用
 *  EMPTY_SESSION_KEY 占位——有草稿的空态 tab 不会被宿主替换（dirty 保护），
 *  存档留给将来可能的恢复入口，也避免切走时清掉 stashedDraft。
 *  重启/reload 级持久化不经过本表（它是内存态）：内容变更经 scheduleDraftSave
 *  防抖落盘 drafts.json，webview 重建时宿主 draftRestore 全量下发种回本表（#14）。 */
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
/** 召回历史消息时待重装进 composer 的图片：attachmentId → 显示名。bytes 经既有
 * requestAttachment 懒取，回执后 staging 进 pendingImages。 */
const recallStagingImages = new Map<string, string>()
/** File-path → data URL for image-file chips (message history), filled by fileThumb replies. */
const fileThumbCache = new Map<string, string>()
/**
 * File path → 请求状态：at=上次请求时间（无回执 5 秒后允许重试），
 * failed=true=宿主失败回执（fileThumbFailed）——该文件不再重发，保持图标 chip。
 */
const fileThumbRequested = new Map<string, { at: number; failed: boolean }>()
const FILE_THUMB_RETRY_MS = 5000

/** 图片文件 chip 的懒缩略图请求：失败态不再发；同一次请求 5 秒内不重复（防重渲染重发）。 */
function requestFileThumbIfNeeded(path: string): void {
  const rec = fileThumbRequested.get(path)
  if (rec?.failed) return
  if (Date.now() - (rec?.at ?? 0) > FILE_THUMB_RETRY_MS) {
    fileThumbRequested.set(path, { at: Date.now(), failed: false })
    post({ type: 'requestFileThumb', path })
  }
}
/**
 * 内嵌图片（markdown 本地路径 src）的懒加载请求：与文件 chip 共用 fileThumbRequested
 * 去重表——同一路径经任一侧发起后另一侧不会重复请求；失败回执后同样收敛不再发。
 */
function requestInlineImageIfNeeded(src: string): void {
  const rec = fileThumbRequested.get(src)
  if (rec?.failed) return
  if (Date.now() - (rec?.at ?? 0) > FILE_THUMB_RETRY_MS) {
    fileThumbRequested.set(src, { at: Date.now(), failed: false })
    post({ type: 'requestInlineImage', src })
  }
}
/** Half-answered pending questions: rpcId → question index → draft. */
const answerDrafts = new Map<string, Map<number, QuestionDraft>>()
/**
 * Composer-takeover panel per pending rpcId: current page (question index),
 * minimized state, skipped pages, a transient notice (local validation) and the
 * host-reported failure of the last answer attempt. `notice`/`failure` both
 * render in the panel's feedback row (`.panel-feedback`), matching the official
 * composer's single error/status slot.
 */
interface PendingPanelState {
  page: number
  minimized: boolean
  skipped: Set<number>
  notice: string
  /** 上一次应答失败的原因（宿主 pendingFailed 回推）：面板显示它并复位按钮，
   *  用户可以再次提交（#50 I2）。提交动作或成功应答时清掉。 */
  failure: string
  /**
   * 失败次数（单调递增）：进 pendingSig，保证「重试后又失败（原因文案可能
   * 相同）」也打破面板保活、按钮重新可用——否则焦点在面板内时保活帧会把
   * 新的失败吞掉，按钮永久置灰。
   */
  failureSeq: number
}
const panelState = new Map<string, PendingPanelState>()

/** Lazy panel-state accessor: defaults page 0 / expanded / no feedback. */
function panelStateFor(rpcId: string): PendingPanelState {
  let s = panelState.get(rpcId)
  if (!s) {
    s = { page: 0, minimized: false, skipped: new Set(), notice: '', failure: '', failureSeq: 0 }
    panelState.set(rpcId, s)
  }
  return s
}

/**
 * Known host slash commands. Two roles: (1) fallback roster while the host's
 * per-session list (state.slashCommands, from commands/list) has not arrived
 * or failed to fetch — e.g. a pre-commands/list host; (2) l10n overlay — the
 * host's descriptions are English-only, so a dynamic entry whose name is
 * known keeps this translated description (host text stays authoritative for
 * `hint` and for any command not listed here). The dynamic roster is composed
 * from the session's agent preset (a preset without command-goal has no
 * `goal`), so it decides membership whenever present. Commands execute via
 * commands/execute, not session.prompt.
 */
const KNOWN_HOST_COMMANDS: Array<{ name: string; description: string; hint?: string }> = [
  { name: 'compact', description: t('Compact older session history') },
  { name: 'export', description: t('Export this session log (ZIP)') },
  { name: 'feedback', description: t('Record feedback for this session'), hint: '<text>' },
  { name: 'goal', description: t('Set or view the long-task goal'), hint: '[<objective>|clear|edit <objective>|pause|resume]' },
  { name: 'permission', description: t('Switch permission preset'), hint: '<preset>' },
  { name: 'plan', description: t('Enter or leave plan mode'), hint: '[off|message]' },
]

/** Client-side command the host has no equivalent of: opens the model menu (the send path intercepts it, like the official web client). */
const MODEL_COMMAND = { name: 'model', description: t('Select the model for this session') }

/** Commands the composer's slash completion and the command menu offer: host roster (or fallback) + the client-side /model. */
function slashCommands(): Array<{ name: string; description: string; hint?: string }> {
  const dynamic = state?.slashCommands
  const host =
    dynamic?.map((c) => {
      const known = KNOWN_HOST_COMMANDS.find((k) => k.name === c.name)
      return known ? { ...c, description: known.description } : c
    }) ?? KNOWN_HOST_COMMANDS
  return [...host, MODEL_COMMAND]
}

/**
 * 会话可用的 skill（宿主 skills/list，官方 `/` 补全的第二路候选源）。与命令
 * 同一条 `/name ` 插入格式、同一名字空间；`modelInvocable === false` 的条目
 * 在描述前加「仅用户」标注（对齐官方 menu.userOnly）。skill 只进 `/` 补全，
 * 不进 ⋯ 命令菜单（官方那个入口只开 command 源）。
 */
function sessionSkills(): Array<{ name: string; description: string }> {
  return (state?.skills ?? []).map((s) => ({
    name: s.name,
    description: s.modelInvocable ? s.description : `${t('user-only')} · ${s.description}`,
  }))
}

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
 * stashedDraft / pendingStash（接管帧快照——正在输入却被面板替换的文本也算
 * 脏位，宿主「脏位为 true 不覆盖本 tab」的保护要靠它）。`force` 用于会话切换帧——
 * 宿主在替换 tab 时会把脏位归零，这里必须无条件重报一次真实状态，否则同值变化
 * 会被比较短路漏报。
 */
function reportComposerDirty(force = false): void {
  const text = composerText()
  const dirty = text.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0
  if (!force && dirty === lastReportedDirty) return
  lastReportedDirty = dirty
  post({ type: 'composerDirty', dirty })
}

/* ---- 草稿持久化上报（#14）：内容变更防抖落盘到 ~/.dsh/dsh-one/drafts.json，
 *  重启/reload 后宿主经 draftRestore 全量下发恢复。 ---- */

/**
 * 落盘防抖间隔。定时器挂起期间不复位（throttle 语义）：流式渲染每帧都会
 * 调度，复位会让长流式期间永不落盘；不复位则陈旧窗口有界（≤间隔）。
 */
const DRAFT_SAVE_DEBOUNCE_MS = 400
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 每个草稿 key 最近一次上报的签名（去重：draftRestore 恢复/切换回来的未变草稿不重写）。 */
const draftSaveSignatures = new Map<string, string>()

/** 当前草稿的持久化 key：附着会话用 sessionId；空态 tab 用 `tab:<tabId>`（重启后 serializer 按 tabId 认回，多空 tab 不撞）。 */
function draftPersistKey(): string {
  return stagedForSession ?? `tab:${tabId ?? 'unknown'}`
}

/** 内存归档占位 key（EMPTY_SESSION_KEY）→ 持久化 key 的翻译；真会话 id 原样。 */
function persistKeyFor(archiveKey: string): string {
  return archiveKey === EMPTY_SESSION_KEY ? `tab:${tabId ?? 'unknown'}` : archiveKey
}

/**
 * 当前 composer 内容快照（落盘用）：文本从 live 编辑器/暂存读（与
 * reportComposerDirty 同源），附件读模块级暂存。
 *
 * 文本落盘前先展开成 canonical（与发送同款：节点级投影 textWithMentions）：显示 token
 * 靠内存里的 mentionBindings 才解析得出，而绑定不跨窗口/不跨重启——直接存显示
 * token 的话，重启后 `@短名` 就是一段无主的普通文字。存展开后的引用，恢复端
 * 一律能解析（setText 把 canonical 引用重建回 chip）。无 live 编辑器时（pending
 * 暂存期）退回原始文本。
 */
function composerDraftSnapshot(): { text: string; images: OutgoingImage[]; files: StagedFile[] } {
  const text = activeComposer ? activeComposer.textWithMentions() : composerText()
  return { text, images: pendingImages, files: pendingFiles }
}

/** 变更判定签名：文本 + 图片（大小:名字）+ 文件路径。内容没变就不发（流式渲染每帧都会调度到）。 */
function draftSignature(d: { text: string; images: OutgoingImage[]; files: StagedFile[] }): string {
  return [
    d.text,
    d.images.map((i) => `${i.data.length}:${i.name ?? ''}`).join(','),
    d.files.map((f) => f.path).join(','),
  ].join('\0')
}

/** 立即上报一份草稿；空内容发 null 让宿主删条目（发送/一键清空/全删都收敛到这里）。 */
/**
 * 草稿落盘的图片预算（base64 字符数）：草稿存的是**全尺寸字节**，一张图片就是
 * 几 MB，几张就把 drafts.json 撑成几十 MB（进程重启读回还得全部解回内存）。
 * 官方把草稿图片放在宿主的附件库里、前端只留 id + 缩略图；dsh-one 还没有这条
 * 通道（宿主侧 draft 存储是纯 JSON），所以先按预算落盘：预算内的图片照旧随草稿
 * 持久化，超出的留在内存里（本次会话仍能发送/预览），重启后自然丢失——比把
 * 磁盘写爆或让 readFile 拖慢启动更可控（B-19）。
 */
const DRAFT_IMAGE_BUDGET_BYTES = 4 * 1024 * 1024

function flushDraftSave(key: string, d: { text: string; images: OutgoingImage[]; files: StagedFile[] }): void {
  const sig = draftSignature(d)
  if (draftSaveSignatures.get(key) === sig) return
  const empty = d.text === '' && d.images.length === 0 && d.files.length === 0
  // 从未上报过的空内容不发（新 webview 首帧恒空，避免每个 tab 白发一条 null）。
  if (empty && !draftSaveSignatures.has(key)) return
  draftSaveSignatures.set(key, sig)
  // 预算内按顺序收，超预算的图片不落盘（见 DRAFT_IMAGE_BUDGET_BYTES）。
  const persistedImages: OutgoingImage[] = []
  let used = 0
  for (const img of d.images) {
    if (used + img.data.length > DRAFT_IMAGE_BUDGET_BYTES) continue
    used += img.data.length
    persistedImages.push(img)
  }
  post({
    type: 'composerDraftSave',
    key,
    draft: empty
      ? null
      : {
          text: d.text,
          // previewData/mediaType 是内存态（缩略图恢复后经 fileThumb 重取），只存 name/path/image。
          ...(persistedImages.length > 0
            ? { images: persistedImages.map((i) => ({ mediaType: i.mediaType, data: i.data, ...(i.name ? { name: i.name } : {}) })) }
            : {}),
          ...(d.files.length > 0
            ? { files: d.files.map((f) => ({ name: f.name, path: f.path, ...(f.image ? { image: true } : {}) })) }
            : {}),
        },
  })
}

/** 防抖调度当前会话草稿上报：输入事件与渲染尾（发送清空/附件增删/草稿恢复）都经这里。 */
function scheduleDraftSave(): void {
  if (draftSaveTimer !== null) return
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null
    flushDraftSave(draftPersistKey(), composerDraftSnapshot())
  }, DRAFT_SAVE_DEBOUNCE_MS)
}

/** 问答卡半答草稿上报：每 rpcId 一个防抖定时器（面板里打字/勾选不触发 render，需独立挂钩）。 */
const answerSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function flushAnswerDraftSave(rpcId: string): void {
  const d = answerDrafts.get(rpcId)
  const answers: Record<string, { selected: string[]; custom: string; other: boolean }> = {}
  for (const [index, v] of d ?? []) {
    if (v.selected.size === 0 && v.custom === '' && !v.other) continue
    answers[String(index)] = { selected: [...v.selected], custom: v.custom, other: v.other }
  }
  post({ type: 'answerDraftSave', rpcId, answers: Object.keys(answers).length > 0 ? answers : null })
}

function scheduleAnswerDraftSave(rpcId: string): void {
  if (answerSaveTimers.has(rpcId)) return
  answerSaveTimers.set(
    rpcId,
    setTimeout(() => {
      answerSaveTimers.delete(rpcId)
      flushAnswerDraftSave(rpcId)
    }, DRAFT_SAVE_DEBOUNCE_MS),
  )
}

/** 提交后立刻清持久化副本（宿主在 pending 解除时也会清，双保险幂等）。 */
function clearAnswerDraft(rpcId: string): void {
  const timer = answerSaveTimers.get(rpcId)
  if (timer) clearTimeout(timer)
  answerSaveTimers.delete(rpcId)
  post({ type: 'answerDraftSave', rpcId, answers: null })
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
 * 行内码右键菜单：悬停高亮的行内码（反引号）右键 → 「复制这段」。替代初版
 * 悬浮复制按钮交互（用户实测反馈：小按钮悬空在 chip 外、鼠标滑过去 hover 就
 * 断、难点中），改为更稳的右键复制。注册在外链/消息右键菜单**之前**（捕获
 * 阶段先命中）：行内码在消息气泡内，不先拦截会被消息菜单的「复制」抢走。
 * 路径码的左键点击打开不受影响（那是 click，不经过这里）。
 */
document.addEventListener(
  'contextmenu',
  (e) => {
    const target = e.target as HTMLElement | null
    const code = target?.closest('code.inline-code') as HTMLElement | null
    if (!code) return
    e.preventDefault()
    // 同元素上的后注册监听器（消息/外链右键菜单）不执行：捕获阶段
    // stopPropagation 挡不住同一 document 上的其他监听器，必须用
    // stopImmediatePropagation（本监听注册在最前，先执行先拦截）。
    e.stopImmediatePropagation()
    const text = (code.textContent ?? '').trim()
    if (!text) return
    const body = el('div')
    body.appendChild(
      menuItem(t('Copy inline code'), {
        icon: iconSvg(MESSAGE_ACTION_ICONS.copy),
        onClick: () => {
          closePopover()
          void navigator.clipboard.writeText(text).then(
            () => showCopyToast(t('Copied')),
            () => showCopyToast(t('Copy failed')),
          )
        },
      }),
    )
    showPopoverAt(e.clientX, e.clientY, body)
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

/**
 * 消息气泡右键菜单（user/assistant 均显示）：复制纯文本。
 * 链接的右键保持原有处理（外链菜单 / 默认菜单）——外链监听先跑并弹自己的
 * 菜单，这里碰到 a[href] 直接让路；注入上下文卡（.msg.context）、命令卡与
 * 压缩卡不弹，只有 genuine 气泡（.msg.user / .msg.assistant）响应。
 * 行内 @参考 chip / 附件 chip 都是 span/button，不属于 a[href]，正常弹。
 */
document.addEventListener(
  'contextmenu',
  (e) => {
    const target = e.target as HTMLElement | null
    if (!target || target.closest('a[href]')) return
    // 行内码右键菜单优先（上面的监听器先注册已拦截；这里显式让路是双保险——
    // 万一注册顺序调整，行内码右键不被消息菜单的「复制」抢走）。
    if (target.closest('code.inline-code')) return
    const row = target.closest('.msg.user, .msg.assistant') as HTMLElement | null
    const key = row?.dataset.msgKey
    if (!key) return
    // renderMessage 的 key 是消息 id（增量更新起不再用 `m${下标}` 位置键，
    // loadEarlier 补页后位置键会指向别的消息）。
    const m = state?.messages.find((mm) => mm.id === key)
    if (!m || (m.kind !== 'user' && m.kind !== 'assistant')) return
    e.preventDefault()
    e.stopPropagation()
    const body = el('div')
    body.appendChild(
      menuItem(t('Copy'), {
        icon: iconSvg(MESSAGE_ACTION_ICONS.copy),
        onClick: () => {
          closePopover()
          copyMessageText(m)
        },
      }),
    )
    showPopoverAt(e.clientX, e.clientY, body)
  },
  true,
)

/**
 * 请求加载更早的一页历史（按钮点击与上翻到顶共用）。发请求时取阅读锚
 * （滚动口顶边的内容行 + 它当时的偏移），补页落地后逐帧按它校正滚动位置。
 * 防重入靠 `earlierRequestAt`（0 = 无挂起请求）：锚在落地后还活着一段时间，
 * 不能用锚当防重入位——那样上翻连续补页会被挡住。
 */
function maybeLoadEarlier(): void {
  if (!state?.hasEarlierHistory || state.loadingEarlier === true || earlierRequestAt !== 0) return
  const messages = document.getElementById('messages')
  if (messages === null) return
  const captured = captureEarlierAnchor(messages)
  if (captured === null) return
  earlierAnchor = { ...captured, until: performance.now() + EARLIER_ANCHOR_SETTLE_MS, height: messages.scrollHeight }
  earlierRequestAt = performance.now()
  post({ type: 'loadEarlier' })
}

/** 文档描边图标（待发送文件 chip 的类型小图标，本地扩展）。 */
const FILE_ICON = ['M4.2 2h4.6L12 5.2V14H4.2z', 'M8.8 2v3.2H12']

/**
 * 运行中像素环（spinSvg/SPIN_CELLS）、相位续播（syncAnimPhase）与转圈 spinner
 * （spinnerEl）已由共享模块 ui/shared/animPhase 承担——两份逐字复制合一。
 */

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
    if (seg.kind === 'file') chip.dataset.refPath = target
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

/**
 * 内嵌图片占位符号 src（增量对账下未变行保活，decorate 不会重跑，只能就地换）。
 * 见 swapInlineImagePlaceholders。
 */
function findInlineImagePlaceholders(src: string): HTMLElement[] {
  const out: HTMLElement[] = []
  document.querySelectorAll<HTMLElement>('.md-img-loading').forEach((ph) => {
    if (ph.dataset.mdimgSrc === src) out.push(ph)
  })
  return out
}

/**
 * 内嵌图片占位 → 真图/失败 chip 的就地替换：消息行在增量对账下按签名保活，
 * 宿主回执（fileThumb/fileThumbFailed）到达时行内容未变、decorateMarkdownImages
 * 不会重跑，靠 render() 换不上——这里直接换掉占位元素（后续任何行重建再经
 * decorate 走缓存，殊途同归）。
 */
function swapInlineImagePlaceholders(src: string): void {
  const dataUrl = fileThumbCache.get(src)
  const failed = fileThumbRequested.get(src)?.failed === true
  for (const ph of findInlineImagePlaceholders(src)) {
    if (dataUrl) {
      const img = document.createElement('img')
      img.className = 'md-img-inline'
      img.src = dataUrl
      img.alt = ph.dataset.mdimgAlt ?? attachmentBaseName(src)
      ph.replaceWith(img)
    } else if (failed) {
      ph.replaceWith(markdownImageFailedChip(src, ph.dataset.mdimgAlt ?? attachmentBaseName(src)))
    }
  }
}

// ---- 消息正文 commit hash 联动（点击打开 git 提交视图 / 悬浮显示提交信息） ----

/**
 * 查询结果缓存（sha → info）。消息区增量更新下未变行不重渲染，但流式中
 * 变化的行会被重建，不缓存仍会在每帧重复查询同一批
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

function onCommitHashHover(span: HTMLElement, show: boolean, ev?: MouseEvent): void {
  if (!show) {
    if (!popover) return
    // 流式重建把 chip「先插新后删旧」：旧元素被摘除时浏览器补发的 mouseleave
    // 坐标还停在 chip 上——此时指针下已是新 chip（elementFromPoint 判定），
    // 不排延迟关闭，卡片交给行重建后的 reanchorPopoverAfterRebuild 接管；
    // 否则每帧重建都触发「关→开」，就是用户看到的卡片一直跳。
    if (ev !== undefined && ev.clientX !== undefined && ev.clientY !== undefined) {
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
      if (under instanceof HTMLElement && under.classList.contains('commit-hash')) return
    }
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

/** commitInfo 回传后就地更新 DOM 里的 chip 样式与 title（不整页重渲——流式期间
 *  render 本身就在频繁重建，避免再叠加一轮）。 */
function refreshCommitHashSpans(shas: string[]): void {
  const set = new Set(shas)
  document.querySelectorAll<HTMLElement>('.commit-hash').forEach((span) => {
    const sha = span.dataset.sha ?? ''
    if (set.has(sha)) applyCommitHashState(span)
  })
}

// 布局骨架：拆分后侧栏会话列表为原生 tree，本 webview（editor WebviewPanel）
// 只渲染聊天列。聊天快照走 render()，会话快照仅留作 @ 补全的数据源（不再渲染面板）。
const chatCol = el('div', 'chat-col')
app.appendChild(chatCol)

// ── 断连横幅（重连状态透出）─────────────────────────────────────────────────
// 横幅是 chatCol 的常驻首子元素，在消息流之外（不受 .flow-col 内容列限宽），
// 由 chatReconnect 消息直接驱动、不进 render() 的重建循环——断连/恢复是与
// ChatState 快照无关的瞬态事件流。render() 的清理循环跳过它（openError/空态
// 分支同），换会话/重建都不会摘掉。
type ReconnectPhase = 'connecting' | 'recovered' | 'failed'
let reconnectBanner: HTMLElement | null = null
/** recovered 短暂显示后的自动隐藏定时器。 */
let reconnectHideTimer: ReturnType<typeof setTimeout> | undefined

/** 取（或建）横幅根元素：惰性插入 chatCol 首子位，render() 重建不摘。 */
function reconnectBannerEl(): HTMLElement {
  if (reconnectBanner) return reconnectBanner
  const banner = el('div', 'reconnect-banner')
  banner.style.display = 'none'
  banner.appendChild(el('span', 'reconnect-banner-icon'))
  banner.appendChild(el('span', 'reconnect-banner-text'))
  const button = buttonEl('reconnect-banner-btn', t('Reconnect now'))
  button.title = t('Reconnect now')
  button.addEventListener('click', () => post({ type: 'forceReconnect' }))
  banner.appendChild(button)
  reconnectBanner = banner
  chatCol.insertBefore(banner, chatCol.firstChild)
  return banner
}

/** 隐藏横幅（恢复自动隐藏 / 空态复位共用）。 */
function hideReconnectBanner(): void {
  if (reconnectHideTimer !== undefined) {
    clearTimeout(reconnectHideTimer)
    reconnectHideTimer = undefined
  }
  if (reconnectBanner) reconnectBanner.style.display = 'none'
}

/** 驱动横幅相位：connecting/failed 常驻；recovered 短暂显示（~3s）后自动隐藏。 */
function applyReconnectPhase(phase: ReconnectPhase | null, attempts = 0): void {
  if (reconnectHideTimer !== undefined) {
    clearTimeout(reconnectHideTimer)
    reconnectHideTimer = undefined
  }
  const banner = reconnectBannerEl()
  if (phase === null) {
    banner.style.display = 'none'
    return
  }
  banner.classList.remove('connecting', 'failed', 'recovered')
  banner.classList.add(phase)
  const icon = banner.querySelector<HTMLElement>('.reconnect-banner-icon')
  const label = banner.querySelector<HTMLElement>('.reconnect-banner-text')
  if (icon) {
    icon.replaceChildren(
      phase === 'connecting'
        ? spinnerEl()
        : phase === 'failed'
          ? strokeSvg(['M8 2.6l5.6 10H2.4z', 'M8 6.4v3.2', 'M8 11.6v.05'])
          : strokeSvg(['M3.5 8.5l3 3 6-7']),
    )
  }
  if (label) {
    label.textContent =
      phase === 'connecting'
        ? t('Connection lost, reconnecting… (attempt {0})', attempts)
        : phase === 'failed'
          ? t('Connection lost, reconnection failed')
          : t('Connection restored')
  }
  banner.style.display = ''
  if (phase === 'recovered') {
    // 恢复给一个明确信号：绿色横幅短暂显示后自动收起。
    reconnectHideTimer = setTimeout(hideReconnectBanner, 3000)
  }
}

/** 最新 sessions 快照；null = 尚未收到。仅作 @ 提及补全的数据源。 */
let sessionsSnapshot: SessionsSnapshot | null = null

window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'draftRestore') {
    // 持久化草稿全量下发（#14，宿主保证先于首个 state 帧到达）：种进内存
    // 草稿表——附着会话的恢复走首个 state 帧的切换归档/草稿消费路径；
    // 签名一并种下，恢复后内容未变不会触发重写。
    for (const [key, entry] of Object.entries(msg.composer ?? {})) {
      if (typeof entry?.text !== 'string') continue
      // 其他 tab 的空态草稿与本 tab 无关，不种。
      if (key.startsWith('tab:') && key !== `tab:${tabId}`) continue
      const images = entry.images ?? []
      const files = entry.files ?? []
      composerDrafts.set(key, entry.text)
      stagedPerSession.set(key, { images: [...images], files: [...files] })
      draftSaveSignatures.set(key, draftSignature({ text: entry.text, images, files }))
    }
    for (const [rpcId, perQuestion] of Object.entries(msg.answers ?? {})) {
      const d = new Map<number, QuestionDraft>()
      for (const [index, a] of Object.entries(perQuestion ?? {})) {
        const i = Number(index)
        if (!Number.isInteger(i) || !a) continue
        d.set(i, {
          selected: new Set(Array.isArray(a.selected) ? a.selected : []),
          custom: typeof a.custom === 'string' ? a.custom : '',
          other: a.other === true,
        })
      }
      if (d.size > 0) answerDrafts.set(rpcId, d)
    }
    // 空态 tab：首个 state 帧 sessionId 恒 null（stagedForSession 也是 null）
    // 不走切换归档，把本 tab 草稿直接停驻，首个 hero 渲染经 stashedDraft 消费。
    const mine = tabId ? msg.composer?.[`tab:${tabId}`] : undefined
    if (mine && !state?.sessionId) {
      if (mine.text) stashedDraft = mine.text
      pendingImages = [...(mine.images ?? [])]
      pendingFiles = [...(mine.files ?? [])]
      // state 未到（首个 state 帧还在路上）时不主动 render：render 不在 null
      // state 的取值域内；首个 state 帧的 hero 渲染同样会消费 stashedDraft。
      if (state) render()
      return
    }
    // state 已到达（面板创建时的首推 state 排队在 ready 回执之前送达）：首个
    // state 帧的切换恢复发生时草稿表还没种上，这里对当前会话主动补一次恢复
    // （draftRestoreFor 帧消费文本，附件直接复位）。
    if (state?.sessionId) {
      const restored = stagedPerSession.get(state.sessionId)
      // 本会话没有持久化草稿时不动作：draftRestoreFor 只在 composer 重建帧消费，
      // 保活帧（keepBlankHero/keepComposer）不清它——空布防会让下一个重建帧从
      // 空表取草稿，把用户已输入的内容抹掉（回归：无暖场首发消息路径）。
      if (!composerDrafts.has(state.sessionId) && !restored) return
      pendingImages = [...(restored?.images ?? [])]
      pendingFiles = [...(restored?.files ?? [])]
      draftRestoreFor = state.sessionId
      render()
    }
    return
  }
  if (msg?.type === 'state' && msg.state) {
    state = msg.state
    const switched = state.sessionId !== stagedForSession
    if (switched) {
      // 换会话：先存档旧会话的 composer 草稿（文本 + 附件），再恢复新会话的
      // ——文本不再跟着搬到下一个会话，附件不再切换即丢。
      // 文本从还挂在 DOM 里的旧输入框读；面板被 pending 接管（无输入框、
      // restoreDraft 暂存进 stashedDraft、接管帧快照进 pendingStash）时把
      // 暂存一并归档。空态（无附着会话）同样存档，占位 key 为 EMPTY_SESSION_KEY。
      // claim 是输入框内的瞬时态，跟着旧会话一起丢弃（新会话的草稿会有自己的
      // 判定：草稿不以旧 token 开头就自然不成立）。
      releaseSlashClaim()
      const oldKey = stagedForSession ?? EMPTY_SESSION_KEY
      // 首个 state 帧（此前无附着会话，oldKey 为空态占位）时保留 stashedDraft：
      // 它只可能来自「composer 尚未渲染时到达的 restoreDraft」回填（发送失败/
      // stop 抽干队列的回填先于首帧 State），属于即将恢复的会话；若随空态一并
      // 归档清空，回填文本会丢（输入区只剩 placeholder）。真实「切走再切回」的
      // 切换帧 oldKey 是真会话 id，仍走归档清空（stashedDraft 归旧会话）。
      //   ——首帧 activeComposer 恒为 null（无 composer 可读），pendingStash 也恒为
      //     null（尚无 pending 帧），归档空态档时两者都不参与。
      const oldDraft = composerText()
      composerDrafts.set(
        oldKey,
        oldKey === EMPTY_SESSION_KEY ? (activeComposer ? oldDraft : '') : oldDraft,
      )
      stagedPerSession.set(oldKey, { images: pendingImages, files: pendingFiles })
      // 旧会话草稿立即落盘（#14）：防抖定时器触发时读的是切换后的当前会话态，
      // 等它火旧草稿已归档摸不着，必须在归档点同步上报。
      flushDraftSave(persistKeyFor(oldKey), {
        text: composerDrafts.get(oldKey) ?? '',
        images: stagedPerSession.get(oldKey)?.images ?? [],
        files: stagedPerSession.get(oldKey)?.files ?? [],
      })
      if (oldKey !== EMPTY_SESSION_KEY) {
        stashedDraft = undefined
        pendingStash = null
      }
      // 数组浅拷贝：归档持有原数组，恢复出的 pending* 之后会被用户在 composer
      // 里 splice 编辑，不能直接引用归档数组（否则删附件会污染归档）。
      const restored = stagedPerSession.get(state.sessionId ?? EMPTY_SESSION_KEY)
      pendingImages = [...(restored?.images ?? [])]
      pendingFiles = [...(restored?.files ?? [])]
      // @ 引用绑定随草稿同生命周期：旧会话的绑定归档（Map 引用，切回时原样
      // 恢复），新会话取自己的那份、没有则空 Map（新会话不再被旧会话的占用
      // token 强制 ` (2)` 后缀）。发送成功/失败不在此清空——草稿清空后回溯
      // 历史（↑）仍要用绑定反查 canonical 长路径。
      mentionBindingsPerSession.set(oldKey, mentionBindings)
      mentionBindings = mentionBindingsPerSession.get(state.sessionId ?? EMPTY_SESSION_KEY) ?? new Map()
      modelCatalog = null
      commandNotices = []
      commandReceipts = []
      recall = null
      recallDraft = ''
      earlierAnchor = null
      earlierRequestAt = 0
      // commit hash 查询缓存按会话隔离：同一短 hash 在不同仓库可能指向不同提交，
      // 换会话后旧缓存里的 title 会误导，需重查（先查后亮保证点击行为仍准确）。
      commitInfoCache.clear()
      commitInfoInflight.clear()
      pendingCommitInfoShas.clear()
      stagedForSession = state.sessionId
      draftRestoreFor = state.sessionId
    }
    // 宿主回流后的占位对账（命中即撤；换会话/超时同样作废）——必须在 render 前，
    // 否则这一帧会同时画出占位与真身。
    reconcilePendingEchoes(state)
    render()
    // 切换帧强制重报脏位（host 替换 tab 时会把脏位归零，同值比较会漏报）。
    if (switched) reportComposerDirty(true)
  } else if (msg?.type === 'sessions' && msg.snapshot) {
    // 拆分后侧栏为原生 tree；这里只更新 @ 提及补全的会话数据源。
    sessionsSnapshot = msg.snapshot
  } else if (msg?.type === 'commandResult' && typeof msg.text === 'string' && msg.text.trim()) {
    // 命令回执：合成/对齐一条生命周期节点（commandId key + 标题/状态/正文），
    // 与 matched 命令的 command/run+done 节点同款形态（官方 CommandNode）。
    // matched 命令用宿主的 commandId 作 key（与 protocol 节点同 id，避免重复）；
    // 未匹配命令（无 commandId）用合成 id 兜底在流尾回执。
    const name = typeof msg.commandName === 'string' && msg.commandName ? msg.commandName : 'command'
    const id = typeof msg.commandId === 'string' && msg.commandId ? msg.commandId : `cmd-unknown-${++commandReceiptSeq}`
    const status = msg.kind === 'error' ? 'error' : 'success'
    commandReceipts = [...commandReceipts.filter((r) => r.id !== id), { id, name, status, text: msg.text }]
    render()
  } else if (msg?.type === 'notice' && typeof msg.text === 'string') {
    // 宿主侧提示（插话失败一类）：与本地闸的提示同一个出口——流尾提示行。
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
    // 新附件不经 input 事件入场：在这里作废清空暂存（一次性反悔的边界）。
    clearedStash = null
    // 长文本粘贴折叠的回执：光标处自动插入 @ 短 token（canonical 记绑定，发送时展开）。
    // 核对回执文件名协议（pasted-*，折叠专属命名）：挂起期间的普通 pickFiles
    // 回执不会误插；跨会话/超时的慢回执由超时兜底兜住。
    if (pendingTextPaste !== null && msg.files.length > 0 && msg.files[0].name.startsWith('pasted-')) {
      clearTimeout(pendingTextPaste.timer)
      pendingTextPaste = null
      insertMentionToken(msg.files[0].name, msg.files[0].path)
    }
    render()
  } else if (msg?.type === 'fileThumb' && typeof msg.path === 'string' && typeof msg.data === 'string') {
    // 消息图片缩略图回执：缓存后就地换占位（增量化对账下未变行不重建，见
    // swapInlineImagePlaceholders），再重渲染走缓存。
    fileThumbCache.set(msg.path, `data:${msg.mediaType};base64,${msg.data}`)
    swapInlineImagePlaceholders(msg.path)
    render()
  } else if (msg?.type === 'fileThumbFailed' && typeof msg.path === 'string') {
    // 宿主放弃该文件（缺失/损坏/超时）：标失败态，就地换失败态占位，不再重发。
    fileThumbRequested.set(msg.path, { at: 0, failed: true })
    swapInlineImagePlaceholders(msg.path)
    render()
  } else if (msg?.type === 'pendingFailed' && typeof msg.rpcId === 'string') {
    // 应答失败回推（#50 I2）：记下原因并重渲染——面板按钮不再永久置灰，
    // 错误显示在面板内的反馈行，用户可以直接重试（官方 catch 复位 busy +
    // setError 同款）。
    const st = panelState.get(msg.rpcId)
    if (st) {
      st.failure = typeof msg.message === 'string' ? msg.message : ''
      st.failureSeq += 1
      // 取消失败（面板还在）：作废「去聊天里说」的延迟聚焦，别让下一次
      // composer 重建莫名其妙抢焦点。
      focusComposerAfterPending = false
      render()
    }
  } else if (msg?.type === 'modelCatalog' && msg.catalog) {
    modelCatalog = msg.catalog
    modelCatalogFailed = false
    if (modelMenuBody) renderModelMenuRoot(modelMenuBody, msg.catalog)
  } else if (msg?.type === 'chatFontSize' && Number.isInteger(msg.value)) {
    // 内容字号设置运行中变化（dshOne.chatFontSize）：覆盖 body 内联变量，
    // 派生变量（delta/secondary）与内容区随 CSS 实时重算，无需重渲染/reload。
    document.body.style.setProperty('--dsh-content-font-size', `${msg.value}px`)
    // 字号变化只改内容高度（scrollHeight 重排），不改 .messages 容器尺寸——
    // ResizeObserver 捕不到这类 H 扰动，这里在样式应用后的下一帧补一次
    // settle pin（幂等：仅跟随且脱底才写，非跟随保持阅读位置）。
    requestAnimationFrame(() => maybeSettlePin())
  } else if (msg?.type === 'chatReconnect' && typeof msg.attempts === 'number') {
    // 断连重连状态（host 侧 onMuxClose / 重连成功 / forceReconnect 发射）：
    // 驱动顶部横幅——connecting 转圈 + 立即重连、failed 红字 + 按钮、
    // recovered 绿色短暂显示后自动收起（见 applyReconnectPhase）。
    applyReconnectPhase(msg.phase, msg.attempts)
  } else if (msg?.type === 'modelCatalogError') {
    // 有旧目录时保留旧数据不打断；无目录时菜单切到 error/Retry 行。
    modelCatalogFailed = true
    if (modelMenuBody && !modelCatalog) renderModelMenuError(modelMenuBody)
  } else if (msg?.type === 'attachmentData' && typeof msg.attachmentId === 'string') {
    const dataUrl = `data:${msg.mediaType};base64,${msg.data}`
    attachmentCache.set(msg.attachmentId, dataUrl)
    // 历史消息召回正在等这张图 staging 进 composer：命中就装 pendingImages。
    const stageName = recallStagingImages.get(msg.attachmentId)
    if (stageName !== undefined) {
      recallStagingImages.delete(msg.attachmentId)
      pendingImages.push({ mediaType: msg.mediaType, data: msg.data, name: stageName })
    }
    if (pendingPreview === msg.attachmentId) {
      pendingPreview = null
      openLightbox(dataUrl)
    }
    // 消息缩略图可能正挂着这张图的占位方块，重渲染换成真图。
    render()
  } else if (msg?.type === 'restoreDraft' && typeof msg.text === 'string') {
    // 还原回 composer：stop 抽干队列的草稿文本，或发送失败的消息（图片/文件
    // chips 一并恢复，不让输入被吞）。回填文本里可能还带未拆的附件行
    // （stop 早期只吐 raw editText，历史项是 <attachment> 形态），这里统一拆附件行
    // + 还原 canonical @ 长路径与 @[标签](uri) 为显示 token（与第一次输入形态一致；
    // 发送时按节点投影展开回 canonical）。
    //
    // 排到队列里由 flushFailedDrafts 落地（对齐官方 detachedDraft 的还原规则）：
    // 提交后用户又打了字就不当场覆盖，等输入框空下来再按提交顺序拼回；多次失败
    // 之间用空行分隔，形态与当初输入的一致（B-21）。
    const { text: splitText, files: splitFiles } = splitAttachmentLines(msg.text)
    const restoredText = restoreRecallMentions(splitText)
    // 发送失败 / stop 抽干队列会把文本回填 composer：对应的本地占位就此作废
    // （否则「正在发送」的占位与回填的草稿会同时挂着——#52 S1）。
    const echoDropped = dropPendingEcho(echoBasis(msg.text))
    detachedDrafts.push({
      text: restoredText,
      images: Array.isArray(msg.images) ? msg.images : [],
      files: [...splitFiles, ...(Array.isArray(msg.files) ? msg.files : [])],
    })
    flushFailedDrafts()
    if (echoDropped) render()
    // 发送失败的回填不一定经过 render（stashedDraft 路径），这里兜一次落盘调度（#14）。
    scheduleDraftSave()
  } else if (msg?.type === 'fileRefList') {
    // 乱序/过期响应丢弃；token 没变才存结果并重算弹窗（token 已消失时
    // updateSlashPopup 自己算不出行，弹窗保持关闭）。
    if (msg.requestId !== fileRefSeq) return
    fileRefPending = false
    const settled = { key: fileRefRequestKey, items: Array.isArray(msg.items) ? msg.items : [] }
    fileRefResult = settled
    fileRefSettled = settled
    if (activeComposer) updateSlashPopup(activeComposer)
  } else if (msg?.type === 'turnJumped') {
    // 回合跳转回执：宿主已翻页覆盖目标 seq，滚动定位到目标回合首行。
    // 行元素可能因刚落的页还没 reconciliation 完，等多帧再滚。
    scrollToMessageId(msg.messageId)
  }
})

/**
 * Esc / Ctrl+C 打断当前 turn，等价于点「停止」按钮。优先级最低：
 * 弹层、图片预览（capture 阶段）与斜杠补全、草稿召回、重命名输入、
 * composer 双击清空（元素自身的 bubble 阶段）都先消费并 preventDefault，
 * 这里靠 defaultPrevented 让路。本处理器挂在 document 的 bubble 阶段，
 * 保证最后执行。Ctrl+C 在有选区（输入框内或页面上）时保持复制语义。
 */
document.addEventListener('keydown', (e) => {
  if (!state?.running) return
  // IME 组合中的按键不算打断意图：中文/日文输入法里 Esc 是「关掉候选窗」（组合
  // 取消），把它当作停止会让用户只是想取消候选就打断了正在跑的 turn。组合态的
  // 事件由输入法消费，composer 自身的 clear-chord 已按 isComposing 让路，这里
  // 同样整体让路（对齐官方 composer 的 isComposing 门控）。
  if (e.isComposing) return
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return
    e.preventDefault()
    post({ type: 'stop' })
    return
  }
  if (isComposerClearChord(e)) {
    // composer 双击清空武装/执行时已 preventDefault，这里让路（运行中也是
    // 「先清输入、再停 turn」两层语义）。
    if (e.defaultPrevented) return
    const active = document.activeElement
    // 输入框本体是 Lexical 的 contentEditable（不是 textarea/input）：光看元素
    // 类型会漏掉「输入框里选中一段再按 Ctrl+C」——那是要复制，不是打断。composer
    // 的选区走编辑器自己的 selection()（DOM Selection 在 contentEditable 里
    // 未必同步给出）。
    const fieldSelection =
      (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
      active.selectionStart !== null &&
      active.selectionStart !== active.selectionEnd
    const composerSelRange = composerSel()
    const composerSelection = composerSelRange.start !== composerSelRange.end
    const sel = window.getSelection()
    const pageSelection = !!sel && !sel.isCollapsed && sel.toString() !== ''
    if (fieldSelection || composerSelection || pageSelection) return
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
/** 定时计划菜单打开期间的 1s tick（刷新相对时间/逾期态；closePopover 统一清理）。 */
let scheduleTick: ReturnType<typeof setInterval> | null = null
/** 弹层重定位的 rAF 去重句柄（scroll capture 每帧多次触发，几何量只需每帧一次）。 */
let popoverRepositionFrame: number | null = null
/** 弹层自身尺寸变化的观察者（内容撑高/换行后重定位；closePopover 统一清理）。 */
let popoverSizeObserver: ResizeObserver | null = null

/**
 * 弹层跟随视口/锚点变化重定位（对齐官方 useAnchoredPosition：window 的
 * scroll(capture) + resize + 面板自身 ResizeObserver）。scroll 用捕获阶段因为
 * 消息流的滚动不冒泡到 window；合帧到 rAF 再做几何计算（滚动期间每帧多次触发）。
 * 面板尺寸变化也重定位：内容换行/撑高后弹层可能溢出视口被裁。
 */
function schedulePopoverReposition(): void {
  if (popover === null) return
  if (typeof requestAnimationFrame !== 'function') {
    positionPopover()
    return
  }
  if (popoverRepositionFrame !== null) return
  popoverRepositionFrame = requestAnimationFrame(() => {
    popoverRepositionFrame = null
    positionPopover()
  })
}

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

// webview 文档失焦即关弹层：点击编辑器/其他面板时 mousedown 在另一个文档
// 派发，webview 收不到（onPopoverOutside 无效），只有 blur 可靠——自绘菜单
// 没有宿主菜单系统帮它全局关闭，靠这一个信号补上「点外面就关」的原生体验。
function onPopoverBlur(): void {
  closePopover()
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
  if (scheduleTick !== null) {
    clearInterval(scheduleTick)
    scheduleTick = null
  }
  if (popoverRepositionFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(popoverRepositionFrame)
  }
  popoverRepositionFrame = null
  popoverSizeObserver?.disconnect()
  popoverSizeObserver = null
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
  window.removeEventListener('blur', onPopoverBlur)
  window.removeEventListener('scroll', schedulePopoverReposition, true)
  window.removeEventListener('resize', schedulePopoverReposition)
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
  window.addEventListener('blur', onPopoverBlur)
  // 打开期间跟随视口/锚点：滚动消息流或缩放面板/窗口后弹层与锚点不再脱开
  // （#50 R8，官方 useAnchoredPosition 同款）。
  window.addEventListener('scroll', schedulePopoverReposition, true)
  window.addEventListener('resize', schedulePopoverReposition)
  if (typeof ResizeObserver !== 'undefined') {
    popoverSizeObserver = new ResizeObserver(() => schedulePopoverReposition())
    popoverSizeObserver.observe(p)
  }
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
  window.addEventListener('blur', onPopoverBlur)
}

/** 重建后能在新 DOM 里按身份找回替代元素的弹层锚点类型；其余类型的锚点被
 *  重建摘除时只能关闭。新增类型要答「新元素凭什么唯一对应旧元素」。 */
function reanchorablePopoverAnchor(anchor: HTMLElement): boolean {
  return (
    (anchor.classList.contains('commit-hash') && anchor.dataset.sha !== undefined) ||
    anchor.classList.contains('msg-usage-pill') ||
    anchor.classList.contains('install-script-platform')
  )
}

/** 在重建后的新 DOM 里找同身份的替代锚点。消息行内的类型限同 flow 行
 *  （data-flow-key 由 reconcileFlow 写入、跨重建稳定），避免同 sha 在多条消息
 *  并存时锚到别的行。 */
function findPopoverAnchorReplacement(anchor: HTMLElement): HTMLElement | null {
  const rowKey = anchor.closest<HTMLElement>('[data-flow-key]')?.getAttribute('data-flow-key') ?? null
  if (anchor.classList.contains('commit-hash') && anchor.dataset.sha !== undefined) {
    const sha = CSS.escape(anchor.dataset.sha)
    const scoped =
      rowKey !== null
        ? document.querySelector<HTMLElement>(
            `[data-flow-key="${CSS.escape(rowKey)}"] .commit-hash[data-sha="${sha}"]`,
          )
        : null
    return scoped ?? document.querySelector<HTMLElement>(`.commit-hash[data-sha="${sha}"]`)
  }
  if (anchor.classList.contains('msg-usage-pill') && rowKey !== null) {
    return document.querySelector<HTMLElement>(`[data-flow-key="${CSS.escape(rowKey)}"] .msg-usage-pill`)
  }
  if (anchor.classList.contains('install-script-platform')) {
    return document.querySelector<HTMLElement>('.install-script-platform')
  }
  return null
}

/** 重建点（流式行对账、空态整块重建）之后收尾弹层：锚点还在 → 按实时布局
 *  重定位（卡片/菜单随锚点移动）；被摘除 → 找同身份替代元素接住，卡片不闪
 *  关闪开（流式每帧重建行时 chip 每帧被摘，不重锚就是「正在输出时卡片一直
 *  跳/闪没」）；找不到替代才关闭。 */
function reanchorPopoverAfterRebuild(): void {
  if (popover === null || popoverAnchor === null) return
  const anchor = popoverAnchor
  if (anchor.isConnected) {
    positionPopover()
    return
  }
  const replacement = findPopoverAnchorReplacement(anchor)
  if (replacement !== null) {
    popoverAnchor = replacement
    positionPopover()
  } else {
    closePopover()
  }
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
  apply?: (composer: ComposerEditor) => void
  /**
   * Tab 下钻（目录候选）：官方 onPick 的 `action === 'drill'` 分支——把目录
   * mention（尾 `/`、引号保持敞开）作为**纯文本**插入并继续补全，而不是落定
   * 成 chip 关掉菜单。缺省（无 drill）时 Tab 与 Enter 同义。
   */
  drill?: (composer: ComposerEditor) => void
  /** 分组小标题行（不可选、无 hover），行间带分割线，如 @ 补全的「文件」「会话」。 */
  header?: true
  /** 异步候选在途的占位行（不可选），对齐官方 pending 组的骨架行语义。 */
  loading?: true
}

let slashPopupEl: HTMLElement | null = null
let slashRows: SlashRow[] = []
let slashIndex = 0
/** 当前弹窗顶部的面包屑（只有 @ 下钻过才有；官方 MenuView 的 crumbs 头）。 */
let slashCrumbs: FileCrumb[] | null = null

/**
 * 取参命令的 claim 状态（对齐官方 dsh-client-ui-commands 的 leadingClaim +
 * dsh-client-ui-conversation 的 claimed 相位）：非 null 时整段输入被这条
 * 命令「认领」——草稿固定以 `${token}` 开头，其后文本都算参数，占位符换成
 * 该命令的参数提示，Enter 依旧整行发出去（宿主按 `/name args` 解析）。
 * 草稿不再以 token 开头即撤 claim（官方 onDraftChanged 的撤销条件）。
 */
let slashClaim: { name: string; token: string } | null = null

/** 参数提示文案：官方 `hint.<name>` 的本地化覆盖优先，其次宿主 commands/list 的 input.hint。 */
function slashCommandHintText(name: string): string | undefined {
  if (name === 'goal') {
    // 官方 hint.goal / hint.goal.active（进行中的目标换一套说法）。
    return state?.goal && state.goal.phase !== 'complete'
      ? t('goal active — edit / modify / pause / resume / clear')
      : t('describe the objective for a long-running task')
  }
  return slashCommands().find((c) => c.name === name)?.hint
}

/** 草稿正是 claim token（还没打参数）时显示参数提示，打了参数就让位给正文。 */
function syncSlashClaimPlaceholder(): void {
  const editor = activeComposer
  if (!editor) return
  if (slashClaim === null) {
    editor.setPlaceholderOverride(undefined)
    return
  }
  const args = editor.getText().slice(slashClaim.token.length)
  const hint = args.trim() === '' ? slashCommandHintText(slashClaim.name) : undefined
  editor.setPlaceholderOverride(hint === undefined ? '' : hint)
}

/**
 * 认领输入框：草稿换成 `/${name} `（官方 beginCommand 把 [0, span.end)
 * 替换成 token），光标落到末尾继续打参数。Skill 与无参命令不 claim——
 * 它们没有 input，输入框没什么可进入的「参数模式」。
 */
function claimSlashCommand(name: string): void {
  const editor = activeComposer
  if (!editor) return
  const spec = slashCommands().find((c) => c.name === name)
  if (!claimableSlashCommand(spec)) {
    editor.replaceRange(0, editor.getText().length, `/${name} `)
    return
  }
  slashClaim = { name, token: slashClaimToken(name) }
  editor.replaceRange(0, editor.getText().length, slashClaim.token)
  syncSlashClaimPlaceholder()
}

/** 撤 claim：草稿不再以 token 开头（或整段被清/换会话）时调用。 */
function releaseSlashClaim(): void {
  if (slashClaim === null) return
  slashClaim = null
  activeComposer?.setPlaceholderOverride(undefined)
}

/**
 * @ 文件候选的请求/响应状态：requestId 递增防乱序，key 是触发时的完整
 * token（`@sub/que`），响应只在 token 没变时上屏。host 端失败回空列表。
 *
 * `pending` 是三态里的「在途」：官方 menu 的组状态是 pending/ready，pending
 * 且无候选时出骨架行、有候选时继续显示旧候选（query 细化不闪回空菜单）。
 * 对应到这里——`settled` 保留最近一次落定的候选，pending 期间拿它顶着。
 */
let fileRefSeq = 0
let fileRefRequestKey = ''
let fileRefResult: { key: string; items: FileRefCandidate[] } | null = null
/**
 * 这次列目录是「下钻」来的还是「手打路径」来的（官方 controller.drilled）：
 * 只有下钻才出面包屑——手打的路径自带上下文，下钻换掉了用户正在读的文本，
 * 欠他一条回程。随菜单关闭一起清。
 */
let fileRefDrilled = false
/** 最近一次落定的候选（key 是当时的 token）；pending 期拿它当「旧候选」。 */
let fileRefSettled: { key: string; items: FileRefCandidate[] } | null = null
/** 工作区候选是否有请求在途（从发起防抖起算，到该 requestId 的回执为止）。 */
let fileRefPending = false
/** @ 补全请求防抖（宿主工作区扫描有目录 stat 开销，防每键一次全量扫描）。 */
let fileRefDebounce: ReturnType<typeof setTimeout> | null = null

/**
 * 显示 token（`@标题`/`@短名`）→ canonical mention 的映射，发送时由
 * expandMentionBindings 展开（src/pure/sessionMention.ts）。@ 补全和
 * mention 粘贴都会登记。与 composerDrafts/stagedPerSession 同级按会话
 * 归档/恢复：切走存旧、切回取新，新会话空 Map；发送成功/失败不强制
 * 清空——绑定随草稿生命周期走（草稿恢复时绑定也在，发送展开照常）。
 * 按会话隔离后跨会话不再互相污染：会话 B 里附加同名文件不会被会话 A
 * 的残留绑定强制加 ` (2)` 后缀。
 */
const mentionBindingsPerSession = new Map<string, Map<string, string>>()
/** 当前会话的绑定（mentionBindingsPerSession 中对应会话的那份；空态用 EMPTY_SESSION_KEY）。 */
let mentionBindings = new Map<string, string>()

/** 活跃的 composer 编辑器（renderInput 每帧创建/挂载时赋值，dispose 时清空）。
 *  全局唯一的 live 编辑器——composer 保活时旧编辑器在 DOM 里存活，此引用同步。 */
let activeComposer: ComposerEditor | null = null

/**
 * ⌘/Ctrl+Enter「全部插话」手势的运行侧前提（对齐官方 canSteerQueue 里与快照有关
 * 的那半）：可发送、模型可用、回合在跑、队列里还有排队消息。等待插话中的
 * （placement='steering'）不算——它们已经在等落地，没有可「插」的。
 * 「草稿是不是空的」那半由调用点按各自手上的内容判：发送路径看 live 编辑器，
 * 渲染路径看这一帧的草稿（见 renderInput）。
 */
function steerQueueArmed(): boolean {
  return (
    state?.canSend === true &&
    state.modelAvailable !== false &&
    state.running === true &&
    (state.queue ?? []).some((item) => item.placement === 'queued')
  )
}

/** 按下 Enter 那一刻的完整判定：手势就绪且输入区确实空（无文本、无附件）。 */
function canSteerQueue(): boolean {
  return (
    steerQueueArmed() &&
    composerText().trim().length === 0 &&
    pendingFiles.length === 0 &&
    pendingImages.length === 0
  )
}

/** 当前 live composer 的纯文本；无 composer（pending 接管/未渲染）回退暂存。 */
function composerText(): string {
  return activeComposer ? activeComposer.getText() : (stashedDraft ?? pendingStash?.text ?? '')
}

/** 当前 live composer 的光标/选区（纯文本偏移）；无 composer 回退 0/0。 */
function composerSel(): { start: number; end: number } {
  return activeComposer ? activeComposer.selection() : { start: 0, end: 0 }
}

function hideSlashPopup(): void {
  slashPopupEl?.remove()
  slashPopupEl = null
  slashRows = []
  slashIndex = 0
  slashCrumbs = null
  // 下次再触发 @ 时重新取文件候选，避免上屏陈旧目录。
  fileRefResult = null
  // 下钻标记同样只属于这一次打开的菜单（官方 dismissed 时清 drilled）：
  // 关掉再打开就是新的浏览，不该还挂着上一轮的面包屑。
  fileRefDrilled = false
  fileRefSettled = null
  fileRefPending = false
}

/**
 * 点面包屑 = 退回那一层（官方 pickCrumb 走的是与下钻同一条路径）：把当前
 * @token 整段换成那一层的目录 mention（根段是裸 `@`），菜单不关——token 变了
 * 自然重查该层候选，面包屑也跟着重算。
 */
function crumbNodeApply(editor: ComposerEditor, crumb: FileCrumb): void {
  const at = activeAtToken(editor.beforeCaret())
  if (!at) return
  const cursor = editor.selection().start
  editor.replaceRange(cursor - at.prefix.length, cursor, crumb.mention)
}

function positionSlashPopup(editor: ComposerEditor): void {
  if (!slashPopupEl) return
  const rect = editor.root.getBoundingClientRect()
  slashPopupEl.style.left = `${Math.max(4, rect.left)}px`
  slashPopupEl.style.width = `${rect.width}px`
  slashPopupEl.style.bottom = `${window.innerHeight - rect.top + 6}px`
}

/** 把选中态画到弹窗子元素上（子下标与 slashRows 一一对齐，含 header/loading 行）。 */
function paintSlashSelection(scroll = false): void {
  if (!slashPopupEl) return
  const children = Array.from(slashPopupEl.querySelectorAll(':scope > *'))
  children.forEach((item, i) => {
    item.classList.toggle('selected', i === slashIndex)
  })
  if (scroll) children[slashIndex]?.scrollIntoView({ block: 'nearest' })
}

/**
 * 指针 hover 驱动选中（对齐官方 MenuView 的 onHover → controller.hover：
 * 键盘与指针共用同一个 highlight，谁后动听谁的）。只有可选行（带 apply 的
 * 候选行）能承接 hover，header/loading 行不改变选中。
 */
function setSlashIndex(i: number): void {
  if (!slashPopupEl || i === slashIndex) return
  if (slashRows[i]?.apply === undefined) return
  slashIndex = i
  paintSlashSelection()
}

/** Recompute the rows from the current value; hide when nothing applies. */
function updateSlashPopup(editor: ComposerEditor): void {
  // 斜杠命令整行匹配优先；不匹配时退到光标处的 @ 补全（文件 + 会话）。
  slashRows = computeSlashRows(editor)
  if (slashRows.length === 0) slashRows = computeRefRows(editor)
  if (slashRows.length === 0) {
    hideSlashPopup()
    return
  }
  const previousIndex = slashIndex
  const previousLabel = slashRows[previousIndex]?.label
  slashIndex = slashRows.findIndex((r) => r.apply !== undefined)
  if (!slashPopupEl) {
    slashPopupEl = el('div', 'popover slash-popup')
    document.body.appendChild(slashPopupEl)
  }
  slashPopupEl.textContent = ''
  // 面包屑头（下钻过才有）：钉在滚动区上方，点一段就退回那一层（官方 pickCrumb
  // 与下钻共用同一条路径，所以这里也是「换 token + 保持菜单打开」）。
  if (slashCrumbs && slashCrumbs.length > 0) {
    const trail = el('div', 'crumbs')
    trail.setAttribute('role', 'navigation')
    slashCrumbs.forEach((crumb, i) => {
      if (i > 0) trail.appendChild(el('span', 'crumb-sep', '/'))
      const btn = buttonEl(crumb.current ? 'crumb current' : 'crumb', crumb.label)
      btn.type = 'button'
      if (crumb.current) btn.disabled = true
      else
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          crumbNodeApply(editor, crumb)
        })
      trail.appendChild(btn)
    })
    slashPopupEl.appendChild(trail)
    // 末段滚进可视区（深层路径默认看不到自己那一段）。
    trail.scrollLeft = trail.scrollWidth
  }
  slashRows.forEach((row, i) => {
    if (row.header) {
      // 每行恰好一个子元素，moveSlashSelection 按子下标对齐 slashRows。
      slashPopupEl?.appendChild(el('div', 'menu-group', row.label))
      return
    }
    if (row.loading) {
      // 异步候选在途：留着菜单并显示加载行（官方 pending 组的骨架行）。
      // 原来的做法是整组为空就 hideSlashPopup——打 @ 的瞬间菜单闪一下没了。
      slashPopupEl?.appendChild(el('div', 'menu-item hint-row loading-row', row.label))
      return
    }
    const item = el('div', 'menu-item')
    item.appendChild(el('span', undefined, row.label))
    if (row.right) item.appendChild(el('span', 'menu-right', row.right))
    if (row.drill) {
      // 目录候选的下钻提示：文案与键帽用官方 drill.hint + drill.key 的形态
      // （menu-hint / menu-key，选中或 hover 该行才显形）；点这行提示也能下钻
      // ——#53 的 .drill-hint 契约（沙盒驱动按它定位目录行）。
      const onDrill = (e: MouseEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        row.drill?.(editor)
      }
      const hint = el('span', 'menu-hint drill-hint', t('Browse folder'))
      hint.title = t('Drill into this folder (Tab)')
      hint.addEventListener('mousedown', onDrill)
      item.appendChild(hint)
      const key = el('kbd', 'menu-key', 'Tab')
      key.addEventListener('mousedown', onDrill)
      item.appendChild(key)
    }
    if (row.apply) {
      // mousedown + preventDefault: completing must not blur the editor.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        row.apply?.(editor)
      })
      item.addEventListener('mousemove', () => setSlashIndex(i))
    } else {
      item.classList.add('hint-row')
    }
    slashPopupEl?.appendChild(item)
  })
  paintSlashSelection()
  // 打字使候选表重排时尽量把选中停在原来那一项上（找不到退回首个可选行）。
  if (previousLabel !== undefined) {
    const kept = slashRows.findIndex((r) => r.label === previousLabel && r.apply !== undefined)
    if (kept >= 0) {
      slashIndex = kept
      paintSlashSelection()
    }
  }
  positionSlashPopup(editor)
}

function moveSlashSelection(dir: number): void {
  if (!slashPopupEl || slashRows.length === 0) return
  const selectable = slashRows.map((r, i) => (r.apply ? i : -1)).filter((i) => i >= 0)
  if (selectable.length === 0) return
  const at = selectable.indexOf(slashIndex)
  slashIndex = selectable[(at + dir + selectable.length) % selectable.length]
  // header/loading 行也是子元素，按子下标（而非 .menu-item 过滤后的下标）对齐 slashRows。
  paintSlashSelection(true)
}

/** Rows for the current composer value: command names, preset args, or one hint row. */
function computeSlashRows(editor: ComposerEditor): SlashRow[] {
  const value = editor.getText()
  if (!looksLikeSlashCommand(value) || value.includes('\n')) return []
  /** Filling the value and dispatching `input` re-enters updateSlashPopup. */
  const complete = (text: string) => () => {
    editor.replaceRange(0, editor.getText().length, text)
  }
  const sp = value.indexOf(' ')
  if (sp === -1) {
    const filter = value.slice(1).toLowerCase()
    if (filter.includes(' ')) return []
    // 命令与 skill 同一个候选池（官方 `/` 的两个源同为 `/name ` 插入格式）：
    // 命令在前、skill 在后，各自按官方 fuzzyScore 子序列过滤（前缀命中整体优先）。
    return [
      ...fuzzyCandidates(slashCommands(), filter).map((c) => ({
        label: `/${c.name}`,
        right: c.description,
        // 取参命令选中即 claim（官方 dispatch → leadingClaim）：token 落定、
        // 输入框进参数模式、占位符换成参数提示。
        apply: claimableSlashCommand(c) ? () => claimSlashCommand(c.name) : complete(`/${c.name} `),
      })),
      ...fuzzyCandidates(sessionSkills(), filter).map((s) => ({
        label: `/${s.name}`,
        right: s.description,
        apply: complete(`/${s.name} `),
      })),
    ]
  }
  const name = value.slice(1, sp)
  const argPrefix = value.slice(sp + 1)
  if (name === 'permission') {
    const options = state?.permissions?.options ?? []
    return options
      .filter((o) => o.value !== argPrefix && (o.value.startsWith(argPrefix) || o.label.toLowerCase().includes(argPrefix.toLowerCase())))
      .map((o) => ({ label: o.label, right: o.value, apply: complete(`/permission ${o.value}`) }))
  }
  const cmd = slashCommands().find((c) => c.name === name)
  // claim 生效且还没打参数时，占位符已经在显示同一条参数提示——不再重复出提示行
  // （官方 claimed 档直接抑制 `/` 触发；这里只压提示行，保住 /permission 的
  // 预设候选，那是本面板自己的参数补全）。
  if (cmd?.hint) {
    if (slashClaim !== null && slashClaim.name === name && argPrefix.trim() === '') return []
    return [{ label: t('Arguments: {0}', cmd.hint) }]
  }
  return []
}

/** 长文本粘贴折叠：超过阈值且会话可发送时拦截，交给宿主落盘（回投后自动插 @ token）。
 *  无附着会话（canSend=false）不折叠，走默认插入——文本不会无处可去。
 *  超时（3s）未回投视为失败：复位并原文插回光标（不能丢了用户的文本）。 */
const PASTE_FOLD_TIMEOUT_MS = 3000
/** 折叠上限：超过该长度的粘贴既不折叠也不塞进 textarea（两者都兜不住），提示另存文件。 */
const PASTE_FOLD_MAX_BYTES = 2 * 1024 * 1024
function foldLongTextPaste(event: ClipboardEvent, text: string): boolean {
  if (state?.canSend !== true) return false
  if (!shouldFoldPastText(text)) return false
  if (text.length > PASTE_FOLD_MAX_BYTES) {
    // 巨量粘贴：不折叠也不塞进 textarea（两者都兜不住），提示用户另存文件。
    event.preventDefault()
    commandNotices = [...commandNotices, t('Pasted content exceeds {0} MB; save it as a file and attach instead', Math.round(PASTE_FOLD_MAX_BYTES / 1024 / 1024))]
    render()
    return true
  }
  event.preventDefault()
  pendingTextPaste = {
    text,
    timer: setTimeout(() => {
      if (pendingTextPaste?.text !== text) return
      pendingTextPaste = null
      // 宿主没回投：原文插回光标处（粘贴点的原始语义），不丢数据。
      const editor = activeComposer
      if (editor) {
        const { start: cursor, end } = editor.selection()
        editor.replaceRange(cursor, end, text)
      }
    }, PASTE_FOLD_TIMEOUT_MS),
  }
  post({ type: 'pasteText', data: text })
  return true
}

/** 在输入框光标处插入 @ 文件引用显示 token（canonical 路径记 mentionBindings，发送时展开）。 */
function insertMentionToken(name: string, path: string): void {
  const editor = activeComposer
  if (!editor) return
  const mention = formatFileMention({ path, kind: 'file' }, false)
  if (mention === undefined) return
  const token = fileMentionToken(name, mention, mentionBindings)
  mentionBindings.set(token, mention)
  const { start: cursor, end } = editor.selection()
  editor.replaceTokenRange(cursor, end, token, mention, 'file')
}

/**
 * @ 补全（对齐 dsh web）：光标前的 `@query`（或未闭合 `@"query`）触发，
 * 候选分三组（各有小标题 + 分割线）：附件（当前 composer 已附加的）、
 * 工作区文件与文件夹（宿主 fileReferences/list 异步返回）、当前会话所属
 * 工作区的会话。引号 token 只出文件。
 *
 * 下钻：目录候选可下钻（Tab / 行内提示钮），下钻后 token 变成 `@dir/`、菜单
 * 不关、下一层候选随即重查；此时弹窗顶部出一条面包屑（官方 crumbsFor），
 * 点某一段退回那一层。
 * 引用其它会话主要靠会话面板的"复制引用"，这里只补本工作区的会话。
 */
function computeRefRows(editor: ComposerEditor): SlashRow[] {
  if (editor.selection().start !== editor.selection().end) return []
  const at = activeAtToken(editor.beforeCaret())
  if (!at) return []
  // token 变了才发新请求；250ms 防抖（宿主侧工作区扫描有目录 stat 开销）。
  // 响应到达后由消息处理分支重算本函数上屏。本地附件候选即时出，不等宿主。
  if (fileRefResult?.key !== at.prefix) {
    fileRefSeq += 1
    fileRefRequestKey = at.prefix
    fileRefResult = null
    fileRefPending = true
    if (fileRefDebounce !== null) clearTimeout(fileRefDebounce)
    fileRefDebounce = setTimeout(() => {
      fileRefDebounce = null
      post({ type: 'fileRefList', requestId: fileRefSeq, query: at.query })
    }, 250)
  }
  const { attachments, workspace, pending } = fileRows(editor, at)
  const sessions = at.quoted ? [] : sessionRows(editor, at)
  // 面包屑：只有下钻过的这一层才出（官方 crumb.root 用工作区名）。
  slashCrumbs = directoryCrumbs(at.query, at.quoted, fileRefDrilled, state?.workspaceLabel ?? t('Workspace')) ?? null
  const rows: SlashRow[] = [
    ...(attachments.length > 0 ? [{ label: t('Attachments'), header: true } as SlashRow, ...attachments] : []),
    ...(workspace.length > 0 ? [{ label: t('Files'), header: true } as SlashRow, ...workspace] : []),
    ...(pending && workspace.length === 0 ? [{ label: `${t('Files')} · ${t('Loading…')}`, loading: true } as SlashRow] : []),
    ...(sessions.length > 0 ? [{ label: t('Sessions'), header: true } as SlashRow, ...sessions] : []),
  ]
  // 工作区候选在途（防抖窗口 + 宿主往返）时给一行加载占位：没有它，下钻/继续
  // 打字的一瞬间行数为 0 会让 updateSlashPopup 直接关菜单，下钻就断了。
  if (workspace.length === 0 && fileRefResult?.key !== at.prefix) {
    return [...rows, { label: t('Loading…') }]
  }
  return rows
}

/**
 * 文件/文件夹候选行：**附件组**（本地即时，当前 composer 已附加的）与
 * **工作区组**（宿主异步返回）分开返回。选中后输入框插入 `@短名` 显示 token，
 * canonical 路径引用（`@/abs/path` 或 `@"..."`）记入 mentionBindings、发送时
 * 才展开——textarea 里看不到长路径；选中的若正是已附加的图片，对应 chip 高亮。
 * 目录候选项名带尾随 `/`（一眼分清文件与文件夹），并额外带 drill：下钻不落
 * token，而是把 token 换成 `@dir/` 继续挑下一层。
 *
 * 工作区组的三态（对齐官方 menu 的 pending/ready 组）：当前 token 已有落定结果
 * 就出真候选；请求在途且自己没有候选时，出**上一次落定的候选**顶着（官方
 * 「pending 组保留已有条目」），一个都没有才由调用方出加载行。
 */
function fileRows(editor: ComposerEditor, at: ActiveAtToken): { attachments: SlashRow[]; workspace: SlashRow[]; pending: boolean } {
  // 落定时的 CAS 依据（官方 insertReference 的 `span.draftRev !== this.rev`）：
  // 候选是异步/防抖期间构建的，落定那一刻草稿必须还是构建时的版本、token 也
  // 还是原样，否则这次插入丢弃——按过期区间改写文本会吃掉用户后打的字。
  const rev = editor.draftRev()
  const guarded = (mention: string, label: string, kind: 'file' | 'folder', action: 'pick' | 'drill') => (): void => {
    if (editor.draftRev() !== rev) return
    const now = activeAtToken(editor.beforeCaret())
    if (!now || now.prefix !== at.prefix) return
    const end = editor.selection().start
    const start = end - now.prefix.length
    if (action === 'drill') {
      // 下钻：目录 mention（尾 `/`，引号按当前 token 状态保持敞开）作为**纯文本**
      // 插入并继续补全——不落 chip、不关菜单，尾 `/` 让 activeAtToken 立刻重新
      // 触发下一层候选（官方 onPick 的 `{ text, continue: true }`）。
      // 同时标记「这次换层来自下钻」：面包屑只对下钻出来的层级显示。
      fileRefDrilled = true
      editor.replaceRange(start, end, mention)
      return
    }
    const token = fileMentionToken(label, mention, mentionBindings)
    mentionBindings.set(token, mention)
    editor.replaceTokenRange(start, end, token, mention, kind)
    // 重建 chips 让「已被 @ 引用」的高亮生效；焦点/光标由 render 恢复。
    render()
  }
  const rowOf = (c: FileRefCandidate): SlashRow[] => {
    const mention = formatFileMention(c, at.quoted)
    if (mention === undefined) return [] // 编辑器语法无法安全表示的路径不出候选
    const name = attachmentBaseName(c.path)
    const directory = c.kind === 'directory'
    const row: SlashRow = {
      // 目录候选项名带尾随 `/`（官方 fileCandidate 同款），一眼能分清文件与文件夹。
      label: `@${name}${directory ? '/' : ''}`,
      right: c.path,
      apply: guarded(mention, name, directory ? 'folder' : 'file', 'pick'),
    }
    if (directory) row.drill = guarded(mention, name, 'folder', 'drill')
    return [row]
  }
  // 当前 token 的落定结果优先；在途时退回上一次落定的候选（官方 pending 组保留旧条目）。
  const settled = fileRefResult !== null && fileRefResult.key === at.prefix ? fileRefResult : fileRefSettled
  return {
    attachments: attachedFileCandidates(at.query).flatMap(rowOf),
    workspace: settled !== null ? settled.items.flatMap(rowOf) : [],
    pending: fileRefPending,
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
function sessionRows(editor: ComposerEditor, at: ActiveAtToken): SlashRow[] {
  const snap = sessionsSnapshot
  if (!snap) return []
  const query = at.query.toLowerCase()
  // 同 fileRows：落定前做 draftRev + token 双重 CAS，过期区间不改写文本。
  const rev = editor.draftRev()
  if (!snap) return []
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
        if (editor.draftRev() !== rev) return
        const now = activeAtToken(editor.beforeCaret())
        if (!now || now.prefix !== at.prefix) return
        const cursor = editor.selection().start
        const token = mentionDisplayToken(s.label, s.sessionId, mentionBindings)
        const mention = formatSessionMention(s.label, s.sessionId)
        mentionBindings.set(token, mention)
        editor.replaceTokenRange(cursor - now.prefix.length, cursor, token, mention, 'session')
      },
    }))
}

/**
 * 当前 composer 能「认识」的 @ 显示名集合（词库门控的候选集，对齐官方 scanTextRefs
 * 的词库 gate）。来源 = @ 补全数据：附件（pendingFiles，本地即时）、工作区文件
 * （宿主异步返回的 fileRefResult，尽力而为）、当前会话所属工作区的会话短名
 * （sessionRows 同一作用域），再加已登记绑定的显示名（@ 补全选中/粘贴/召回时
 * 登记过、发送时能展开的那类引用——即使已不在当前补全候选里也保持着色）。
 * @dir/、尾 / 的 @"…"（目录、引号敞开）不走这个词库（按语法着色，见 composerEditor
 * registerTextRefDecoration）；无尾 / 的 @"…"（闭合引号、非目录）不着色（官方
 * FOLDER_REF_RE 引号分支须尾 /）。
 */
function composerAtTokenNames(): Set<string> {
  const names = new Set<string>()
  // dsh-one 的 `@` 名录来自补全候选（附件 basename / 工作区文件 / 会话短名），
  // 这些名字带扩展名与空格；官方的 name 口径是触发符后的 `[\w-]+`。两条都登记：
  // 整名（dsh-one 适配，`@img1.png` 这种带 `.` 的名字官方匹配不到）与官方
  // name 段（`@img1` 也能命中，对齐官方 scanTextRefs 的名录语义）。
  const add = (name: string): void => {
    if (name.length === 0) return
    names.add(name)
    const official = atTokenName(`@${name}`)
    if (official.length > 0) names.add(official)
  }
  for (const f of pendingFiles) add(attachmentBaseName(f.path))
  for (const c of fileRefResult?.items ?? []) add(attachmentBaseName(c.path))
  const snap = sessionsSnapshot
  if (snap) {
    const own =
      snap.workspaces.find((w) => w.sessions.some((s) => s.sessionId === state?.sessionId)) ??
      snap.workspaces.find((w) => state?.workspaceLabel !== undefined && w.label === state.workspaceLabel)
    for (const s of own?.sessions ?? []) add(s.label)
  }
  for (const token of mentionBindings.keys()) {
    // 绑定 key 是显示 token（@标题 / @img1.png (2)）：取掉 @ 与序号后缀得词库名。
    add(token.slice(1).replace(/\s*\(\d+\)$/, ''))
  }
  return names
}

/** `@` 词库的稳定签名：集合内容变了才触发重扫（render 很频繁，不能每次都扫）。 */
let lastAtLexiconSignature = ''

/**
 * 词库变化 → 全量重扫已输入的 @token（对齐官方 lexicon.subscribe → rescanTextRefs）。
 * Lexical 的着色变换只跑 dirty 节点，词库变了不弄脏任何节点——不主动重扫的话
 * 「先打 @img1.png 再附加该文件」这类顺序永远不变亮（B-08）。
 */
function syncAtLexiconRescan(): void {
  if (!activeComposer) return
  const signature = [...composerAtTokenNames()].sort().join('\u0000')
  if (signature === lastAtLexiconSignature) return
  lastAtLexiconSignature = signature
  activeComposer.rescanTextRefs()
}

/**
 * 当前 composer 能「认识」的 /command（skill 形态）名称集合（对齐官方 TEXT_REF_RE
 * 的 `[/@]` 触发符词库门控）。来源 = 宿主指令名录（state.slashCommands 或静态回退）
 * + 宿主 skill 名录（state.skills）+ 客户端 /model——`/plan`、`/compact`、skill 名
 * 命中着色，未知名 `/foo` 保持纯文本。
 */
function composerSlashTokenNames(): Set<string> {
  return new Set([...slashCommands().map((c) => c.name), ...sessionSkills().map((s) => s.name)])
}

/**
 * 粘贴板文本含 canonical 会话 mention（"复制引用"的产物 `@[标题](dsh-session:...)`）
 * 时接管粘贴：mention 换成 @ 补全同款的显示 token 并登记 mentionBindings
 * （发送时才展开）；光标前正在输入的 @query 触发词一并吃掉，先打 @ 再粘贴
 * 不会变成 `@@标题`。末尾是 mention 时补一个空格，与接着输入的文字隔开。
 * 返回是否已处理；普通文本粘贴返回 false，走默认行为。
 */
function pasteSessionMentions(editor: ComposerEditor, pasted: string): boolean {
  if (!pasted.includes(SESSION_REFERENCE_SCHEME)) return false
  const segments = splitSessionMentions(pasted)
  if (!segments.some((seg) => typeof seg !== 'string')) return false
  const parts = segments.map((seg) => {
    if (typeof seg === 'string') return { text: seg }
    const token = mentionDisplayToken(seg.label, seg.sessionId, mentionBindings)
    const mention = formatSessionMention(seg.label, seg.sessionId)
    mentionBindings.set(token, mention)
    // 带 mention 的引用节点：显示形态与原来一致（着色 token），但发送投影能
    // 展开成 canonical——文本级的绑定展开已经改成节点级（B-16），粘进来的
    // 会话引用必须自己带上 mention，否则发送时不会展开。
    return { text: token, mention }
  })
  const inserted = parts.map((p) => p.text).join('')
  const { start: selStart, end: selEnd } = editor.selection()
  const before = editor.getText().slice(0, selStart)
  const after = editor.getText().slice(selEnd)
  const endsWithMention = typeof segments[segments.length - 1] !== 'string'
  const pad = endsWithMention && !/^\s/.test(after) ? ' ' : ''
  // 光标前正在输入的 @query 触发词一并吃掉（先打 @ 再粘贴不会变成 `@@标题`）。
  let insertStart = selStart
  if (inserted.startsWith('@')) {
    const trigger = /(^|\s)@[^\s@]{0,30}$/.exec(before)
    if (trigger) insertStart = selStart - trigger[0].length + (trigger[1]?.length ?? 0)
  }
  if (pad) parts.push({ text: pad })
  editor.replaceRangeWithParts(insertStart, selEnd, parts)
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
          checked: isCurrent,
          onClick: () => {
            closePopover()
            if (isCurrent) return
            // 对齐官方 web：切模型重置为新模型声明默认档（未声明 = Default，
            // 不带 reasoningEffort），不保留旧档位。
            post({
              type: 'setModel',
              provider: g.id,
              model: m.id,
              reasoningEffort: m.defaultEffort,
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
  const efforts = model?.efforts ?? []
  const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
  // 对齐官方 web：模型未声明 defaultEffort 时，首项是 Default（清除显式档位，
  // 交给 provider 默认），不显示各档位 description。
  if (model?.defaultEffort === undefined) {
    body.appendChild(
      menuItem(t('Default'), {
        checked: effortId === undefined,
        onClick: () => {
          closePopover()
          if (catalog.current.reasoningEffort !== undefined) {
            post({
              type: 'setModel',
              provider: catalog.current.provider,
              model: catalog.current.model,
            })
          }
        },
      }),
    )
  }
  for (const e of efforts) {
    body.appendChild(
      menuItem(e.name, {
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

/**
 * 头部「N 个提醒」chip 的下拉（对齐官方 ScheduleCatalogAction 的只读
 * catalog）：每行 状态点（等待中蓝 / 逾期琥珀）+ 状态文案 + 提醒内容 +
 * 元信息（频率 · 本地时刻 · 剩余/逾期相对时间），逾期行淡黄底。
 * 打开期间每秒刷新相对时间与逾期态（官方同款 now tick，closePopover 清理）。
 */
function openScheduleMenu(anchor: HTMLElement): void {
  // 点 trigger 切换开合（与 jobs 菜单同款 toggle）。
  if (popover !== null && popoverAnchor === anchor) {
    closePopover()
    return
  }
  const records = state?.schedule
  if (!records || records.length === 0) return
  const now = Date.now()
  const body = el('div', 'schedule-menu')
  // 官方 orderScheduleRecords：overdue 在前、各自按目标时刻升序。
  for (const record of orderScheduleRecords(records, now)) {
    body.appendChild(renderScheduleMenuRow(record, now))
  }
  showPopover(anchor, body, 'below')
  scheduleTick = setInterval(() => {
    const tick = Date.now()
    popover?.querySelectorAll<HTMLElement>('[data-schedule-target]').forEach((row) => {
      patchScheduleRow(row, row.dataset.scheduleTarget ?? '', tick)
    })
  }, 1000)
}

/** 下拉里的一行提醒；now 由调用方取一次，保证同一帧渲染的行状态一致。 */
function renderScheduleMenuRow(record: ChatScheduleEntry, now: number): HTMLElement {
  const overdue = isScheduleOverdue(record, now)
  const row = el('div', overdue ? 'schedule-row overdue' : 'schedule-row')
  row.dataset.scheduleTarget = record.scheduledAt
  const status = el('span', overdue ? 'schedule-status overdue' : 'schedule-status')
  status.appendChild(el('span', overdue ? 'schedule-dot overdue' : 'schedule-dot'))
  status.appendChild(el('span', 'schedule-status-label', scheduleStatusLabel(record, now)))
  row.appendChild(status)
  const prompt = el('span', 'schedule-prompt', record.prompt)
  prompt.title = record.prompt
  row.appendChild(prompt)
  const meta = el('span', 'schedule-meta')
  const freq = el('span', undefined, scheduleFrequencyLabel(record))
  meta.appendChild(freq)
  meta.appendChild(el('span', 'schedule-meta-sep', '·'))
  const time = el('span', undefined, scheduleLocalTime(record.scheduledAt))
  meta.appendChild(time)
  meta.appendChild(el('span', 'schedule-meta-sep', '·'))
  const rel = el('span', overdue ? 'schedule-relative overdue' : 'schedule-relative', scheduleRelativeLabel(record, now))
  meta.appendChild(rel)
  row.appendChild(meta)
  return row
}

/** 打开期间每秒就地更新一行（状态文案/逾期态/相对时间），不重建弹层。 */
function patchScheduleRow(row: HTMLElement, scheduledAt: string, now: number): void {
  const overdue = isScheduleOverdue({ scheduledAt }, now)
  row.classList.toggle('overdue', overdue)
  const status = row.querySelector('.schedule-status')
  status?.classList.toggle('overdue', overdue)
  status?.querySelector('.schedule-dot')?.classList.toggle('overdue', overdue)
  const label = status?.querySelector('.schedule-status-label')
  if (label) label.textContent = overdue ? t('Overdue') : t('Scheduled')
  const rel = row.querySelector('.schedule-relative')
  if (rel) {
    rel.classList.toggle('overdue', overdue)
    rel.textContent = scheduleRelativeLabel({ scheduledAt }, now)
  }
}

/** chip 计数文案（官方 trigger.one/trigger.other：单复数两种 key）。 */
function scheduleCountLabel(count: number): string {
  return t(count === 1 ? '{0} reminder' : '{0} reminders', count)
}

/** 频率文案：「单次」（after/at）或「每 N 单位一次」（every，取最大整除单位）。 */
function scheduleFrequencyLabel(record: ChatScheduleEntry): string {
  if (record.kind !== 'every' || record.everySeconds === undefined) return t('Once')
  const { unit, value } = scheduleEveryUnit(record.everySeconds)
  return t('Every {0} {1}', String(value), scheduleUnitWord(unit, value))
}

/** 目标时刻的本地化展示（官方 formatScheduleLocalTime：当前 locale 的 medium date + short time）。 */
function scheduleLocalTime(scheduledAt: string): string {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(Date.parse(scheduledAt))
}

/** 剩余/逾期相对文案（官方 formatScheduleRelative：future/overdue/now 三态）。 */
function scheduleRelativeLabel(record: Pick<ChatScheduleEntry, 'scheduledAt'>, now: number): string {
  const delta = scheduleRelativeDelta(record.scheduledAt, now)
  if (delta.value === 0) return t('Due now')
  const unit = scheduleUnitWord(delta.unit, Math.abs(delta.value))
  const value = String(Math.abs(delta.value))
  return delta.value > 0 ? t('in {0} {1}', value, unit) : t('{0} {1} overdue', value, unit)
}

/** 时间单位词（官方 unit.day.one/other 等：英文按 1 与否选单复数，中文同词）。 */
function scheduleUnitWord(unit: ScheduleTimeUnit, value: number): string {
  if (value === 1) {
    const keys: Record<ScheduleTimeUnit, string> = { day: 'day', hour: 'hour', minute: 'minute', second: 'second' }
    return t(keys[unit])
  }
  const keys: Record<ScheduleTimeUnit, string> = { day: 'days', hour: 'hours', minute: 'minutes', second: 'seconds' }
  return t(keys[unit])
}

/** 状态文案（官方 status.scheduled/overdue）。 */
function scheduleStatusLabel(record: Pick<ChatScheduleEntry, 'scheduledAt'>, now: number): string {
  return isScheduleOverdue(record, now) ? t('Overdue') : t('Scheduled')
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
  for (const c of slashCommands()) {
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
  // Slash commands must lead the prompt; prepend ahead of any draft (its args).
  // 取参命令走 claim 路径（进参数模式 + 参数提示），与补全菜单选中一致。
  claimSlashCommand(name)
}

/**
 * Inline rename 的渲染状态（显式化进渲染模型，不再就地替换 title span）：
 * renaming 期间 renderHeader 渲染输入框而非标题；headerSig 纳入 renaming 且
 * 剔除 sessionTitle（标题投影变化不改渲染输出）——流式快照时 keepHeader 原位
 * 保留，输入框存活、IME 组合不断。Enter 提交、Esc/blur 取消后 renaming=false，
 * 签名变化驱动 header 重建还原标题。
 */
let renaming = false
let renameDraft = ''
let renameOriginal = ''
let renameSelStart = 0
let renameSelEnd = 0
/** 清理循环移除 header 期间为 true：销毁输入框同步派发的 blur 不视为取消
 *  （元素被 remove 时浏览器先重置焦点再摘离，blur 派发时 isConnected 仍为
 *  true，isConnected 守卫无效——与侧栏 rebuildInProgress 同款）。 */
let rebuildingHeader = false

/** Inline rename: Enter commits, Esc/blur cancels. */
function startInlineRename(_header: HTMLElement): void {
  if (!state?.sessionId) return
  renaming = true
  renameDraft = state.sessionTitle ?? ''
  renameOriginal = renameDraft
  renameSelStart = 0
  renameSelEnd = renameDraft.length
  render()
}

/** 改名输入框的提交/取消公共收尾：退出改名态并重建 header 还原标题。 */
function endInlineRename(): void {
  renaming = false
  renameDraft = ''
  render()
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
      // 置顶/运行中/未读/待处理禁用：置顶归档绕过置顶保护（pinned-not-archivable），
      // 其余归档后状态难追踪。host 命令层对置顶还有兜底（防菜单绕过）。
      disabled: pinned || running || unread || pending,
      disabledTip: pinned
        ? t('Pinned sessions cannot be archived; unpin them first')
        : pending
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
  // 行级定时器（turn-status clock / 重试行倒计时）归各自行所有：增量更新下
  // 未变行整体保活，定时器继续走；行被替换/移除时由 flow dispose 清理
  // （clearTurnStatusTimer / clearRetryTimersFor），不再在 render 头全局清。
  // <details> 展开态按会话隔离：换会话整体换帧（不是清空）——切走再切回，
  // 思考/工具卡/代码块/JSON 树/产物行的展开态与卡内滚动位置原样保留（#52 W3）。
  // 换帧前先把旧会话的卡内滚动位置存进它的帧（此刻 DOM 还是旧会话内容）。
  // workflow 卡片状态同样按会话隔离。
  const detailsSid = state?.sessionId ?? null
  const switchingDisclosure = detailsSid !== detailsSession
  if (switchingDisclosure) {
    saveInnerScroll(chatCol)
    activateSession(detailsSid)
    detailsSession = detailsSid
    copyConfirmedAt.clear()
    assistantTailSigs.clear()
    // 双击清空武装态与清空暂存同样按会话隔离：切走后旧会话的「再按一次清空」
    // 提示和 Ctrl+Z 反悔内容都不该落到新会话（文本/附件归档各走各的）。
    disarmClearConfirm()
    clearedStash = null
  }
  const oldInput = document.getElementById('input') as HTMLElement | null
  const hadFocus = oldInput !== null && document.activeElement === oldInput
  // Pending 接管（approval/question/plan-review 把 composer 整体替换成面板）是
  // 本帧唯一会移除 composer 元素的情形：先把输入状态（文本/recall 态/焦点/光标）
  // 存入 pendingStash——pending 期间 activeComposer 恒为 null，没有这份快照，pending
  // 结束恢复 composer 时草稿会按 undefined 还原（回归：输入到一半弹卡，应答后
  // 内容全丢）。
  if (oldInput !== null && (state?.pending.length ?? 0) > 0) {
    const sel = composerSel()
    pendingStash = {
      sessionId: state?.sessionId ?? null,
      text: composerText(),
      recall,
      recallDraft,
      focus: hadFocus,
      selStart: sel.start,
      selEnd: sel.end,
    }
  }
  // Pending 结束后恢复 composer 的那帧按暂存还原；会话已切走（sessionId 不匹配）
  // 则作废——切换时文本已归档进 composerDrafts 并清空了 pendingStash。
  const stashRestore =
    pendingStash !== null && state?.sessionId === pendingStash.sessionId
  const stashSel =
    stashRestore && pendingStash !== null && pendingStash.focus
      ? { start: pendingStash.selStart, end: pendingStash.selEnd }
      : null
  // 换会话后的首个消费帧：草稿按会话从 composerDrafts 恢复（message handler
  // 已把旧会话的文本归档）；pending 结束恢复帧按 pendingStash 还原；其余帧仍从
  // live 编辑器读，流式重建时正在输入的内容不丢。
  const draft =
    draftRestoreFor === state?.sessionId && state.sessionId !== null
      ? composerDrafts.get(state.sessionId)
      : stashRestore
        ? pendingStash?.text ?? ''
        : composerText()
  const inputSel = hadFocus ? composerSel() : null
  // The rebuild wipes scroll state; remember it so a user reading history
  // mid-stream is not thrown back to the top. Also re-evaluate pinning from
  // the LIVE position whenever it moved away from where the last render left
  // it: scroll events dispatch asynchronously, so a streaming render running
  // on the stale stickToBottom would yank the view back to the bottom while
  // the user is scrolling up. The old intent-window guard is gone —内容增长
  // 只在增大 scrollHeight 时不动 scrollTop、收缩时由 min(observedTop,floor)
  // 抵消 clamp，靠 isReaderMoved 位移比对（>0.5px=用户动）区分即可。
  const oldMessages = document.getElementById('messages')
  // 内部滚动容器（IN/OUT、指令卡、JSON 树、todo 清单）要在重建前存档位置：
  // 流式每帧 textContent='' 会销毁它们，不恢复的话展开着的卡内滚动直接回到顶部。
  // 根节点用 chatCol（todo 卡在输入区上方，不在 messages 容器里）。换会话帧
  // 已在 render 头部存过（那时 DOM 还是旧会话内容），这里不能再存一次——此刻
  // 活跃帧已经换成新会话的，会把旧会话的键写进去。
  if (!switchingDisclosure) saveInnerScroll(chatCol)
  const prevScrollTop = oldMessages?.scrollTop ?? null
  if (oldMessages && pinnedScrollTop !== null) {
    const floor = Math.max(0, oldMessages.scrollHeight - oldMessages.clientHeight)
    if (isReaderMoved(oldMessages.scrollTop, pinnedScrollTop, floor)) {
      stickToBottom = isAtBottom(oldMessages.scrollHeight, oldMessages.scrollTop, oldMessages.clientHeight)
    }
  }
  // Per-session 滚动记忆：容器里还是 scrollSession 的内容（换会话的 loading
  // 帧也如此），每帧按实时位置刷新增档，切走时读到的就是离开时的位置。
  // 换会话帧再取新会话的存档定恢复目标：无存档默认贴底；prevScrollTop 是
  // 旧会话的位置，跨会话绝不复用（落地分支见 render 尾）。
  if (oldMessages && scrollSession !== null) {
    scrollPositions.set(
      scrollSession,
      archiveScrollPosition(oldMessages.scrollTop, stickToBottom, scrollAnchorOf(oldMessages)),
    )
  }
  const newSid = state?.sessionId ?? null
  const switchingSession = newSid !== scrollSession
  let restoreScrollTop: number | null = null
  let restoreAnchor: ScrollAnchor | null = null
  if (switchingSession) {
    const saved = newSid !== null ? scrollPositions.get(newSid) : undefined
    const target = restoreScrollTarget(saved)
    stickToBottom = target.stickToBottom
    restoreScrollTop = target.scrollTop
    // 翻历史的存档才要锚（贴底存档直接回底部，锚无意义）。
    restoreAnchor = target.stickToBottom ? null : (saved?.anchor ?? null)
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
  // 注意：pending 面板在 .messages 的 .composer-seat 里（sticky bottom 坐席），
  // 不是 chatCol 直接子级。
  const oldPending = chatCol.querySelector<HTMLElement>('.composer-seat > .pending-panel')
  const pendingFocus = oldPending !== null && oldPending.contains(document.activeElement)
  // 签名带 sessionId：换会话时旧会话的 pending 卡必须移除，不能因内容
  // 恰好相同（rpcId 全局唯一，理论不会，但防御起见）被保活成跨会话残留。
  // 签名含面板本地状态（分页/最小化/反馈行）：翻页、收起、去聊天里说、提交
  // 失败提示等就地状态变化必须打破保活触发重建，否则焦点在面板内时新状态不会
  // 上屏（「请先完成本题」/失败原因被保活帧吞掉）。
  const pendingSig =
    state && state.pending.length > 0
      ? JSON.stringify([
          state.sessionId,
          state.pending,
          state.pending.map((p) => {
            const s = panelState.get(p.rpcId)
            return [p.rpcId, s?.page ?? 0, s?.minimized ?? false, s?.notice ?? '', s?.failure ?? '', s?.failureSeq ?? 0]
          }),
        ])
      : null
  // 本帧 pending 刚解除（上一帧还有挂起交互、这一帧没有了）：计划审核
  // 「去聊天里说」的延迟聚焦据此判定（见 render 尾部 composer 收尾）。
  const pendingCleared = lastPendingSig !== null && (state?.pending.length ?? 0) === 0
  // 签名相同时焦点在内即保活（输入不被打断）；签名变化但 IME 组合中同样
  // 保活，推迟到 compositionend 补帧重建（见 composingEl）。
  const keepPending =
    oldPending !== null &&
    (pendingFocus || composingInside(oldPending)) &&
    pendingSig !== null &&
    (pendingSig === lastPendingSig || composingInside(oldPending)) &&
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
    // modelStatus 进签名：modelLabel 缺失时 pill 在「加载中/选择模型」间切换
    // （目录从 loading 到 error），只靠 modelLabel 会漏帧（两帧 label 都是 null）。
    state?.modelStatus ?? null,
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
    (hadFocus || popoverInComposer || composingInside(oldComposer)) &&
    stashedDraft === undefined &&
    (composerSig === lastComposerSig || composingInside(oldComposer)) &&
    (oldHero !== null && oldHero.contains(oldComposer)) === blankHero &&
    // Pending 接管面板（approval/question/plan-review）存在时不保留 composer：
    // 输入区整个换成面板，原输入框被移除。文本不丢：接管那帧已存入
    // pendingStash，pending 结束恢复普通 composer 时按暂存还原。
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
    (composerSig === lastComposerSig || composingInside(oldComposer)) &&
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
  // schedule（定时计划 chip 数据源）必须进签名：它的到达是运行中帧（非首帧
  // 基线），不进签名的话 keepHeader 会把未含 chip 的旧头部原样保留——chip
  // 永远不出现（实测：真 dsh 0.1.2 schedule 投影推送后头部无变化）。
  const headerSig = JSON.stringify([
    state?.sessionId ?? null,
    // 改名中 sessionTitle 不进签名：标题 span 已被输入框替换，投影变化不
    // 改渲染输出——进签名会让标题更新打断改名输入。renaming 自身进签名。
    renaming ? null : (state?.sessionTitle ?? null),
    state?.parentSession ?? null,
    state?.presetLabel ?? null,
    state?.presetDescription ?? null,
    state?.subagents ?? null,
    state?.backgroundJobs ?? null,
    state?.schedule ?? null,
    renaming,
  ])
  // 改名中 header 同样保活（renaming 是渲染模型的一部分，commit/cancel 置
  // false 后签名变化驱动重建还原标题）；IME 组合中强制保活——签名真变了也
  // 推迟到 compositionend 补帧再重建，输入框销毁会中止组合会话。
  const keepHeader =
    oldHeader !== null &&
    !!state?.sessionId &&
    state.loading !== true &&
    !blankHero &&
    (headerSig === lastHeaderSig || composingInside(oldHeader))
  // 任务清单 todo 卡保活（与 composer/pending 同款 keep）：todos 内容没变时保留
  // 原元素。流式快照每帧重建 chatCol，in_progress 行首的转圈弧环是新建 SVG——
  // CSS 动画随节点替换从 0° 重启，~100ms 一帧的快照下转圈永远走不完，看起来像
  // 疯狂刷新。保活后动画连续；todos 真变了才重建，重启动画本就是期望行为。
  // 注意：todo 卡在 .messages 的 .composer-seat 里（sticky bottom 坐席），
  // 不是 chatCol 直接子级。
  const oldTodoPanel = chatCol.querySelector<HTMLElement>('.composer-seat > .todo-panel')
  const todosSig = state?.todos ? JSON.stringify(state.todos) : null
  const keepTodoPanel =
    oldTodoPanel !== null &&
    state !== null &&
    state.sessionId !== null &&
    state.loading !== true &&
    !switchingSession &&
    !blankHero &&
    todosSig !== null &&
    (todosSig === lastTodosSig || composingInside(oldTodoPanel))
  // Queue dock 保活（与 pending 同款）：编辑态（editingQueueItem 非空）且焦点在
  // 编辑器内时流式快照不重建 queue 容器——文本有 queueEditDrafts、焦点有
  // queueFocus 恢复，但元素销毁会中止 IME 组合。签名含 queuedItems 与编辑目标：
  // 队列数据变化或切换编辑项必须重建（就地更新），输入本身不触发 render 不进
  // 签名。组合中签名变化同样推迟（composing 兜底）。
  const oldQueue = chatCol.querySelector<HTMLElement>('.composer-seat > .queue')
  const queueFocusInside =
    oldQueue !== null && oldQueue.contains(document.activeElement)
  // 本地占位（#52 S1）也算队列内容：占位出现/消失必须驱动 queue 容器重建，
  // 否则 keepQueue 会把不含占位的旧容器原样留下。
  const queuedEchoIds = state ? sessionEchoes(state.sessionId).filter((e) => e.placement === 'queued').map((e) => e.id) : []
  const queueSig =
    state && ((state.queue?.length ?? 0) > 0 || queuedEchoIds.length > 0)
      ? JSON.stringify([state.sessionId, editingQueueItem, state.queue ?? [], queuedEchoIds])
      : null
  const keepQueue =
    oldQueue !== null &&
    (queueFocusInside || composingInside(oldQueue)) &&
    queueSig !== null &&
    (queueSig === lastQueueSig || composingInside(oldQueue)) &&
    state?.loading !== true
  // Goal bar 保活（同 queue）：编辑态（goalEditingId 非空）且焦点在输入框内时
  // 保留 dock；签名含 goal 数据与编辑 id。
  const oldGoalBar = chatCol.querySelector<HTMLElement>('.composer-seat > .goal-bar-dock')
  const goalFocusInside =
    oldGoalBar !== null && oldGoalBar.contains(document.activeElement)
  const goalSig =
    state && state.goal
      ? JSON.stringify([state.sessionId, state.goal, goalEditingId])
      : null
  const keepGoalBar =
    oldGoalBar !== null &&
    (goalFocusInside || composingInside(oldGoalBar)) &&
    goalSig !== null &&
    (goalSig === lastGoalSig || composingInside(oldGoalBar)) &&
    state?.loading !== true
  // loading 帧（换会话的历史基线加载中）不动现有 DOM：整页保留到新状态落地
  // 再一次性切换——否则 hero 布局切换（blank→blank 切 workspace 尤甚）会先被
  // 清成「加载会话…」空占位再重建，观感像整页刷新。keep* 布尔照常计算（无
  // 副作用），落地帧仍按签名决定重建。
  if (state?.loading !== true) {
    rebuildingHeader = true
    try {
      for (const child of Array.from(chatCol.children)) {
        // 断连横幅常驻首子位，重建不摘（它由 chatReconnect 消息独立驱动）。
        if (reconnectBanner !== null && child === reconnectBanner) continue
        if (keepMessages && child === oldMessages) continue
        if (keepHeader && child === oldHeader) continue
        if (keepBlankHero && (child === oldComposer || child === oldHero)) continue
        child.remove()
      }
    } finally {
      rebuildingHeader = false
    }
    // dock 家族（todo/goal/queue）与 pending/composer 已搬进 messages 内的
    // .composer-seat（sticky bottom 坐席，对齐官方 data-composer-seat）——
    // chatCol 顶层清理碰不到它们，同一套保活规则在这里单独清理 seat 子级。
    const oldSeat = oldMessages?.querySelector<HTMLElement>(':scope > .composer-seat') ?? null
    if (oldSeat) {
      for (const child of Array.from(oldSeat.children)) {
        if (keepTodoPanel && child === oldTodoPanel) continue
        if (keepQueue && child === oldQueue) continue
        if (keepGoalBar && child === oldGoalBar) continue
        if (keepPending && child === oldPending) continue
        if (keepComposer && child === oldComposer) continue
        child.remove()
      }
    }
  }
  // Menus anchored to surviving elements (kept composer, sessions header)
  // stay open across snapshot renders — re-anchor in case the layout shifted
  // under them; only close when the rebuild above actually removed the anchor.
  // popoverAnchor === null：坐标定位菜单（会话右键），没有锚点，保持原样。
  // 可重锚类型（commit chip / 用量药丸 / 安装脚本平台）被摘除时不在这里关闭：
  // 本帧重建可能在更后面才挂上替代元素（空态 appendChild 在存活检查之后），
  // 由各重建点末尾的 reanchorPopoverAfterRebuild 收尾（重锚或关闭）。
  if (popover) {
    if (popoverAnchor === null) {
      // 坐标定位：不关闭、不 reposition。
    } else if (popoverAnchor.isConnected) positionPopover()
    else if (!reanchorablePopoverAnchor(popoverAnchor)) closePopover()
  }
  if (!state || !state.sessionId) {
    lastComposerSig = null
    lastHeaderSig = null
    lastPendingSig = null
    lastTodosSig = null
    lastQueueSig = null
    lastGoalSig = null
    turnStatusStart = null
    scrollSession = null
    // 无附着会话：pending 快照没有归属（sessionId 不匹配也不会被消费），
    // 清掉避免滞留到下一个同 key 会话的 composer 上。
    pendingStash = null
    // 断连横幅同源复位：controller 已释放（服务 down），旧横幅不能残留。
    hideReconnectBanner()
    chatCol.appendChild(renderEmpty(state))
    // 空态整块重建（dshNotFound 的安装脚本等锚点在里面）：重建后收尾重锚。
    reanchorPopoverAfterRebuild()
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
  // 打开失败（历史读取/RPC 错误、会话损坏或不存在）：整页换成可读错误
  // 提示——不是空白、不是空会话 hero（后者会误导用户以为是个新会话）。
  // 侧栏再点一次该会话即重试（host 端重建 controller，见 chatView.openSession）。
  if (state.openError) {
    lastComposerSig = null
    lastHeaderSig = null
    lastPendingSig = null
    lastTodosSig = null
    lastQueueSig = null
    lastGoalSig = null
    turnStatusStart = null
    scrollSession = null
    pendingStash = null
    for (const child of Array.from(chatCol.children)) {
      // 断连横幅保留：打开失败 + 重连进行中时横幅照常透出（见 render 主循环）。
      if (reconnectBanner !== null && child === reconnectBanner) continue
      child.remove()
    }
    chatCol.appendChild(renderOpenError(state.openError))
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
      if (slashPopupEl && activeComposer) positionSlashPopup(activeComposer)
    } else {
      chatCol.appendChild(renderHero(state, draft))
      // 本帧消费了恢复草稿，标志清零；loading 帧/pending 帧不走这里，标志保留。
      draftRestoreFor = null
      reanchorPopoverAfterRebuild()
      pendingStash = null
      const composer = activeComposer
      if (composer) {
        if (hadFocus || stashSel !== null) {
          composer.focus()
          // A rebuilt composer at least keeps the caret where it was.
          const sel = stashSel ?? inputSel
          if (sel) composer.setSelection(sel.start, sel.end)
        }
        // 重建后恢复补全弹窗（含 @ 会话补全；无候选时 updateSlashPopup 自行隐藏）
        updateSlashPopup(composer)
      }
    }
    lastComposerSig = composingInside(oldComposer) ? lastComposerSig : composerSig
    lastHeaderSig = composingInside(oldHeader) ? lastHeaderSig : headerSig
    lastPendingSig = composingInside(oldPending) ? lastPendingSig : pendingSig
    lastTodosSig = composingInside(oldTodoPanel) ? lastTodosSig : todosSig
    lastQueueSig = composingInside(oldQueue) ? lastQueueSig : queueSig
    lastGoalSig = composingInside(oldGoalBar) ? lastGoalSig : goalSig
    return
  }
  // dock 家族与 pending/composer 的父容器是 messages 内的 .composer-seat
  // （对齐官方 data-composer-seat），不是 chatCol——seat 随 messages 保活。
  // seat/seatAnchor/seatAdd 在 messages 创建之后声明（见下方装配段）。
  const jobsLabel = state.backgroundJobs ? jobsChipLabel(state.backgroundJobs, t) : null
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
    // 与「N 个子代理」chip 同字号），不与父会话标题同级。改名态渲染输入框
    // 替代标题（渲染模型的一部分，保活逻辑见 keepHeader）。
    if (renaming) {
      const input = document.createElement('input')
      input.className = 'rename-input'
      input.value = renameDraft
      input.setAttribute('aria-label', t('Rename'))
      input.addEventListener('input', () => {
        renameDraft = input.value
        renameSelStart = input.selectionStart ?? renameDraft.length
        renameSelEnd = input.selectionEnd ?? renameDraft.length
      })
      input.addEventListener('keydown', (e) => {
        // isComposing: Enter confirms an IME candidate, not the rename.
        if (e.key === 'Enter' && !e.isComposing) {
          const title = renameDraft.trim()
          if (title && title !== renameOriginal) post({ type: 'renameSession', title })
          endInlineRename()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          endInlineRename()
        }
      })
      input.addEventListener('blur', () => {
        // 重建销毁输入框同步派发的 blur（rebuildingHeader）不是用户离开，忽略；
        // 其余 blur 取消改名。
        if (rebuildingHeader) return
        if (renaming) endInlineRename()
      })
      header.appendChild(input)
    } else {
      const titleSpan = el('span', state.parentSession ? 'chat-title crumb-subagent' : 'chat-title', state.sessionTitle ?? '')
      if (state.sessionTitle) {
        titleSpan.title = state.sessionTitle
        titleSpan.addEventListener('click', () => startInlineRename(header))
      }
      header.appendChild(titleSpan)
    }
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
    // 「N 个提醒」chip（对齐官方 ScheduleCatalogAction：AlarmClock + 计数 +
    // chevron → 只读下拉）：schedule 投影（state.active）非空才显示；0.1.1
    // 服务器无该投影 → state.schedule 缺省 → 不渲染（降级不崩、无计划也不显示）。
    if (state.schedule && state.schedule.length > 0) {
      const chip = buttonEl('header-chip', '')
      chip.appendChild(iconSvg(ALARM_CLOCK_ICON, 14))
      chip.appendChild(el('span', undefined, scheduleCountLabel(state.schedule.length)))
      chip.appendChild(iconSvg(PANEL_ICONS.chevronDown, 14))
      chip.title = t('Active reminders')
      chip.addEventListener('click', () => openScheduleMenu(chip))
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
    const headerAnchor = keepMessages ? oldMessages : null
    if (headerAnchor) chatCol.insertBefore(header, headerAnchor)
    else chatCol.appendChild(header)
  }

  const messages = oldMessages ?? el('div', 'messages')
  if (!oldMessages) {
    messages.id = 'messages'
    // 居中内容列 + 回到底部浮标槽（对齐 dsh web 的 EvIC1a_column/toBottomSlot
    // 结构）：全部流内元素对账进 flow-col（宽度只在这一层约束）；jump-latest
    // 的 sticky 槽位列在列外——小 pill 贴内容列右缘、不占流高、不随列限宽。
    const flowCol = el('div', 'flow-col')
    messages.appendChild(flowCol)
    const jumpSlot = el('div', 'jump-slot')
    const jumpBtn = buttonEl('jump-latest', t('↓ Back to latest'))
    jumpBtn.addEventListener('click', () => {
      stickToBottom = true
      writeMessagesScrollTop(messages, messages.scrollHeight)
      jumpBtn.style.display = 'none'
    })
    jumpSlot.appendChild(jumpBtn)
    messages.appendChild(jumpSlot)
    // composer 坐席（对齐官方 dsh web 的 data-composer-seat）：滚动容器内
    // sticky bottom 的末位项，dock 家族（todo/goal/queue）与 pending 面板/
    // composer 都挂这里。它们增高只把滚动内容往上顶，不再压缩 .messages 的
    // clientHeight——V 类扰动（兄弟高度变化 1:1 传导成消息区尺寸变化）在布局
    // 层消失（回归 composer-input-jitter-pinned-scroll /
    // composer-multiline-input-jitter，官方同构）。
    const seat = el('div', 'composer-seat')
    messages.appendChild(seat)
    // --dsh-composer-height 发布 + seat 尺寸变化的重跟随（对齐官方
    // ConversationRoot.seatResizeRef 的 CSS 变量链路 + follow 语义）：
    // - 发布变量：jump-latest 的 bottom 用 calc() 跟住 seat 高度，无 JS 重排。
    // - 跟随态同帧钉底：seat 增高（composer 换行/dock 开合/pending 接管）只涨
    //   scrollHeight、不动 clientHeight，浏览器不派发 scroll 事件——不写回的话
    //   跟随态视口会被增高的 seat 盖住尾部。seat 收缩则浏览器先 clamp
    //   scrollTop 到新区间并派发 scroll 事件；这里无条件写入最新
    //   scrollHeight（clamp 后同值，仅刷新 pinnedScrollTop 比对基）——写后
    //   位移比对里该 clamp 自回声位移 0、不误判为用户滚动活动。
    //   非跟随态不写：阅读位置像素级不动。
    new ResizeObserver(() => {
      messages.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
      if (scrollActiveRecently()) {
        deferSettlePin()
        return
      }
      if (!stickToBottom) return
      // 幂等守卫（与下方 messages RO 同款）：高度变化后若视口已贴底（seat 收缩被
      // 浏览器 clamp 回底部 / 上一帧已 pin 到最新，实际距底 0）就不必再写——重
      // 复写 scrollTop 会触发回声 scroll 事件并重排 settle debounce，跟「queue dock
      // 高度一边流式一边增又减」叠加会让输出区高频率微抖。非贴底（内容增长顶出）
      // 才写一次吸回。
      if (isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight)) return
      writeMessagesScrollTop(messages, messages.scrollHeight)
      const jump = messages.querySelector<HTMLElement>('.jump-latest')
      if (jump) jump.style.display = 'none'
    }).observe(seat)
    // 用户/程序滚动区分走官方「一条位移比对」（movedByReader）：实时位置 vs 上次程序
    // 写/读位置（pinnedScrollTop），差 >0.5px = 用户动。程序 pin 写后 pinnedScrollTop
    // 已同步到 clamp 落点，自回声位移 0；内容增长只增 scrollHeight 不动 scrollTop 也
    // 不位移——只有真实用户手势才会让实时位置偏离比对基。用户动了就按「是否仍在
    // 25px 贴底带」重判跟随态；没动维持现态，绝不让程序滚动把跟随态置 false。
    // 同时用 movedByReader 区分自回声：只有用户滚动才算滚动活动（锁住回归动画期间不
    // 写）；程序 pin 的自回声/内容 clamp（movedByReader=false）不入锁，否则它们刷新
    // 活动时间戳、锁掉 SETTLE_IDLE_MS 内下次补 pin → 视口脱底一帧增量 → 120ms 后
    // settle 吸回，形成「脱底→吸回」周期脉冲。
    messages.addEventListener('scroll', () => {
      const floor = Math.max(0, messages.scrollHeight - messages.clientHeight)
      const movedByReader = isReaderMoved(messages.scrollTop, pinnedScrollTop ?? messages.scrollTop, floor)
      if (movedByReader) noteScrollActivity()
      stickToBottom = nextStickToBottom(
        stickToBottom,
        movedByReader,
        isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight),
      )
      // 用户自己滚动时重取「加载更早」的阅读锚（官方同款：onScroll 里用新位置
      // 刷新 anchorRef）——否则补页落地后逐帧重锚会跟手势较劲，把用户按回去。
      if (movedByReader && earlierAnchor !== null && !stickToBottom) {
        const captured = captureEarlierAnchor(messages)
        if (captured !== null) earlierAnchor = { ...captured, until: earlierAnchor.until, height: messages.scrollHeight }
      }
      const jump = messages.querySelector<HTMLElement>('.jump-latest')
      if (jump) jump.style.display = stickToBottom ? 'none' : ''
      // 上翻到顶部附近时按需加载更早一页（按钮之外的第二触发路径）。
      if (messages.scrollTop < 80) maybeLoadEarlier()
      // 同步比对基：本次 scroll 后的最新位置，下一次 scroll 与它对比区分用户/程序滚动。
      pinnedScrollTop = messages.scrollTop
    })
    messages.addEventListener('wheel', noteScrollActivity, { passive: true })
    messages.addEventListener('touchmove', noteScrollActivity, { passive: true })
    messages.addEventListener('keydown', (e) => {
      if (isScrollKey(e.key)) noteScrollActivity()
    })
    messages.addEventListener('pointerdown', noteScrollActivity)
    // Async height growth (markdown/attachment images finishing loading,
    // <details> toggling) changes scrollHeight without a scroll event, so the
    // view would silently drift off the tail. Neither event bubbles — listen
    // in the capture phase and re-pin while following.
    const repinIfFollowing = (): void => {
      // 图片 load / details toggle 引发的异步高度增长：走「滚动空闲」判定。回归动画期间
      // 不得直接写（加载事件本身不代表滚动已停），交给 maybeSettlePin——仅在滚动真正
      // 停、仍跟随、已脱底时才补 pin（幂等：已贴底/非跟随/滚动活动中都不写）。
      maybeSettlePin()
    }
    // 补页的异步撑高（页内图片/懒加载缩略图 load、details 展开）不经过 render：
    // 「加载更早」的锚还活着时这里就地按锚行校正一次，用户读的那行不回跳
    // （#50 R2 的后半段）。
    const reanchorIfAnchored = (): void => {
      if (earlierAnchor === null) return
      reanchorEarlier(messages)
      releaseEarlierAnchorWhenSettled()
    }
    messages.addEventListener(
      'load',
      (e) => {
        if (!(e.target instanceof HTMLImageElement)) return
        repinIfFollowing()
        reanchorIfAnchored()
      },
      true,
    )
    messages.addEventListener(
      'toggle',
      (e) => {
        if (!(e.target instanceof HTMLDetailsElement)) return
        repinIfFollowing()
        reanchorIfAnchored()
      },
      true,
    )
    // 视口尺寸变化补偿（窗口/面板 resize 改变 .messages clientHeight）：这类
    // 变化既不派发 scroll 事件也不伴随 render，旧机制只能在下一推帧拽回，形成
    // 「顶出-拽回」跳动。ResizeObserver 回调在 layout 后 paint 前派发，跟随态
    // 同帧钉底：顶出帧根本不被绘制。手势/滚动活动中不写，转 settle debounce
    // 兜底；非跟随不写（纯视口尺寸变化下阅读位置像素级不动本就正确）。
    // 注：composer/dock 家族已搬进滚动容器内的 .composer-seat（composer-sticky-
    // in-scroller-layout），它们的增高只顶内容、不再压缩 clientHeight，不会再
    // 触发本补偿——这里只剩窗口/面板 resize 场景。
    // 写经 writeMessagesScrollTop 同步 pinnedScrollTop 比对基，自回声位移 0 不误判。
    new ResizeObserver(() => {
      if (scrollActiveRecently()) {
        deferSettlePin()
        return
      }
      if (!stickToBottom) return
      if (isAtBottom(messages.scrollHeight, messages.scrollTop, messages.clientHeight)) return
      writeMessagesScrollTop(messages, messages.scrollHeight)
      const jump = messages.querySelector<HTMLElement>('.jump-latest')
      if (jump) jump.style.display = 'none'
    }).observe(messages)
  }
  // 插话（steering）和排队分开展示，对齐官方 dsh web：等待插话的消息直接
  // 进对话流末尾（用户气泡 + 「等待插话」标记），排队消息留在输入框上方。
  // 混在一个队列区里时，先插话再排队的快照顺序会让两条消息看起来颠倒。
  const steeringItems = (state.queue ?? []).filter((item) => item.placement === 'steering')
  // queue dock 按合成 QueuedItem.seq 升序（无 seq 排尾）：宿主快照不保证发送序，
  // 多条排队折叠列表按序渲染（对齐 steering 插排的排序语义）。
  const queuedItems = orderBySeq((state.queue ?? []).filter((item) => item.placement === 'queued'))
  // 消息流增量更新（不再 textContent='' 全量重建）：按消息 id / workflow runId
  // 对账，未变行整体保活。turn-status 行的 clock interval 归行所有：行保活时
  // 不动 timer，turn 结束行被移除时由 dispose 统一清理；turnStatusStart 由
  // 下方 !running 分支复位（同旧「turn 结束」分支）。
  if (!state.running) {
    turnStatusStart = null
  }
  const flow = buildFlowItems(state)
  syncTurnRail(messages, flow.rail)
  reconcileFlow(flowColOf(messages), flow.colItems)
  // 流式行重建把行内弹层锚点（commit chip / 用量药丸）摘掉了：立即按同身份
  // 替代元素重锚，卡片随行增长移动而不是闪关闪开。
  reanchorPopoverAfterRebuild()
  // 正文 commit hash 的「先查后亮」：把本次 render 新建行里发现的 hash 批量上报宿主查询。
  flushCommitInfoRequests()
  // "Back to latest" floater（jump-latest 是流的末位项，由对账保活/重建）。
  const jump = messages.querySelector<HTMLElement>('.jump-latest')
  if (jump) jump.style.display = stickToBottom ? 'none' : ''
  if (!keepMessages) chatCol.appendChild(messages)

  // seat 装配（声明于 messages 创建之后）：dock 家族（todo/goal/queue）与
  // pending/composer 的父容器是 messages 内的 .composer-seat（对齐官方
  // data-composer-seat）。anchor 语义同原 chatCol 版 add()：保活的
  // pending/composer 在 seat 末位，dock 重建要插到它前面。
  const seat = seatOf(messages)
  const seatAnchor = keepPending ? oldPending : keepComposer ? oldComposer : null
  const seatAdd = (node: HTMLElement): void => {
    if (seatAnchor) seat.insertBefore(node, seatAnchor)
    else seat.appendChild(node)
  }

  // 任务清单卡（对齐官方 input.dock id=todo order 0，排在排队消息之前）：
  // 缺省/null（首写前 / turn/start 后）与 [] 空数组都不渲染。
  if (state.todos && state.todos.length > 0) {
    if (keepTodoPanel && oldTodoPanel !== null) seatAdd(oldTodoPanel)
    else seatAdd(renderTodoPanel(state.todos))
  }

  // 目标条幅（对齐官方 input.dock id=goal order 10：todo 之后、queue 之前）：
  // 缺省/null（无投影 / create 前 / clear 后）与 complete 目标都不渲染。
  // keepGoalBar 时 dock 原位保留（编辑输入不被流式快照打断）。
  if (state.goal) {
    if (!(keepGoalBar && oldGoalBar !== null)) {
      const goalBar = renderGoalBar(state.goal)
      if (goalBar) seatAdd(goalBar)
    }
  }

  // 已回流（?）未回流的本地占位排在真排队项之后——发送顺序恒在已排队者之后。
  const queuedEchoes = sessionEchoes(state.sessionId).filter((echo) => echo.placement === 'queued')
  if (queuedItems.length > 0 || queuedEchoes.length > 0) {
    if (editingQueueItem && !queuedItems.some((item) => item.id === editingQueueItem)) editingQueueItem = null
    // keepQueue 时 queue 容器原位保留（编辑器输入不被流式快照打断）。
    if (keepQueue && oldQueue !== null) {
      // nothing to rebuild; the live editor stays attached
    } else {
      const queue = el('div', 'queue')
      // 多条排队折叠成计数 header（对齐 dsh web QueueDock：>1 条才出现折叠 header）：
      // 编辑/插话/删除等操作入口随列表一起藏进展开态；单条保持一行内联。
      if (queuedItems.length + queuedEchoes.length === 1) {
        queue.appendChild(queuedItems.length === 1 ? renderQueueItem(queuedItems[0]) : renderEchoQueueItem(queuedEchoes[0]))
      } else {
        const det = detailsEl('queue', 'queue-dock', '')
        // 编辑态（编辑器在列表里）必须展开，否则保存/取消入口被折叠藏掉。
        if (editingQueueItem !== null) det.open = true
        const summary = det.querySelector('summary') as HTMLElement
        const chev = iconSvg(PANEL_ICONS.chevronUp, 14)
        chev.classList.add('queue-chevron')
        summary.appendChild(chev)
        summary.appendChild(
          el('span', 'queue-dock-count', t('{0} queued messages', queuedItems.length + queuedEchoes.length)),
        )
        const list = el('div', 'queue-dock-list')
        for (const item of queuedItems) list.appendChild(renderQueueItem(item))
        for (const echo of queuedEchoes) list.appendChild(renderEchoQueueItem(echo))
        det.appendChild(list)
        queue.appendChild(det)
      }
      seatAdd(queue)
    }
  } else {
    editingQueueItem = null
  }

  // Live-jobs 内联横条已移除（对齐官方 dsh web：只留头部「N 个后台任务」chip）：
  // 任务信息由 state.backgroundJobs → 头部 chip / openJobsMenu 菜单承担。
  // state.jobs 仍被上方 blankHero 空态判断消费，链路保留。

  if (state.pending.length > 0) {
    // Pending 接管 composer 区：消息流尾部不再渲染 pending 卡（对齐 dsh web
    // 的 QuestionFlow / PlanReviewPanel 挂 conversation.composer 的形态）。
    if (!keepPending) seat.appendChild(renderPendingPanel(state.pending))
  } else if (keepComposer && oldComposer) {
    // The composer element was never detached, so focus, caret, and any
    // in-flight IME composition survive; only patch the stats line in place.
    patchStatsRow(oldComposer, state.statsLine, state.contextUsage)
    // 权限 pill 懒切换选中帧的就地 patch（permissions 不在 composerSig 里）。
    patchPermissionPill(oldComposer, state.permissions)
  } else {
    seat.appendChild(renderInput(draft))
    // 本帧消费了恢复草稿，标志清零（pending 接管帧走不到这里，标志保留到
    // pending 结束恢复普通 composer 时）。
    draftRestoreFor = null
    pendingStash = null
  }
  // composing 兜底保活的区域不推进签名：保持旧签名，组合结束后补帧时差异
  // 仍在，按签名差异重建落地（否则保活帧吞掉「推迟的签名变化」）。
  lastComposerSig = composingInside(oldComposer) ? lastComposerSig : composerSig
  lastHeaderSig = composingInside(oldHeader) ? lastHeaderSig : headerSig
  lastPendingSig = composingInside(oldPending) ? lastPendingSig : pendingSig
  lastTodosSig = composingInside(oldTodoPanel) ? lastTodosSig : todosSig
  lastQueueSig = composingInside(oldQueue) ? lastQueueSig : queueSig
  lastGoalSig = composingInside(oldGoalBar) ? lastGoalSig : goalSig
  // 「加载更早」的锚定（对齐官方 anchorRef）：宿主接单（loadingEarlier=true）
  // 即清掉重入位；其后每一帧都按锚行重锚——补页分多帧到达、页内图片/缩略图
  // 稍后撑高都能跟上，而不是只在落地那一帧补一次。锚在内容稳定（settle 窗口
  // 到期）或用户回到最新（贴底）时解除。
  if (state.loadingEarlier === true) earlierRequestAt = 0
  if (earlierRequestAt !== 0 && performance.now() - earlierRequestAt > EARLIER_REQUEST_GUARD_MS) earlierRequestAt = 0
  // 恢复/补偿路径（换会话恢复历史位置、加载更早、非贴底跳转）同步写：它们是
  // 用户明确动作，不涉及「抢原生惯性动画」，也无需等布局 settle。
  if (restoreScrollTop !== null) {
    // 存档带视口锚就按锚换算（内容在切走期间增长/收缩时回到同一条消息的同一
    // 位置）；锚行已不在新内容里才回退原始 scrollTop（#52 W2）。
    writeMessagesScrollTop(messages, anchoredRestoreTop(messages, restoreAnchor) ?? restoreScrollTop)
  } else if (!switchingSession && reanchorEarlier(messages)) {
    // 补页按锚行重锚生效（#50 R2）：本帧 scrollTop 已按锚行校正（可能是补页落地
    // 后的第一帧，也可能是之后图片撑高的任意一帧），不再用上一帧的位置覆盖它。
  } else if (!switchingSession && prevScrollTop !== null) {
    writeMessagesScrollTop(messages, prevScrollTop)
  }
  // 内部滚动容器（展开的 IN/OUT、指令卡、JSON 树、todo 清单）在新 DOM 上恢复位置。
  // 换会话帧同样恢复：位置存档随展开态帧按会话隔离（已切到新会话的帧），键都是
  // 新会话自己的渲染键，恢复的正是切走前那个会话的卡内位置（#52 W2/W3）。
  restoreInnerScroll(chatCol)
  releaseEarlierAnchorWhenSettled()
  // Read back the clamped value: this is the position the next render compares
  // against to tell user scrolls apart from content growth. 若恢复的 scrollTop
  // 被浏览器 clamp 到新的底部（切走期间内容收缩/变短到不足一屏），实际
  // 视口已贴底但跟随态可能仍残留 false——按 clamp 结果单向同步一次，修
  // 「切回后贴底仍显示回到最新」。贴底跟随路径的真实 scrollTop 由下方
  // microtask 写回后覆盖，这里先给个占位值避免依赖上一次渲染的脏值。
  const clampedScrollTop = messages.scrollTop
  pinnedScrollTop = clampedScrollTop
  if (isAtBottom(messages.scrollHeight, clampedScrollTop, messages.clientHeight)) stickToBottom = true
  if (jump) jump.style.display = stickToBottom ? 'none' : ''
  // 贴底跟随滚底：同步段不写 scrollTop。栈内（消息流对账后）读
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
      if (!shouldSettlePinNow(stickToBottom, isAtBottom(m.scrollHeight, m.scrollTop, m.clientHeight), scrollActiveRecently())) return
      // writeMessagesScrollTop 同步 pinnedScrollTop 比对基：下一帧 render 头部 / scroll
      // 监听拿它跟实时位置对比以区分用户滚动，pin 得靠它避免自己被误判为用户滚离。
      writeMessagesScrollTop(m, m.scrollHeight)
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
  // 改名态跨重建恢复：进入编辑态那帧聚焦全选；签名变化重建（标题投影/子代理
  // 变化等）后按记录的选区恢复焦点。保活帧（activeElement 已在输入框上）跳过。
  if (renaming) {
    const renameInput = document.querySelector<HTMLInputElement>('.chat-header .rename-input')
    if (renameInput && document.activeElement !== renameInput) {
      renameInput.focus()
      renameInput.setSelectionRange(renameSelStart, renameSelEnd)
    }
  }
  if (!keepComposer) {
    const composer = activeComposer
    // Pending 接管帧不渲染 composer（renderPendingPanel 替换输入区），composer
    // 不存在——跳过全部收尾。
    if (composer) {
      if (hadFocus || stashSel !== null) {
        composer.focus()
        // A rebuilt composer at least keeps the caret where it was; pending
        // 恢复帧回到接管时的光标位置。
        const sel = stashSel ?? inputSel
        if (sel) composer.setSelection(sel.start, sel.end)
      }
      // 同上：重建后恢复补全弹窗（含 @ 会话补全）
      updateSlashPopup(composer)
    }
  } else if (slashPopupEl && activeComposer) {
    positionSlashPopup(activeComposer)
  }
  // 词库（@ 候选/绑定名）变了就把已输入的 @token 全量重扫一遍：Lexical 的
  // 着色变换只跑 dirty 节点，附件/候选到位本身不弄脏文本（B-08）。
  syncAtLexiconRescan()
  // 计划审核「去聊天里说」：pending 解除、普通 composer 回到输入区的那一帧把
  // 焦点交给它（用户接着用自然语言说；#50 I4）。取消失败（面板还在）时不消费，
  // 由 pendingFailed 清掉标志。
  if (focusComposerAfterPending && pendingCleared && activeComposer) {
    focusComposerAfterPending = false
    activeComposer.focus(true)
  }
  // 脏位跟随渲染结果上报：切换会话恢复草稿、发送清空、附件增删都经这里。
  reportComposerDirty()
  // 草稿落盘同款（#14）：发送清空/附件增删/restoreDraft 回填等经 render 的变化在此收口。
  scheduleDraftSave()
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

/**
 * 打开失败整页提示（不做空态 hero、不做 loading）：标题 + 可操作建议 +
 * 后端原因（原样透传 RPC 错误码/简述，用户可据此判断是日志损坏还是会话
 * 不存在）。重试入口 = 侧栏再点一次该会话（提示行里写明）。
 */
function renderOpenError(reason: string): HTMLElement {
  const wrap = el('div', 'empty open-error')
  wrap.appendChild(el('div', 'empty-title', t('Failed to open session')))
  wrap.appendChild(
    el(
      'div',
      'empty-hint',
      t('This session could not be opened. The session log may be corrupt, or the session may have been deleted. Click the session in the list to try again.'),
    ),
  )
  wrap.appendChild(el('div', 'open-error-reason', reason))
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
  attachCollapseFooter(det)
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
/**
 * 双击清空确认态（本地增强，官方 dsh web 无此功能）：空闲 + composer 有内容时
 * 第一次 Ctrl+C/ESC 武装并亮提示小框，第二次执行清空（与 × 按钮同一函数）。
 * 模块级：render() 重建 composer 后武装态不丢（新 input 的 keydown 读同一份）。
 */
let clearConfirmArmed = false
let clearConfirmTimer: ReturnType<typeof setTimeout> | null = null
/** 确认提示小框：挂 document.body（仿 composer popover），render() 重建不销毁。 */
let clearConfirmHint: HTMLElement | null = null
/**
 * 清空暂存（× 按钮 / 双击 Ctrl+C / 双击 ESC 三入口共享）：空 composer 里
 * Ctrl+Z/Cmd+Z 反悔恢复。一次性：恢复后作废；任何新输入/附件变动也作废
 * （新内容入场后旧暂存再还回来只会迷惑）。mentionBindings 不在其中——清空
 * 不动绑定，verbatim 灌回文本即可让 @ 引用 token 正确渲染/展开。
 */
let clearedStash: { text: string; images: OutgoingImage[]; files: StagedFile[] } | null = null
/**
 * 正在执行清空动作（clearComposer 里的程序化 setText('')）。onTextChange 的
 * 「有输入就作废清空暂存」必须跳过这一次——否则刚存下的暂存被清空自身抹掉，
 * Ctrl+Z 永远恢复不了（B-06）。
 */
let clearingComposer = false

/** 从 data URL 拆出 {mediaType, data}（composer 图片 staging 用；无逗号整体当 data）。 */
function outgoingImageFromDataUrl(dataUrl: string): Pick<OutgoingImage, 'mediaType' | 'data'> {
  const comma = dataUrl.indexOf(',')
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const mediaType = header.startsWith('data:') ? header.slice(5).split(';')[0] : ''
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return { mediaType, data }
}

/**
 * 发送失败/被 stop 抽干而回填的稿子（对齐官方 detachedDraft）：提交那一刻的
 * 文本 + 附件被摘下来排在这里，输入框空下来时按提交顺序拼回；用户已经在输入框
 * 里打了新内容就不当场覆盖（B-21）。多条之间用空行分隔，与官方 restoreFailedDrafts
 * 同款。
 */
const detachedDrafts: Array<{ text: string; images: OutgoingImage[]; files: StagedFile[] }> = []

/** 输入框空着（无文本、无待发附件）时把排队的回填稿落地；否则等下一次变空。 */
function flushFailedDrafts(): void {
  if (detachedDrafts.length === 0) return
  const hasComposer = activeComposer !== null
  const busy = hasComposer
    ? activeComposer!.getText().trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0
    : (stashedDraft ?? '').trim().length > 0
  if (busy) return
  const records = detachedDrafts.splice(0, detachedDrafts.length)
  const text = records.map((r) => r.text).filter((t) => t.length > 0).join('\n\n')
  if (hasComposer) {
    activeComposer!.setText(text, mentionBindings)
    activeComposer!.focus(true)
  } else {
    stashedDraft = text
  }
  let staged = false
  for (const record of records) {
    if (record.images.length > 0) {
      pendingImages = [...pendingImages, ...record.images]
      staged = true
    }
    const existing = new Set(pendingFiles.map((f) => f.path))
    for (const f of record.files) {
      if (existing.has(f.path)) continue
      pendingFiles.push(f)
      existing.add(f.path)
      staged = true
    }
  }
  if (staged) clearedStash = null
  if (staged && hasComposer) render()
}

/**
 * 把 recalled / restoreDraft 文本里的内部形态（canonical `@长路径`、`@[标签](uri)`）
 * 统一还原为 composer 显示形态：短 token + 登记绑定，与第一次输入一致。会话标签先
 * 还原（避免其 label 里含分隔符时被文件还原按路径处理），再还原路径引用。
 */
function restoreRecallMentions(text: string): string {
  return restoreFileMentionTokens(restoreSessionMentionTokens(text, mentionBindings), mentionBindings)
}

/**
 * 把历史消息的图片重装进 composer（pendingImages）：已缓存就直接 staging，未缓存
 * 发 requestAttachment 等回执（回执处理里按 attachmentId 命中 staging）。单张
 * 缺失/失败静默跳过，不阻塞其余恢复。
 */
function stageRecallImages(images: readonly ChatImage[] | undefined): void {
  if (!images || images.length === 0) return
  for (const image of images) {
    if (!image.attachmentId) continue
    recallStagingImages.set(image.attachmentId, image.name ?? t('Image'))
    const dataUrl = attachmentCache.get(image.attachmentId)
    if (dataUrl) {
      pendingImages.push({ ...outgoingImageFromDataUrl(dataUrl), name: image.name })
      recallStagingImages.delete(image.attachmentId)
    } else if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
  }
}

/** 双击清空的武装超时时长。 */
const CLEAR_CONFIRM_TIMEOUT_MS = 3000

/** 解除双击清空武装并摘除提示小框（超时/输入/失焦/发送/清空/恢复/切会话统一走这里）。 */
function disarmClearConfirm(): void {
  clearConfirmArmed = false
  if (clearConfirmTimer !== null) {
    clearTimeout(clearConfirmTimer)
    clearConfirmTimer = null
  }
  clearConfirmHint?.remove()
  clearConfirmHint = null
}

/** 武装双击清空：在输入框上方亮「再按一次」提示小框（fixed 定位，只亮一次不跟随），超时自动解除。 */
function armClearConfirm(anchor: HTMLElement): void {
  disarmClearConfirm()
  clearConfirmArmed = true
  const hint = el('div', 'clear-confirm-hint', t('Press Esc or Ctrl+C again to clear the input'))
  // 撤销键的文案与平台同源（清空那一键两平台都是 Ctrl+C，见 isComposerClearChord；
  // 撤销走 Lexical history，mac 惯例 ⌘Z、Windows/Linux Ctrl+Z）。提示里原本完全
  // 没提撤销键，验收场景却又按 Ctrl+Z 验收——文案补上，键值由纯函数出。
  hint.title = t('{0} restores the cleared input', undoChordLabel(state?.hostOs))
  document.body.appendChild(hint)
  clearConfirmHint = hint
  const rect = anchor.getBoundingClientRect()
  hint.style.left = `${Math.max(8, rect.left)}px`
  hint.style.bottom = `${window.innerHeight - rect.top + 6}px`
  clearConfirmTimer = setTimeout(disarmClearConfirm, CLEAR_CONFIRM_TIMEOUT_MS)
}
/** Unsaved queue-editor text by item id; survives the rebuild-per-snapshot rendering. */
const queueEditDrafts = new Map<string, string>()
/** Composer draft arriving while no input element exists yet (restoreDraft before first render). */
let stashedDraft: string | undefined
/**
 * Pending 接管（approval/question/plan-review 把 composer 整体替换成面板）那帧的
 * composer 快照：文本 + recall 态 + 焦点/光标。render() 取草稿只在当前帧从 DOM 读
 * （oldInput?.value），接管后 oldInput 恒为 null——没有这份暂存，pending 结束
 * 恢复 composer 时草稿按 undefined 还原（输入到一半弹卡，应答后内容全丢）。
 * 恢复帧渲染输入框时消费；会话切换时归档进 composerDrafts 后清空。recall 态
 * 恢复走模块级 recall/recallDraft 的实时值（排队项被领取的清理逻辑会合法地
 * 把 recall 清成 null），快照里留一份仅供追溯。
 */
let pendingStash:
  | {
      sessionId: string | null
      text: string
      recall: { kind: 'queue'; itemId: string } | { kind: 'history' } | null
      recallDraft: string
      focus: boolean
      selStart: number
      selEnd: number
    }
  | null = null
/**
 * 计划审核「去聊天里说」请求：取消挂起的审核后，普通 composer 回到输入区时
 * 自动聚焦它（用户接着用自然语言说）。只在 pending 解除的那一帧消费。
 */
let focusComposerAfterPending = false
/** Slash-command receipt texts shown at the message tail; cleared on session switch. */
let commandNotices: string[] = []
/**
 * 未匹配斜杠命令的生命周期回执节点（宿主 commandResult，本面板合成 commandId）。
 * 与 commandNotices（纯文本、数组下标 key）不同，这里按官方把命令回执做成
 * 「按锚插排 + commandId 作 key + 标题/状态/正文」的生命周期节点，成败都回执。
 * matched 命令走 protocol 的 command/run + command/done（conversation.ts 折叠成
 * kind:'command'）；本列表只承载宿主不认识的命令（无 command/run 事件、无 seq），
 * 渲染在流尾，用合成 commandId 作稳定 key。
 */
let commandReceipts: Array<{ id: string; name: string; status: 'running' | 'success' | 'error'; text: string }> = []
let commandReceiptSeq = 0
/** 消息区 ref chip 的 hover 高亮缓存（跨渲染帧）：消息行重建后按它恢复高亮
 *  （否则鼠标不动就永久丢失）；msgKey 定位行（renderMessage 的 key = 消息 id），
 *  path 为 ref chip 的 data-ref-path。mouseleave / 命中无对应行时清空。 */
let refHoverCache: { msgKey: string; path: string } | null = null

/**
 * 本地乐观占位（#52 S1）：发送/排队/插话都要等宿主往返（几百 ms ~ 秒级）才会
 * 以排队项或用户消息的形式回流，此前界面毫无反应。这里在 post({type:'send'})
 * 的同一帧先插一条本地占位（形态与回流后的真身一致），宿主快照一到就撤掉——
 * 观感就是「回车立即出现、随后原位替换」。
 *
 * placement 按宿主落点定：运行中回车 = 排队（输入区上方的 queue dock）、
 * ⌘Enter = 插话（对话流尾部）、空闲发送 = 直接进对话流。
 */
interface PendingEcho {
  id: string
  /** 发送时所在会话；会话切走即作废（宿主回流按会话路由，占位不该跟过去）。 */
  sessionId: string | null
  /** 发送时展开 mention 后的完整文本（含 <attachment> 行），与宿主回流的同一份。 */
  text: string
  /** 刚发出去的图片（composer 原件，字节还在内存里；还没有 attachmentId）。 */
  images?: OutgoingImage[]
  files?: StagedFile[]
  placement: 'queued' | 'steering' | 'turn'
  /** 入队时刻（兜底超时用）。 */
  at: number
}

let pendingEchoes: PendingEcho[] = []
let pendingEchoSeq = 0

/**
 * 占位兜底存活上限：宿主既回流也不回 restoreDraft（RPC 挂住/面板已拆）时，
 * 不让「正在发送」的转圈永久滞留。正常往返远快于此。
 */
const PENDING_ECHO_TTL_MS = 30_000

/**
 * 占位与回流文本的比对基：剥掉 <attachment> 文件行后去首尾空白。队列项的
 * editText 是全文（带附件行）、预览 text 已剥附件行，durable 用户消息是发送时
 * 的全文——统一到这个基才能两边对上。
 */
function echoBasis(text: string | undefined): string {
  return typeof text === 'string' ? splitAttachmentLines(text).text.trim() : ''
}

/** 当前会话的占位（其他会话的占位不参与渲染）。 */
function sessionEchoes(sessionId: string | null): PendingEcho[] {
  return pendingEchoes.filter((echo) => echo.sessionId === sessionId)
}

/** 记一条本地占位（发送时调用，早于宿主回流）。 */
function addPendingEcho(echo: Omit<PendingEcho, 'id' | 'at'>): void {
  pendingEchoSeq += 1
  pendingEchoes = [...pendingEchoes, { ...echo, id: `echo-${pendingEchoSeq}`, at: Date.now() }]
}

/** 撤掉一条文本基命中的占位（发送失败回填草稿时调用）；返回是否真撤掉了。 */
function dropPendingEcho(basis: string): boolean {
  if (!basis) return false
  let dropped = false
  pendingEchoes = pendingEchoes.filter((echo) => {
    if (dropped || echoBasis(echo.text) !== basis) return true
    dropped = true
    return false
  })
  return dropped
}

/**
 * 宿主快照到达后撤占位：排队项（全文或预览）或 durable 用户消息的文本基与占位
 * 相同即命中，一条命中只撤一条占位（连发相同文本时按顺序一一对应）。会话切走
 * 的占位直接作废；超过 TTL 的占位兜底撤掉。
 */
function reconcilePendingEchoes(next: ChatState): void {
  if (pendingEchoes.length === 0) return
  const now = Date.now()
  const hostBasis = new Map<string, number>()
  const bump = (text: string | undefined): void => {
    const key = echoBasis(text)
    if (!key) return
    hostBasis.set(key, (hostBasis.get(key) ?? 0) + 1)
  }
  for (const m of next.messages) {
    if (m.kind === 'user' && !m.context) bump(m.text)
  }
  for (const item of next.queue ?? []) bump(item.editText || item.text)
  const kept: PendingEcho[] = []
  for (const echo of pendingEchoes) {
    if (echo.sessionId !== next.sessionId) continue
    const key = echoBasis(echo.text)
    const left = key ? (hostBasis.get(key) ?? 0) : 0
    if (left > 0) {
      hostBasis.set(key, left - 1)
      continue
    }
    if (now - echo.at > PENDING_ECHO_TTL_MS) continue
    kept.push(echo)
  }
  pendingEchoes = kept
}

/** 占位气泡里的图片缩略图：与待发送缩略图同款，但没有移除入口（已经发出去了）。 */
function echoImageThumb(img: OutgoingImage): HTMLElement {
  const name = img.name ?? t('Image')
  const dataUrl = isImageMediaType(img.mediaType) ? attachmentDataUrl(img.mediaType, img.data) : null
  if (dataUrl === null) return el('span', 'image-chip', name)
  const item = el('span', 'attach-thumb')
  item.title = t('{0} (click to preview)', name)
  const image = document.createElement('img')
  image.src = dataUrl
  image.alt = name
  item.addEventListener('click', () => openLightbox(dataUrl))
  item.appendChild(image)
  return item
}

/**
 * 占位气泡（与等待插话的 pending 气泡同款：用户气泡 + 处理中圆圈）。本地占位
 * 还没有宿主 itemId，交互入口（转向/编辑/删除）一概不给；附件用内存里的原件
 * 渲染（图片缩略图 / 文件名 chip）。
 */
function renderEchoBubble(echo: PendingEcho): HTMLElement {
  const row = el('div', 'msg user steering-pending')
  const attachments = el('div', 'msg-images')
  for (const image of echo.images ?? []) attachments.appendChild(echoImageThumb(image))
  for (const file of echo.files ?? []) attachments.appendChild(fileChip(file))
  if (attachments.childElementCount > 0) row.appendChild(attachments)
  const { text: readable, references } = parseSessionMentions(echoBasis(echo.text))
  const parts = readable.length > 0 ? renderUserBubbleParts(readable, references) : null
  const line = el('div', 'steering-line')
  const spin = el('span', 'spinner')
  spin.style.animationDelay = `${-(performance.now() % 900)}ms`
  line.appendChild(spin)
  if (parts) line.appendChild(parts.bubble)
  else if (attachments.childElementCount === 0) line.appendChild(el('div', 'bubble', t('(empty message)')))
  row.appendChild(line)
  if (parts?.summary) row.appendChild(parts.summary)
  return row
}

/** 占位的排队行（样式与真排队行一致，只是无操作按钮、右侧转圈）。 */
function renderEchoQueueItem(echo: PendingEcho): HTMLElement {
  const row = el('div', 'queue-item')
  row.appendChild(el('span', 'queue-tag', t('Queued')))
  const preview = el('span', 'queue-text')
  const { text: readable, references } = parseSessionMentions(echoBasis(echo.text))
  if (readable.length > 0) preview.appendChild(renderUserBubbleParts(readable, references).bubble)
  else preview.textContent = t('(empty message)')
  row.appendChild(preview)
  const spin = el('span', 'spinner')
  spin.style.animationDelay = `${-(performance.now() % 900)}ms`
  row.appendChild(spin)
  return row
}

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

  // 预览与插话/正式气泡同款拆分：canonical mention（@[标题](dsh-session:…)）
  // 展开成可读 @label + references，渲染成会话 chip（短标题、title 完整引用）；
  // @path/@folder 折叠成 basename chip——长 URI/路径不再把两行 clamp 占满、正文被
  // `...` 吞没。计数前缀（[image ×N] 等）与无引用文本保持纯文本。
  const preview = el('span', 'queue-text')
  if (item.text) {
    const { text: readable, references } = parseSessionMentions(item.text)
    preview.appendChild(renderUserBubbleParts(readable, references).bubble)
  } else {
    preview.textContent = t('(empty message)')
  }
  row.appendChild(preview)
  const actions = el('div', 'queue-actions')
  const steer = buttonEl('link', t('Steer'))
  steer.title = t('Interrupt the current turn and steer with this message')
  steer.addEventListener('click', () => {
    // 用户主动把排队消息作为插话现在发（对齐「只有发送才滚底」）：滚到底并复位跟随态。
    post({ type: 'queueSteer', itemId: item.id })
    pinToLatest()
  })
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
 * 该行被重建（等待插话内容变化 / 流式期间存在替换）时，新建节点的 spinner 的 CSS
 * 动画会从 0° 重新启动——转圈每帧被打回起点，看起来就是疯狂刷新。给新建元素补
 * 一个负 animation-delay（= 当前时刻在 0.9s 周期里的相位），新节点从旧节点的
 * 相位继续转，观感连续（与 todo/命令卡 spinner 的 syncAnimPhase 同机制）。
 */
function renderSteeringItem(item: QueuedItem): HTMLElement {
  const row = el('div', 'msg user steering-pending')
  const { text: readable, references } = parseSessionMentions(splitAttachmentLines(item.editText).text)
  const parts = readable.length > 0 ? renderUserBubbleParts(readable, references) : null
  // 附件与正式用户消息同款：图片缩略图（字节懒取）+ 文件名称 chip；
  // @ 文件引用同样提升到附件区（fileRefs）。
  const attachments = renderUserAttachments(item.images, mergedAttachments(parts?.files ?? [], item.files))
  if (attachments) row.appendChild(attachments)
  // 气泡行：spinner + 气泡一条横向 flex（.steering-line 撑满行宽）。气泡
  // max-width:85% 因此按整行解析——与插话落地后的正式用户消息一致，不会
  // 被 shrink-to-fit 的包含块压窄提前换行；spinner 只对气泡垂直居中。
  const line = el('div', 'steering-line')
  const spin = el('span', 'spinner')
  spin.style.animationDelay = `${-(performance.now() % 900)}ms`
  line.appendChild(spin)
  // 文本与正式用户消息同款：剥离 <attachment> 文件行，canonical mention
  // （@[标题](dsh-session:…)）展开成可读 @label + references——与 host 解析
  // 后落盘的形态一致，气泡据此拼可点击的会话 chip 与引用摘要行。
  if (parts) {
    line.appendChild(parts.bubble)
  } else if (!attachments) {
    line.appendChild(el('div', 'bubble', t('(empty message)')))
  }
  row.appendChild(line)
  if (parts?.summary) row.appendChild(parts.summary)
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
  // 图片文件：先画图标 chip 并懒请求缩略图（回执后整卡换成缩略图；宿主失败
  // 回执后标记失败态不再重发——保持图标 chip）。
  if (file.image && !fileThumbCache.has(file.path)) {
    requestFileThumbIfNeeded(file.path)
  }
  if (file.image) {
    const dataUrl = fileThumbCache.get(file.path)
    if (dataUrl) return fileThumbItem(file, dataUrl)
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
  return chip
}

/** 图片文件的缩略图 chip（历史消息）：点击放大（复用 attach-thumb 样式，底部名称横幅）。 */
function fileThumbItem(file: ChatFile, dataUrl: string): HTMLElement {
  const item = el('span', 'attach-thumb')
  item.dataset.attachPath = file.path
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
  chip.dataset.attachPath = file.path
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
 * 展开态容器全部来自「按会话隔离的展开态帧」（见 chat/disclosure.ts）：换会话
 * 时整帧换出/换入，切回来展开态照旧（#52 W3）。容器对象身份恒定，模块初始化
 * 就把它注入 markdown 工具链（mdTools）——所以这里只能原地改内容，不能换引用。
 */
const { detailsOpen, producedOpen, workflowDisclosure, innerScrollPositions, turnProcessOpen } = disclosureFrame()

// 共享 md 渲染/装饰工具（#40）：webview 状态（t/post/缓存/popover/整页 render）
// 经 MarkdownCtx 注入，调用点签名保持不变。
const mdTools = createMarkdownTools({
  t,
  post,
  fileThumbCache,
  fileThumbRequested,
  requestInlineImageIfNeeded,
  applyCommitHashState,
  noteCommitInfoRequest,
  onCommitHashHover,
  render,
  detailsOpen,
  showCopyFeedback,
  initCopyFeedback,
  renderJsonTree,
} satisfies MarkdownCtx)
const {
  decorateSessionMentions,
  decorateMarkdownImages,
  decorateCommitHashes,
  decorateInlineCodes,
  enhanceCodeBlocks,
  sessionMentionChip,
  markdownImageFailedChip,
} = mdTools

// #42：消息流 block 层 Preact 承载（治 #29）注入给 BlockList 的命令式渲染工具。
// renderBlock 是函数声明（hoisted），在此绑定的引用在模块加载期即已完成初始化。
// shell（preact/blocks.tsx）按 block 内容签名决定「重建/保活」，构建全权交给它。
// tool 块已完全 Preact 化（#43）：ToolCard 的局部 state（展开/JSON 树/复制反馈/滚动）
// 由组件实例自持，替代 webview 全局 Map，流式重建不再销毁 tool 卡自身状态。
const blockTools: BlockTools = {
  renderBlock,
  toolTools: {
    t,
    iconSvg,
    // subagents 是每帧解析的（state 会在 render 时更新）：用 getter 保证 ToolCard
    // 读到当前会话的血缘树，而不是模块加载时的旧引用。
    get subagents() {
      return state?.subagents
    },
  },
}

/**
 * 消息流里内部滚动容器（工具卡 IN/OUT、skill 指令卡、JSON 树等）的滚动位置
 * 存档（key 按渲染 key，同 detailsOpen 机制，随会话帧隔离）：消息行重建（流式
 * 变化行 / 行替换）时这些容器是新建元素、scrollTop 归零——用户正在滚动读内容
 * 会被顶回起点。重建前扫描 [data-scroll-key] 存下，重建后按 key 恢复。
 * 容器本身取自 disclosureFrame() 解构。
 */

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

const COPY_FEEDBACK_MS = 1000

/**
 * 复制按钮「已复制」反馈的成功时刻（key 按复制入口的位置/路径）。消息行重建
 * （流式变化行）时，新建的复制按钮初始文案都是「复制」，会把 1s 的「已复制」
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

/**
 * 展开块内容底部加一个「收起」小按钮：长内容（思考/工具调用/命令输出等）
 * 展开后用户往往已滚到文字底部，顶部的 summary 够不着，底部一键收起。
 * 按钮挂 details 内容之后，折叠态随内容一起隐藏；点击让 det.open = false，
 * toggle 事件会照常更新 detailsOpen 持久化。调用方在 append 完内容后调用。
 */
function attachCollapseFooter(det: HTMLDetailsElement): void {
  const b = buttonEl('details-collapse', t('Collapse'))
  b.type = 'button'
  b.title = t('Collapse')
  b.addEventListener('click', () => {
    det.open = false
  })
  det.appendChild(b)
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
    // 一段可见弧 + CSS 旋转（对齐 web 的 todo-progress-spin）。相位续播：
    // todo 面板内容真变时整面板重建，弧环从旧相位继续转而非从 0° 重启。
    svg.classList.add('todo-glyph-progress', 'todo-progress-spin')
    syncAnimPhase(svg, 1000)
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

/** Drop the clock interval (called by the flow dispose when the row leaves). */
function clearTurnStatusTimer(): void {
  if (turnStatusTimer !== null) {
    clearInterval(turnStatusTimer)
    turnStatusTimer = null
  }
}

function renderTurnStatus(): HTMLElement {
  if (turnStatusStart === null) turnStatusStart = Date.now()
  const start = turnStatusStart
  // 旧计时器若还挂着（替换路径的兜底）先清掉，再按本行重新注册。
  clearTurnStatusTimer()
  const row = el('div', 'turn-status')
  row.setAttribute('role', 'status')
  row.setAttribute('aria-live', 'polite')
  const statusText = el('span', 'turn-status-text', 'Deep diving...')
  // 1.8s shimmer 相位续播：该行被重建时不再从头闪。
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

/** 气泡行内 @文件引用 → ChatFile 列表（附件区渲染与右键复制共用同一合并源）。 */
function inlineFileRefs(
  text: string,
  references?: readonly { sessionId: string; label: string }[],
): ChatFile[] {
  const refs: ChatFile[] = []
  for (const seg of splitUserBubble(text, references)) {
    if (seg.kind !== 'file') continue
    const target = seg.path.replace(/^@/, '').replace(/^"|"$/g, '')
    refs.push({ name: seg.label, path: target, ...(isImagePath(target) ? { image: true } : {}) })
  }
  return refs
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
  const fileRefs = inlineFileRefs(text, references)
  for (const seg of splitUserBubble(text, references)) {
    if (seg.kind === 'text') bubble.appendChild(document.createTextNode(seg.text))
    else if (seg.kind === 'session') bubble.appendChild(sessionMentionChip(seg.label, seg.sessionId))
    // 文件/文件夹/命令引用 chip（文件及文件夹带图标，命令纯文本）。
    else bubble.appendChild(referenceChip(seg))
  }
  const summary = references?.length
    ? el('div', 'ref-summary', t('Referenced sessions: {0}', references.map((r) => r.label).join(t(', '))))
    : null
  return { bubble, summary, files: fileRefs }
}

/** 合并消息内既有附件与 @ 文件引用（路径不区分大小写去重——Windows 大小写不敏感）。 */
function mergedAttachments(fileRefs: ChatFile[], existing: readonly ChatFile[] | undefined): ChatFile[] {
  const byPath = new Map<string, ChatFile>()
  for (const f of existing ?? []) byPath.set(f.path.toLowerCase(), f)
  for (const f of fileRefs) if (!byPath.has(f.path.toLowerCase())) byPath.set(f.path.toLowerCase(), f)
  return [...byPath.values()]
}

/**
 * 折叠态下答案步要藏掉的内联推理块（官方 AssistantStep 的 reasoningHidden：
 * turn-process 可折 + 答案步带内联推理 + 未展开）。块带稳定 id，过滤不换 key。
 */
function visibleAssistantBlocks(m: ChatAssistantMessage, hideReasoning: boolean | undefined): readonly ChatBlock[] {
  if (hideReasoning !== true) return m.blocks
  return m.blocks.filter((block) => block.type !== 'reasoning')
}

function renderMessage(m: ChatMessage, key: string, hideReasoning?: boolean): HTMLElement {
  if (m.kind === 'user') {
    // Host-injected context renders collapsed; only real human input bubbles.
    if (m.context) {
      return renderInjectedContext(contextOf(m.context), m.text, key)
    }
    const row = el('div', 'msg user')
    row.dataset.msgKey = key
    // 附件在文字气泡上方（对齐 dsh web）：图片显示方形缩略图，文件仍是名称 chip。
    const parts = m.text ? renderUserBubbleParts(m.text, m.references) : null
    const attachments = renderUserAttachments(m.images, mergedAttachments(parts?.files ?? [], m.files))
    if (attachments) row.appendChild(attachments)
    if (parts) {
      row.appendChild(parts.bubble)
      if (parts.summary) row.appendChild(parts.summary)
    }
    // 行内 @ 文件引用 chip 的 hover 联动：悬停时对应附件 chip 高亮（与
    // composer 输入框的 hover 同款反馈；委托到整行，短名 chip 与附件区
    // 一一对应）。
    const clearRefHighlight = (): void => {
      for (const el of Array.from(row.querySelectorAll('.ref-hover, .hovered'))) {
        el.classList.remove('ref-hover', 'hovered')
      }
    }
    const applyRefHover = (ref: HTMLElement, path: string): void => {
      clearRefHighlight()
      ref.classList.add('ref-hover')
      for (const chip of Array.from(row.querySelectorAll<HTMLElement>('[data-attach-path]'))) {
        if (chip.dataset.attachPath === path) chip.classList.add('hovered')
      }
    }
    row.addEventListener('mouseover', (e) => {
      const ref = (e.target as Element | null)?.closest?.('[data-ref-path]')
      if (!ref || !(ref instanceof HTMLElement)) return
      const path = ref.dataset.refPath ?? ''
      applyRefHover(ref, path)
      refHoverCache = { msgKey: key, path }
    })
    row.addEventListener('mouseleave', () => {
      clearRefHighlight()
      refHoverCache = null
    })
    // 消息行重建（流式变化行）后按缓存恢复高亮（鼠标不动就保持）。
    if (refHoverCache?.msgKey === key) {
      const cached = refHoverCache.path
      const ref = Array.from(row.querySelectorAll<HTMLElement>('[data-ref-path]')).find(
        (el) => el.dataset.refPath === cached,
      )
      if (ref) applyRefHover(ref, cached)
      else refHoverCache = null
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
      attachCollapseFooter(det)
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
  row.dataset.msgKey = key
  // #42：assistant 行骨架（.msg.assistant）与尾列（streaming / interrupted /
  // turnError / maxTokens / produced-files / assistant-actions）保持命令式；block
  // 内容挂 .msg-blocks 容器，由 Preact BlockList 托管。流式内容变化走 buildFlowItems
  // 的 update 分支只对 .msg-blocks 做 Preact diff（行骨架保活，tool 卡实例不因整行
  // 重建而连坐销毁，治 #29）。块 key 沿用 `${key}:b${bi}`（与既有详情/滚动/复制反馈
  // 的持久化键一致）。
  const blocksContainer = el('div', 'msg-blocks')
  row.appendChild(blocksContainer)
  renderPreact(h(BlockList, { blocks: visibleAssistantBlocks(m, hideReasoning), rowKey: key, tools: blockTools }), blocksContainer)
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
  // 记录该消息的尾列签名，流式更新首帧起即知道「尾列未变、无需重挂」。
  assistantTailSigs.set(key, assistantTailSig(m))
  return row
}

/** 行尾（非 .msg-blocks）子节点的签名：流式中期这些字段稳定（只有 .streaming ▍），
 *  到结束才翻转。签名不变就不重挂尾列——避免每帧 remove/re-add 落点信号与操作栏。 */
function assistantTailSig(m: ChatAssistantMessage): string {
  return JSON.stringify([
    m.complete,
    m.interrupted,
    m.turnError ? m.turnError.message : null,
    m.maxTokens,
    m.producedFiles ?? null,
    m.turnEnd && !(m.blocks.length === 0 && (m.turnError || m.interrupted || m.maxTokens)),
  ])
}

/** 重挂 assistant 行的尾列（.streaming / .interrupted / .turn-error / .max-tokens /
 *  .produced-files / .msg-actions）——只在尾列签名变化时调用（见 updateMessageBlocks）。 */
function mountAssistantTail(row: HTMLElement, m: ChatAssistantMessage, key: string): void {
  for (const child of Array.from(row.children)) {
    if (!child.classList.contains('msg-blocks')) child.remove()
  }
  if (!m.complete) row.appendChild(el('div', 'streaming', '▍'))
  if (m.interrupted) row.appendChild(el('div', 'interrupted', t('Interrupted')))
  if (m.turnError) row.appendChild(renderTurnError(m.turnError))
  if (m.maxTokens) row.appendChild(renderMaxTokensNotice())
  if (m.producedFiles && m.producedFiles.length > 0) {
    row.appendChild(renderProducedFiles(m.producedFiles, `${key}:produced`))
  }
  if (m.turnEnd && !(m.blocks.length === 0 && (m.turnError || m.interrupted || m.maxTokens))) {
    row.appendChild(renderAssistantActions(m))
  }
}

/** assistant 行尾列的最近签名（msg id → sig）；换签名才重挂。 */
const assistantTailSigs = new Map<string, string>()

/**
 * #42：assistant 行骨架保活的更新入口（buildFlowItems 的 `update` 分支）。
 * 内容变化（流式追加 text / tool 状态流转 / turn 结束翻转尾列）时不再整行重建，
 * 而是：1) 对行内 `.msg-blocks` 做 Preact diff（shell 按 block 签名保活/重建，
 * tool 卡实例与它的滚动/展开/动画随之存活，这是 #29 的根治）；2) 尾列只在签名
 * 变化时重挂（流式中期尾列只有 `.streaming ▍`，签名稳定 → 不触碰 DOM）。
 *
 * `.msg-blocks` 容器自身保活（Preact 的 reconcile 依赖稳定的挂载点）。
 */
function updateMessageBlocks(row: HTMLElement, m: ChatAssistantMessage, key: string, hideReasoning?: boolean): void {
  const blocks = row.querySelector<HTMLElement>('.msg-blocks')
  if (blocks) renderPreact(h(BlockList, { blocks: visibleAssistantBlocks(m, hideReasoning), rowKey: key, tools: blockTools }), blocks)
  const tailSig = assistantTailSig(m)
  if (assistantTailSigs.get(key) !== tailSig) {
    assistantTailSigs.set(key, tailSig)
    mountAssistantTail(row, m, key)
  }
}

/**
 * 回合轨道栏（web parity: TurnNavigator 的垂直刻度栏）：数据源是 host 透传的
 * turnOutline 投影（整份日志所有回合，未载入回合也在）。每个回合一条刻度：
 * 已载入实心、未载入半透明；hover 显示 preview 气泡（prompt 一行 + response
 * 三行，投影侧已裁剪）；点击发布 turnJump，host 翻页覆盖目标 seq 后经
 * turnJumped 回传定位消息 id。mark 高度 10px、间距 10px（官方刻度几何）。
 */
const TURN_RAIL_SPACING = 10
const TURN_RAIL_INSET = 6

/**
 * 每个回合刻度是否「已载入」：存在消息 seq 落在本回合区间 [S_k, S_{k+1})（最后
 * 一个回合无上界）——回合内容（或它的尾部）在窗口里才算载入；窗口头切在回合中间
 * 时该回合按其尾部消息正确标为已载入。buildFlowItems 用它算轨道栏签名（窗口变了
 * 刻度态要跟着变）。
 */
function turnRailLoadedFlags(entries: readonly ChatTurnOutlineEntry[], messages: ChatMessage[]): boolean[] {
  const msgSeqs: number[] = []
  for (const m of messages) {
    const s = (m as { seq?: unknown }).seq
    if (typeof s === 'number') msgSeqs.push(s)
  }
  msgSeqs.sort((a, b) => a - b)
  return entries.map((entry, index) => {
    const lo = entry.seq
    const hi = index + 1 < entries.length ? entries[index + 1].seq : Number.POSITIVE_INFINITY
    return msgSeqs.some((s) => s >= lo && s < hi)
  })
}

/**
 * 最近一帧的回合大纲：hover 预览的实时数据源。轨道栏只在结构/刻度态变化时重建
 * （签名不带流式 response 预览，见 buildFlowItems），预览文案因此不能烘焙进
 * 重建时的快照——鼠标悬停时现读最新一帧。
 */
let latestTurnOutline: readonly ChatTurnOutlineEntry[] = []

function renderTurnRail(entries: ChatTurnOutlineEntry[], loadedFlags: readonly boolean[]): HTMLElement {
  const slot = el('div', 'turn-rail-slot')
  const frame = el('nav', 'turn-rail-frame')
  frame.setAttribute('aria-label', t('Turn navigation'))
  const marks = el('div', 'turn-rail-marks')
  marks.style.height = `${(entries.length - 1) * TURN_RAIL_SPACING + 2 * TURN_RAIL_INSET}px`
  const preview = el('div', 'turn-rail-preview')
  const previewPrompt = el('div', 'turn-rail-preview-prompt')
  const previewResponse = el('div', 'turn-rail-preview-response')
  preview.appendChild(previewPrompt)
  preview.appendChild(previewResponse)
  entries.forEach((entry, index) => {
    const position = el('div', 'turn-rail-mark-position')
    position.style.top = `${index * TURN_RAIL_SPACING + TURN_RAIL_INSET}px`
    const mark = el('button', 'turn-rail-mark') as HTMLButtonElement
    mark.type = 'button'
    const loaded = loadedFlags[index] === true
    if (!loaded) mark.classList.add('mark-unloaded')
    // active = 最新回合（新近锚点；官方按视口阅读位跟随，此处取最新简化）。
    if (index === entries.length - 1) mark.classList.add('mark-active')
    const jumpLabel = loaded ? t('Jump to turn {0}', entry.turn) : t('Load turn {0}', entry.turn)
    mark.title = jumpLabel
    mark.setAttribute('aria-label', jumpLabel)
    mark.addEventListener('click', () => post({ type: 'turnJump', seq: entry.seq }))
    mark.addEventListener('mouseenter', () => {
      // 预览读最新一帧的同一回合（重建时的快照可能已过期；见 latestTurnOutline）。
      const live = latestTurnOutline.find((e) => e.turn === entry.turn) ?? entry
      const scroller = frame.querySelector<HTMLElement>('.turn-rail-scroller')
      const scrollTop = scroller?.scrollTop ?? 0
      const top = index * TURN_RAIL_SPACING + TURN_RAIL_INSET - scrollTop
      preview.classList.add('show')
      const height = preview.offsetHeight
      const maxOffset = Math.max(0, frame.offsetHeight - height)
      preview.style.top = `${Math.max(0, Math.min(top - height / 2, maxOffset))}px`
      previewPrompt.textContent = entry.prompt || t('Turn {0}', entry.turn)
      previewResponse.textContent = entry.response
      previewResponse.style.display = entry.response === '' ? 'none' : ''
    })
    mark.addEventListener('mouseleave', () => preview.classList.remove('show'))
    position.appendChild(mark)
    marks.appendChild(position)
  })
  const scroller = el('div', 'turn-rail-scroller')
  scroller.appendChild(marks)
  frame.appendChild(scroller)
  frame.appendChild(preview)
  slot.appendChild(frame)
  return slot
}

/**
 * 回合跳转落点（turnJumped 回执）：释放吸底并滚动定位到目标消息行。行可能
 * 因新页刚落尚未 reconcile，队列多帧重试（最多 ~20 帧），找不到静默。
 */
function scrollToMessageId(messageId: string | null): void {
  if (!messageId) return
  stickToBottom = false
  // 回合跳转是显式定位：作废「加载更早」的阅读锚，免得下一帧把它拽回原位。
  earlierAnchor = null
  const messages = document.getElementById('messages')
  if (!messages) return
  const rowKey = `msg:${messageId}`
  let attempts = 0
  const tryScroll = (): void => {
    let row: Element | null = null
    for (const child of Array.from(messages.querySelectorAll('[data-flow-key]'))) {
      if (child.getAttribute('data-flow-key') === rowKey) {
        row = child
        break
      }
    }
    if (row) {
      const target = Math.max(
        0,
        row.getBoundingClientRect().top - messages.getBoundingClientRect().top + messages.scrollTop - 8,
      )
      writeMessagesScrollTop(messages, target)
      const jump = messages.querySelector<HTMLElement>('.jump-latest')
      if (jump) jump.style.display = 'none'
      return
    }
    if (attempts < 20) {
      attempts += 1
      requestAnimationFrame(tryScroll)
    }
  }
  tryScroll()
}

/**
 * 消息流增量更新（替代每快照 textContent='' 全量重建）：
 *
 * 每个快照按当前 state 算出一份「期望流」（older 入口、消息行 + workflow 卡按
 * anchorSeq 插流、命令通知、空态提示、turn-status、steering 气泡），
 * 与现有 DOM 按稳定 key 对账（reconcileFlow，容器是居中列 .flow-col）：
 * 内容未变的行整体保活——各自的
 * <details> 展开态、内部滚动位置、异步图片/已加载缩略图、hover 高亮与行级
 * 定时器全部随元素留存；只有新增/删除/内容变化的行才动 DOM。与原实现相比，
 * 流式期间每帧只重建「变化的那一行」，其余行零变更。
 * 列外成员：turn-rail（syncTurnRail 挂 .messages 顶层）与 jump-latest
 * （随 messages 创建挂 .jump-slot）不参与对账，见 buildFlowItems 返回结构。
 *
 * key 语义：
 * - 消息行 = `msg:${m.id}`（消息 id 跨快照稳定；loadEarlier 从顶部补页后不变，
 *   不会像旧的 `m${下标}` 位置键那样错位）；renderMessage 的 key 同步换成 m.id
 *   （detailsOpen / jsonTreeOpen / producedOpen / innerScrollPositions 等派生键
 *   跟随 id，展开状态贴在消息本身而非位置）。
 * - workflow 卡 = `wf:${run.runId}`；steering 气泡 = `steer:${item.id}`；
 *   通知按位置 `notice:${i}`；older / turn-status / jump 各自固定 key。
 *
 * 变更检测：消息/run/steering 渲染期签名 = JSON.stringify（快照对象每帧都是
 * structured clone 的新对象，无法用引用比较；字符串化成本低于 markdown 渲染，
 * 且只对变化行付）。user 消息与 steering 行额外并入懒加载图片缓存态（lazyThumbSig：
 * 回执只写缓存、消息数据不变，签名需覆盖缓存态否则缩略图回执后行被保活、
 * 占位/文件框换不成真图）。签名相同 → 复用现元素；不同 → 重渲染该行原位替换。
 */
type FlowItem = ReconcileItem

/**
 * 消息/steering 行渲染依赖的懒加载图片缓存态（逐项 '0'=未命中 '1'=已命中）：
 * attachmentCache（消息 images 缩略图）与 fileThumbCache（图片文件 chip——
 * files 区 + 行内 @ 文件引用提升路径）。并入 buildFlowItems 的行签名：
 * attachmentData / fileThumb / fileThumbFailed 回执只写 webview 侧缓存、不改
 * 消息数据，JSON.stringify(m/item) 本身不变——签名不含缓存态时行被对账保活，
 * 占位/文件框永远换不成真图（回执后那次 render 只重算签名，行不重建）。
 * 缓存态并入后：回执 → 下一帧签名变化 → 该行重建一次换真图，之后缓存稳定 →
 * 签名稳定 → 行保活（流式期间无额外重建）。fileThumbFailed 不改渲染输出
 * （仍是图标 chip、不再发请求），不加入签名，不触发无谓重建。
 * 输入与渲染路径完全同源（inlineFileRefs / mergedAttachments 同函数同参数序），
 * 避免回执侧失效签名方案要覆盖 images/files/@引用/steering 四处、漏项即复发。
 */
function lazyThumbSig(
  images: readonly ChatImage[] | undefined,
  text: string,
  references: readonly { sessionId: string; label: string }[] | undefined,
  files: readonly ChatFile[] | undefined,
): string {
  let sig = ''
  for (const img of images ?? []) sig += attachmentCache.has(img.attachmentId) ? '1' : '0'
  const merged = mergedAttachments(text ? inlineFileRefs(text, references) : [], files)
  for (const f of merged) if (f.image) sig += fileThumbCache.has(f.path) ? '1' : '0'
  return sig
}

/** steering 气泡的懒加载缓存态摘要：解析管线与 renderSteeringItem 一致
 *  （先剥 <attachment> 行 + 会话 mention 解析，再提 @ 文件引用）。 */
function steerLazyThumbSig(item: QueuedItem): string {
  const { text, references } = parseSessionMentions(splitAttachmentLines(item.editText).text)
  return lazyThumbSig(item.images, text, references, item.files)
}

/** 每条消息最近一次渲染的签名（id → sig）；无此 id = 未渲染过。 */
const flowMsgSigs = new Map<string, string>()
/** workflow run 卡签名（runId → sig）。 */
const flowRunSigs = new Map<string, string>()
/** steering 气泡签名（item.id → sig）。 */
const flowSteerSigs = new Map<string, string>()
/** 未匹配命令生命周期节点签名（合成 commandId → sig）。 */
const flowReceiptSigs = new Map<string, string>()
/** 回合过程折叠行签名（turn → sig：规格 + 展开态）。 */
const flowProcessSigs = new Map<number, string>()
/** 上一帧的命令通知列表（逐条按位置比对）。 */
let flowLastNotices: string[] = []

/**
 * 消息流渲染：workflow 运行卡片按 anchorSeq 插进聊天流（对齐官方把 durable
 * workflow-run 节点放在 chat 流里的位置语义）。run 的全部事件都落在承载它的
 * tool 卡所在 turn 内，assistant 消息的 seq 会随 turn 内事件涨到 ≥ anchorSeq，
 * 所以「第一条 seq ≥ anchorSeq 的消息之后」就是该 run 的插位；没有配对消息
 * （窗口起点切在 run 之后）时统一排在流尾。runs 已按 anchorSeq 升序。
 *
 * 返回分两部分（chat-width 列容器化起）：colItems 对账进 .flow-col 居中列；
 * turn-rail 与 jump-latest 不是内容流——rail 由 syncTurnRail 单独挂在
 * .messages 顶层（sticky 贴滚动面板右缘，不随列限宽），jump 的元素在
 * messages 创建时一次性挂在列外的 .jump-slot 里，这里不再重复创建。
 */
/**
 * 一个回合的「过程折叠」运行时视图（F1）：官方 ChatNodeSeat 的判定按回合算一次
 * ——成员（过程窗内的节点）在折叠态隐藏，答案步自己可见（它的 reasoning 在
 * `inlineReasoning` 时也藏起来），折叠行在 `afterSeq` 那条人类输入之后。
 *
 * `foldable` 与官方同款：过程窗就绪（有答案步）+ 有外部过程或答案步带内联推理
 * 才折——一问一答的简单回合照常平铺。
 */
interface TurnProcessRuntime {
  view: ChatTurnProcess
  open: boolean
  foldable: boolean
}

/**
 * 本消息在所属回合过程里的位置。判定用 step 归属而不是官方的 anchor 区间：
 * 官方 tool 是独立节点、有自己的 anchorSeq；我们的 tool 块挂在所属 step 的
 * assistant 消息里，所以「step < 答案步」就是过程成员、「step = 答案步」就是
 * 答案步（顺序执行的回合里两者等价）。注入上下文/命令卡/压缩卡这些非独立节点
 * 按 seq 落在过程窗内即成员（官方那套里它们同样会被折掉）。
 */
function isProcessMemberMessage(m: ChatMessage, runtime: TurnProcessRuntime): boolean {
  const view = runtime.view
  if (m.kind === 'assistant') return m.turn === view.turn && m.step !== undefined && m.step < view.answerStep
  if (typeof m.seq !== 'number') return false
  if (m.kind === 'user') return m.context !== undefined && m.seq > view.processStartSeq && m.seq < view.answerAnchorSeq
  return m.kind === 'command' || m.kind === 'compaction'
    ? m.seq > view.processStartSeq && m.seq < view.answerAnchorSeq
    : false
}

/** 折叠态下本行该怎么渲染；null = 与过程折叠无关（照常渲染）。 */
function processFoldStateOf(m: ChatMessage, runtime: TurnProcessRuntime | null): { hidden: boolean; hideReasoning: boolean } | null {
  if (!runtime || !runtime.foldable || runtime.open) return null
  const member = isProcessMemberMessage(m, runtime)
  const answer = m.kind === 'assistant' && m.turn === runtime.view.turn && m.step === runtime.view.answerStep
  if (!member && !answer) return null
  // 答案步：官方 AssistantStep 在折叠态也藏掉自己的推理块（inlineReasoning）。
  return { hidden: member, hideReasoning: answer && runtime.view.inlineReasoning }
}

/** 折叠行的展开态键（官方 storedTurnProcessEntry 的 {turn, answerStep}）。 */
function turnProcessKeyOf(view: ChatTurnProcess): string {
  return `${view.turn}:${view.answerStep}`
}

/** 折叠行文案（官方 TurnProcessNodeView）：有计数就列计数，没有显示「已思考」。 */
function turnProcessLabel(view: ChatTurnProcess): string {
  const labels: string[] = []
  if (view.toolCallCount > 0) labels.push(t(view.toolCallCount === 1 ? '{0} tool call' : '{0} tool calls', view.toolCallCount))
  if (view.messageCount > 0) labels.push(t(view.messageCount === 1 ? '{0} message' : '{0} messages', view.messageCount))
  if (view.subagentCount > 0) labels.push(t(view.subagentCount === 1 ? '{0} subagent' : '{0} subagents', view.subagentCount))
  return labels.length === 0 ? t('Thought for a while') : labels.join(' · ')
}

/** 折叠行：一个可点的 button（标签 + chevron），整行参与 flow 对账。 */
function renderTurnProcessRow(view: ChatTurnProcess, open: boolean): HTMLElement {
  const row = el('div', 'turn-process-row')
  if (open) row.dataset.open = 'true'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'turn-process'
  button.dataset.turnProcess = String(view.turn)
  button.dataset.turnProcessMessages = String(view.messageCount)
  button.dataset.turnProcessToolCalls = String(view.toolCallCount)
  button.dataset.turnProcessSubagents = String(view.subagentCount)
  button.setAttribute('aria-expanded', String(open))
  button.appendChild(el('span', 'turn-process-label', turnProcessLabel(view)))
  button.appendChild(chevronEl(open))
  button.addEventListener('click', () => {
    button.focus()
    turnProcessOpen.set(turnProcessKeyOf(view), !open)
    render()
  })
  row.appendChild(button)
  return row
}

/** 折叠行尾部的 chevron：展开朝上、折叠朝下（与官方 IconChevronDown 的旋转一致）。 */
function chevronEl(open: boolean): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', open ? 'turn-process-chevron open' : 'turn-process-chevron')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M4 6l4 4 4-4')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.4')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  return svg
}

function buildFlowItems(state: ChatState): { rail: FlowItem | null; colItems: FlowItem[] } {
  const items: FlowItem[] = []
  // 回合轨道栏（web parity: TurnNavigator）：整份日志的回合刻度，未载入回合
  // 同显可点（click → host 翻页 → 定位）。放在流首（sticky 悬浮层，DOM 顺序
  // 不影响视觉与对账）；≥2 回合才有导航意义，单回合/无投影不渲染。
  const outline = state.turnOutline
  let rail: FlowItem | null = null
  if (outline !== undefined && outline.length >= 2) {
    // 签名只取「结构 + 已载入刻度」：outline 里带当前回合的流式 response 预览，
    // 每个 delta 都变——把它算进签名会让轨道栏每个 token 整栏重建（气泡被打断、
    // 轨道滚位弹回，见 #11 R3）。预览改由 hover 时读最新 outline（见
    // renderTurnRail），所以内容不进签名；已载入刻度随窗口变化，必须进签名，
    // 否则补页后刻度还是旧的「未载入」态。
    const loaded = turnRailLoadedFlags(outline, state.messages)
    const sig = JSON.stringify([outline.map((e) => [e.turn, e.seq, e.prompt]), loaded])
    const same = flowRailSig === sig
    // hover 预览的实时数据源：轨道栏重建是低频事件，预览文案要跟最新一帧。
    latestTurnOutline = outline
    flowRailSig = sig
    rail = { key: 'turn-rail', same, create: () => renderTurnRail(outline, loaded) }
  } else {
    latestTurnOutline = outline ?? []
  }
  // 「加载更早」入口（对齐官方 dsh web ChatView 的分页按钮）：还有更早历史
  // 或一页正在加载时显示在消息流顶部。
  if (state.hasEarlierHistory || state.loadingEarlier === true) {
    const loading = state.loadingEarlier === true
    items.push({
      key: 'older',
      same: loading === olderWasLoading,
      create: () => {
        const olderWrap = el('div', 'older')
        const btn = buttonEl(undefined, loading ? t('Loading…') : t('Load earlier'))
        btn.disabled = loading
        btn.addEventListener('click', maybeLoadEarlier)
        olderWrap.appendChild(btn)
        return olderWrap
      },
    })
    olderWasLoading = loading
  } else {
    olderWasLoading = false
  }
  const runs = state.workflowRuns ?? []
  let ri = 0
  const emitThrough = (seq: number | undefined): void => {
    if (seq === undefined) return
    while (ri < runs.length && runs[ri].anchorSeq <= seq) {
      const run = runs[ri]
      const sig = JSON.stringify(run)
      const same = flowRunSigs.get(run.runId) === sig
      flowRunSigs.set(run.runId, sig)
      items.push({ key: `wf:${run.runId}`, same, create: () => renderWorkflowRun(run) })
      ri += 1
    }
  }
  const seenMsgIds = new Set<string>()
  const seenProcessTurns = new Set<number>()
  // Pending steering bubbles: interleave by send-time seq into the message flow
  // (aligns official orderedVisibleChatNodes' anchorSeq ordering + observedRpcIds
  // duplicate suppression). Snapshot order is not guaranteed to be send order, so
  // sort by the synthetic seq (QueuedItem.seq); a steering item whose durable user
  // message is already rendered is hidden (no duplicate trailing bubble). Items
  // without a seq (legacy/harness snapshots) sort to the tail.
  const durableUserIds = new Set<string>()
  for (const m of state.messages) if (m.kind === 'user' && m.id) durableUserIds.add(m.id)
  // durable 用户消息 id → 它对应的 steering queue 项。插话落地（claim）后，pending
  // 气泡被隐藏、durable 以 kind:'user' 进 state.messages；这里把它**认回插话身份**，
  // 渲染成与 pending 气泡共享同一 key（steer:<item.id>）的落地节点——reconcile 按
  // 相同 key 就地切换（原位切换），而不是删 pending 气泡再尾置重插一条普通 user 消息。
  // （对齐官方 SteeringMessageNode：durable 阶段保留插话身份 + 与 inbox occurrence
  //  共用的 messageId 作为稳定 key，claim 落地原位替换。）
  const steerLanding = new Map<string, QueuedItem>()
  for (const item of state.queue ?? []) {
    if (item.placement === 'steering' && typeof item.messageId === 'string' && item.messageId) {
      steerLanding.set(item.messageId, item)
    }
  }
  const seenSteerIds = new Set<string>()
  const steerItems = (state.queue ?? [])
    .filter((item) => item.placement === 'steering')
    .filter((item) => !(typeof item.messageId === 'string' && durableUserIds.has(item.messageId)))
  const emitSteering = (item: QueuedItem): void => {
    const sig = JSON.stringify(item) + `|${steerLazyThumbSig(item)}`
    const same = flowSteerSigs.get(item.id) === sig
    flowSteerSigs.set(item.id, sig)
    seenSteerIds.add(item.id)
    items.push({ key: `steer:${item.id}`, same, create: () => renderSteeringItem(item) })
  }
  // 插排结果：messages 按 seq 升序（消费前兜底稳排——折叠层正常情况已保证
  // 升序，这里防御 host 快照/基线乱序时插排错位），pseudo-steers 按其 seq
  // 插到「应落位」处。
  const orderedMessages = orderBySeq(state.messages)
  const flowEntries = interleaveSteering(orderedMessages, steerItems)
  // 切分：最后一条消息之后的 entries 全是「最新（或无可比 seq）」的 steers——它们放
  // turn-status 之后（对齐官方 pendingSteering 尾置；插话总在「当前运行回合」之后）；
  // 之前/中间的（早发、确实晚于某条已渲染消息的）插排进消息流，治「先发插话却排到
  // 后发消息之后」。
  let lastMsgIdx = -1
  for (let i = 0; i < flowEntries.length; i++) if (flowEntries[i].kind === 'message') lastMsgIdx = i
  const inFlow = lastMsgIdx >= 0 ? flowEntries.slice(0, lastMsgIdx + 1) : []
  const tailSteers = lastMsgIdx >= 0 ? flowEntries.slice(lastMsgIdx + 1) : flowEntries
  // 回合过程折叠（F1）：每个回合一份运行时视图（展开态 + foldable 判定），
  // 折叠行在「首条人类输入之后」或（那条没在窗口里时）「第一个过程成员之前」插入。
  const processRuntime = new Map<number, TurnProcessRuntime>()
  for (const view of state.turnProcess ?? []) {
    processRuntime.set(view.turn, {
      view,
      open: turnProcessOpen.get(turnProcessKeyOf(view)) === true,
      foldable: view.hasExternalProcess || view.inlineReasoning,
    })
  }
  // 非 assistant 消息（注入上下文 / 命令卡 / 压缩卡）按 seq 找它落在哪个回合的
  // 过程窗里：消息按 seq 升序处理，所以游标单调前进即可（O(N+T) 不是 O(N*T)）。
  const procList = [...processRuntime.values()].sort((a, b) => a.view.processStartSeq - b.view.processStartSeq)
  let procIdx = 0
  const runtimeForSeq = (seq: number): TurnProcessRuntime | null => {
    while (procIdx < procList.length && procList[procIdx].view.answerAnchorSeq < seq) procIdx += 1
    const candidate = procList[procIdx]
    if (!candidate) return null
    return seq > candidate.view.processStartSeq && seq < candidate.view.answerAnchorSeq ? candidate : null
  }
  const emittedProcessRows = new Set<number>()
  const emitProcessRow = (runtime: TurnProcessRuntime): void => {
    const turn = runtime.view.turn
    if (emittedProcessRows.has(turn) || !runtime.foldable) return
    emittedProcessRows.add(turn)
    seenProcessTurns.add(turn)
    const sig = `${JSON.stringify(runtime.view)}|${runtime.open ? 1 : 0}`
    const same = flowProcessSigs.get(turn) === sig
    flowProcessSigs.set(turn, sig)
    items.push({
      key: `proc:${turn}`,
      same,
      create: () => renderTurnProcessRow(runtime.view, runtime.open),
    })
  }
  for (const entry of inFlow) {
    if (entry.kind === 'steer') {
      emitSteering(entry.steer)
      continue
    }
    const m = entry.message
    // 本消息在所属回合过程里的角色：成员（折叠态隐藏）/ 答案步（折叠态藏
    // 内联推理）/ 无关。折叠行要抢在第一个成员之前、或在首条人类输入之后。
    const runtime =
      m.kind === 'assistant'
        ? (m.turn !== undefined ? processRuntime.get(m.turn) ?? null : null)
        : typeof m.seq === 'number'
          ? runtimeForSeq(m.seq)
          : null
    // 折叠行的插位：首条人类输入那条要排在本行**之后**（官方 rank：user 0 →
    // 折叠行 1 → 成员 2）；首条人类输入不在窗口里时退回「排在本回合第一个过程
    // 成员之前」。两条路径各自在本行入列后调用 emitProcessRowAfter。
    const isProcessAnchorMsg = runtime !== null && typeof m.seq === 'number' && m.seq === runtime.view.afterSeq
    if (runtime && !isProcessAnchorMsg && isProcessMemberMessage(m, runtime)) emitProcessRow(runtime)
    // 插话落地：durable 用户消息认回插话身份，渲染成与 pending 气泡共享
    // steer:<id> key 的落地节点（原位切换，保留插话身份 + seq 锚）。
    // 身份有两个来源（F5）：
    // ① 折叠层给的 m.steering（重放 agent/inbox/spliced 得出，durable 侧自己就
    //    知道这是插话）——queue 项落地后立刻被移除，只看 queue 的话那一帧 key
    //    会从 steer:<id> 掉回 msg:<id>，行被整个重建；
    // ② 还在队列里的 pending 项（steerLanding，按 durable 认回）——它带着编辑/
    //    撤销入口，key 用 queue 项 id（与 pending 气泡同 key，保证原位切换）。
    // 两者 id 同源（inbox 项 id = 落盘 user/message 的 data.id），所以 key 一致。
    if (m.kind === 'user' && !m.context) {
      const landing = steerLanding.get(m.id)
      const steerId = landing ? landing.id : m.steering === true ? m.id : null
      if (steerId !== null) {
        const key = `steer:${steerId}`
        const sig = JSON.stringify(m) + `|${lazyThumbSig(m.images, m.text ?? '', m.references, m.files)}`
        const same = flowSteerSigs.get(steerId) === sig
        flowSteerSigs.set(steerId, sig)
        seenSteerIds.add(steerId)
        // 该消息此刻以 steer 槽位渲染，不再以 msg:<id> 槽位签名；清掉旧的 msg 签名
        // 防残留。落地节点元素由 reconcile 按相同 key 原地保留（pending 气泡不删除）。
        flowMsgSigs.delete(m.id)
        items.push({
          key,
          same,
          create: () => renderMessage(m, m.id),
          dispose: clearRetryTimersFor,
        })
        if (runtime && isProcessAnchorMsg) emitProcessRow(runtime)
        emitThrough(undefined)
        continue
      }
    }
    const foldState = processFoldStateOf(m, runtime)
    const hidden = foldState?.hidden === true
    const hideReasoning = foldState?.hideReasoning === true
    // 折叠态影响本行渲染（可见性 / 答案步推理块是否渲染）→ 并入签名，让展开
    // 折叠那一下精确地只重建受影响的行（内容没变、只有折叠态变的行走 same=false
    // 的 update 分支，行骨架仍保活）。
    const processSig = foldState ? `|p${hidden ? 1 : 0}${hideReasoning ? 1 : 0}` : ''
    const sig =
      JSON.stringify(m) +
      (m.kind === 'user' && !m.context ? `|${lazyThumbSig(m.images, m.text ?? '', m.references, m.files)}` : '') +
      processSig
    const same = flowMsgSigs.get(m.id) === sig
    flowMsgSigs.set(m.id, sig)
    seenMsgIds.add(m.id)
    items.push({
      key: `msg:${m.id}`,
      same,
      hidden,
      create: () => renderMessage(m, m.id, hideReasoning),
      // #42：assistant 行内容变化时走「行骨架保活」的 update 路径——只对行内
      // .msg-blocks 做 Preact diff（块层 block 由 Preact 对账，text 流式增量、
      // tool 卡按签名保活），不整行重建（治 #29）。`same` 仍按整条消息内容签名：
      // 内容变化（流式追加/状态翻转）时 same=false 才触发 update 分支。
      update: m.kind === 'assistant' ? (el) => updateMessageBlocks(el, m, m.id, hideReasoning) : undefined,
      dispose: clearRetryTimersFor,
    })
    if (runtime && isProcessAnchorMsg) emitProcessRow(runtime)
    emitThrough(m.kind === 'assistant' ? m.seq : undefined)
  }
  emitThrough(Number.POSITIVE_INFINITY)
  // 换会话/窗口收缩后清掉不再出现的签名，防 Map 跨会话累积。
  if (flowMsgSigs.size > seenMsgIds.size) {
    for (const id of [...flowMsgSigs.keys()]) if (!seenMsgIds.has(id)) flowMsgSigs.delete(id)
  }
  if (flowProcessSigs.size > seenProcessTurns.size) {
    for (const turn of [...flowProcessSigs.keys()]) if (!seenProcessTurns.has(turn)) flowProcessSigs.delete(turn)
  }
  // 未匹配/兜底命令的生命周期回执节点（与 matched 命令的 command/run+done 节点
  // 同款形态）：标题/状态 running→error/可展开正文，成败都回执（对齐官方
  // CommandNode）。protocol 节点已存在（matched 命令在 state.messages 里）时
  // 跳过对应回执，避免与 protocol 生命周期节点重复渲染。
  const protocolCmdIds = new Set<string>()
  for (const m of state.messages) if (m.kind === 'command' && m.id) protocolCmdIds.add(m.id)
  const seenReceiptIds = new Set<string>()
  commandReceipts.forEach((receipt) => {
    if (protocolCmdIds.has(receipt.id)) return
    const sig = JSON.stringify(receipt)
    const same = flowReceiptSigs.get(receipt.id) === sig
    flowReceiptSigs.set(receipt.id, sig)
    seenReceiptIds.add(receipt.id)
    items.push({
      key: `cmd:${receipt.id}`,
      same,
      create: () => renderMessage({ kind: 'command', id: receipt.id, name: receipt.name, status: receipt.status, text: receipt.text }, receipt.id),
      dispose: clearRetryTimersFor,
    })
  })
  for (const id of [...flowReceiptSigs.keys()]) if (!seenReceiptIds.has(id)) flowReceiptSigs.delete(id)
  // 命令通知（宿主回执的文本消息，按位置比对）。
  commandNotices.forEach((notice, i) => {
    items.push({
      key: `notice:${i}`,
      same: flowLastNotices[i] === notice,
      create: () => el('div', 'command-notice', notice),
    })
  })
  flowLastNotices = [...commandNotices]
  // 本地乐观占位（#52 S1）：还没回流的发送先在这条流里占位——直接进对话流的
  // （空闲发送）排在 turn-status 之前，就是新消息该在的位置；插话占位与
  // tailSteers 一样留在 turn-status 之后（见流尾）。
  const echoItems = sessionEchoes(state.sessionId)
  for (const echo of echoItems) {
    if (echo.placement !== 'turn') continue
    items.push({ key: `echo:${echo.id}`, same: true, create: () => renderEchoBubble(echo) })
  }
  // 空态提示（无消息且无等待插话时；本地占位也算有内容）。
  if (
    state.messages.length === 0 &&
    echoItems.length === 0 &&
    !(state.queue ?? []).some((item) => item.placement === 'steering')
  ) {
    items.push({
      key: 'empty',
      same: true,
      create: () => el('div', 'muted-hint', t('No messages yet — start typing below.')),
    })
  }
  // Turn-status row: 流程末位（对齐官方 turn 中），turn 结束即移除。
  if (state.running) {
    items.push({
      key: 'turn-status',
      same: true,
      create: () => renderTurnStatus(),
      dispose: () => clearTurnStatusTimer(),
    })
  }
  // 最新（或无可比 seq）的 pending steering 气泡留在 turn-status 之后（对齐官方）。
  for (const entry of tailSteers) if (entry.kind === 'steer') emitSteering(entry.steer)
  // 本地插话占位同款尾置：宿主回流后由真 steering 气泡 / durable 用户消息接管。
  for (const echo of echoItems) {
    if (echo.placement !== 'steering') continue
    items.push({ key: `echo:${echo.id}`, same: true, create: () => renderEchoBubble(echo) })
  }
  for (const id of [...flowSteerSigs.keys()]) if (!seenSteerIds.has(id)) flowSteerSigs.delete(id)
  // "Back to latest" 浮标不入流：元素随 messages 创建时一次性挂在列外
  // .jump-slot（见 messages 创建块），render 尾部只按跟随态切 display。
  return { rail, colItems: items }
}

let olderWasLoading = false
/** 上一帧回合大纲的签名（turn-rail 复用判断；仅用于 same 对账）。 */
let flowRailSig = ''

/**
 * 期望流与容器现有 child 对账（单遍指针 + key 索引）：
 * - 同 key 且 same → 原位复用（最常见的纯尾部追加快照：除新行外零变更）；
 * - 同 key 但内容变了 → 重建新元素原位替换（先插后删，避免列表闪空）；
 * - 新 key → 插入（尾部追加 / loadEarlier 顶部补页 / workflow 卡按 anchorSeq
 *   落位）；
 * - 期望流之后残留的 child → 移除（turn-status 结束、older 关闭、steering
 *   落地等），dispose 清理行级资源。
 * 顺序修正（把已在 DOM 里但位置不对的元素 insertBefore 挪位）只会在真正重排
 * 时触发（如 loadEarlier 补页后 anchorSeq 插位前移），正常流式零移动。
 */
/** messages 顶层结构里的居中内容列（不存在 = 老 DOM，防御性兜底到 messages）。 */
function flowColOf(messages: HTMLElement): HTMLElement {
  return messages.querySelector<HTMLElement>(':scope > .flow-col') ?? messages
}

/** messages 顶层结构里的 composer 坐席（dock 家族 + pending/composer 挂载点）。 */
function seatOf(messages: HTMLElement): HTMLElement {
  return messages.querySelector<HTMLElement>(':scope > .composer-seat') ?? messages
}

/**
 * 回合轨道栏挂到 .messages 顶层（flow-col 之前的 sticky 槽位）：rail 不是内容
 * 流成员，随列限宽会把它从滚动面板右缘拽到内容列右缘（dsh web 贴面板右缘）。
 * 单元素同步：same 且已在位则不动；否则原位替换/移除。
 */
function syncTurnRail(messages: HTMLElement, item: FlowItem | null): void {
  const existing = messages.querySelector<HTMLElement>(':scope > .turn-rail-slot')
  if (item === null) {
    existing?.remove()
    return
  }
  if (existing !== null && item.same) return
  // 重建时保留轨道自身的滚动位置：长会话里用户滚到轨道中段看某几个回合，若因
  // 结构变化（新回合开始、补页后刻度态翻转）整栏重建，滚位不该被弹回顶部。
  const keptScrollTop = existing?.querySelector<HTMLElement>('.turn-rail-scroller')?.scrollTop ?? 0
  const fresh = item.create()
  fresh.setAttribute('data-flow-key', item.key)
  existing?.remove()
  messages.insertBefore(fresh, flowColOf(messages))
  const scroller = fresh.querySelector<HTMLElement>('.turn-rail-scroller')
  if (scroller && keptScrollTop > 0) scroller.scrollTop = keptScrollTop
}

/** 消息流对账的承载（通用实现已抽到共享模块 ui/shared/reconcile）。 */
const reconcileFlow = reconcileChildren

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
  decorateMarkdownImages(body)
  enhanceCodeBlocks(body, `${key}:compact`)
  decorateInlineCodes(body)
  det.appendChild(body)
  attachCollapseFooter(det)
  return det
}

/**
 * 模型重试行（对齐官方 ModelRetryItem）：折叠行 = 状态文本（含倒计时），展开
 * 显示重试延迟 + 失败原因。scheduled 等待期行上每秒刷新剩余秒数（只改自己
 * 的文本节点，不触发列表重渲染）。计时器按行元素登记：增量更新下行的替换/
 * 移除由 dispose（clearRetryTimersFor）清掉本行的表，保活的行计时器继续走，
 * 不再像全量重建那样每帧全局清一遍。
 */
const RETRY_LABELS: Record<ChatRetryBlock['retryState'], string> = {
  scheduled: t('Retrying model request'),
  started: t('Model request retried'),
  cancelled: t('Model request retry cancelled'),
}

let retryTimers = new Map<HTMLElement, ReturnType<typeof setInterval>>()

/** 清理某行（消息行）内所有重试行倒计时：行被替换/移除时由 flow dispose 调用。 */
function clearRetryTimersFor(row: HTMLElement): void {
  const rows = row.querySelectorAll<HTMLElement>('.retry-row')
  for (let i = 0; i < rows.length; i++) {
    const timer = retryTimers.get(rows[i])
    if (timer !== undefined) {
      clearInterval(timer)
      retryTimers.delete(rows[i])
    }
  }
}

function retrySeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

function renderRetryRow(block: ChatRetryBlock, key: string): HTMLElement {
  const det = detailsEl(`${key}:retry`, 'retry-row', '')
  if (block.retryState === 'scheduled') det.setAttribute('data-active', '')
  const maximum = block.mode === 'normal' ? String(block.maxRetries ?? '?') : '∞'
  const status = el('span', 'retry-text')
  // 1.6s retry-shimmer 相位续播：该行被重建时不再从头闪。
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
        retryTimers.delete(det)
      }
    }, 1000)
    retryTimers.set(det, timer)
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
  attachCollapseFooter(det)
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
  // Token 用量药丸（web parity: TurnUsagePanel）——只有 host 可证明的精确聚合
  // 才带上（usage 缺省 = 缺边界/计数不安全，药丸不渲染）。
  if (m.usage) actions.appendChild(renderTurnUsagePill(m.usage))
  return actions
}

// ---- 消息右键菜单：复制 ----

/** 瞬时提示（复制成功/失败：菜单已关闭，没有按钮图标可换）。 */
function showCopyToast(text: string): void {
  const toast = el('div', 'copy-toast', text)
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 2000)
}

/** 复制纯文本（user 取 m.text；assistant 复用 assistantText，与操作栏复制按钮同内容）。 */
function copyMessageText(m: ChatUserMessage | ChatAssistantMessage): void {
  const text = m.kind === 'user' ? m.text : assistantText(m)
  if (!text) return
  void navigator.clipboard.writeText(text).then(
    () => showCopyToast(t('Copied')),
    () => showCopyToast(t('Copy failed')),
  )
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

/**
 * Token 用量药丸（web parity: TurnUsagePanel 的 trigger「用量 N tokens」）：
 * 点击弹锚定小窗（复用全局 .popover 基建，outside-dismiss / Esc 关闭）。
 */
function renderTurnUsagePill(usage: ChatTurnUsage): HTMLElement {
  const pill = buttonEl('msg-usage-pill', t('Usage {0}', formatCompactTokens(usage.totalTokens, t)))
  pill.title = t('Turn usage')
  pill.setAttribute('aria-haspopup', 'dialog')
  pill.setAttribute('aria-expanded', 'false')
  pill.addEventListener('click', () => {
    const expanded = pill.getAttribute('aria-expanded') === 'true'
    if (expanded) {
      closePopover()
    } else {
      showPopover(pill, renderTurnUsagePanel(usage), 'above')
      pill.setAttribute('aria-expanded', 'true')
    }
  })
  // 弹层关闭（outside 点击 / Esc / blur）后回滚 pill 的 aria-expanded。
  const observer = new MutationObserver(() => {
    if (popover === null) pill.setAttribute('aria-expanded', 'false')
  })
  observer.observe(document.body, { childList: true })
  return pill
}

/** 用量明细弹窗内容（字段对齐官方 TurnUsagePanel 的 dl 列）。 */
function renderTurnUsagePanel(usage: ChatTurnUsage): HTMLElement {
  const panel = el('div', 'usage-panel')
  const title = el('div', 'usage-panel-title')
  title.appendChild(el('span', 'usage-panel-title-label', t('Turn usage')))
  title.appendChild(el('span', 'usage-panel-title-value', formatExactTokens(usage.totalTokens)))
  panel.appendChild(title)
  panel.appendChild(el('div', 'usage-panel-rule'))
  const dl = el('dl', 'usage-panel-details')
  const routes = (usage.routes ?? []).map((r) => `${r.provider}/${r.model}`).join(', ')
  if (routes) {
    dl.appendChild(el('dt', undefined, t('Provider / model')))
    dl.appendChild(el('dd', 'usage-panel-route', routes))
  }
  // 缓存命中率只在缓存桶可证明时显示（缺省 = 未知，不在 UI 上标 0%）。
  const cacheHit =
    usage.cacheReadTokens !== undefined
      ? formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
      : null
  if (cacheHit !== null) {
    dl.appendChild(el('dt', undefined, t('Cache hit')))
    dl.appendChild(el('dd', undefined, `${cacheHit}%`))
  }
  dl.appendChild(el('dt', undefined, t('Uncached input')))
  dl.appendChild(el('dd', undefined, formatExactTokens(usage.uncachedInputTokens)))
  if (usage.cacheReadTokens !== undefined) {
    dl.appendChild(el('dt', undefined, t('Cached input')))
    dl.appendChild(el('dd', undefined, formatExactTokens(usage.cacheReadTokens)))
  }
  if (usage.cacheWriteTokens !== undefined) {
    dl.appendChild(el('dt', undefined, t('Cache write')))
    dl.appendChild(el('dd', undefined, formatExactTokens(usage.cacheWriteTokens)))
  }
  dl.appendChild(el('dt', undefined, t('Output')))
  const output = el('dd', undefined, formatExactTokens(usage.outputTokens))
  if (usage.reasoningTokens !== undefined) {
    output.appendChild(el('span', 'usage-panel-reasoning', t('({0} reasoning)', formatExactTokens(usage.reasoningTokens))))
  }
  dl.appendChild(output)
  panel.appendChild(dl)
  return panel
}

/** 官方 formatExactTokens：三位分组的精确整数。 */
function formatExactTokens(value: number): string {
  const digits = String(value)
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end))
  return groups.join(',')
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
      decorateMarkdownImages(div)
      enhanceCodeBlocks(div, key)
      decorateInlineCodes(div)
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
      attachCollapseFooter(det)
      return det
    }
    case 'retry':
      // 模型重试行（对齐官方 ModelRetryItem）：倒计时 + 失败原因 + 最大次数。
      return renderRetryRow(block, key)
    default:
      // tool 块由 Block 直接渲染 <ToolCard>（#43），命令式 renderBlock 不再处理；
      // 走到这里是防御兜底（BlockShell 只接 text/reasoning/retry）。
      return el('div')
  }
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

const treeTools: TreeTools = { t, iconSvg }

/**
 * 一段 JSON 输出渲染成 JsonTree（对齐 dsh web JsonTree：对象/数组逐节点展开、
 * 箭头点击 toggle、逐级缩进、暗色 token 配色）。
 *
 * #43：渲染已迁到 preact/json-tree.tsx 的 <JsonTree> 组件，节点展开集（旧
 * jsonTreeOpen）与复制反馈（旧 copyConfirmedAt）收进组件 useState —— 本函数只是
 * 给命令式调用方（markdown enhanceCodeBlocks / 整段正文恰为 JSON 的文本块）的薄
 * 适配：把组件 render 进一个宿主 div 返回。tool 卡的 OUT 树不经过这里，ToolCard
 * 直接以 vnode 形式渲染 <JsonTree>，组件实例保活、useState 跨流式重建存活（治 #29）。
 */
function renderJsonTree(value: JsonContainer, outputKey: string): HTMLElement {
  const host = el('div')
  renderPreact(h(JsonTree, { value, outputKey, tools: treeTools }), host)
  return host
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
  // 只清内存副本：落盘的那份由宿主在 pending 解除时 prune
  // （chatTab.pruneResolvedAnswerDrafts），webview 不必重复上报。
  for (const rpcId of [...answerDrafts.keys()]) {
    if (!live.has(rpcId)) answerDrafts.delete(rpcId)
  }
  const panel = el('div', 'pending-panel')
  for (const p of pending) {
    panel.appendChild(p.kind === 'approval' ? renderApprovalPanel(p) : renderQuestionPanel(p))
  }
  return panel
}

function renderApprovalPanel(p: PendingApproval): HTMLElement {
  const st = panelStateFor(p.rpcId)
  const panel = el('div', 'pending-block')
  panel.appendChild(panelHeader(p.rpcId, t('Permission request')))
  if (st.minimized) return panel
  const body = el('div', 'panel-body')
  body.appendChild(el('div', 'pending-title', p.toolName))
  if (p.reason) body.appendChild(el('div', 'pending-reason', p.reason))
  // 待执行命令（对齐官方 conversation.approval.detail → ApprovalCommand）：
  // 审批请求带 callId 时回查那次 tool call 的输入参数，把 command 原文显示
  // 出来——用户看得见要跑什么才谈得上「允许」（#50 I1）。窗口里找不到该调用
  // （被翻页切走 / 老协议无 callId）时静默不显示，与官方一致。
  const command = approvalCommandOf(p)
  if (command !== null) body.appendChild(el('div', 'pending-command', command))
  if (st.failure) body.appendChild(el('div', 'panel-feedback', st.failure))
  const actions = el('div', 'pending-actions')
  const allow = buttonEl('', t('Allow once'))
  const deny = buttonEl('secondary', t('Reject'))
  // Disable both on click so a slow host can't be answered twice. 宿主应答失败
  // 时回推 pendingFailed：面板重建、按钮复位、原因显示在反馈行，可直接重试。
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome })
  }
  allow.addEventListener('click', () => answer('allowed-once'))
  deny.addEventListener('click', () => answer('rejected'))
  actions.appendChild(allow)
  actions.appendChild(deny)
  body.appendChild(actions)
  panel.appendChild(body)
  return panel
}

/**
 * 审批请求关联的那次 tool call 的命令文本：审批带 callId 时在当前窗口的消息
 * 流里按 callId 找该 tool 块，从它的 args（原始 JSON）里取 `command`
 * （官方 ApprovalCommand：JSON.parse(argsRaw).command）。找不到返回 null。
 */
function approvalCommandOf(p: PendingApproval): string | null {
  const callId = p.callId
  if (!callId) return null
  for (const m of state?.messages ?? []) {
    if (m.kind !== 'assistant') continue
    for (const b of m.blocks) {
      if (b.type === 'tool' && b.callId === callId) return commandOfToolArgs(b.args)
    }
  }
  return null
}

/**
 * Pending 面板头部：标题 + 分页器（多题时）+ 最小化/取消按钮。最小化后
 * 只留这一行，正文隐藏（对齐 dsh web QuestionFlow 的 header 最小化）；取消
 * 以「用户取消」拒绝挂起请求，面板消失、对话继续（对齐官方 QuestionComposer
 * 的 nav.cancel → pending.cancel()，见 #50 I3）。计划审核面板两个按钮都不给
 * （官方 PlanReviewPanel 只有底部的讨论/拒绝/确认三个动作）。
 */
function panelHeader(
  rpcId: string,
  title: string,
  pager: HTMLElement | null = null,
  actions: { minimize?: boolean; cancel?: boolean } = {},
): HTMLElement {
  const st = panelStateFor(rpcId)
  const header = el('div', 'panel-header')
  header.appendChild(el('span', 'panel-title', title))
  if (pager) header.appendChild(pager)
  if (actions.minimize ?? true) {
    const toggle = buttonEl('panel-toggle', '')
    toggle.title = st.minimized ? t('Expand') : t('Minimize')
    toggle.setAttribute('aria-label', toggle.title)
    toggle.appendChild(iconSvg(PANEL_ICONS.chevronUp, 14))
    toggle.classList.toggle('minimized', st.minimized)
    toggle.addEventListener('click', () => {
      st.minimized = !st.minimized
      render()
    })
    header.appendChild(toggle)
  }
  if (actions.cancel ?? false) header.appendChild(panelCancelButton(rpcId))
  return header
}

/**
 * 面板取消按钮（×）：拒绝挂起的提问/计划审核（宿主侧 ASK_CANCELLED），面板
 * 随 pending 解除消失，用户回到普通输入（对齐官方 QuestionComposer 的
 * nav.cancel）。失败（请求其实已过期/别处已答）由 pendingFailed 回推，原因
 * 显示在面板反馈行，可再点一次。
 */
function panelCancelButton(rpcId: string): HTMLElement {
  const cancel = buttonEl('panel-toggle panel-cancel', '')
  cancel.title = t('Cancel')
  cancel.setAttribute('aria-label', t('Cancel'))
  cancel.appendChild(iconSvg(GOAL_ICONS.close, 14))
  cancel.addEventListener('click', () => {
    cancel.disabled = true
    post({ type: 'cancelPending', rpcId })
  })
  return cancel
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
    st.failure = ''
    render()
  })
  pager.appendChild(prev)
  pager.appendChild(el('span', 'pager-count', `${st.page + 1}/${n}`))
  const next = buttonEl('secondary pager-btn', '›')
  next.disabled = st.page >= n - 1
  next.addEventListener('click', () => {
    st.page = Math.min(n - 1, st.page + 1)
    st.notice = ''
    st.failure = ''
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
  // 草稿复用 answerDrafts 的 custom 字段：pending 内容变化面板重建时文本不丢
  // （保活帧下输入框本就不动，这里是重建路径的恢复源）。提交后随 answerDrafts
  // 清理，与 question 自定义输入同生命周期。
  const draft = draftFor(p.rpcId, index)
  input.value = draft.custom
  const send = buttonEl('', t('Submit'))
  const submit = (): void => {
    const text = input.value.trim()
    if (!text) return
    submitAnswer(p, { index, text })
  }
  input.addEventListener('input', () => {
    draft.custom = input.value
    scheduleAnswerDraftSave(p.rpcId)
  })
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
  /** 单选「其他」选项态：选中后其下方展开自定义输入框（不入 selected，避免
   *  提交伪造的「其他」label——单选 custom 非空时 selected 本就置空）。 */
  other: boolean
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
    v = { selected: new Set(), custom: '', other: false }
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
  clearAnswerDraft(p.rpcId)
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
  clearAnswerDraft(p.rpcId)
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
  // 头部：最小化 + 取消（×）。取消 = 拒绝本次提问，面板消失、对话继续
  // （官方 QuestionComposer 的 nav.cancel；#50 I3）。
  panel.appendChild(panelHeader(p.rpcId, t('Waiting for your answer'), questionPager(p), { cancel: true }))
  if (st.minimized) {
    panel.appendChild(renderPanelAnswer(p, page))
    return panel
  }
  const body = el('div', 'panel-body')
  // 反馈行：本地校验提示（请先完成本题）与宿主应答失败原因共用一处
  // （官方 QuestionComposer 的 feedback 单槽位）。
  const feedback = st.failure || st.notice
  if (feedback) body.appendChild(el('div', 'panel-feedback', feedback))
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
      st.failure = ''
      render()
      return
    }
    // 提交期置灰防重复应答；宿主失败时回推 pendingFailed，面板重建后按钮
    // 重新可用（#50 I2：过去置灰是永久的，只能换会话重开）。
    ok.disabled = true
    st.failure = ''
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
      st.failure = ''
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
    decorateMarkdownImages(body)
    enhanceCodeBlocks(body, `q:${p.rpcId}:${index}`)
    decorateInlineCodes(body)
    det.appendChild(body)
    attachCollapseFooter(det)
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
          scheduleAnswerDraftSave(p.rpcId)
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
          draft.other = false
          scheduleAnswerDraftSave(p.rpcId)
          // 保活态下 render() 不会重建面板，选中高亮与自定义输入框必须就地
          // 更新；无保活时下次快照重建也会按 draft 恢复同态。
          group.querySelectorAll('.option-btn').forEach((b) => b.classList.toggle('selected', b === btn))
          const customRow = wrap.querySelector<HTMLElement>('.question-custom')
          if (customRow) customRow.classList.add('hidden')
          const customInput = wrap.querySelector<HTMLInputElement>('.question-custom input')
          if (customInput) customInput.value = ''
          updateOkState()
        })
        group.appendChild(btn)
      }
      // 单选「其他」选项：选中后展开其下方的自定义输入框并聚焦；「其他」本身
      // 不进入 draft.selected（提交时 custom 非空即 selected 置空，编码不变）。
      const otherBtn = buttonEl('secondary option-btn', t('Other'))
      if (draft.other) otherBtn.classList.add('selected')
      otherBtn.addEventListener('click', () => {
        draft.selected.clear()
        draft.custom = ''
        draft.other = true
        scheduleAnswerDraftSave(p.rpcId)
        group.querySelectorAll('.option-btn').forEach((b) => b.classList.toggle('selected', b === otherBtn))
        const customRow = wrap.querySelector<HTMLElement>('.question-custom')
        if (customRow) customRow.classList.remove('hidden')
        const customInput = wrap.querySelector<HTMLInputElement>('.question-custom input')
        if (customInput) {
          customInput.value = ''
          customInput.focus()
        }
        updateOkState()
      })
      group.appendChild(otherBtn)
      wrap.appendChild(group)
    }
  }
  // Every question also takes a free-text "Other" answer, like the web UI.
  // 单选有选项时输入框跟随「其他」选项显隐（初始/点其他选项后隐藏）；多选与
  // 无选项问题常显（多选时 custom 伴随 selected，无选项时输入框即唯一作答方式）。
  const customRow = el('div', 'question-custom')
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = q.options?.length ? t('Other (custom answer)') : t('Type your answer')
  input.value = draft.custom
  if (!q.multiSelect && q.options?.length && !draft.other && draft.custom === '') {
    customRow.classList.add('hidden')
  }
  input.addEventListener('input', () => {
    draft.custom = input.value
    if (input.value && !q.multiSelect) draft.selected.clear()
    scheduleAnswerDraftSave(p.rpcId)
    updateOkState()
  })
  customRow.appendChild(input)
  wrap.appendChild(customRow)
  return wrap
}

/**
 * PlanReviewPanel：warn strip「计划待审」+ 计划 Markdown + 确认/拒绝/去聊天里说。
 * 头部不给最小化/取消（官方 PlanReviewPanel 只有底部三个动作）。
 */
function renderPlanReviewPanel(p: PendingQuestion): HTMLElement {
  const st = panelStateFor(p.rpcId)
  const q = p.questions[0]
  const panel = el('div', 'pending-block')
  panel.appendChild(panelHeader(p.rpcId, t('Plan review'), null, { minimize: false }))
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
    decorateMarkdownImages(plan)
    enhanceCodeBlocks(plan, `plan:${p.rpcId}`)
    decorateInlineCodes(plan)
    body.appendChild(plan)
  }
  if (st.failure) body.appendChild(el('div', 'panel-feedback', st.failure))
  // 三分结构：确认执行（approve 选项，主按钮）/ 拒绝（另一选项）/ 去聊天里说。
  const approve = q.intent?.approve
  const reject = q.options?.find((o) => o.label !== approve)?.label
  const actions = el('div', 'pending-actions plan-actions')
  const ok = buttonEl('option-btn', approve ?? t('Confirm and run'))
  ok.addEventListener('click', () => {
    ok.disabled = true
    st.failure = ''
    submitPlanReview(p, approve ? [approve] : [])
  })
  const no = buttonEl('secondary option-btn', reject ?? t('Reject'))
  no.addEventListener('click', () => {
    no.disabled = true
    st.failure = ''
    submitPlanReview(p, reject ? [reject] : [])
  })
  // 「去聊天里说」= 取消这个挂起的审核（不是把它当答案提交），面板收起、输入区
  // 交回普通 composer，用户说的是普通聊天消息（对齐官方 PlanReviewPanel 的
  // discuss → pending.cancel()；#50 I4）。
  const chat = buttonEl('secondary option-btn', t('Reply in chat'))
  chat.title = t('Cancel this review and reply in natural language in the input box')
  chat.addEventListener('click', () => {
    chat.disabled = true
    focusComposerAfterPending = true
    post({ type: 'cancelPending', rpcId: p.rpcId })
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
 *  图片文件（image 标记）：优先用 host 提供的 previewData 画缩略图；恢复/还原的
 *  附件没有 previewData 时走懒加载（requestFileThumb，同历史 chip 机制）——回执
 *  到达后换缩略图，文件已被系统清理则保持图标 chip。高亮只走 hover 联动。 */
function pendingFileChip(file: StagedFile, index: number): HTMLElement {
  const lazyUrl = fileThumbCache.get(file.path)
  if (file.image && (file.previewData || lazyUrl)) {
    const dataUrl = file.previewData && file.mediaType
      ? attachmentDataUrl(file.mediaType, file.previewData)
      : (lazyUrl ?? '')
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
  // 图片但暂时无预览：懒加载请求（宿主失败回执后标记失败态不再重试——保持图标）。
  if (file.image && !file.previewData) {
    requestFileThumbIfNeeded(file.path)
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

/* ------------------------------------------------------------------ *
 * 附件入站（粘贴 / 拖拽）：一条闸 + 一条落盘链路。
 * ------------------------------------------------------------------ */

/** composer 里已 staged 的图片张数与字节数（闸的「本条消息已有量」一侧）。 */
function stagedImageStats(): { count: number; bytes: number } {
  let count = 0
  let bytes = 0
  for (const f of pendingFiles) {
    if (!f.image) continue
    count += 1
    if (f.previewData) bytes += base64Bytes(f.previewData)
  }
  for (const img of pendingImages) {
    count += 1
    bytes += base64Bytes(img.data)
  }
  return { count, bytes }
}

/** 闸的拒绝原因 → 用户可读文案（对齐官方 image.tooMany / fileTooLarge / totalTooLarge）。 */
function imageIntakeNotice(rejection: ImageIntakeRejection): string {
  switch (rejection.reason) {
    case 'tooMany':
      return t('A message can include up to {0} images', rejection.max)
    case 'fileTooLarge':
      return t('Each image must be smaller than {0}', formatBytes(rejection.maxBytes))
    case 'totalTooLarge':
      return t('Images exceed {0} in total; remove some and try again', formatBytes(rejection.maxBytes))
  }
}

/** 入站批次里 0 字节且无类型的项（拖文件夹的典型形态，读不出内容也无从附加）。 */
function unreadableIntakeEntry(file: File): boolean {
  return file.size === 0 && file.type === ''
}

/**
 * 粘贴 / 拖拽文件统一入站：先过图片闸（张数 / 单张字节 / 本条总字节），
 * 再把每个文件读成 base64 交宿主落盘，宿主回投 `filesPicked` 后变成附件
 * chip。与官方 dsh web 的 `intakeImages` 同一判定顺序，但闸只拦图片
 * ——非图片文件在我们管线里落成 path chip，不进模型图像部分。
 */
function intakeAttachmentFiles(files: readonly File[]): void {
  const usable = files.filter((file) => !unreadableIntakeEntry(file))
  if (usable.length === 0) return
  const staged = stagedImageStats()
  const rejection = imageIntakeRejection(
    usable.map((file) => ({ name: file.name, mediaType: file.type, bytes: file.size })),
    staged.count,
    staged.bytes,
    state?.imageLimits,
  )
  if (rejection) {
    // 拒绝时不动 composer：已 staged 的附件保留，用户按提示自行删减后重试。
    commandNotices = [...commandNotices, imageIntakeNotice(rejection)]
    render()
    return
  }
  void (async () => {
    const outgoing: OutgoingImage[] = []
    for (const [i, file] of usable.entries()) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        const comma = dataUrl.indexOf(',')
        outgoing.push({
          mediaType: file.type,
          data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
          name: file.name || `pasted-${Date.now()}-${i + 1}`,
        })
      } catch {
        // Unreadable clipboard/dropped item: skip it, keep the rest.
      }
    }
    if (outgoing.length > 0) post({ type: 'filesPasted', files: outgoing })
  })()
}

/**
 * 附件拖拽入站（对齐官方 dsh-client-ui-attachment）：监听挂在 document 上
 * ——拖到面板任何位置都收，与输入框是否聚焦无关。认文件拖拽靠
 * `dataTransfer.types.includes('Files')`；纯文本拖拽不拦（不 preventDefault），
 * 交浏览器默认行为（拖进编辑器即插文本）。dragenter/dragleave 用深度计数，
 * 子元素间穿梭不会闪断遮罩；drop 必须 preventDefault，否则 Chromium 会把
 * 文件当导航打开。
 */
let dragDepth = 0
let dropOverlayEl: HTMLElement | null = null

function fileDragOf(event: DragEvent): DataTransfer | null {
  const dt = event.dataTransfer
  if (!dt || !Array.from(dt.types).includes('Files')) return null
  return dt
}

/** 拖拽可接收位：会话可发送且模型可用（与粘贴/选择同一条门控）。 */
function canAcceptDrop(): boolean {
  return state?.canSend === true && state?.modelAvailable !== false
}

function showDropOverlay(): void {
  const accepting = canAcceptDrop()
  if (!dropOverlayEl) {
    const overlay = el('div', 'drop-overlay')
    overlay.setAttribute('role', 'status')
    const box = el('div', 'drop-box')
    box.appendChild(el('div', 'drop-title', t('Drop files here to attach')))
    box.appendChild(el('div', 'drop-desc', ''))
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    dropOverlayEl = overlay
  }
  dropOverlayEl.classList.toggle('disabled', !accepting)
  const desc = dropOverlayEl.querySelector('.drop-desc')
  const limits = state?.imageLimits
  if (desc) {
    desc.textContent = accepting
      ? limits
        ? t('Up to {0} images, {1} each', limits.maxImagesPerMessage, formatBytes(limits.maxImageBytes))
        : ''
      : t('Service is not ready; cannot send right now')
  }
}

function hideDropOverlay(): void {
  dragDepth = 0
  dropOverlayEl?.remove()
  dropOverlayEl = null
}

document.addEventListener('dragenter', (event) => {
  if (!fileDragOf(event)) return
  event.preventDefault()
  dragDepth += 1
  showDropOverlay()
})
document.addEventListener('dragover', (event) => {
  const dt = fileDragOf(event)
  if (!dt) return
  event.preventDefault()
  dt.dropEffect = canAcceptDrop() ? 'copy' : 'none'
})
document.addEventListener('dragleave', (event) => {
  if (!fileDragOf(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) hideDropOverlay()
})
document.addEventListener('drop', (event) => {
  const dt = fileDragOf(event)
  if (!dt) return
  event.preventDefault()
  const files = Array.from(dt.files)
  hideDropOverlay()
  if (!canAcceptDrop()) return
  intakeAttachmentFiles(files)
  // 拖入后光标落到输入框：接上「拖完继续说」的手感（与粘贴一致）。
  activeComposer?.focus(true)
})
// 拖出窗口（未落点）时 dragleave 可能收不到：window 的 dragend 兜底复位。
window.addEventListener('dragend', hideDropOverlay)

/**
 * 把输入框内的光标/选区滚进可视区（对齐官方 dsh-client-ui-conversation 的
 * revealSelection）：草稿超过输入区限高（#input max-height 160px）后内部滚动，
 * 光标会被滚到看不见的位置——聚焦与「草稿从空变非空」时按选区 rect 校正输入框
 * 自身的 scrollTop。内层本来就滚不动（内容不超限高）时不动。
 */
function revealComposerCaret(root: HTMLElement): void {
  if (root.scrollHeight <= root.clientHeight) return
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return
  let rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.height === 0 && rect.width === 0) {
    // 空选区的 rect 可能全 0（折叠光标）：退回光标所在元素的 rect。
    const anchor = selection.anchorNode
    const node = anchor instanceof HTMLElement ? anchor : (anchor?.parentElement ?? null)
    if (node === null) return
    rect = node.getBoundingClientRect()
  }
  const box = root.getBoundingClientRect()
  if (rect.bottom > box.bottom) root.scrollTop += rect.bottom - box.bottom
  else if (rect.top < box.top) root.scrollTop -= box.top - rect.top
}

function renderInput(draft: string | undefined, hero = false): HTMLElement {
  const wrap = el('div', 'input-area')
  const canSend = !!state?.canSend

  if (pendingImages.length > 0 || pendingFiles.length > 0) {
    const chips = el('div', 'image-chips')
    pendingImages.forEach((img, i) => chips.appendChild(pendingImageThumb(img, i)))
    pendingFiles.forEach((file, i) => chips.appendChild(pendingFileChip(file, i)))
    // 附件 chip → 文本 @ 引用 的反向 hover（applyHover 的对称入口）。挂容器上
    // 用事件委托：chip 每次 render 都重建，逐个绑定会漏。
    chips.addEventListener('mouseover', (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-attach-path]')
      hoverAttachment(target?.dataset.attachPath ?? null)
    })
    chips.addEventListener('mouseleave', () => hoverAttachment(null))
    wrap.appendChild(chips)
  }

  const row = el('div', 'input-row')
  // 输入框外包 frame：@ 引用 token 由 Lexical 的 RefTokenNode 在真实文本流里高亮
  // （不再靠叠加层画点），hover token → 联动对应附件 chip 高亮。
  const frame = el('div', 'composer-frame')
  // 草稿合并（stashedDraft 优先在尾部追加），与旧 textarea 行为一致。占位符要
  // 按「这一帧输入框是不是空的」选文案，所以在算占位符之前先合。
  let draftContent = draft ?? ''
  if (stashedDraft) {
    draftContent = draftContent.trim() ? `${draftContent.trimEnd()}\n${stashedDraft}` : stashedDraft
    stashedDraft = undefined
  }
  // 模型不可用（routable=false）时输入区整体阻塞，文案对齐 dsh web 的
  // 「当前模型不可用，请先选择模型」；与「服务未就绪」是两个独立维度。
  const modelAvailable = state?.modelAvailable !== false
  const placeholderText = !canSend
    ? t('Service is not ready; cannot send right now')
    : !modelAvailable
      ? t('Current model is unavailable; choose a model first')
      : recall?.kind === 'queue'
        ? t('Editing queued message; Enter saves, Esc cancels')
        : steerQueueArmed() && draftContent.trim() === '' && pendingFiles.length === 0 && pendingImages.length === 0
          ? // 空草稿 + 运行中 + 有排队消息：这个手势此刻能把排队的一次插完（官方
            // placeholder.steerQueue），比「Enter 排队」那句更贴当前能做的事。
            steerModifierLabel(state?.hostOs) === 'Ctrl'
            ? t('Ctrl+Enter steers all queued messages')
            : t('⌘Enter steers all queued messages')
          : state?.running
          ? // 插话快捷键按宿主平台出文案：mac ⌘Enter，win/linux Ctrl+Enter
            // （hostOs 未知回退 ⌘ 版，与修复前一致）。Esc/Ctrl+C 在运行中是
            // 两层：composer 有内容先双击清空，空了再按才是打断 turn。
            steerModifierLabel(state?.hostOs) === 'Ctrl'
            ? t('Type a message; Enter queues, Ctrl+Enter steers now, ↑ edits the queued message, Esc clears input first, then interrupts')
            : t('Type a message; Enter queues, ⌘Enter steers now, ↑ edits the queued message, Esc clears input first, then interrupts')
          : hero
            ? t('Describe what you want to build')
            : t('Type a message; Enter sends, Shift+Enter for newline, paste images/files, ↑ recalls the previous one')
  const editable = canSend && modelAvailable

  // 主按钮（对齐官方 InputBar primary）：无文字图标按钮——非运行显示发送
  // 箭头，运行中同一按钮切换为停止方块（primaryStops），点击即 stop；排队
  // 发送走 Enter（官方同款交互，独立的「停止」文字按钮随之淘汰）。
  const running = !!state?.running
  const button = buttonEl('send-button', '')
  const buttonLabel = running ? t('Stop') : recall?.kind === 'queue' ? t('Save changes') : t('Send')
  button.title = buttonLabel
  button.setAttribute('aria-label', buttonLabel)
  button.appendChild(iconSvg(running ? STOP_PRIMARY_ICON : SEND_ICON, 16))

  // 一键清空（本地增强，官方 dsh web 无此按钮）：仅 composer 有内容（文本/
  // 附件任一非空）时显示，点击清空文本（含 recall 态与召回草稿）+ 全部待发附件。
  // 放在 input-row 内、发送按钮左侧——既不与附件 chip 自带 ×（chip 右上角）
  // 重叠，也不受 hero 大圆角卡片布局影响。
  const clearAll = buttonEl('clear-all-button', '×')
  clearAll.title = t('Clear input')
  clearAll.setAttribute('aria-label', t('Clear input'))

  let composer: ComposerEditor

  const updateButton = (): void => {
    if (running) {
      // 运行中主按钮=停止，stop 无前置条件（官方 disabled: stop === void 0）。
      button.disabled = false
      return
    }
    button.disabled =
      !canSend ||
      !modelAvailable ||
      (composer.getText().trim().length === 0 && pendingImages.length === 0 && pendingFiles.length === 0)
  }
  const updateClearAll = (): void => {
    clearAll.hidden = !(composer.getText().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0)
  }

  /**
   * hover 联动（**双向**，B-17）：文本里的 @ 引用 ↔ 附件 chip 互相点亮。
   *  - 文本侧两个形态都算引用：落定的原子 chip（`.ref-chip[data-ref]` 存 canonical）
   *    与着色文本（`.ref-token[data-path]`，有绑定存 canonical、手打的存显示 token）。
   *  - 附件侧是 `.input-area [data-attach-path]`（文件 chip 与图片缩略图）。
   *  - 两侧一律归一到「纯路径」再比：剥掉 `@`/引号，显示 token 经 mentionBindings
   *    反查 canonical——不然手打的 `@img1.png` 永远对不上 `/abs/img1.png` 那张 chip。
   *  - 反向入口是附件 chip 的 mousemove（见 hoverAttachment）。
   *  - 粘贴进来的裸图片没有路径（只有字节），没有可对上的引用，天然不参与。
   */
  let hoverTokenMention: string | null = null
  const plainPath = (p: string): string => p.replace(/^@/, '').replace(/^"|"$/g, '')
  /** 文本侧节点的 data 属性值 → 纯路径（先反查绑定，再归一化）。 */
  const plainOfTokenAttr = (raw: string): string => plainPath(mentionBindings.get(raw) ?? raw)
  const applyHover = (mention: string | null): void => {
    if (mention === hoverTokenMention) return
    hoverTokenMention = mention
    const plain = mention === null ? null : plainOfTokenAttr(mention)
    for (const span of Array.from(frame.querySelectorAll<HTMLElement>('.ref-token'))) {
      span.classList.toggle('active', plain !== null && plainOfTokenAttr(span.dataset.path ?? '') === plain)
    }
    for (const chip of Array.from(frame.querySelectorAll<HTMLElement>('.ref-chip[data-ref]'))) {
      chip.classList.toggle('active', plain !== null && plainOfTokenAttr(chip.dataset.ref ?? '') === plain)
    }
    // hover 用独立 class（hovered），不碰点击选中态的 referenced；查询收窄到
    // composer 输入区（避免点亮历史消息里同路径的附件 chip）。
    for (const chip of Array.from(document.querySelectorAll<HTMLElement>('.input-area [data-attach-path]'))) {
      chip.classList.toggle('hovered', plain !== null && chip.dataset.attachPath === plain)
    }
  }

  /** 附件 chip → 文本 @ 引用（applyHover 的反向入口）：按路径找同路径的引用节点。 */
  const hoverAttachment = (path: string | null): void => {
    let matched: string | null = null
    if (path !== null) {
      for (const span of Array.from(frame.querySelectorAll<HTMLElement>('.ref-token'))) {
        if (plainOfTokenAttr(span.dataset.path ?? '') === path) {
          matched = span.dataset.path ?? null
          break
        }
      }
      if (matched === null) {
        for (const chip of Array.from(frame.querySelectorAll<HTMLElement>('.ref-chip[data-ref]'))) {
          if (plainOfTokenAttr(chip.dataset.ref ?? '') === path) {
            matched = chip.dataset.ref ?? null
            break
          }
        }
      }
    }
    applyHover(matched)
  }

  const sendCurrent = (steer = false): void => {
    if (!state || !state.canSend || state.modelAvailable === false) return
    hideSlashPopup()
    // 双击清空：发送即「内容有了归宿」，武装态不再保留（提示小框一并摘除）。
    disarmClearConfirm()
    // 空草稿的加速 Enter（⌘/Ctrl+Enter）= 「把排队的消息全部插话」（官方
    // canSteerQueue + steerQueue）：没有内容可发，但队列里有等待的排队消息时，
    // 这个手势一次把它们都推进当前回合，不必逐行点「插话」。
    if (steer && canSteerQueue()) {
      post({ type: 'queueSteerAll' })
      return
    }
    // 发送后的输入区就地收尾：keepComposer 保活（签名未变的帧——运行中 Enter
    // 排队、⌘Enter 插话、/model 打开菜单）时 render() 只 patch 不重建输入区，
    // 这里在 setText('') 后同步按钮态。
    const syncAfterClear = (): void => {
      if (composer.root.isConnected) updateButton()
    }
    // 清空 + 重建输入区。Enter 走的是 Lexical 的 KEY_ENTER_COMMAND，命令上下文里
    // setText 的更新不会立刻落地——紧跟的 render() 读到的是清空前的文本，重建出来
    // 的 composer 就会把已经发出去的内容留在输入框（发送带附件时必现：附件清空
    // 触发重建）。这里在重建后补清一次：这次 setText 落在新编辑器上，排队落地也
    // 落在同一个（还在 DOM 里的）编辑器上。
    const clearAndRender = (): void => {
      composer.setText('')
      render()
      const live = composer.root.isConnected ? composer : activeComposer
      if (live && live !== composer) live.setText('')
    }
    // Staged file chips travel as `@path` reference lines appended to the prompt
    // text (dsh's PromptContentPart has no file part); both dsh-one and the
    // official web front-end render such a token as a file chip. 旧的私有
    // `<attachment>` 行官方前端不认、会显示成裸文本（B-18），解析侧仍兼容它。
    //
    // 引用展开走**节点级**投影（composer.textWithMentions）：补全落定的 chip /
    // 召唤还原的 ref-token 出 canonical mention；手打的 `@img1.png` 是普通文本
    // 节点，原样发出。原来的文本级 expandMentionBindings 只看字符串，会把
    // 「碰巧和某个历史绑定同名的手打 token」也改写成那条长路径（B-16）。
    const text = [composer.textWithMentions().trim(), ...pendingFiles.map((f) => fileAttachmentLine(f.path))]
      .filter(Boolean)
      .join('\n')
    if (!text && pendingImages.length === 0) return
    const expanded = text
    // `/model` is a client-side command (dsh-client-ui-model-selection): the
    // host has no such command, so open the model menu instead of sending.
    if (text === '/model' && !recall) {
      clearAndRender()
      syncAfterClear()
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
      clearAndRender()
      return
    }
    recall = null
    recallDraft = ''
    const images = pendingImages
    const files = pendingFiles
    pendingImages = []
    pendingFiles = []
    // 本地乐观占位（#52 S1）：先落占位再发，宿主回流前界面就有反应。
    addPendingEcho({
      sessionId: state?.sessionId ?? null,
      text: expanded,
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
      placement: steer ? 'steering' : state?.running ? 'queued' : 'turn',
    })
    post({
      type: 'send',
      text: expanded,
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(steer ? { steer } : {}),
    })
    clearAndRender()
    syncAfterClear()
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

  /** ArrowUp on the first line with no selection recalls：有等待插话的 steering
   *  气泡时首选撤销它（↑ 第一个可回退编辑的就是它——宿主移除该项并把内容
   *  含附件回填 composer）；否则召回排队消息（改回后 Enter 保存），再否则
   *  召回最后一条真正的用户消息重新发送。进行中的 recall 保持箭头移光标。 */
  const recallOnArrowUp = (): boolean => {
    if (!state?.canSend) return false
    const sel = composer.selection()
    if (sel.start !== sel.end) return false
    if (composer.getText().slice(0, sel.start).includes('\n')) return false
    const lastSteer = [...(state.queue ?? [])].reverse().find((q) => q.placement === 'steering')
    if (lastSteer) {
      // 撤销即最终动作（消息从 inbox 移除），不进 recall 状态、无 Esc 取消。
      post({ type: 'unsteer', itemId: lastSteer.id })
      return true
    }
    const lastQueued = [...(state.queue ?? [])].reverse().find((q) => q.placement === 'queued')
    const lastUser = lastQueued
      ? null
      : [...state.messages].reverse().find((m) => m.kind === 'user' && !m.context && m.text.trim())
    if (!lastQueued && !lastUser) return false
    // 召回以编程方式改写 composer（不经输入事件触发渲染）：作废清空暂存并解除
    // 双击清空武装，与手动输入同款边界。
    clearedStash = null
    disarmClearConfirm()
    recallDraft = composer.getText()
    if (lastQueued) {
      recall = { kind: 'queue', itemId: lastQueued.id }
      // 排队项往返自洽：拆附件行 → chips，canonical @长路径/@[标签](uri) 还原为
      // 显示 token（回写时重拼附件行并 expand 展开回 canonical）。
      const { text: queueText, files: queueFiles } = splitAttachmentLines(lastQueued.editText)
      composer.setText(restoreRecallMentions(queueText), mentionBindings)
      const existingQ = new Set(pendingFiles.map((f) => f.path))
      const restoredQFiles = queueFiles.filter((f) => !existingQ.has(f.path))
      if (restoredQFiles.length > 0) pendingFiles = [...pendingFiles, ...restoredQFiles]
    } else if (lastUser && lastUser.kind === 'user') {
      recall = { kind: 'history' }
      // 历史里存的是 canonical @长路径（发送时展开的结果）；还原成显示 token，
      // 与第一次输入时的形态一致（会话标签同样还原成 @标签）。
      composer.setText(restoreRecallMentions(lastUser.text), mentionBindings)
      // 原附件一并恢复（文件形式后可直接再编辑重发）：按 path 去重，
      // 图片带 image 标记（缩略图需磁盘数据，恢复为图标 chip 可接受）。
      const existing = new Set(pendingFiles.map((f) => f.path))
      const restoredFiles = (lastUser.files ?? [])
        .filter((f) => !existing.has(f.path))
        .map((f) => ({ name: f.name, path: f.path, ...(f.image ? { image: true } : {}) }))
      if (restoredFiles.length > 0) pendingFiles = [...pendingFiles, ...restoredFiles]
      // 历史消息的粘贴图（attachmentId 引用）重拉字节 staging 进 composer。
      stageRecallImages(lastUser.images)
    }
    render()
    return true
  }

  /** Esc：召回态取消（回到 recallDraft）；否则返回 false 交回 clear-chord/原生。 */
  const escapeInComposer = (): boolean => {
    if (recall) {
      recall = null
      composer.setText(recallDraft, mentionBindings)
      recallDraft = ''
      render()
      return true
    }
    return false
  }

  // 清空动作（× 按钮点击与「双击 Ctrl+C/ESC」共用）：清空文本（含 recall 态与
  // 召回草稿）+ 全部待发附件，清空前暂存进 clearedStash 供 Ctrl+Z 反悔。
  const clearComposer = (): void => {
    // 整个清空动作（含随后的 render 重建 composer）都算「程序化」：新编辑器的
    // 首帧 onTextChange('') 同样不该把刚存下的暂存抹掉（B-06）。清空暂存的语义
    // 是「这一下清掉的内容可反悔」，只有用户真的又输入了才作废。
    clearingComposer = true
    try {
      const text = composer.getText()
      clearedStash =
        text.length > 0 || pendingImages.length > 0 || pendingFiles.length > 0
          ? { text, images: pendingImages, files: pendingFiles }
          : null
      composer.setText('')
      recall = null
      recallDraft = ''
      pendingImages = []
      pendingFiles = []
      disarmClearConfirm()
      // 保活态（如 model 菜单开着）下 render() 不重建 composer：旧 × 就地隐藏，
      // 重建态则由新渲染的按钮自然带出正确可见性。
      updateClearAll()
      render()
      // render() 重建了 composer（新编辑器），焦点回到 live 输入框（光标默认在末尾）；
      // 保活态下 composer 未被重建，仍用当前 live。
      const live = composer.root.isConnected ? composer : activeComposer
      live?.focus(true)
      // keepComposer 保活时 render() 只 patch 不动输入区：清空后发送按钮态就地更新。
      if (composer.root.isConnected) updateButton()
    } finally {
      clearingComposer = false
    }
  }

  // 清空反悔恢复：附件在 composer 签名里（pendingImages/pendingFiles），恢复后
  // 由 render() 带出 chips，文本经 stashedDraft 交给这一帧的输入区渲染。
  //
  // 文本不在这里 composer.setText：撤销是从 Lexical 的 UNDO_COMMAND 命令里进来
  // 的，命令上下文里发起的 editor.update 不会立刻落地（实测 setText 返回时编辑器
  // 仍是空的），紧跟的 render() 会读到空文本、把重建出来的 composer 也建成空的
  // ——带附件的清空反悔恢复就会只回来附件、文本丢失。走 stashedDraft 由渲染直接
  // 喂给新编辑器，不依赖 update 的落地时机（stashedDraft 非 undefined 时
  // keepComposer 恒 false，本帧必定重建，不会把暂存漏给后面的帧）。
  const restoreCleared = (): void => {
    const stash = clearedStash
    if (!stash) return
    clearedStash = null
    disarmClearConfirm()
    pendingImages = stash.images
    pendingFiles = stash.files
    stashedDraft = stash.text || undefined
    render()
    const live = composer.root.isConnected ? composer : activeComposer
    if (!live) return
    live.focus(true)
    updateButton()
  }

  /** Cmd/Ctrl+Z：空 composer 且有待恢复时恢复清空内容（本地增强）；让位原生撤销。 */
  const undoRestore = (): boolean => {
    if (
      clearedStash !== null &&
      composer.getText() === '' &&
      pendingImages.length === 0 &&
      pendingFiles.length === 0
    ) {
      restoreCleared()
      return true
    }
    return false
  }

  // paste：文件与文本**都要处理**（官方 registerComposerKeymap 的 PASTE_COMMAND）：
  // 剪贴板同时含文件与文本时（从 Finder/资源管理器复制一个文件、或编辑器里
  // 复制一段带图的富文本），原来是「有文件就只收文件」，文本被静默丢掉（B-15）。
  // 所以：先把 file 项同步取出来（clipboardData 只在事件里有效），再走文本
  // 三条分支（会话 mention / 长文本折叠 / 默认插入）。
  const onPaste = (event: ClipboardEvent): boolean => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return false
    // Every clipboard file becomes an attachment, images or not — the host
    // sniffs the bytes, so a missing declared type (macOS file promises) is fine.
    const items = Array.from(clipboardData.items ?? []).filter((item) => item.kind === 'file')
    const text = clipboardData.getData('text/plain') ?? ''
    if (items.length === 0 && text === '') return false
    event.preventDefault()
    if (items.length > 0) {
      // getAsFile() 必须同步调（异步回调里 clipboardData 已失效）。macOS file
      // promise 的 File.type 可能为空，退回落剪贴板项声明的 MIME——入站闸按
      // type 判图片，缺了会把图片当普通文件放行。文件统一交给
      // intakeAttachmentFiles：图片过闸（张数 / 单张字节 / 本条总字节），
      // 非图片文件不受图片闸管，照旧落成文件附件。
      const files = items
        .map((item) => ({ file: item.getAsFile(), type: item.type }))
        .filter((p): p is { file: File; type: string } => p.file !== null)
        .map(({ file, type }) => (file.type === '' && type !== '' ? new File([file], file.name, { type }) : file))
      intakeAttachmentFiles(files)
    }
    if (text === '') return true
    // 会话 mention 粘贴优先（canonical 转显示 token）；长文本折叠为文件附件；
    // 都未命中时原文插到光标处（与 registerPlainText 的默认插入同义）。
    if (pasteSessionMentions(composer, text)) return true
    if (foldLongTextPaste(event, text)) return true
    const { start, end } = composer.selection()
    composer.replaceRange(start, end, text)
    return true
  }

  // 本帧新建的编辑器实例（handler 在 createComposerEditor 返回前就要引用它，
  // 用局部引用而不是模块级 composer：保活/重建期间模块级变量可能已指向新实例）。
  let editorRef: ComposerEditor | null = null
  /** 上一帧输入框是否已有内容（空 → 非空那一帧把光标露出，官方 revealSelection 同款）。 */
  let hadText = false
  composer = createComposerEditor({
    handlers: {
      onTextChange: (text, meta) => {
        updateButton()
        updateClearAll()
        // claim 撤销：草稿不再以 token 开头（整段删掉/改成别的命令）即释放，
        // 占位符回落到常规文案。在 token 后继续打参数则保持不变。
        if (slashClaim !== null && !slashClaimHolds(text, slashClaim.token)) releaseSlashClaim()
        else syncSlashClaimPlaceholder()
        updateSlashPopup(composer)
        // 双击清空：任何内容变化都解除武装（提示小框只对「刚武装时的那份内容」
        // 有意义；清空/召回/恢复这些程序化重写各自也会显式解除，这里是兜底）；
        // 清空暂存则只被真实的用户输入作废——clearComposer 的 setText('') 会在它
        // 自己设置的暂存之后同步触发本回调，一并作废的话 Ctrl+Z 反悔就成了永远
        // 走不到的死代码。
        disarmClearConfirm()
        if (!clearingComposer) clearedStash = null
        // 输入框重新空下来：排队中的失败回填稿这时才落地（B-21）。
        if (!clearingComposer && text.trim().length === 0) flushFailedDrafts()
        // 纯输入不触发 render，脏位上报单独跟一次（宿主的 dirty 保护决策读它）。
        reportComposerDirty()
        // 草稿落盘同款（不经 render 的输入事件独立挂钩，#14）。
        scheduleDraftSave()
        // 草稿从空变非空：草稿超过输入区限高时把光标带进可视区（官方
        // useEffect(..., [draft !== ""]) → revealSelection；#50 R7）。
        if (text !== '' && !hadText && editorRef !== null) revealComposerCaret(editorRef.root)
        hadText = text !== ''
      },
      onSelectionChange: () => updateSlashPopup(composer),
      onEnter: (steer) => {
        sendCurrent(steer)
        return true
      },
      onArrowUp: () => recallOnArrowUp(),
      onEscape: () => escapeInComposer(),
      onUndoRestore: () => undoRestore(),
      onPaste: (event) => onPaste(event),
      onTokenHover: (mention) => applyHover(mention),
    },
    placeholderText,
    editable,
    bindings: mentionBindings,
    atTokenNames: composerAtTokenNames,
    slashTokenNames: composerSlashTokenNames,
  })
  editorRef = composer
  composer.root.id = 'input'
  // 聚焦时把光标露出可视区（官方 editor.focus(() => revealSelection())）。
  composer.root.addEventListener('focus', () => revealComposerCaret(composer.root))
  // 滚轮停在输入框上、输入框内部已到顶/底时把这次滚动转给消息流（官方
  // onWheel：内部还能滚就自己滚，到边界才 preventDefault + 转发；#50 R7）。
  composer.root.addEventListener(
    'wheel',
    (e) => {
      const messages = document.getElementById('messages')
      if (messages === null) return
      const delta = forwardedWheelDelta(
        e.deltaY,
        composer.root.scrollTop,
        composer.root.clientHeight,
        composer.root.scrollHeight,
      )
      if (delta === null) return
      e.preventDefault()
      // 直接写外层 scrollTop（不经 writeMessagesScrollTop）：位移比对会把它
      // 当成用户滚动，跟随态与「回到最新」浮标随之重估，与真人滚轮同效。
      messages.scrollTop += delta
    },
    { passive: false },
  )
  // .value/selectionStart/selectionEnd/setSelectionRange 存取 shim：让 harness/场景
  // 与残留的 textarea 式读法能继续以编程方式读写编辑器（写走 setText 重建 @token 节点，
  // 读走 getText/selection，与旧 textarea 的块间 \n 语义一致）。无生产副作用。
  Object.defineProperties(composer.root, {
    value: {
      get: () => composer.getText(),
      set: (v: string) => composer.setText(String(v ?? '')),
      configurable: true,
    },
    selectionStart: { get: () => composer.selection().start, configurable: true },
    selectionEnd: { get: () => composer.selection().end, configurable: true },
  })
  ;(composer.root as unknown as { setSelectionRange: (start: number, end?: number) => void }).setSelectionRange = (start: number, end?: number) => composer.setSelection(start, end)
  frame.appendChild(composer.root)
  frame.appendChild(composer.placeholder)
  row.appendChild(frame)
  const previous = activeComposer
  activeComposer = composer
  if (previous && previous !== composer) previous.dispose()
  if (draftContent) composer.setText(draftContent, mentionBindings)
  // 重建后的占位符层是新的：claim 还成立时把参数提示重新压上（overrides 不跨实例）。
  syncSlashClaimPlaceholder()

  // 双击清空（本地增强，与 × 按钮同一 clearComposer）：composer 有内容时第一次
  // Esc/Ctrl+C 亮提示小框并武装，第二次执行清空。运行中同样先走这层「清输入」。
  // 优先级低于斜杠补全/召回（编辑器内已路由到 onEscape/onArrowUp）。Ctrl+C 有
  // 选区时保持复制语义；IME 组合中不响应。斜杠补全弹出时导航键交给编辑器（其
  // 命令在 keydown 里消费），这里只处理 clear-chord。
  // 空格认领（官方 matchSpace）：行首刚打完的 `/name` 一按空格、且这条命令取参，
  // 就进参数模式——空格本身照常插入，文本结果与直接敲空格一样（`/name `）。
  composer.root.addEventListener('keydown', (e) => {
    if (
      e.key === ' ' &&
      !e.isComposing &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      slashClaim === null &&
      !e.defaultPrevented
    ) {
      const bare = /^\/([^\s/]+)$/.exec(composer.getText())
      const sel = composer.selection()
      if (
        bare &&
        sel.start === sel.end &&
        sel.start === composer.getText().length &&
        claimableSlashCommand(slashCommands().find((c) => c.name === bare[1]))
      ) {
        // token 自带尾随空格，这一次空格键吃掉即可（官方 matchSpace 也是
        // 返回 true 让调用方 preventDefault），否则会多出一个空格。
        e.preventDefault()
        claimSlashCommand(bare[1])
        return
      }
    }
    const isClearChord = e.key === 'Escape' || isComposerClearChord(e)
    if (
      isClearChord &&
      !e.defaultPrevented &&
      !e.isComposing &&
      (e.key === 'Escape' || composer.selection().start === composer.selection().end)
    ) {
      if (composer.getText().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0) {
        e.preventDefault()
        if (clearConfirmArmed) {
          clearComposer()
        } else {
          // 锚定整个输入区（含附件 chips 行）：提示小框浮在 chips 上方，不遮内容。
          armClearConfirm(frame.closest('.input-area') ?? frame)
        }
        return
      }
      // 武装期间内容已被清空/发送：残留的武装态就地解除。Esc/无选区 Ctrl+C 在
      // 空 composer 下不 preventDefault，落回 document 级（运行态=停止 turn，
      // 空闲态那里直接返回）。
      disarmClearConfirm()
    }
  })
  // Slash 补全弹出时导航键（↑↓/Tab/Enter/Esc）优先于编辑器的 Enter 发送/↑ 召回/
  // Esc 取消——capture 阶段拦截并 stopPropagation，宿主到编辑器的命令不触发。
  // 与旧 textarea keydown 的「popup owns these keys」分支行为一致。
  composer.root.addEventListener(
    'keydown',
    (e) => {
      if (!slashPopupEl || composer.blockedByComposition(e)) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        moveSlashSelection(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        moveSlashSelection(-1)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        // Tab 的 drill 语义（官方 arbitrate('tab')）：高亮项可下钻就下钻
        // （目录进一层、菜单不关），否则与 Enter 同义落定。
        const row = slashRows[slashIndex]
        if (row?.drill) {
          row.drill(composer)
          return
        }
        row?.apply?.(composer)
        return
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        e.stopPropagation()
        hideSlashPopup()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const apply = slashRows[slashIndex]?.apply
        if (apply) {
          e.preventDefault()
          e.stopPropagation()
          apply(composer)
          return
        }
        // Hint-only popup: Enter falls through and sends the line as-is.
      }
    },
    true,
  )
  composer.root.addEventListener('blur', () => {
    hideSlashPopup()
    applyHover(null)
    // 焦点离开输入框（点别处/切面板）即解除双击清空武装：提示小框是给
    // 「正在输入框里操作」的人看的，焦点没了再按第二次也没有上下文。
    disarmClearConfirm()
  })
  updateButton()
  updateClearAll()
  clearAll.addEventListener('click', () => {
    clearComposer()
  })
  row.appendChild(clearAll)
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
  // 目录还在途时显示「正在加载模型…」（对齐官方 trigger.loading），不冒充
  // 「选择模型」——宿主打开会话后一帧内就切真名，闪烁感来自那个假文案。
  const model = buttonEl(
    'pill',
    state?.modelLabel ?? (state?.modelStatus === 'loading' ? t('Loading models…') : t('Select model')),
  )
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

