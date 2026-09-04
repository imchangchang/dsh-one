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
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
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
import { hostOsFromPlatform } from '../pure/installScript.ts'
import { imageMediaTypeByExtension, imgFileName } from '../pure/composerAttachment.ts'
import { attachmentDir, nextSequenceIndex } from './attachmentDir.ts'
import type { SessionsStore } from './sessionsStore.ts'
import { JobsStore } from './jobsStore.ts'
import type { SubagentCatalogStore } from './subagentsStore.ts'
import { chatHtml, loadWebviewL10n } from './chatViewHtml.ts'
import { chatMessageHandlers } from './chatMessages.ts'

/** Editor 面板的 viewType（窗口 reload 时 serializer 按它匹配恢复）。 */
export const CHAT_PANEL_VIEW_TYPE = 'dshOne.chatPanel'
/**
 * 窗口 reload 的恢复凭据：webview 内容经 `vscode.setState()` 保存（VSCode
 * 关停时把它交给 serializer）。tabId 是面板创建后不变的稳定标识——会话可在
 * 同一 tab 内被替换，而映射里的 sessionId 随时更新，凭 tabId 查最新值。
 */
export interface ChatPanelRestoreState {
  tabId: string
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
  /** tab 的（panel, sessionId）组合变化（打开/关闭/替换会话）→ provider 更新恢复映射。 */
  onTabsChanged(host: ChatTabHost): void
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
   * 记录/取消当前会话的 pending 目标（点 chip 时零 RPC），发送前随
   * applySendIntent 落地。
   */
  setPendingWorkspace(host: ChatTabHost, workspaceId: string): void
  /** hero 空会话的 preset 懒切换：记录当前会话 pending 并推 state（chip 显示
   *  选中帧），零 RPC——真正 setAgentPreset 推迟到发送落地。 */
  setPendingPreset(host: ChatTabHost, presetId: string): void
  /** 空会话与消息流的权限模式懒切换：记录当前会话 pending 并推 state（pill 显示
   *  选中帧），零 RPC——真正 /permission 命令推迟到发送落地。 */
  setPendingPermission(host: ChatTabHost, value: string): void
  /** 发送前落地当前会话的待发送意图（快照一次，按序执行 workspace → preset →
   *  permission；workspace 失败=已提示并取消发送，preset/permission 失败只记
   *  日志）。返回 false = workspace 切换失败，调用方应取消发送。 */
  applySendIntent(host: ChatTabHost): Promise<boolean>
  /** hero picker「添加已有文件夹…」：注册 workspace 后设为 pending 目标。 */
  addWorkspaceAndOpen(host: ChatTabHost): Promise<void>
  /** hero picker「创建工作区…」：注册 workspace 后设为 pending 目标。 */
  createWorkspaceAndOpen(host: ChatTabHost): Promise<void>
}

/**
 * 一次发送前待落地的会话级懒切换意图（workspace/preset/permission 各一域，
 * 域缺省 = 无该域切换）。按会话归档（见 ChatTabHost.pendingIntentBySession）：
 * tab 跨会话复用（replaceWith）时不清不迁、零处理，结构上不可能串台；切回
 * 原会话时恢复——与草稿/附件生命周期一致。tab 销毁随对象回收。
 */
export interface SendIntent {
  workspaceId?: string
  presetId?: string
  permission?: string
}

/** SendIntent 的意图域（setPendingIntentField 按域记账用）。 */
export type SendIntentField = keyof SendIntent

/** 一个会话 tab 的全部状态：panel（可被用户关闭）+ controller（服务重启前
 * 常驻）+ 各自的订阅。关闭 tab 只置空 panel 与面板侧订阅；controller 与
 * controllerSub 保留（pending 兜底再拉出、重开复用）。 */
