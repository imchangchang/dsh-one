/**
 * Chat webview 前端跨域共享状态（拆分自 webview.ts）：被多个域模块读取的
 * 状态集中在这里。采用 ESM live binding（export let + setter）：读取方直接
 * `import { state }` 读当前值，赋值方（webview.ts 消息接收 / 各域模块内部）
 * 通过配套 setter 写。esbuild 打包成单 bundle，模块间无循环依赖。
 *
 * 拆分动机（multi-tab 重构第二层）：webview.ts 原本 3695+ 行单文件，任何
 * 前端新功能（渲染块、弹层、补全）都往里面塞。按域拆出后，新功能落在
 * 对应域文件，不再堆进入口文件。
 */
import type {
  ChatState,
  ModelCatalog,
  OutgoingImage,
  SessionsSnapshot,
  StagedFile,
} from '../../pure/chatContract.ts'
import type { WorkflowDisclosureState } from '../../pure/workflowRun.ts'

/** 问题作答草稿（webview.ts 输入区渲染与 webviewState 共享）。 */
export interface QuestionDraft {
  /** 已选的选项 label（多选/单选共用，交互在 webview.ts 输入区）。 */
  selected: Set<string>
  /** 自由文本补充回答（选项外的自定义输入）。 */
  custom: string
}

/** 最新 ChatState 快照；null = 尚未收到（宿主 ready 重推前的空窗）。 */
export let state: ChatState | null = null
export function setState(next: ChatState | null): void {
  state = next
}

/** 最新 sessions 快照；null = 尚未收到。仅作 @ 提及补全的数据源。 */
export let sessionsSnapshot: SessionsSnapshot | null = null
export function setSessionsSnapshot(next: SessionsSnapshot | null): void {
  sessionsSnapshot = next
}

/** Images staged in the composer, sent with the next `send`. */
export let pendingImages: OutgoingImage[] = []
export function setPendingImages(v: OutgoingImage[]): void {
  pendingImages = v
}
/** Non-image files staged as chips; their paths join the prompt text on send. */
export let pendingFiles: StagedFile[] = []
export function setPendingFiles(v: StagedFile[]): void {
  pendingFiles = v
}
/** Session the staged images belong to; a switch drops them. */
export let stagedForSession: string | null = null
export function setStagedForSession(v: string | null): void {
  stagedForSession = v
}
/** Latest model catalog reply; dropped on session switch, refetched on menu open. */
export let modelCatalog: ModelCatalog | null = null
export function setModelCatalog(v: ModelCatalog | null): void {
  modelCatalog = v
}
/** Body of the open model menu awaiting the catalog reply (menus 模块设置、主文件收到 catalog 后刷新)。 */
export let modelMenuBody: HTMLElement | null = null
export function setModelMenuBody(v: HTMLElement | null): void {
  modelMenuBody = v
}
/** Attachment id → data URL, filled by attachmentData replies; lives for the webview's lifetime. */
export const attachmentCache = new Map<string, string>()
/** Attachment ids already requested, so re-renders don't repost while a fetch is in flight. */
export const attachmentRequested = new Set<string>()
/** Half-answered pending questions: rpcId → question index → draft. */
export const answerDrafts = new Map<string, Map<number, QuestionDraft>>()

/** Attachment id whose bytes are being fetched to open a preview on arrival. */
export let pendingPreview: string | null = null
export function setPendingPreview(v: string | null): void {
  pendingPreview = v
}
/** Queue item currently being edited inline, null when none. */
export let editingQueueItem: string | null = null
export function setEditingQueueItem(v: string | null): void {
  editingQueueItem = v
}
/**
 * Composer recall mode entered by ArrowUp: 'queue' loads the last queued
 * message into the composer and send saves it back; 'history' recalls the
 * last genuine user message and send re-sends it as a new prompt.
 */
export let recall: { kind: 'queue'; itemId: string } | { kind: 'history' } | null = null
export function setRecall(v: typeof recall): void {
  recall = v
}
/** Draft stashed when a recall replaced it; restored by Escape. */
export let recallDraft = ''
export function setRecallDraft(v: string): void {
  recallDraft = v
}
/** Unsaved queue-editor text by item id; survives the rebuild-per-snapshot rendering. */
export const queueEditDrafts = new Map<string, string>()
/** Composer draft arriving while no input element exists yet (restoreDraft before first render). */
export let stashedDraft: string | undefined
export function setStashedDraft(v: string | undefined): void {
  stashedDraft = v
}
/** Slash-command receipt texts shown at the message tail; cleared on session switch. */
export let commandNotices: string[] = []
export function setCommandNotices(v: string[]): void {
  commandNotices = v
}

/** 块级展开态（details 元素）：key 按消息/块位置，换会话清空（detailsSession）。 */
export const detailsOpen = new Map<string, boolean>()
export let detailsSession: string | null = null
export function setDetailsSession(v: string | null): void {
  detailsSession = v
}
/** JsonTree 展开态：key 按输出位置（与 detailsOpen 同生命周期约定）。 */
export const jsonTreeOpen = new Map<string, boolean>()
/** workflow 运行卡片的展开/自动折叠状态机（见 src/pure/workflowRun.ts）。 */
export const workflowDisclosure = new Map<string, WorkflowDisclosureState>()
/** Turn-status 计时（run 显示耗时）；消息流重建时重置。 */
export let turnStatusStart: number | null = null
export function setTurnStatusStart(v: number | null): void {
  turnStatusStart = v
}
export let turnStatusTimer: ReturnType<typeof setInterval> | null = null
export function setTurnStatusTimer(v: ReturnType<typeof setInterval> | null): void {
  turnStatusTimer = v
}

/** Slash 补全行（webviewSlash.ts 使用；接口定义在这里避免循环 import）。 */
export interface SlashRow {
  label: string
  right?: string
  /** Complete the line; absent on pure hint rows. */
  apply?: (input: HTMLTextAreaElement) => void
  /** 分组小标题行（不可选、无 hover），行间带分割线，如 @ 补全的「文件」「会话」。 */
  header?: true
}
