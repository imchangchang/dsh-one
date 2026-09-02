/**
 * 单个会话 tab 的宿主（`dshOne.chatPanel` 一个 editor tab = 一个实例）：
 * 内聚这个 tab 的全部 per-tab 职责——WebviewPanel 生命周期、会话 controller
 * 的附着/释放与订阅、标题同步、pending 交互兜底、右键暂存附件队列，以及
 * 来自本 tab webview 的消息处理（按域拆到 handler，见 chatMessages.ts）。
 *
 * 设计动机（multi-tab 重构第二层）：ChatViewProvider 原本是单类上帝——tab
 * 集合管理、消息路由、状态合成、附件、命令全在里面，任何新功能都往同一个
 * 类的同一批方法（onMessage/composeHeader/attach）里加，两个并行开发任务
 * 必然撞车（main 的功能增量与多 tab 重构在同一文件冲突）。把 per-tab 行为
 * 下沉到这个类后：新功能如果是 per-tab 的（workspace 懒切换、goal 条幅、
 * plan chip 这类几乎全是），改动落在本类或其 handler 文件里，不再碰
 * ChatViewProvider 的集合逻辑。
 */
import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Logger } from '../log.ts'
import type { ServerManager } from '../server/manager.ts'
import { ChatSessionController } from '../server/chatSession.ts'
import type {
  ChatState,
  FromWebviewMessage,
  OutgoingImage,
  StagedFile,
  ToWebviewMessage,
} from '../pure/chatContract.ts'
import type { SessionsStore } from './sessionsStore.ts'
import { JobsStore } from './jobsStore.ts'
import type { SubagentCatalogStore } from './subagentsStore.ts'
import { chatHtml } from './chatViewHtml.ts'
import { chatMessageHandlers } from './chatMessages.ts'

/** Media type by file extension (dsh ImageMediaType: png/jpeg/webp/gif). */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Magic-byte sniffing for the four raster formats dsh accepts. Clipboard
 * file-promises often carry no declared MIME type, so the bytes are the only
 * reliable source (dsh itself verifies stored bytes the same way).
 */
function sniffImageMediaType(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return undefined
}

/** 宿主（ChatViewProvider）注入的集合级能力——per-tab 逻辑需要但不属于 tab。 */
export interface ChatTabHostActions {
  manager: ServerManager
  logger: Logger
  extensionUri: vscode.Uri
  store: SessionsStore
  jobs: JobsStore
  subagents: SubagentCatalogStore
  /** 打开一个会话（默认在当前活动 chat tab 打开；见 ChatViewProvider.openSession）。 */
  openSession(sessionId: string): void
  /** 显式在新 tab 中打开一个会话。 */
  openSessionInNewTab(sessionId: string): void
  /** chat 内改名/分叉等会话变更后让 store 重建基线。 */
  onSessionsChanged(): void
  /** 活动 tab 变化（聚焦/失焦/关闭/重建）→ provider 重算侧栏高亮。 */
  onViewStateChanged(): void
  /** 把 SessionsSnapshot 推给所有打开的 tab（@ 补全数据源，webview ready 时）。 */
  pushSessions(): void
  /** 同步「打开中的会话」集合给 store（完成标记排除打开中的会话）。 */
  syncAttachedSessions(): void
  /**
   * 推送 ChatState 到指定 tab：provider 负责 composeHeader 合成头部后 post。
   * per-tab 逻辑不直接 post state，统一走这里（头部合成需要 provider 级
   * 的 store/jobs/subagents 数据源）。
   */
  push(host: ChatTabHost, state: ChatState): void
  /**
   * 空会话 hero 的 workspace 懒切换（main 功能移植，per-tab）：
   * 记录/取消 pending 目标（点 chip 时零 RPC），发送/选 preset 前落地。
   */
  setPendingWorkspace(host: ChatTabHost, workspaceId: string): void
  /** 发送/选 preset 前落地懒切换；返回 false = 切换失败（已提示用户）。 */
  resolvePendingWorkspace(host: ChatTabHost): Promise<boolean>
  /** hero picker「添加已有文件夹…」：注册 workspace 后设为 pending 目标。 */
  addWorkspaceAndOpen(host: ChatTabHost): Promise<void>
  /** hero picker「创建工作区…」：注册 workspace 后设为 pending 目标。 */
  createWorkspaceAndOpen(host: ChatTabHost): Promise<void>
}

