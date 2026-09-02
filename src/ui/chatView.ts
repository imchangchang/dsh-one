/**
 * Chat 编辑器的 tab 集合管理（`ChatViewProvider`）：**一个会话一个 tab**。
 * 每个 tab 的 per-tab 职责（panel 生命周期、controller 订阅、标题同步、
 * pending 兜底、消息处理、暂存附件）都内聚在 ChatTabHost（chatTab.ts），
 * 本类只做集合级的事：
 * - tabs 的打开/聚焦/替换/关闭（默认在当前活动 tab 打开；「在新 tab 中
 *   打开」显式新开；焦点不在 chat tab 时替换最近活动 tab——用户决策）
 * - 活动 tab 检测（panel.onDidChangeViewState → 侧栏高亮跟随）
 * - 服务生命周期：down/重启时释放全部 controller，重启后只恢复最近活动
 *   的会话 tab；归档/删除会话时关闭对应 tab
 * - 头部信息合成（composeHeader：子代理树/jobs/workspace/preset/面包屑）
 *   与 SessionsSnapshot 广播（@ 补全数据源）
 *
 * 设计动机（multi-tab 重构第二层）：本类原本是单类上帝——tab 管理、消息
 * 路由（25+ case）、状态合成、附件、命令全在一起，任何新功能都往同一批
 * 方法（onMessage/composeHeader/attach）里加，两个并行开发任务必然撞车。
 * 拆出 ChatTabHost 与按域消息 handler（chatMessages.ts）后：per-tab 的
 * 新功能落在 tab 类或其 handler 文件里，集合逻辑只改本类。
 */
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { createSession, ensureSession, executeCommand } from '../server/dshRpc.ts'
import type { WorkspaceView } from '../server/dshRpc.ts'
import type { ChatState, OutgoingImage, SessionsSnapshot, ToWebviewMessage } from '../pure/chatContract.ts'
import { contextMenuResource } from '../pure/contextResource.ts'
import { orderJobs } from '../pure/activityTree.ts'
import { buildSubagentTree } from '../pure/sessionTree.ts'
import { SubagentCatalogStore } from './subagentsStore.ts'
import type { SessionsStore } from './sessionsStore.ts'
import { JobsStore } from './jobsStore.ts'
import { ChatTabHost, EMPTY_STATE, type ChatPanelRestoreState, type ChatTabHostActions } from './chatTab.ts'

/** workspaceState key：tabId → 当前附着会话（reload 后 serializer 按它重建 tab）。 */
const OPEN_TABS_KEY = 'chat.openTabs'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Chat editor tabs（`dshOne.chatPanel`）：见文件头注释。会话列表不在编辑器
 * 里（已拆到侧栏原生 tree）；宿主仍向每个 panel 的 webview 推 SessionsStore
 * 快照，因为 composer 的 @-mention 补全读它。tab 懒创建，默认
 * ViewColumn.Active（当前活动编辑器列，用户决策：不自动分栏）。用户关闭
 * tab 时 controller 保留——pending 交互兜底再拉出与重开即复用都依赖它；
 * 服务重启时统一释放，只恢复活动的会话 tab。
 * With no session — or a non-running server — the webview gets EMPTY_STATE
 * and shows its placeholder copy.
 */
