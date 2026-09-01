import * as vscode from 'vscode'
import type { SessionsStore } from './sessionsStore.ts'
import type { PendingInteraction } from '../pure/chatContract.ts'
import type { SessionNodeModel, WorkspaceNodeModel } from '../pure/sessionTree.ts'
import { UNGROUPED_WORKSPACE_ID } from '../pure/sessionTree.ts'

/**
 * 侧栏 sessions 原生 tree：拆分后把原 webview 里的「sessions 列表」整块从
 * 前端移到 host 端 createTreeView/TreeDataProvider。只展示 workspace 分组 +
 * session 行；原有全部交互（头部工具栏、workspace 行 hover 动作、会话行
 * 菜单/右键菜单）相应地落到 view/title 命令与 view/item/context 右键菜单。
 * 图标与高亮用 VS Code ThemeIcon/ThemeColor 近似官方 dsh web 的像素环/圆点/
 * 图钉（原生 tree 无法承载 webview 的逐像素动画，状态语义经图标+颜色+
 * tooltip 完整保留）。
 */
export type SessionTreeNode =
  | {
      kind: 'workspace'
      workspaceId: string
      label: string
      path: string
      isCurrent: boolean
      /** 「未分组」虚拟组：无路径，不可新建会话/打开终端与文件夹。 */
      ungrouped: boolean
      hasSessions: boolean
      sessions: SessionNodeModel[]
    }
  | {
      kind: 'session'
      sessionId: string
      workspaceId: string
      label: string
      description: string
      running: boolean
      descendantRunning: boolean
      unread: boolean
      pinned: boolean
      pendingInteraction?: PendingInteraction
    }

/** 从任意会话参数（tree 元素 / 裸 sessionId 字符串）提取 sessionId。 */
export function sessionIdOf(el: unknown): string | null {
  if (typeof el === 'string') return el
  if (el && typeof el === 'object' && typeof (el as { sessionId?: unknown }).sessionId === 'string') {
    return (el as { sessionId: string }).sessionId
  }
  return null
}

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionTreeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeNode | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private readonly storeSub: vscode.Disposable
  private readonly activeSub: vscode.Disposable
  /** 折叠/展开所有的一击态：建树时套到每个 workspace 项上，命令后再复位。 */
  private forceCollapsible: vscode.TreeItemCollapsibleState | null = null

  constructor(
    private readonly store: SessionsStore,
    /** 侧栏高亮的会话（附着的、或懒加载待附着目标）。 */
    private readonly getActiveSessionId: () => string | null,
    activeChanged: vscode.Event<string | null>,
  ) {
    this.storeSub = store.onDidChange(() => this.refresh())
    this.activeSub = activeChanged(() => this.refresh())
  }

  getTreeItem(node: SessionTreeNode): vscode.TreeItem {
    return node.kind === 'workspace' ? this.workspaceItem(node) : this.sessionItem(node)
  }

  getChildren(element?: SessionTreeNode): SessionTreeNode[] {
    if (!element) {
      return this.store.snapshot().workspaces.map((w) => this.workspaceNode(w))
    }
    if (element.kind === 'workspace') {
      return element.sessions.map((s) => this.sessionNode(s, element.workspaceId))
    }
    return []
  }

  /** 一键折叠列表里的所有 workspace 组。 */
  collapseAll(): void {
    this.forceCollapsible = vscode.TreeItemCollapsibleState.Collapsed
    this._onDidChangeTreeData.fire(undefined)
  }

  /** 一键展开列表里的所有 workspace 组。 */
  expandAll(): void {
    this.forceCollapsible = vscode.TreeItemCollapsibleState.Expanded
    this._onDidChangeTreeData.fire(undefined)
  }

  private workspaceNode(w: WorkspaceNodeModel): SessionTreeNode {
    return {
      kind: 'workspace',
      workspaceId: w.workspaceId,
      label: w.label,
      path: w.path,
      isCurrent: w.isCurrent,
      ungrouped: w.workspaceId === UNGROUPED_WORKSPACE_ID,
      hasSessions: w.sessions.length > 0,
      sessions: w.sessions,
    }
  }

  private sessionNode(s: SessionNodeModel, workspaceId: string): SessionTreeNode {
    return {
      kind: 'session',
      sessionId: s.sessionId,
      workspaceId,
      label: s.label,
      description: s.description,
      running: s.running,
      descendantRunning: s.descendantRunning,
      unread: s.unread,
      pinned: s.pinned,
      ...(s.pendingInteraction !== undefined ? { pendingInteraction: s.pendingInteraction } : {}),
    }
  }

  private workspaceItem(node: Extract<SessionTreeNode, { kind: 'workspace' }>): vscode.TreeItem {
    const w = node
    const current = this.getActiveSessionId()
    const hasActive = w.sessions.some((s) => s.sessionId === current)
    const collapsible = !w.hasSessions
      ? vscode.TreeItemCollapsibleState.None
      : (this.forceCollapsible ?? vscode.TreeItemCollapsibleState.Collapsed)
    const item = new vscode.TreeItem(w.label, collapsible)
    item.id = `workspace:${w.workspaceId}`
    // 当前文件夹 / 附着会话所在组的文件夹图标染 deepseek 蓝（dsh web 同款标识）。
    item.iconPath = new vscode.ThemeIcon(
      collapsible === vscode.TreeItemCollapsibleState.Expanded ? 'folder-opened' : 'folder',
      w.isCurrent || hasActive ? new vscode.ThemeColor('charts.blue') : undefined,
    )
    item.description = w.isCurrent ? 'vscode/当前' : w.path || undefined
    item.tooltip = w.ungrouped ? '不属于任何工作区的会话' : w.path
    item.contextValue = w.ungrouped ? 'workspace-ungrouped' : 'workspace'
    return item
  }

  private sessionItem(node: Extract<SessionTreeNode, { kind: 'session' }>): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
    item.id = `session:${node.sessionId}`
    item.description = node.description
    item.tooltip = node.label
    item.contextValue = 'session'
    // 行首状态槽：待交互黄点 > 运行中 > 未读 > 置顶（官方语义 pending first）。
    item.iconPath = this.sessionIcon(node)
    item.command = {
      command: 'dshOne.session.open',
      title: '打开会话',
      arguments: [node.sessionId],
    }
    return item
  }

  /** 状态槽图标（themeIcon 近似）：pending 黄环、运行中蓝 sync、未读绿点、置顶图钉。 */
  private sessionIcon(node: Extract<SessionTreeNode, { kind: 'session' }>): vscode.ThemeIcon {
    if (node.pendingInteraction !== undefined) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
    }
    if (node.running || node.descendantRunning) {
      return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.blue'))
    }
    if (node.unread) {
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
    }
    if (node.pinned) {
      return new vscode.ThemeIcon('pinned')
    }
    return new vscode.ThemeIcon('circle-outline')
  }

  /** 常规刷新（store/高亮变化）：重置一击态，交回 VS Code 原生展开持久。 */
  private refresh(): void {
    this.forceCollapsible = null
    this._onDidChangeTreeData.fire(undefined)
  }

  dispose(): void {
    this.storeSub.dispose()
    this.activeSub.dispose()
    this._onDidChangeTreeData.dispose()
  }
}