/** 一个会话 tab 的全部状态：panel（可被用户关闭）+ controller（服务重启前
 * 常驻）+ 各自的订阅。关闭 tab 只置空 panel 与面板侧订阅；controller 与
 * controllerSub 保留（pending 兜底再拉出、重开复用）。 */
export class ChatTabHost implements vscode.Disposable {
  /** 附着会话 id；null = 空态 tab（服务未就绪/无会话可挂）。 */
  sessionId: string | null
  /** 编辑器 tab（用户关闭后为 null）。 */
  panel: vscode.WebviewPanel | null = null
  /** 会话控制器（服务 down/重启后为 null，恢复时重建）。 */
  controller: ChatSessionController | null = null
  /** Last title projection seen from the attached session (auto-rename watch). */
  lastSessionTitle: string | undefined
  /**
   * 右键「发送到当前会话」暂存的附件：webview 尚未解析（用户还没打开过
   * 这个会话的 tab）时先落这两个队列，tab 打开后再投给 composer。只活到
   * 下一次 flush——成功后清空，不跨会话堆积（per-tab）。
   */
  pendingStagedFiles: StagedFile[] = []
  pendingStagedImages: OutgoingImage[] = []
  /**
   * 空会话 hero 的懒切换目标 workspace id（per-tab；null = 无待切换）。点
   * workspace chip 只记录这里并更新显示（零 RPC），发送/选 preset 时经
   * provider 的 resolvePendingWorkspace 落地（ensureSession + 打开目标会话
   * tab），让「点击切换」瞬时完成、把等待移进发送动作本身。会话切换/附着时
   * 清除（跟 tab 同生命周期）。
   */
  pendingWorkspaceId: string | null = null
  /** controller 状态订阅；tab 关闭后保留（pending 兜底需要继续听）。 */
  private controllerSub: vscode.Disposable | null = null
  /** panel 消息订阅（panel 侧，随 panel 关闭清理）。 */
  private msgSub: vscode.Disposable | null = null
  /** panel 活动状态订阅（随 panel 关闭清理）。 */
  private viewStateSub: vscode.Disposable | null = null
  private disposed = false

  constructor(
    /** 宿主注入的集合级能力（handler 与 tab 逻辑通过它访问 provider 服务）。 */
    readonly actions: ChatTabHostActions,
    sessionId: string | null,
  ) {
    this.sessionId = sessionId
    this.createPanel('DSH One')
  }

  // ---- 面板生命周期 ----