export class ChatViewProvider implements vscode.Disposable {
  /** 一个会话一个 tab（key = sessionId；空态 tab 用 EMPTY_TAB_KEY）。 */
  private readonly tabs = new Map<string, ChatTabHost>()
  /** 空态 tab 的 map key（sessionId 为 null 的占位 tab，无 controller）。 */
  private static readonly EMPTY_TAB_KEY = '\u0000empty'
  /** 高亮会话变化时通知侧栏刷新（拆分解耦：侧栏读 activeSessionId）。 */
  private readonly activeEmitter = new vscode.EventEmitter<string | null>()
  /** Fired when activeSessionId changes (活动 tab 切换/关闭). */
  readonly onActiveSessionChanged = this.activeEmitter.event
  /** 最近一次活动 tab 的会话（服务重启后只恢复它）。 */
  private lastActiveSessionId: string | null = null
  /** 服务重启后待恢复的会话（等 store 基线刷新确认还在，再 openSession）。 */
  private pendingRestoreSessionId: string | null = null
  /** 当前服务的 url（null = 未运行）；url 变化 = 新服务进程（重启）。 */
  private lastUrl: string | null = null
  private readonly managerSub: vscode.Disposable
  private readonly storeSub: vscode.Disposable
  private readonly jobs: JobsStore
  private readonly jobsSub: vscode.Disposable
  /** 子代理目录数据层（subagent.list）：菜单行显示名的来源（descriptor label）。 */
  private readonly subagents: SubagentCatalogStore
  private readonly subagentsSub: vscode.Disposable
  /** 注入给每个 ChatTabHost 的集合级能力（见 ChatTabHostActions）。 */
  private readonly hostActions: ChatTabHostActions
  /** tabId → 附着会话（窗口 reload 恢复映射，增量维护；见 syncTabMapping）。 */
  private tabMappings: Record<string, string | null>

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly extensionUri: vscode.Uri,
    private readonly store: SessionsStore,
    private readonly workspaceState: vscode.Memento,
    /** Fired after a chat-initiated session mutation (e.g. rename) so the store can rebuild. */
    private readonly onSessionsChanged?: () => void,
  ) {
    this.tabMappings = workspaceState.get<Record<string, string | null>>(OPEN_TABS_KEY, {})
    this.hostActions = {
      manager,
      logger,
      extensionUri,
      store,
      jobs: (this.jobs = new JobsStore(manager, logger)),
      subagents: (this.subagents = new SubagentCatalogStore(manager, logger)),
      openSession: (sessionId) => this.openSession(sessionId),
      openSessionInNewTab: (sessionId) => this.openSessionInNewTab(sessionId),
      onSessionsChanged: () => this.onSessionsChanged?.(),
      onViewStateChanged: () => this.recomputeActive(),
      onTabsChanged: (host) => this.syncTabMapping(host),
      pushSessions: () => this.pushSessions(),
      syncAttachedSessions: () => this.syncAttachedSessions(),
      push: (host, state) => this.push(host, state),
      setPendingWorkspace: (host, workspaceId) => this.setPendingWorkspace(host, workspaceId),
      resolvePendingWorkspace: (host) => this.resolvePendingWorkspace(host),
      setPendingPreset: (host, presetId) => this.setPendingPreset(host, presetId),
      resolvePendingPreset: (host) => this.resolvePendingPreset(host),
      setPendingPermission: (host, value) => this.setPendingPermission(host, value),
      resolvePendingPermission: (host) => this.resolvePendingPermission(host),
      addWorkspaceAndOpen: (host) => this.addWorkspaceAndOpen(host),
      createWorkspaceAndOpen: (host) => this.createWorkspaceAndOpen(host),
    }
    this.managerSub = manager.onDidChangeState((s) => this.onServerState(s))
    this.storeSub = store.onDidChange(() => {
      this.pushSessions()
      // 服务重启后待恢复的活动会话：等基线刷新确认还在，再重新打开它的 tab。
      if (this.pendingRestoreSessionId && this.store.hasSession(this.pendingRestoreSessionId)) {
        const target = this.pendingRestoreSessionId
        this.pendingRestoreSessionId = null
        this.openSession(target)
      }
      // 聊天头部的「N 个子代理」chip 来自 session.list 基线（子代理开跑/收尾
      // 触发 host 事件 → store 刷新），每个附着 tab 重推一次 state。
      for (const tab of this.tabs.values()) {
        const controller = tab.controller
        if (!controller) continue
        // 中继服务端 running 位（session-status 增量随 store 变更到达）。
        controller.setServerRunning(this.store.runningFor(controller.sessionId))
        this.push(tab, controller.getState())
        // 子代理目录随基线变化重拉：新子代理 spawn 让子树签名变化，菜单行
        // 显示名即时更新（不会只靠异步 title 兜底）。
        this.subagents.ensure(controller.sessionId, store.rawList())
      }
    })
    // 头部「N 个后台任务」chip 的数据源（mux 全局 session/jobs 帧）：
    // 基线变化时重推所有附着 tab 的 state，composeHeader 重新组合下拉行。
    this.jobsSub = this.jobs.onDidChange(() => {
      for (const tab of this.tabs.values()) {
        if (tab.controller) this.push(tab, tab.controller.getState())
      }
    })
    // 子代理目录拉到后重推 state，composeHeader 用最新的 descriptor label
    // 重组成下拉行（初次 attach 时 label 可能还没到，先走 title/id 回退）。
    this.subagentsSub = this.subagents.onDidChange(() => {
      for (const tab of this.tabs.values()) {
        if (tab.controller) this.push(tab, tab.controller.getState())
      }
    })
  }

  /** 当前活动 tab 附着的会话（无活动 chat tab 或服务未运行 → null）。 */
  get currentSessionId(): string | null {
    const tab = this.activeTab()
    return tab?.controller ? tab.sessionId : null
  }

  /** 是否还有打开的 chat tab。 */
  get isOpen(): boolean {
    return this.tabs.size > 0
  }

  /**
   * 侧栏高亮的会话：当前活动 chat tab 的会话（多 tab 时高亮跟随活动编辑器；
   * 无活动 chat tab → null，用户决策：所有 tab 关闭后不高亮任何会话；服务
   * down 时 controller 释放，同样回落 null——与单面板时代行为一致）。
   */
  get activeSessionId(): string | null {
    const tab = this.activeTab()
    return tab?.controller ? tab.sessionId : null
  }

  /**
   * 当前活动 chat tab 真实附着的会话（tab 开着且附着才非 null）。侧栏
   * 「已打开会话单击 = 行内重命名」的判定用它：活动 tab 的会话点侧栏
   * 行是改名，其他会话（含已开非活动的）都是打开/聚焦。
   */
  get attachedSessionId(): string | null {
    const tab = this.activeTab()
    return tab?.panel && tab.controller ? tab.sessionId : null
  }

  /** 所有已附着（有 controller）的会话 id——extension 的归档/清理遍历用。 */
  openSessionIds(): string[] {
    const ids: string[] = []
    for (const tab of this.tabs.values()) {
      if (tab.controller && tab.sessionId) ids.push(tab.sessionId)
    }
    return ids
  }

  /** 把当前打开的会话集合同步给 store（完成标记排除打开中的会话）。 */
  private syncAttachedSessions(): void {
    const ids: string[] = []
    for (const tab of this.tabs.values()) {
      if (tab.panel && tab.sessionId) ids.push(tab.sessionId)
    }
    this.store.setAttachedSessions(ids)
  }

  /**
   * 打开一个会话（侧栏点击 / 聊天内跳转 / 新建会话）：**默认在当前活动
   * chat tab 打开**（替换该 tab 的会话，用户决策）——已有该会话的 tab 则
   * 聚焦它（一个会话一个 tab，不复制）；焦点不在 chat tab（如在看文件）时
   * 替换**最近活动过**的 chat tab（用户决策：不新增 tab）；从未打开过 chat
   * tab 才新建。非运行中的服务：已有 tab 显示空态，没有则开空态 tab（服务
   * 恢复后自动重开活动会话）。
   */
  openSession(sessionId: string): void {
    if (!sessionId) return
    // 显式打开（侧栏/命令/恢复）都会带出会话，挂起的重启恢复目标作废。
    this.pendingRestoreSessionId = null
    const existing = this.tabs.get(sessionId)
    if (existing) {
      if (!existing.controller) existing.attachController(sessionId)
      if (!existing.panel) {
        // 用户关过这个 tab：重建 panel（复用保留的 controller）。
        existing.ensurePanel()
      } else {
        existing.reveal()
      }
      // 打开（聚焦）即视为已读。
      this.store.setUnread(sessionId, false)
      return
    }
    // 替换目标：优先当前活动 tab；焦点不在 chat tab 时用最近活动过的 tab
    // （用户决策：无活动 tab 也替换最近活动 tab，不新增）；都没有才新建。
    // 最近活动 tab 若已被用户关闭（panel null）不参与替换——那是幽灵 entry，
    // 替换它等于凭空重建，直接走新建。
    const active = this.activeTab()
    const last = this.lastActiveSessionId ? (this.tabs.get(this.lastActiveSessionId) ?? null) : null
    const target = active ?? (last?.panel ? last : null)
    if (target) {
      // 目标 tab 有未发送内容（composer 草稿/附件）：不覆盖，改走新 tab
      // （VS Code dirty-editor 惯例：编辑中的 tab 不被其他点击顶掉；草稿按
      // 会话存档不丢，但用户正在编辑的上下文不应被替换）。
      if (target.composerDirty) {
        this.openSessionInNewTab(sessionId)
        return
      }
      this.replaceTabSession(target, sessionId)
      return
    }
    // 从未打开过 chat tab → 新建 tab（原「总是新建」路径）。
    this.openSessionInNewTab(sessionId)
  }

  /**
   * 显式「在新 tab 中打开」（侧栏菜单/命令）：总是新建一个 tab；该会话
   * 已有 tab 则聚焦它（不复制）。非运行中的服务开空态 tab。
   */
  openSessionInNewTab(sessionId: string): void {
    if (!sessionId) return
    this.pendingRestoreSessionId = null
    const existing = this.tabs.get(sessionId)
    if (existing) {
      if (!existing.controller) existing.attachController(sessionId)
      if (!existing.panel) {
        existing.ensurePanel()
      } else {
        existing.reveal()
      }
      this.store.setUnread(sessionId, false)
      return
    }
    const status = this.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (!url) {
      // 与单面板时代一致：服务没起来点会话也有反馈——打开（或聚焦）空态
      // tab 显示安装引导/hero，等服务恢复（自动重开活动会话）。
      this.logger.warn(`chat: openSessionInNewTab(${sessionId}) ignored — server not running`)
      const empty = this.tabs.get(ChatViewProvider.EMPTY_TAB_KEY)
      if (empty) {
        empty.reveal()
      } else {
        const tab = this.createTab(null)
        tab.reveal()
      }
      return
    }
    // 打开（附着）即视为已读。
    this.store.setUnread(sessionId, false)
    const tab = this.createTab(sessionId)
    tab.attachController(sessionId)
    tab.reveal()
  }

  /**
   * 把当前活动 tab 的内容换成目标会话（「在当前 tab 打开」）：旧会话的
   * controller 与订阅释放（等同单面板时代切换会话），暂存附件清空（不投给
   * 别的会话），tab 的 panel/消息订阅复用。
   */
  private replaceTabSession(tab: ChatTabHost, sessionId: string): void {
    const oldKey = tab.sessionId ?? ChatViewProvider.EMPTY_TAB_KEY
    if (this.tabs.get(oldKey) === tab) this.tabs.delete(oldKey)
    tab.replaceWith(sessionId)
    this.tabs.set(sessionId, tab)
    this.store.setUnread(sessionId, false)
    tab.reveal()
    this.syncAttachedSessions()
  }

  /**
   * 打开（或揭示）聊天 editor tab。已有 tab 时聚焦活动的那个（无活动则
   * 第一个）；一个都没有时打开当前 workspace 最新会话的 tab（贴合现状的
   * 「打开面板即见最新会话」），无会话则开空态 tab（安装引导/hero）。
   */
  openPanel(): void {
    const active = this.activeTab()
    if (active) {
      active.reveal()
      return
    }
    // 焦点不在 chat tab：优先回退最近活动过的会话 tab，其次第一个。tab 被
    // 用户关过（panel null、controller 保留）的，重建 panel。
    const last = this.lastActiveSessionId ? (this.tabs.get(this.lastActiveSessionId) ?? null) : null
    const fallback = last ?? (this.tabs.values().next().value as ChatTabHost | undefined)
    if (fallback) {
      if (!fallback.panel) fallback.ensurePanel()
      else fallback.reveal()
      return
    }
    const latest = this.store.latestCurrentSessionId()
    const status = this.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (latest && url) {
      this.openSession(latest)
      return
    }
    const tab = this.createTab(null)
    tab.reveal()
  }

  /**
   * 关闭一个会话的 tab（归档/删除后清理）：panel 销毁 + controller 释放 +
   * 订阅全部解除。活动 tab 被关时侧栏高亮自动重算。
   */
  closeSession(sessionId: string): void {
    const tab = this.tabs.get(sessionId)
    if (!tab) return
    this.disposeTab(tab)
    this.recomputeActive()
    this.pushSessions()
  }

  /** 当前活动的 chat tab（panel.active），无则 null。 */
  private activeTab(): ChatTabHost | null {
    for (const tab of this.tabs.values()) {
      if (tab.panel?.active) return tab
    }
    return null
  }

  /** 活动 tab 变化后重算高亮并通知侧栏（tab 聚焦/关闭/重建时调用）。 */
  private recomputeActive(): void {
    const active = this.activeTab()
    // lastActiveSessionId 只认「活动过」（含服务 down 时 controller 已释放
    // 但 tab 还开着的情况）——重启恢复、发送文件回退都靠它。
    if (active?.sessionId) this.lastActiveSessionId = active.sessionId
    // 高亮值要求 controller 在（服务 down 时回落 null）。
    this.activeEmitter.fire(active?.controller ? active.sessionId : null)
    this.pushSessions()
  }

  /** 新建一个 tab（panel 骨架 + 消息/视图状态订阅）；随后通常 attachController。 */
  private createTab(sessionId: string | null): ChatTabHost {
    const tab = new ChatTabHost(this.hostActions, sessionId)
    this.tabs.set(sessionId ?? ChatViewProvider.EMPTY_TAB_KEY, tab)
    tab.push(EMPTY_STATE)
    tab.syncPanelTitle()
    this.syncAttachedSessions()
    this.pushSessions()
    return tab
  }

  /** 释放一个 tab 的全部资源（panel + controller + 订阅），从 map 移除。 */
  private disposeTab(tab: ChatTabHost): void {
    const key = tab.sessionId ?? ChatViewProvider.EMPTY_TAB_KEY
    if (this.tabs.get(key) === tab) this.tabs.delete(key)
    tab.dispose()
    this.syncAttachedSessions()
  }

  /**
   * 恢复映射的增量维护（tab 打开/关闭/替换会话时由 ChatTabHost 通知）：
   * 只写或删本 tab 的 entry——reload 后 serializer 逐个恢复面板，若整表重建
   * 会把尚未恢复的面板 entry 覆盖掉。孤儿 entry（面板关闭但 reload 时
   * VSCode 未再恢复）无引用面板，无害。
   */
  private syncTabMapping(host: ChatTabHost): void {
    if (host.panel) {
      this.tabMappings[host.tabId] = host.sessionId
    } else {
      delete this.tabMappings[host.tabId]
    }
    void this.workspaceState.update(OPEN_TABS_KEY, this.tabMappings)
  }

  /**
   * WebviewPanelSerializer 的 deserializeWebviewPanel：窗口 reload 后 VSCode
   * 把当时打开的 chat 面板（位置/active 已还原）交回这里重建。按面板 state 里
   * 的 tabId 查持久化映射得会话；服务 running 直接附着 controller，未起则
   * 显示空态、由 onServerState 的 running 事件经 lastActive/pendingRestore
   * 链补附着（与「服务 down 时开 tab 再恢复」同一条路）。
   */
  restoreChatPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const raw = state as Partial<ChatPanelRestoreState> | undefined
    const tabId = typeof raw?.tabId === 'string' && raw.tabId ? raw.tabId : randomUUID()
    const sessionId = this.tabMappings[tabId] ?? null
    const key = sessionId ?? ChatViewProvider.EMPTY_TAB_KEY
    const existing = this.tabs.get(key)
    if (existing) {
      // 防御：一个会话一个 tab / 空态 tab 唯一，VSCode 不会重复恢复同一面板；
      // 真到了（如映射损坏）丢弃多余面板，保留先恢复的。
      panel.dispose()
      return Promise.resolve()
    }
    const tab = new ChatTabHost(this.hostActions, sessionId, panel, tabId)
    this.tabs.set(key, tab)
    if (sessionId && this.manager.getStatus().state === 'running') {
      tab.attachController(sessionId)
    }
    this.syncAttachedSessions()
    this.pushSessions()
    this.recomputeActive()
    return Promise.resolve()
  }

  /** 服务 down / 重启：释放所有 controller（panel 保留显示空态，等待恢复）。 */
  private detachAllControllers(): void {
    for (const tab of this.tabs.values()) {
      tab.detachController()
      tab.push(EMPTY_STATE)
      tab.syncPanelTitle()
    }
    this.recomputeActive()
  }

  private onServerState(status: ServerStatus): void {
    if (status.state !== 'running' || !status.url) {
      // Server down → 全部空态；旧 controller 全释放。
      this.detachAllControllers()
      this.lastUrl = null
    } else if (this.lastUrl !== status.url) {
      // 新服务（首次启动或重启，url 变化）：旧 controller 全释放，重启场景
      // 记住最近活动的会话，等 store 基线刷新确认后只恢复它（任务范围：
      // 「可先只恢复活动的」）。
      this.lastUrl = status.url
      const prevActive = this.lastActiveSessionId
      this.detachAllControllers()
      if (prevActive) this.pendingRestoreSessionId = prevActive
    }
    // 面板空态依赖 serverState/dshNotFound，状态变化时同步推一次。
    this.pushSessions()
  }

  /** 推送 ChatState 到指定 tab（ChatTabHost 委托进来；composeHeader 合成头部）。 */
  private push(tab: ChatTabHost, state: ChatState): void {
    const message: ToWebviewMessage = { type: 'state', state: this.composeHeader(state, tab) }
    tab.postMessage(message)
  }

  /**
   * 头部信息区：附着会话的 continuable 子代理（SessionsStore 的 session.list
   * 基线里 origin === 'subagent' 且 parentSessionId 指向它的行，含已完成的）、
   * 全部后台 job（JobsStore 的 mux 基线，含已结束，按官方 JobListAction 行序）、
   * 空会话 hero 区的 workspace 名（workspace.list 基线，blank 会话也在所属
   * workspace 的 sessionIds 里），以及头部只读 preset 标签——渠道对齐官方
   * AgentPresetLabel：session.list 基线的 agentPreset id（官方
   * sessionSummarySchema 字段，创建时即定、新旧会话都有）经 controller 的
   * roster 映射成显示名，roster 的 description 作为悬停 tooltip
   * （presetDescription，对齐官方 AgentPresetLabel 的悬停描述）。空会话由
   * hero 的选择 chip 呈现当前 preset（
   * state.agentPreset 在），标签不重复。附着的是真子代理会话（origin ===
   * 'subagent'）时另合成面包屑父段 parentSession（「父标题 / 子标题」，点击
   * 回父会话，对齐官方 dsh web 的子代理进入逻辑）。字段为空时都缺省，
   * webview 不渲染。
   */
  private composeHeader(state: ChatState, tab: ChatTabHost): ChatState {
    if (!state.sessionId) return state
    // 局部 const 快照：回调闭包里 TS 不对函数参数做属性收窄，后续闭包读取
    // 都走它（sid 在 composeHeader 内只读）。
    const sid = state.sessionId
    const raw = this.store.rawList()
    // 血缘树：直接子代理为顶层项，每项的 children 递归挂各自后代
    // （子代理再开子代理）。每层按 运行中优先 + 新近优先 在纯函数里排好；
    // 状态点由 webview 按 running 字段画。行显示名用 subagent.list 目录的
    // descriptor label（label ?? id），落到 labelFor 层面就是「目录有该子代理用
    // label，没有回退 title/短 id」——对齐官方 dsh web 的菜单行名。
    const subagents = buildSubagentTree(raw, state.sessionId, (s) => this.subagents.labelFor(s.sessionId))
    const jobs = orderJobs(this.jobs.jobs().get(state.sessionId) ?? [])
    // 懒切换的目标 workspace 覆盖：chip 与选择器对勾显示 pending 目标（未发送
    // 前真实的会话所属 workspace 不变，随 send/resolve 落地后由 attach 清标记）。
    const pendingWs = tab.pendingWorkspaceId
      ? this.store.workspaceBaseline.find((w) => w.workspaceId === tab.pendingWorkspaceId)
      : undefined
    const workspaceLabel = pendingWs?.title ?? this.store.workspaceLabelFor(state.sessionId)
    // workspace 选择器数据（空会话 hero chip 的弹层）：全部 workspace 的轻量
    // 投影 + 当前会话所属 workspace 的 id（选中对勾）。基线随 store 刷新重推。
    const workspaces = this.store.workspaceBaseline.map((w) => ({
      workspaceId: w.workspaceId,
      path: w.path,
      title: w.title,
    }))
    const workspaceId =
      pendingWs?.workspaceId ??
      this.store.workspaceBaseline.find((w) => w.sessionIds.includes(sid))?.workspaceId
    const self = raw.find((s) => s.sessionId === state.sessionId)
    // 面包屑父段：只有附着的是真子代理（origin === 'subagent'）才合成
    // 「父会话标题 /」，webview 点击回到父会话（官方 dsh web 的进入逻辑）。
    // 普通 fork 会话虽有 parentSessionId 但不写 origin，不显示父标题。
    const parentId = self?.origin === 'subagent' ? self?.parentSessionId : undefined
    const parent = parentId ? raw.find((s) => s.sessionId === parentId) : undefined
    const parentSession = parentId
      ? { sessionId: parentId, title: parent?.title ?? `会话 ${parentId.slice(0, 8)}` }
      : undefined
    const presetId = self?.agentPreset
    const presetLabel =
      !state.agentPreset && presetId !== undefined ? tab.controller?.agentPresetLabelFor(presetId) : undefined
    const presetDescription =
      !state.agentPreset && presetId !== undefined
        ? tab.controller?.agentPresetDescriptionFor(presetId)
        : undefined
    // 懒切换的 preset/权限 pending 覆盖：chip/pill 显示选中的目标（未发送前
    // 会话真实值不变，随 send/resolve 落地后由清标记恢复真实显示）。
    const pendingPreset = tab.pendingPresetId
      ? state.agentPreset && state.agentPreset.options.some((o) => o.id === tab.pendingPresetId)
        ? { ...state.agentPreset, current: tab.pendingPresetId }
        : state.agentPreset
      : state.agentPreset
    const pendingPermissions = tab.pendingPermission
      ? state.permissions &&
        state.permissions.options.some((o) => o.value === tab.pendingPermission)
        ? { ...state.permissions, current: tab.pendingPermission }
        : state.permissions
      : state.permissions
    return {
      ...state,
      ...(subagents.length > 0 ? { subagents } : {}),
      ...(jobs.length > 0 ? { backgroundJobs: jobs } : {}),
      ...(workspaceLabel ? { workspaceLabel } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(workspaces.length > 0 ? { workspaces } : {}),
      ...(parentSession ? { parentSession } : {}),
      ...(presetLabel ? { presetLabel } : {}),
      ...(presetDescription ? { presetDescription } : {}),
      ...(pendingPreset ? { agentPreset: pendingPreset } : {}),
      ...(pendingPermissions ? { permissions: pendingPermissions } : {}),
    }
  }

  /** Store 快照 + 服务状态，合成面板用的 SessionsSnapshot（推给所有打开的 tab）。 */
  private pushSessions(): void {
    const status = this.manager.getStatus()
    const snapshot: SessionsSnapshot = {
      ...this.store.snapshot(),
      serverState: status.state,
      dshNotFound: status.state === 'error' && status.reason === 'dshNotFound',
      activeSessionId: this.activeSessionId,
      attachedSessionId: this.attachedSessionId,
    }
    const message: ToWebviewMessage = { type: 'sessions', snapshot }
    for (const tab of this.tabs.values()) {
      tab.postMessage(message)
    }
  }

  /**
   * 右键「发送到当前会话」：把当前文件作为附件暂存到**当前活动 chat tab**
   * 的 composer，与点「添加附件」等价。无活动 tab 时自动打开当前 workspace
   * 最新的会话 tab，一个都没有则新建；图片走图片附件（缩略图 + 限额校验），
   * 其他文件以路径 chip 暂存，发送时拼进 prompt 让 agent 自己读。
   */
  async attachFileToSession(arg: unknown): Promise<void> {
    const target = contextMenuResource(arg)
    const active = vscode.window.activeTextEditor?.document.uri
    const fsPath = target?.fsPath ?? active?.fsPath
    const scheme = target?.scheme ?? active?.scheme
    if (!fsPath) {
      vscode.window.showWarningMessage(vscode.l10n.t('No file to send: open a file in the editor first, or right-click a file in the explorer.'))
      return
    }
    if (scheme !== undefined && scheme !== 'file') {
      vscode.window.showWarningMessage(vscode.l10n.t('Only local files can be sent (current resource scheme is {0}).', scheme))
      return
    }
    const status = await this.manager.ensureStarted()
    if (status.state !== 'running' || !status.url) {
      vscode.window.showErrorMessage(vscode.l10n.t('DSH service is not ready; cannot send the file.'))
      return
    }
    // 目标 = 当前活动 chat tab；焦点不在 chat tab（如正在看文件）时回退到
    // 最近活动过的会话 tab；都没有 → 最新会话 tab，没有则新建一个。
    let targetId = this.activeTab()?.sessionId ?? null
    if (!targetId && this.lastActiveSessionId && this.tabs.has(this.lastActiveSessionId)) {
      targetId = this.lastActiveSessionId
    }
    if (!targetId) {
      targetId = this.store.latestCurrentSessionId() ?? (await this.ensureNewSession())
      if (!targetId) return
    }
    // 已开 → 聚焦；用户关过 → 重建 tab；没开过 → 新建。总让 tab 出现。
    this.openSession(targetId)
    const tab = this.tabs.get(targetId)
    if (!tab || !tab.controller) return
    await tab.stageContextFile(fsPath)
    tab.reveal()
    tab.flushStaged()
  }

  /**
   * 空会话 hero 懒切换：只记录目标 workspace 并重推 state（chip/对勾显示
   * pending 目标），**不发任何 RPC、不换 controller**——真正切换推迟到
   * 下一次 send / setAgentPreset 的 {@link resolvePendingWorkspace}，让点
   * 击切换瞬时完成、把等待移进发送动作本身。目标等于当前会话所属 workspace
   * 时解释为取消（点当前显示项是取消手势）；基线里找不到目标（刚被删除）也
   * 取消。per-tab：状态挂在 ChatTabHost.pendingWorkspaceId 上（多 tab 各自
   * 独立，不串台）。
   */
  setPendingWorkspace(host: ChatTabHost, workspaceId: string): void {
    const cur = host.controller?.sessionId
    const current = cur
      ? this.store.workspaceBaseline.find((w) => w.sessionIds.includes(cur))?.workspaceId
      : undefined
    host.pendingWorkspaceId =
      workspaceId === current || !this.store.workspaceBaseline.some((w) => w.workspaceId === workspaceId)
        ? null
        : workspaceId
    if (host.controller) this.push(host, host.controller.getState())
  }

  /**
   * 发送/选 preset 前落地懒切换：在 pending 目标 workspace 下复用/新建 blank
   * 会话（dshRpc.ensureSession，官方 connectWorkspace 语义）并打开附着。
   * 成功返回 true；失败清理标记并返回 false（错误提示在 openWorkspaceSession）。
   */
  async resolvePendingWorkspace(host: ChatTabHost): Promise<boolean> {
    const workspaceId = host.pendingWorkspaceId
    if (!workspaceId) return true
    host.pendingWorkspaceId = null
    const workspace = this.store.workspaceBaseline.find((w) => w.workspaceId === workspaceId)
    if (!workspace) return false
    const ok = await this.openWorkspaceSession(workspace)
    if (!ok && host.controller) this.push(host, host.controller.getState())
    return ok
  }

  /**
   * 空会话 hero 的 preset 懒切换（与 workspace 同模式）：只记录目标并重推
   * state（chip 显示选中项），**不发 setAgentPreset RPC**——真正落地推迟到
   * 发送时（resolvePendingPreset），让点击切换零等待、不打断 hero 布局。
   * preset 不在会话列表（被删）或已与会话当前一致时取消。
   */
  setPendingPreset(host: ChatTabHost, presetId: string): void {
    const ap = host.controller?.getState().agentPreset
    host.pendingPresetId =
      !ap || ap.current === presetId || !ap.options.some((o) => o.id === presetId)
        ? null
        : presetId
    if (host.controller) this.push(host, host.controller.getState())
  }

  /** 发送前落地 pending preset：真正 setAgentPreset；失败只记日志不阻塞发送。 */
  async resolvePendingPreset(host: ChatTabHost): Promise<void> {
    const presetId = host.pendingPresetId
    if (!presetId) return
    host.pendingPresetId = null
    const target = host.controller
    if (!target) return
    try {
      await target.setAgentPreset(presetId)
    } catch (err) {
      this.logger.warn(`chat: resolvePendingPreset(${presetId}) failed — ${errorText(err)}`)
    }
  }

  /**
   * 权限模式懒切换：只记录目标并重推 state（pill 显示选中项），**不发
   * /permission 命令**——真正落地推迟到发送时（resolvePendingPermission），
   * 避免命令节点进消息流把空态 hero 变成消息流 tab。目标等于当前值时取消。
   */
  setPendingPermission(host: ChatTabHost, value: string): void {
    const perms = host.controller?.getState().permissions
    host.pendingPermission =
      !perms || perms.current === value || !perms.options.some((o) => o.value === value)
        ? null
        : value
    if (host.controller) this.push(host, host.controller.getState())
  }

  /** 发送前落地 pending 权限：执行 /permission 命令；失败只记日志不阻塞发送。 */
  async resolvePendingPermission(host: ChatTabHost): Promise<void> {
    const value = host.pendingPermission
    if (!value) return
    host.pendingPermission = null
    const controller = host.controller
    if (!controller) return
    try {
      await executeCommand(controller.url, controller.sessionId, `/permission ${value}`)
    } catch (err) {
      this.logger.warn(`chat: resolvePendingPermission(${value}) failed — ${errorText(err)}`)
    }
  }

  /** hero picker「添加已有文件夹…」：复用 dshOne.workspace.add 命令（VSCode
   *  原生目录对话框 → workspace.create），注册成功后设为懒切换目标（用户
   *  发送时才真正切过去；命令返回注册结果，取消/失败返回 undefined——
   *  错误提示由命令负责）。 */
  async addWorkspaceAndOpen(host: ChatTabHost): Promise<void> {
    const workspace = await vscode.commands.executeCommand<WorkspaceView | undefined>('dshOne.workspace.add')
    if (!workspace) return
    // 等基线刷新包含新 workspace 再设 pending（setPendingWorkspace 校验基线）。
    await this.store.refresh()
    this.setPendingWorkspace(host, workspace.workspaceId)
  }

  /** hero picker「创建工作区…」：复用 dshOne.workspace.create 命令（在
   *  ~/.dsh/workspaces/ 下建目录并注册），成功后设为懒切换目标。 */
  async createWorkspaceAndOpen(host: ChatTabHost): Promise<void> {
    const workspace = await vscode.commands.executeCommand<WorkspaceView | undefined>('dshOne.workspace.create')
    if (!workspace) return
    await this.store.refresh()
    this.setPendingWorkspace(host, workspace.workspaceId)
  }

  /** 在目标 workspace 下复用/新建 blank 会话并打开；成功返回 true。 */
  private async openWorkspaceSession(
    workspace: Pick<WorkspaceView, 'workspaceId' | 'sessionIds' | 'path'>,
  ): Promise<boolean> {
    const url = this.store.runningUrl
    if (!url) return false
    try {
      const sessionId = await ensureSession(url, workspace)
      this.openSession(sessionId)
      return true
    } catch (error) {
      this.logger.warn(`workspace: switch to ${workspace.workspaceId} failed: ${errorText(error)}`)
      vscode.window.showWarningMessage(vscode.l10n.t('Failed to switch workspace: {0}', errorText(error)))
      return false
    }
  }

  /**
   * 在默认 workspace 下新建会话（右键发送时没有可附着会话的兜底）。
   * 失败或没有可用 workspace 时返回 null 并已提示用户。
   */
  private async ensureNewSession(): Promise<string | null> {
    const url = this.store.runningUrl
    if (!url) return null
    const targetWorkspaceId = this.store.defaultWorkspaceId()
    if (!targetWorkspaceId) {
      vscode.window.showWarningMessage(vscode.l10n.t('No workspace available. Open a folder in VSCode first.'))
      return null
    }
    try {
      const sessionId = await createSession(url, { workspaceId: targetWorkspaceId })
      await this.store.refresh()
      return sessionId
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to create session: {0}', errorText(err)))
      return null
    }
  }

  dispose(): void {
    this.managerSub.dispose()
    this.storeSub.dispose()
    this.jobsSub.dispose()
    this.jobs.dispose()
    this.subagentsSub.dispose()
    this.subagents.dispose()
    for (const tab of [...this.tabs.values()]) {
      tab.dispose()
    }
    this.tabs.clear()
    this.activeEmitter.dispose()
  }
}
