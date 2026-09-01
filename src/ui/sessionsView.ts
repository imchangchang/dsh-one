import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { deleteWorkspace, renameSession } from '../server/dshRpc.ts'
import { formatSessionMention } from '../pure/sessionMention.ts'
import type { FromWebviewMessage, SessionsSnapshot } from '../pure/chatContract.ts'
import type { SessionsStore } from './sessionsStore.ts'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
function nonce(): string {
  return crypto.randomBytes(16).toString('base64')
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SESSIONS_STYLE = `
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  .sessions-panel {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    background: var(--vscode-sideBar-background, transparent);
  }
  .sessions-header {
    flex: none; display: flex; align-items: center; gap: 2px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  /* 搜索框外裹一个相对定位容器，✕ 清空按钮绝对定位其右侧。 */
  .search-wrap {
    flex: 1; min-width: 0; position: relative;
    display: flex; align-items: center;
  }
  .sessions-search {
    flex: 1; min-width: 0; padding: 3px 22px 3px 6px; font-family: inherit; font-size: 12px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
  }
  .sessions-search:focus { outline: 1px solid var(--vscode-focusBorder); }
  /* 一键清除 ✕：默认隐藏，输入非空时显示；半透明 hover 变实，风格同 .sessions-tool。 */
  .search-clear {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    width: 20px; height: 20px; padding: 0;
    display: none; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 3px;
    color: var(--vscode-descriptionForeground, #888); opacity: 0.7; cursor: pointer;
  }
  .search-wrap.has-text .search-clear { display: inline-flex; }
  .search-clear:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .search-clear svg { display: block; }
  .sessions-tool {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; background: transparent; border: 0;
    color: inherit; opacity: 0.7; cursor: pointer; border-radius: 4px;
  }
  .sessions-tool:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .sessions-tool svg { display: block; }
  /* 刷新中：图标短暂旋转 + 按钮变灰，给出操作反馈。 */
  .sessions-tool.refreshing svg { animation: dsh-tool-spin 0.6s linear infinite; }
  @keyframes dsh-tool-spin { to { transform: rotate(360deg); } }
  .sessions-tool:disabled { opacity: 0.5; cursor: default; }
  .sessions-list { flex: 1; overflow-y: auto; padding: 2px 0; }
  .workspace-row {
    display: flex; align-items: center; gap: 6px; padding: 0 10px;
    height: 32px; box-sizing: border-box; overflow: hidden;
    font-weight: 600; font-size: 12px; cursor: pointer;
  }
  .workspace-row:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  /* 行首图标槽：默认文件夹图标，hover 换成实心三角（dsh web 分组行模式）。 */
  .ws-folder, .ws-arrow {
    flex: none; width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
  }
  .ws-arrow { display: none; }
  .workspace-row:hover .ws-arrow { display: inline-flex; }
  .workspace-row:hover .ws-folder { display: none; }
  /* 空组无可展开内容：hover 不切换成三角，保持闭合文件夹图标。 */
  .workspace-row.empty:hover .ws-arrow { display: none; }
  .workspace-row.empty:hover .ws-folder { display: inline-flex; }
  /* 附着会话所在 workspace 的文件夹图标染 deepseek 蓝（dsh web 同款标识）。 */
  .workspace-row.has-active .ws-folder { color: var(--vscode-charts-blue, #5686fe); }
  .ws-arrow svg { transition: transform .15s ease; }
  .workspace-row.expanded .ws-arrow svg { transform: rotate(90deg); }
  /* label + counts 包在组里：组占 flex:1（badge 仍右对齐），组内 counts 紧跟
     label 文本（label 只收缩不伸展，省略号行为不变）。 */
  .workspace-label-group {
    flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px;
  }
  .workspace-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 组名右侧角标：待交互/运行中/未读 计数（小字 + 小图标，紧凑、不挤压 label/badge）。 */
  .ws-counts { flex: none; display: inline-flex; align-items: center; gap: 6px; }
  .ws-count { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; line-height: 1; opacity: 0.75; }
  .workspace-badge {
    flex: none; font-size: 10px; font-weight: 400; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .session-row {
    display: flex; align-items: center; gap: 6px; margin: 0 4px; padding: 0 6px 0 12px;
    height: 32px; box-sizing: border-box; overflow: hidden;
    cursor: pointer; border-radius: 4px; font-size: 12px;
  }
  .session-row:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  /* 会话菜单打开期间保持来源行的 hover 背景（webview.ts 的 .menu-open）。 */
  .session-row.menu-open { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  .session-row.active {
    background: var(--vscode-list-activeSelectionBackground, rgba(0,122,204,.35));
    color: var(--vscode-list-activeSelectionForeground, inherit);
  }
  /* 行首状态槽：宽度固定（对齐官方 dsh web 的 16px slot），四种标记同一位置
     居中——待交互黄点 > 运行中像素环 > 已完成/未读绿点 > 置顶图钉；空闲会话留空。 */
  .session-status {
    width: 16px; height: 16px; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
  }
  /* 槽内图钉（strokeSvg 固定输出 14px，缩到 13px 与槽匹配）。 */
  .session-status svg.pin-icon { width: 13px; height: 13px; display: block; color: var(--vscode-descriptionForeground); }
  /* 运行中：官方 dsh web StateDot(ongoing) 的 8 格像素环追逐动画，deepseek 蓝。 */
  .session-spin { display: block; color: var(--vscode-charts-blue, #5686fe); }
  .session-spin rect { fill: currentColor; opacity: 0.15; animation: session-spin-chase 1s infinite; }
  @keyframes session-spin-chase {
    0%, 12.4% { opacity: 1; }
    12.5%, 24.9% { opacity: 0.6; }
    25%, 37.4% { opacity: 0.35; }
    37.5%, to { opacity: 0.15; }
  }
  /* 已完成/未读提醒：绿色实心点 + 标题加粗（对齐官方 StateDot completed
     「已完成」视觉；本地未读沿用同一槽位，仅换颜色，合并逻辑不变）。 */
  .session-dot {
    width: 6px; height: 6px; border-radius: 50%;
  }
  .session-dot.completed { background: var(--vscode-charts-green, #89d185); }
  /* 待审批/待回答/计划待审：黄色实心点（官方 StateDot warning，
     --dsw-alias-state-warn-primary 的 VS Code 对应色）。 */
  .session-dot.warning { background: var(--vscode-charts-yellow, #e5c07b); }
  .session-title.unread { font-weight: 600; }
  /* 组合状态（置顶 + 运行中/未读）时被挤出槽位的图钉，退到标题前。
     main 的 flex gap 已有 8px，用 -2px margin 收回到与行 gap 一致的 6px。 */
  .session-pin {
    flex: none; width: 14px; height: 14px; margin-right: -2px;
    color: var(--vscode-descriptionForeground);
    display: inline-flex; align-items: center; align-self: center;
  }
  .session-pin svg { width: 14px; height: 14px; display: block; }
  /* 紧凑单行：标题省略号 + 右对齐的相对时间（对齐原原生树的观感）。 */
  .session-main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
  .session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 行内重命名输入框：对齐 chat 内改名（session/main 内的 rename-input）。 */
  .session-main .rename-input {
    flex: 1; min-width: 0; font: inherit; font-weight: 500;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; padding: 1px 6px; outline: none;
  }
  .session-time { flex: none; font-size: 11px; opacity: 0.55; }
  .row-actions { display: none; gap: 2px; flex: none; }
  .session-row:hover .row-actions, .workspace-row:hover .row-actions { display: inline-flex; }
  /* 菜单打开期间 ⋯ 按钮不随 hover 离开而消失。 */
  .session-row.menu-open .row-actions { display: inline-flex; }
  .row-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; padding: 0; background: transparent; border: 0;
    color: inherit; opacity: 0.7; cursor: pointer; border-radius: 3px;
  }
  .row-action:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .row-action svg { display: block; }
  .sessions-empty {
    padding: 20px 12px; display: flex; flex-direction: column; align-items: center;
    gap: 6px; text-align: center;
  }
  .sessions-empty .empty-hint { font-size: 12px; }
  .sessions-empty button { margin-top: 4px; }
  /* 内容命中的片段块：跟会话行下面，暗色小字最多 2 行，点击与父行一致。 */
  .session-snippet {
    margin: 0 4px 0 12px; padding: 1px 6px 2px; font-size: 11px; line-height: 16px;
    color: var(--vscode-descriptionForeground, #888);
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    word-break: break-word; cursor: pointer; border-radius: 4px;
  }
  .session-snippet:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  /* 命中关键词高亮：加粗 + 变色（无底色，用户要求"加底色不好看"）。对内容片段、
     会话行标题、workspace 组名三处统一生效。 */
  .session-snippet .dsh-mark,
  .session-title .dsh-mark,
  .workspace-label .dsh-mark {
    font-weight: 600; color: var(--vscode-charts-blue, #5686fe); background: none;
  }
  /* 内容搜索结果超过 20 条的底部轻提示（非交互）。 */
  .sessions-search-more { padding: 6px 12px; font-size: 11px; opacity: 0.6; }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; border-radius: 4px; padding: 4px 12px; cursor: pointer;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .popover {
    position: fixed; z-index: 20; min-width: 180px; max-width: 340px; max-height: 50vh; overflow-y: auto;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    border-radius: 12px; padding: 4px;
    box-shadow: 0 0 1px 0 rgba(0,0,0,.2), 0 12px 32px 0 rgba(0,0,0,.14);
  }
  /* 菜单项几何对齐 dsh web：30px 行高、8px 圆角、左图标位 14px tertiary 色。 */
  .menu-item {
    display: flex; align-items: center; gap: 8px; min-height: 30px; box-sizing: border-box;
    padding: 4px 10px; border-radius: 8px; cursor: pointer; white-space: nowrap; font-size: 12px;
  }
  .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  /* 禁用态菜单项：置灰、cursor 默认、hover 无高亮（onClick 未绑定）。 */
  .menu-item.disabled,
  .menu-item.disabled:hover {
    opacity: .45; cursor: default; background: none; color: inherit;
  }
  .menu-item .menu-item-icon {
    flex: none; width: 14px; height: 14px; display: inline-flex;
    align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
  }
  .menu-item .menu-item-icon svg { width: 14px; height: 14px; display: block; }
  /* 选中态的 check 放菜单项尾部（dsh web 模式），仅 checked 时渲染。 */
  .menu-item .check { margin-left: auto; flex: none; }
  .menu-item .glyph { display: inline-flex; flex: none; opacity: .85; }
  .menu-item .menu-right { margin-left: auto; padding-left: 16px; opacity: .65; font-size: .9em; }
  .menu-group { padding: 5px 6px 2px; font-size: .8em; opacity: .55; }
  .menu-hint { padding: 8px; opacity: .7; }
  /* 自实现悬停提示：fixed 定位挂在 body 上，不随 .sessions-list 滚动裁剪。
     pre-wrap 让含换行的 data-tip（如降级详情）多行展示，长词可折行。 */
  .dsh-tooltip {
    position: fixed; z-index: 40; pointer-events: none;
    padding: 3px 8px; border-radius: 6px; font-size: 11px; line-height: 16px;
    white-space: pre-wrap; word-break: break-word; max-width: 380px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
`

function sessionsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const n = nonce()
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'sessionsWebview.js'))
  // Same CSP discipline as the chat webview: nonce-gated scripts, no remote resources.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${n}'`,
  ].join('; ')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${SESSIONS_STYLE}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${escapeHtml(scriptUri.toString())}"></script>