  /** 创建（或重建）editor panel 并接线消息/视图状态订阅。 */
  private createPanel(title: string): void {
    const { extensionUri } = this.actions
    const panel = vscode.window.createWebviewPanel(
      'dshOne.chatPanel',
      title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        // 保留隐藏时的 webview 上下文：tab 切走再切回不重载页面，聊天内容、
        // 草稿、滚动位置原样保留（与 dshOne.tab 的 openInTab 对齐）。即使
        // 极端情况下仍被重载，webview 的 ready 报到也会让宿主重推状态。
        retainContextWhenHidden: true,
      },
    )
    // tab 图标用 dsh 官方品牌图标（assets/dsh-favicon.svg，拷自已安装的
    // @deepseek-ai/dsh-web-frontend/dist/favicon.svg；iconPath 是宿主层行为，
    // 无需把 assets 加进 localResourceRoots）。
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'dsh-favicon.svg')
    panel.webview.html = chatHtml(panel.webview, extensionUri)
    this.panel = panel
    // 消息按 tab 路由：闭包捕获本 host，动作落在自己的 controller 上，回复
    // 都 post 回本 tab 的 webview（互不串台）。
    this.msgSub = panel.webview.onDidReceiveMessage((m: FromWebviewMessage) => void this.handleMessage(m))
    // 活动 tab 检测：聚焦/失焦都重算高亮（侧栏跟随活动编辑器）。
    this.viewStateSub = panel.onDidChangeViewState(() => this.actions.onViewStateChanged())
    panel.onDidDispose(() => {
      // 用户关闭 tab：panel 侧订阅随 panel 自动清理，引用置空；controller
      // 保留——pending 交互兜底再拉出、重开即复用都依赖它（与单面板时代
      // 一致）。activeSessionId 由 provider 重算，侧栏高亮跟随。
      this.panel = null
      this.msgSub = null
      this.viewStateSub = null
      this.actions.onViewStateChanged()
    })
    this.push(this.controller?.getState() ?? this.emptyState())
    this.syncPanelTitle()
  }

  /** 用户关闭 tab 后 pending 交互到来：重建 panel（复用保留的 controller）。 */
  ensurePanel(): void {
    if (this.panel) return
    this.createPanel(this.sessionId ? vscode.l10n.t('Session {0}', this.sessionId.slice(0, 8)) : 'DSH One')
    this.actions.pushSessions()
    this.actions.syncAttachedSessions()
    this.reveal()
  }

  /** 聚焦本 tab 并同步活动高亮。 */
  reveal(): void {
    this.panel?.reveal()
    // reveal 会触发 onDidChangeViewState；未触发时（已活动/无焦点变化）兜底。
    this.actions.onViewStateChanged()
  }

  /** EMPTY_STATE plus the startup-failure marker when the server is in error. */
  private emptyState(): ChatState {
    const status = this.actions.manager.getStatus()
    return status.state === 'error' && status.reason === 'dshNotFound'
      ? { ...EMPTY_STATE, serverError: 'dshNotFound' }
      : EMPTY_STATE
  }

  // ---- 会话附着 ----

  /** 给本 tab 附着（或重建）controller（首次打开、服务重启恢复共用）。 */
  attachController(sessionId: string): void {
    const status = this.actions.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (!url) return
    if (this.controller) {
      // 已附着：可能还差 push 初始状态（tab 骨架刚建时 controller 为 null，
      // 不会走到这里；走到说明重复调用，幂等处理）。
      return
    }
    const controller = new ChatSessionController(url, sessionId, this.actions.logger)
    this.sessionId = sessionId
    this.controller = controller
    // 附着即取一次服务端 running 位（基线未覆盖时为 undefined，controller
    // 内部回退 mux 折叠值）；之后随 store 变更中继。
    controller.setServerRunning(this.actions.store.runningFor(sessionId))
    this.controllerSub = controller.onDidChange((state) => {
      this.push(state)
      // 兜底：tab 被用户关闭但有 pending 交互（审批/问题/计划评审）时自动
      // 再拉出该会话的 tab，避免交互被静默吞掉（per-session）。
      if (state.pending.length > 0 && !this.panel) this.ensurePanel()
      // dsh 自动命名经会话内的 title 投影到达，host 事件流没有对应事件，
      // sessions 面板不会自己刷新——标题变化时主动重拉一次基线，并同步
      // 编辑器 tab 标题（标题投影即 tab 标题源，含用户重命名）。
      if (state.sessionTitle !== this.lastSessionTitle) {
        this.lastSessionTitle = state.sessionTitle
        void this.actions.store.refresh()
        this.syncPanelTitle()
      }
    })
    // 附着即拉取该会话子代理子树的目录（label 描述符），菜单行显示名会随
    // onDidChange 重推时更新；首次 attach 时可能还没到，先走 title/id 回退。
    this.actions.subagents.ensure(sessionId, this.actions.store.rawList())
    this.lastSessionTitle = controller.getState().sessionTitle
    this.push(controller.getState())
    // tab 标题随附着会话同步（含空态回落「DSH One」；标题投影的后续更新由
    // controller.onDidChange 里的 syncPanelTitle 跟进）。
    this.syncPanelTitle()
  }

  /** 释放 controller 与订阅（服务 down/重启、替换会话前）。 */
  detachController(): void {
    this.controllerSub?.dispose()
    this.controllerSub = null
    this.controller?.dispose()
    this.controller = null
  }

  /**
   * 把本 tab 的内容换成目标会话（「在当前 tab 打开」）：旧会话的 controller
   * 与订阅释放（等同单面板时代切换会话），暂存附件清空（不投给别的会话），
   * panel/消息订阅复用。调用方负责 map key 迁移与 store 集合同步。
   */
  replaceWith(sessionId: string): void {
    this.detachController()
    this.pendingStagedFiles = []
    this.pendingStagedImages = []
    this.lastSessionTitle = undefined
    this.sessionId = sessionId
    this.attachController(sessionId)
    if (!this.controller) {
      // 服务没起来附着失败：tab 显示空态（旧会话内容已释放，不能残留）。
      this.push(this.emptyState())
      this.syncPanelTitle()
    }
  }

  // ---- 状态推送与标题 ----

  /** 把 ChatState 推到本 tab 的 webview（provider 负责 composeHeader 合成头部）。 */
  push(state: ChatState): void {
    this.actions.push(this, state)
  }

  /** 向本 tab 的 webview post 任意消息（state 之外的类型走这里）。 */
  postMessage(message: ToWebviewMessage): void {
    void this.panel?.webview.postMessage(message)
  }

  /**
   * 把编辑器 tab 标题同步到附着会话的标题（含 dsh 自动命名/用户重命名，均经
   * controller 的 title 投影到达）。会话未命名时以「会话 <ID 前 8 位>」兜底，
   * 无会话空态回落「DSH One」。面板已销毁（panel 为 null）时跳过，不写悬空引用。
   */
  syncPanelTitle(): void {
    if (!this.panel) return
    const state = this.controller?.getState()
    this.panel.title = !state?.sessionId
      ? 'DSH One'
      : state.sessionTitle ?? vscode.l10n.t('Session {0}', state.sessionId.slice(0, 8))
  }

  // ---- 消息处理（按域分发） ----

  /** 本 tab webview 的消息入口：按 type 分发给 chatMessages 注册的 handler。 */
  private async handleMessage(m: FromWebviewMessage): Promise<void> {
    if (!m || typeof m.type !== 'string') return
    // Webview 重载后（tab 切走再切回时 VSCode 重新加载面板内容）报到：立即重推
    // 当前 ChatState 与 sessions 快照，恢复界面。不能依赖事件驱动推送——重载
    // 后若无新事件，webview 会一直收不到状态。
    if (m.type === 'ready') {
      this.push(this.controller?.getState() ?? this.emptyState())
      this.actions.pushSessions()
      return
    }
    for (const handler of chatMessageHandlers) {
      if (handler.types.includes(m.type)) {
        try {
          await handler.handle(this, m)
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          this.actions.logger.warn(`chat: ${m.type} failed — ${detail}`)
          vscode.window.showErrorMessage(vscode.l10n.t('Chat operation failed: {0}', detail))
        }
        return
      }
    }
    // 未注册的消息类型（契约扩展但宿主未实现）：静默忽略。
    this.actions.logger.warn(`chat: unhandled webview message ${m.type}`)
  }

  // ---- 暂存附件 ----

  /**
   * Attachment picker: images are read into base64 and staged via the shared
   * validator; any other file already lives on disk, so it is staged as a
   * path chip (no temp copy needed).
   */
  async pickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: vscode.l10n.t('Add attachment'),
      // No filters: any file type is a valid attachment (images are inlined,
      // everything else goes into the prompt as a path).
    })
    if (!uris || uris.length === 0) return
    const skipped: string[] = []
    const images: OutgoingImage[] = []
    const paths: string[] = []
    for (const uri of uris) {
      const mediaType = IMAGE_MEDIA_TYPES[path.extname(uri.fsPath).toLowerCase()]
      if (!mediaType) {
        paths.push(uri.fsPath)
        continue
      }
      const name = path.basename(uri.fsPath)
      let data: Uint8Array
      try {
        data = await fs.readFile(uri.fsPath)
      } catch (err) {
        skipped.push(vscode.l10n.t('{0} (read failed: {1})', name, err instanceof Error ? err.message : String(err)))
        continue
      }
      images.push({ mediaType, data: Buffer.from(data).toString('base64'), name })
    }
    this.stageImages(images, skipped)
    if (paths.length > 0) {
      const message: ToWebviewMessage = {
        type: 'filesPicked',
        files: paths.map((p) => ({ name: path.basename(p), path: p })),
      }
      void this.panel?.webview.postMessage(message)
    }
  }

  /**
   * Paste intake: every clipboard file becomes an attachment. Images (sniffed
   * from bytes, or a declared image/* type) go through the same staging and
   * limit validation as the picker; anything else is written to a temp file
   * and staged as a path chip for the agent to read.
   */
  async stagePastedFiles(files: OutgoingImage[]): Promise<void> {
    if (files.length === 0) return
    const images: OutgoingImage[] = []
    const staged: Array<{ name: string; path: string }> = []
    const skipped: string[] = []
    for (const file of files) {
      const name = file.name ?? vscode.l10n.t('Attachment')
      const bytes = Buffer.from(file.data, 'base64')
      const mediaType = sniffImageMediaType(bytes) ?? file.mediaType.trim().toLowerCase()
      if (mediaType.startsWith('image/')) {
        images.push({ ...file, mediaType })
        continue
      }
      try {
        staged.push({ name, path: await this.saveTempAttachment(name, bytes) })
      } catch (err) {
        skipped.push(vscode.l10n.t('{0} (failed to write temp file: {1})', name, err instanceof Error ? err.message : String(err)))
      }
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0} file(s): {1}', skipped.length, skipped.join('；')))
    }
    this.stageImages(images)
    if (staged.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: staged }
      void this.panel?.webview.postMessage(message)
    }
  }

  /** Persist a non-image paste under the OS temp dir; returns the file path. */
  private async saveTempAttachment(name: string, bytes: Buffer): Promise<string> {
    const dir = path.join(os.tmpdir(), 'dsh-one-attachments')
    await fs.mkdir(dir, { recursive: true })
    const safe = name.replace(/[^\w.-]+/g, '_') || 'attachment'
    const file = path.join(dir, `${Date.now()}-${safe}`)
    await fs.writeFile(file, bytes)
    this.actions.logger.info(`chat: pasted file saved to ${file}`)
    return file
  }

  /**
   * 把暂存的附件投给本 tab 的 webview composer（等同点「添加附件」）。视图还没
   * 解析或没有附着会话时留在队列，等 tab 打开 / 重新附着时重投；
   * 有面板却没有会话可挂时清空队列（附件无处可去）。
   */
  flushStaged(): void {
    if (!this.panel) return
    if (!this.controller) {
      this.pendingStagedFiles = []
      this.pendingStagedImages = []
      return
    }
    if (this.pendingStagedImages.length > 0) {
      const message: ToWebviewMessage = { type: 'imagesPicked', images: this.pendingStagedImages }
      void this.panel.webview.postMessage(message)
      this.pendingStagedImages = []
    }
    if (this.pendingStagedFiles.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: this.pendingStagedFiles }
      void this.panel.webview.postMessage(message)
      this.pendingStagedFiles = []
    }
  }

  /**
   * 右键「发送到当前会话」的附件暂存：图片读 base64 + 限额校验后入
   * pendingStagedImages，其他文件以路径 chip 入 pendingStagedFiles（发送时
   * 拼进 prompt 让 agent 自己读）。由 ChatViewProvider.attachFileToSession
   * 选好目标 tab 后调用；投递由 flushStaged 完成。
   */
  async stageContextFile(fsPath: string): Promise<void> {
    const name = path.basename(fsPath)
    const mediaType = IMAGE_MEDIA_TYPES[path.extname(fsPath).toLowerCase()]
    if (mediaType) {
      let data: Uint8Array
      try {
        data = await fs.readFile(fsPath)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to read file: {0}', err instanceof Error ? err.message : String(err)))
        return
      }
      const skipped: string[] = []
      if (!this.controller) return
      const accepted = this.validateImages(
        this.controller,
        [{ mediaType, data: Buffer.from(data).toString('base64'), name }],
        skipped,
      )
      if (skipped.length > 0) {
        vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0} file(s): {1}', skipped.length, skipped.join('；')))
        return
      }
      this.pendingStagedImages.push(...accepted)
    } else {
      this.pendingStagedFiles.push({ name, path: fsPath })
    }
  }

  /** Validate then post accepted images back to this tab's webview (picker/paste path). */
  stageImages(images: OutgoingImage[], skipped: string[] = []): void {
    if (images.length === 0 && skipped.length === 0) return
    if (!this.controller) return
    const accepted = this.validateImages(this.controller, images, skipped)
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0} file(s): {1}', skipped.length, skipped.join('；')))
    }
    if (accepted.length > 0) {
      const message: ToWebviewMessage = { type: 'imagesPicked', images: accepted }
      void this.panel?.webview.postMessage(message)
    }
  }

  /**
   * Validate staged images (from the picker, a webview paste, or the context
   * menu) against the session's image limits; returns the accepted ones.
   * Skipped files are appended to `skipped` with human-readable reasons.
   */
  private validateImages(controller: ChatSessionController, images: OutgoingImage[], skipped: string[]): OutgoingImage[] {
    const limits = controller.imageLimits
    const accepted: OutgoingImage[] = []
    let acceptedBytes = 0
    for (const image of images) {
      const name = image.name ?? vscode.l10n.t('Image')
      const byteLength = Buffer.from(image.data, 'base64').byteLength
      const mediaType = image.mediaType.trim().toLowerCase()
      if (limits && !limits.mediaTypes.some((t) => t.trim().toLowerCase() === mediaType)) {
        skipped.push(
          vscode.l10n.t('{0} (unsupported format: {1}; supported: {2})', name, image.mediaType || vscode.l10n.t('unknown'), limits.mediaTypes.join('、')),
        )
        this.actions.logger.warn(`chat: image rejected — mediaType=${JSON.stringify(image.mediaType)}, allowed=${JSON.stringify(limits.mediaTypes)}`)
        continue
      }
      if (limits) {
        if (accepted.length >= limits.maxImagesPerMessage) {
          skipped.push(vscode.l10n.t('{0} (max {1} images per message)', name, limits.maxImagesPerMessage))
          continue
        }
        if (byteLength > limits.maxImageBytes) {
          skipped.push(vscode.l10n.t('{0} (exceeds the per-image limit of {1})', name, formatBytes(limits.maxImageBytes)))
          continue
        }
        if (acceptedBytes + byteLength > limits.maxMessageImageBytes) {
          skipped.push(vscode.l10n.t('{0} (exceeds the total image size limit of {1} per message)', name, formatBytes(limits.maxMessageImageBytes)))
          continue
        }
      }
      accepted.push(image)
      acceptedBytes += byteLength
    }
    return accepted
  }

  /** 释放本 tab 的全部资源（panel + controller + 订阅）。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachController()
    const panel = this.panel
    this.panel = null
    this.msgSub = null
    this.viewStateSub = null
    panel?.dispose()
  }
}

/** Human byte size for limit warnings, e.g. "10 MB". */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Pushed when no session is attached; the webview renders the empty state. */
export const EMPTY_STATE: ChatState = {
  sessionId: null,
  messages: [],
  pending: [],
  running: false,
  canSend: false,
}