export class ChatTabHost implements vscode.Disposable {
  /** 附着会话 id；null = 空态 tab（服务未就绪/无会话可挂）。 */
  sessionId: string | null
  /**
   * 稳定标识：跨窗口 reload 的恢复凭据（面板 state 里的 tabId）。面板每次
   * 重建（createPanel/ensurePanel）沿用同一 tabId；会话替换也不变。
   */
  readonly tabId: string
  /** 编辑器 tab（用户关闭后为 null）。 */
  panel: vscode.WebviewPanel | null = null
  /**
   * 本 tab composer 是否有未发送内容（webview 上报）。宿主在点击其他会话
   * 决定「复用本 tab 还是新开 tab」时用它：有未发送内容时绝不覆盖，改走
   * 新 tab（对应 VS Code 中 dirty editor 不被 preview 复用的惯例）。
   */
  composerDirty = false
  /** 会话控制器（服务 down/重启后为 null，恢复时重建）。 */
  controller: ChatSessionController | null = null
  /** Last title projection seen from the attached session (auto-rename watch). */
  lastSessionTitle: string | undefined
  /**
   * 右键「发送到当前会话」暂存的附件：webview 尚未解析（用户还没打开过
   * 这个会话的 tab）时先落这个队列，tab 打开后再投给 composer。只活到
   * 下一次 flush——成功后清空，不跨会话堆积（per-tab）。图片也走文件
   * 方式（原路径引用，不做 base64 暂存）。
   */
  pendingStagedFiles: StagedFile[] = []
  /**
   * 会话级懒切换意图归档（per-session；key = 附着会话 id，见 SendIntent）：
   * 三个 pending 裸字段的替代（方案 C）。懒切换目标与原会话绑定——tab 跨会话
   * 复用（replaceWith）时 Map 按会话隔离、不清不迁，结构上不可能串台；切回原
   * 会话 pending 恢复（与草稿/附件生命周期一致）。tab 销毁随对象回收。
   */
  private readonly pendingIntentBySession = new Map<string, SendIntent>()
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
    /** 恢复场景：VSCode 还原的面板（位置/active 已还原），不再自行创建。 */
    restoredPanel?: vscode.WebviewPanel,
    /** 恢复场景：面板 state 里的 tabId（缺省 = 新建，随机生成）。 */
    restoreTabId?: string,
  ) {
    this.sessionId = sessionId
    this.tabId = restoreTabId ?? randomUUID()
    if (restoredPanel) this.adoptPanel(restoredPanel)
    else this.createPanel('DSH One')
  }

  // ---- 面板生命周期 ----

  /** 创建（或重建）editor panel 并接线消息/视图状态订阅。 */
  private createPanel(title: string): void {
    const { extensionUri } = this.actions
    const panel = vscode.window.createWebviewPanel(
      CHAT_PANEL_VIEW_TYPE,
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
    this.wirePanel(panel)
  }

  /** 接线一个已存在的 editor panel（创建与恢复共用）：html/图标/订阅/首推。 */
  private wirePanel(panel: vscode.WebviewPanel): void {
    const { extensionUri } = this.actions
    // tab 图标用 dsh 官方品牌图标（assets/dsh-favicon.svg，拷自已安装的
    // @deepseek-ai/dsh-web-frontend/dist/favicon.svg；iconPath 是宿主层行为，
    // 无需把 assets 加进 localResourceRoots）。
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'dsh-favicon.svg')
    panel.webview.html = chatHtml(panel.webview, extensionUri, this.tabId, loadWebviewL10n(extensionUri))
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
      // 关闭即从恢复映射删除（VSCode 只恢复打开状态的面板，不留幽灵 entry）。
      this.actions.onTabsChanged(this)
    })
    this.push(this.controller?.getState() ?? this.emptyState())
    this.syncPanelTitle()
    this.actions.onTabsChanged(this)
  }

  /** 采用 VSCode 恢复的面板（reload 后 serializer 调用，面板不可自行创建）。 */
  private adoptPanel(panel: vscode.WebviewPanel): void {
    this.wirePanel(panel)
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

  // ---- 懒切换意图（per-session 归档） ----

  /** 读：某会话的待发送意图（无 = undefined）。 */
  pendingIntentFor(sessionId: string): SendIntent | undefined {
    return this.pendingIntentBySession.get(sessionId)
  }

  /**
   * 写：设置/取消某会话意图的指定域（value = null 清该域；条目三个域全空时
   * 删除）。setPending* 的记账入口，key 只使用「产生意图的会话」，与发送时
   * applySendIntent 的归属一致。
   */
  setPendingIntentField(sessionId: string, field: SendIntentField, value: string | null): void {
    let entry = this.pendingIntentBySession.get(sessionId)
    if (!entry) {
      if (value === null) return
      entry = {}
      this.pendingIntentBySession.set(sessionId, entry)
    }
    if (value === null) {
      delete entry[field]
      if (!entry.workspaceId && !entry.presetId && !entry.permission) {
        this.pendingIntentBySession.delete(sessionId)
      }
      return
    }
    entry[field] = value
  }

  /** 清：消费后删除某会话的整个意图条目。 */
  clearPendingIntent(sessionId: string): void {
    this.pendingIntentBySession.delete(sessionId)
  }

  /**
   * 把本 tab 的内容换成目标会话（「在当前 tab 打开」）：旧会话的 controller
   * 与订阅释放（等同单面板时代切换会话），暂存附件清空（不投给别的会话），
   * panel/消息订阅复用。调用方负责 map key 迁移与 store 集合同步。
   */
  replaceWith(sessionId: string): void {
    this.detachController()
    this.pendingStagedFiles = []
    this.lastSessionTitle = undefined
    // 脏位先归零，等 webview 切换渲染后按新会话的真实草稿重新上报。
    this.composerDirty = false
    this.sessionId = sessionId
    this.attachController(sessionId)
    if (!this.controller) {
      // 服务没起来附着失败：tab 显示空态（旧会话内容已释放，不能残留）。
      this.push(this.emptyState())
      this.syncPanelTitle()
    }
    // 会话替换：映射里的 sessionId 更新（reload 后按 tabId 恢复新会话）。
    this.actions.onTabsChanged(this)
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
    // composer 脏位上报：webview 侧在输入/附件/会话切换后同步真实状态；
    // 这里只记账——openSession 的「dirty 则不覆盖」决策读的就是它。
    if (m.type === 'composerDirty') {
      this.composerDirty = m.dirty
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
   * Attachment picker: everything is staged as a path chip — images keep
   * their on-disk location (no copy) and carry a base64 preview for the
   * thumbnail; other files join the prompt as a path for the agent to read.
   */
  async pickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: vscode.l10n.t('Add attachment'),
      // No filters: any file type is a valid attachment (images are staged
      // as files too; everything goes into the prompt as a path).
    })
    if (!uris || uris.length === 0) return
    const skipped: string[] = []
    const staged: StagedFile[] = []
    for (const uri of uris) {
      const name = path.basename(uri.fsPath)
      const mediaType = imageMediaTypeByExtension(path.extname(uri.fsPath))
      if (!mediaType) {
        staged.push({ name, path: uri.fsPath })
        continue
      }
      let data: Uint8Array
      try {
        data = await fs.readFile(uri.fsPath)
      } catch (err) {
        skipped.push(vscode.l10n.t('{0} (read failed: {1})', name, err instanceof Error ? err.message : String(err)))
        continue
      }
      staged.push({ name, path: uri.fsPath, image: true, mediaType, previewData: Buffer.from(data).toString('base64') })
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0} file(s): {1}', skipped.length, skipped.join('；')))
    }
    if (staged.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: staged }
      void this.panel?.webview.postMessage(message)
    }
  }

  /**
   * Paste intake: every clipboard file becomes an attachment. Everything is
   * written to the per-session dir under the OS temp dir (the OS does not
   * guarantee periodic cleanup; consistent with dsh archive semantics —
   * archiving only marks a session, never deletes data — attachments only
   * grow and stay recoverable; never inside a project/git tree, so no repo
   * pollution); images get sequential `imgN.ext` names (N per session
   * directory), other files keep their own name. Both are staged as path
   * chips; the path joins the prompt on send and the agent reads it directly.
   */
  async stagePastedFiles(files: OutgoingImage[]): Promise<void> {
    if (files.length === 0) return
    // 无附着会话：与长文本折叠的门控保持一致，不落共享 default/ 目录（提示走 webview 侧）。
    if (!this.controller) {
      vscode.window.showWarningMessage(vscode.l10n.t('Attach files to a session first (open a chat panel)'))
      return
    }
    const staged: StagedFile[] = []
    const skipped: string[] = []
    const dir = attachmentDir(this.controller?.sessionId)
    for (const file of files) {
      const name = file.name ?? vscode.l10n.t('Attachment')
      const bytes = Buffer.from(file.data, 'base64')
      const mediaType = sniffImageMediaType(bytes) ?? file.mediaType.trim().toLowerCase()
      try {
        if (mediaType.startsWith('image/')) {
          const seq = await nextSequenceIndex(dir, /^img(\d+)(?:-\d+)?\.(?:png|jpg|webp|gif)$/i)
          const target = await this.saveTempAttachment(imgFileName(mediaType, seq), bytes)
          staged.push({ name: path.basename(target), path: target, image: true, mediaType, previewData: file.data })
        } else {
          staged.push({ name, path: await this.saveTempAttachment(name, bytes) })
        }
      } catch (err) {
        skipped.push(vscode.l10n.t('{0} (failed to write attachment file: {1})', name, err instanceof Error ? err.message : String(err)))
      }
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0} file(s): {1}', skipped.length, skipped.join('；')))
    }
    if (staged.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: staged }
      void this.panel?.webview.postMessage(message)
    }
  }

  /** 原子写一个附件名：wx 独占创建，冲突即递增 -N 后缀重试（并发粘贴不互相覆盖；
   *  -N 后缀虽不入 imgN 序号序列，但原子写下正常路径永远不会产生它）。 */
  private async saveTempAttachment(name: string, bytes: Buffer): Promise<string> {
    const dir = attachmentDir(this.controller?.sessionId)
    await fs.mkdir(dir, { recursive: true })
    const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_') || 'attachment'
    const dot = safe.lastIndexOf('.')
    const base = dot > 0 ? safe.slice(0, dot) : safe
    const ext = dot > 0 ? safe.slice(dot) : ''
    for (let i = 0; ; i += 1) {
      const candidate = path.join(dir, i === 0 ? safe : `${base}-${i + 1}${ext}`)
      try {
        await fs.writeFile(candidate, bytes, { flag: 'wx' })
        this.actions.logger.info(`chat: pasted file saved to ${candidate}`)
        return candidate
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
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
      return
    }
    if (this.pendingStagedFiles.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: this.pendingStagedFiles }
      void this.panel.webview.postMessage(message)
      this.pendingStagedFiles = []
    }
  }

  /**
   * 右键「发送到当前会话」的附件暂存：图片以原路径引用（带 base64 预览）
   * 入 pendingStagedFiles——与粘贴相比图片已在磁盘，无需复制；发送时拼进
   * prompt 让 agent 自己读。由 ChatViewProvider.attachFileToSession 选好
   * 目标 tab 后调用；投递由 flushStaged 完成。
   */
  async stageContextFile(fsPath: string): Promise<void> {
    const name = path.basename(fsPath)
    const mediaType = imageMediaTypeByExtension(path.extname(fsPath))
    if (mediaType) {
      let data: Uint8Array
      try {
        data = await fs.readFile(fsPath)
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to read file: {0}', err instanceof Error ? err.message : String(err)))
        return
      }
      this.pendingStagedFiles.push({
        name,
        path: fsPath,
        image: true,
        mediaType,
        previewData: Buffer.from(data).toString('base64'),
      })
    } else {
      this.pendingStagedFiles.push({ name, path: fsPath })
    }
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

/** Pushed when no session is attached; the webview renders the empty state. */
export const EMPTY_STATE: ChatState = {
  sessionId: null,
  messages: [],
  pending: [],
  running: false,
  canSend: false,
  hostOs: hostOsFromPlatform(process.platform),
}