</body>
</html>`
}

/**
 * Sidebar sessions view (`dshOne.chat`): a WebviewViewProvider that renders
 * the sessions list only (no chat). Split in from the original combined
 * webview. Owns the SessionsStore snapshot push（含 activeSessionId，供高亮），
 * routes sessions-panel actions back. Session/workspace actions that touch the
 * editor panel or do RPC are forwarded to extension.ts commands (which open
 * the editor chat panel); pure store ops (search/sort/pin/unread/collapse/
 * refresh) fall directly on the store.
 */
export class SessionsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null
  private readonly managerSub: vscode.Disposable
  private readonly storeSub: vscode.Disposable
  private readonly activeSub: vscode.Disposable

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly extensionUri: vscode.Uri,
    private readonly store: SessionsStore,
    /** 高亮会话 id（附着的、或懒加载待附着目标），来自 editor 面板。 */
    private readonly getActiveSessionId: () => string | null,
    /** editor 面板真实附着的会话 id（面板未开为 null），行内重命名判定用。 */
    private readonly getAttachedSessionId: () => string | null,
    activeChanged: vscode.Event<string | null>,
  ) {
    this.managerSub = manager.onDidChangeState(() => this.pushSessions())
    this.storeSub = store.onDidChange(() => this.pushSessions())
    this.activeSub = activeChanged(() => this.pushSessions())
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    }
    view.webview.html = sessionsHtml(view.webview, this.extensionUri)
    const msg = view.webview.onDidReceiveMessage((m: FromWebviewMessage) => void this.onMessage(m))
    view.onDidDispose(() => {
      msg.dispose()
      if (this.view === view) this.view = null
    })
    this.pushSessions()
  }

  /** Store 快照 + 服务状态 + 当前高亮会话，合成面板用的 SessionsSnapshot。 */
  private pushSessions(): void {
    if (!this.view) return
    const status = this.manager.getStatus()
    const snapshot: SessionsSnapshot = {
      ...this.store.snapshot(),
      serverState: status.state,
      dshNotFound: status.state === 'error' && status.reason === 'dshNotFound',
      activeSessionId: this.getActiveSessionId(),
      attachedSessionId: this.getAttachedSessionId(),
    }
    const message: { type: 'sessions'; snapshot: SessionsSnapshot } = { type: 'sessions', snapshot }
    void this.view.webview.postMessage(message)
  }

  private async onMessage(m: FromWebviewMessage): Promise<void> {
    if (!m || typeof m.type !== 'string') return
    switch (m.type) {
      // 打开/更新 editor 面板并附着（复用 extension 命令，其内部 openSession）。
      case 'sessionOpen':
        void vscode.commands.executeCommand('dshOne.session.open', m.sessionId)
        return
      case 'sessionNew':
        void vscode.commands.executeCommand('dshOne.session.new', m.workspaceId)
        return
      case 'sessionRename':
        void vscode.commands.executeCommand('dshOne.session.rename', m.sessionId, m.title)
        return
      case 'sessionRenameDirect':
        void this.renameSessionDirect(m.sessionId, m.title)
        return
      case 'sessionArchive':
        void vscode.commands.executeCommand('dshOne.session.archive', m.sessionId, m.title)
        return
      case 'sessionFork':
        void vscode.commands.executeCommand('dshOne.session.fork', m.sessionId)
        return
      case 'workspaceAdd':
        void vscode.commands.executeCommand('dshOne.workspace.add')
        return
      case 'workspaceCreate':
        void vscode.commands.executeCommand('dshOne.workspace.create')
        return
      case 'workspaceOpenFolder':
        void vscode.commands.executeCommand('dshOne.workspace.openFolder', m.path)
        return
      case 'workspaceOpenTerminal':
        void vscode.commands.executeCommand('dshOne.workspace.openTerminal', m.path)
        return
      case 'workspaceRemove':
        void this.removeWorkspace(m.workspaceId, m.label)
        return
      // 纯 store 本地操作。
      case 'sessionsRefresh':
        void this.store.refresh()
        return
      case 'sessionsSearch':
        this.store.setQuery(typeof m.query === 'string' && m.query.trim() !== '' ? m.query : null)
        return
      case 'sessionsSort':
        this.store.setSortOrder(m.order)
        return
      case 'sessionPin':
        this.store.setPinned(m.sessionId, m.pin)
        return
      case 'sessionUnread':
        this.store.setUnread(m.sessionId, m.unread)
        return
      case 'workspaceCollapse':
        this.store.setCollapsed(m.workspaceId, m.collapsed)
        return
      case 'workspacesCollapseAll':
        this.store.collapseAll()
        return
      case 'workspacesExpandAll':
        this.store.expandAll()
        return
      case 'sessionCopyReference': {
        const mention = formatSessionMention(m.title, m.sessionId)
        await vscode.env.clipboard.writeText(mention)
        void vscode.window.showInformationMessage('已复制会话引用，粘贴到输入框即可 @ 这个会话')
        return
      }
      case 'serverStart':
        void this.manager.ensureStarted()
        return
      case 'openInstallPage':
        void vscode.commands.executeCommand('dshOne.openInstallPage')
        return
      default:
        return
    }
  }

  /** 行内重命名直接提交：绕过 showInputBox 弹窗，RPC 改名 + 刷新基线。 */
  private async renameSessionDirect(sessionId: string, title: string): Promise<void> {
    const url = this.store.runningUrl
    const trimmed = title.trim()
    if (!url || !trimmed) return
    try {
      await renameSession(url, sessionId, trimmed)
    } catch (err) {
      this.logger.warn(`sessions: rename ${sessionId} failed: ${errorText(err)}`)
      return
    }
    await this.store.refresh()
  }

  /**
   * 软移除 workspace（dsh web 同款语义）：modal 确认后调 host 的
   * workspace.delete——只删注册表记录，磁盘文件夹与会话日志保留，
   * 组内会话归入「未分组」。
   */
  private async removeWorkspace(workspaceId: string, label: string): Promise<void> {
    const url = this.store.runningUrl
    if (!url) return
    const confirm = await vscode.window.showWarningMessage(
      `将把“${label}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。`,
      { modal: true },
      '从列表移除',
    )
    if (!confirm) return
    try {
      await deleteWorkspace(url, workspaceId)
    } catch (error) {
      this.logger.warn(`workspace: remove ${workspaceId} failed: ${errorText(error)}`)
      vscode.window.showWarningMessage(`移除工作区失败：${errorText(error)}`)
      return
    }
    await this.store.refresh()
  }

  dispose(): void {
    this.managerSub.dispose()
    this.storeSub.dispose()
    this.activeSub.dispose()
  }
}
