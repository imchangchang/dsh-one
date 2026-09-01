import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Logger } from './log.ts'
import { ServerManager } from './server/manager.ts'
import { archiveSession, createSession, deleteWorkspace, ensureWorkspace, forkSession, renameSession } from './server/dshRpc.ts'
import { openInTab } from './ui/webview.ts'
import { formatSessionMention } from './pure/sessionMention.ts'
import { ChatViewProvider } from './ui/chatView.ts'
import { SessionsStore } from './ui/sessionsStore.ts'
import { SessionsTreeProvider, sessionIdOf } from './ui/sessionsTree.ts'
import { StatusBar } from './ui/statusbar.ts'

/** Official dsh product page with the "Get started" install instructions. */
const DSH_INSTALL_URL = 'https://www.deepseek.com/harness/'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/* ---- 侧栏原生 tree 的元素参数解包（右键/标题命令把 tree 元素当第一个参数传入） ---- */
function workspaceElementOf(el: unknown): { workspaceId: string; label: string; path: string; isCurrent: boolean } | null {
  if (el && typeof el === 'object' && (el as { kind?: unknown }).kind === 'workspace') {
    const w = el as { workspaceId: unknown; label: unknown; path: unknown; isCurrent: unknown }
    return {
      workspaceId: String(w.workspaceId),
      label: String(w.label),
      path: String(w.path),
      isCurrent: w.isCurrent === true,
    }
  }
  return null
}
function pathOfArg(el: unknown): string | null {
  if (typeof el === 'string') return el
  const ws = workspaceElementOf(el)
  return ws ? ws.path : null
}
function sessionLabelOf(el: unknown): string | null {
  if (el && typeof el === 'object' && (el as { kind?: unknown }).kind === 'session') {
    const label = (el as { label?: unknown }).label
    return typeof label === 'string' ? label : null
  }
  return null
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger()
  logger.info(`dsh-one activating (platform=${process.platform}/${process.arch})`)

  const manager = new ServerManager(context, logger)

  // Auto-start (or adopt) the dsh web service on activation, so opening the
  // chat/session views never begins with a manual click.
  if (vscode.workspace.getConfiguration('dshOne').get<boolean>('autoStart', true)) {
    void manager.ensureStarted()
  }

  const statusBar = new StatusBar(manager)
  const sessions = new SessionsStore(manager, logger, context.workspaceState)
  const chatView = new ChatViewProvider(manager, logger, context.extensionUri, sessions, () => void sessions.refresh())

  // 侧栏的 sessions 原生 tree：只展示 workspace + session，高亮读 chatView 的
  // activeSessionId（附着的、或懒加载待附着目标），附着变化时刷新。
  const sessionsTree = new SessionsTreeProvider(
    sessions,
    () => chatView.activeSessionId,
    chatView.onActiveSessionChanged,
  )
  const treeView = vscode.window.createTreeView('dshOne.chat', {
    treeDataProvider: sessionsTree,
    showCollapseAll: true,
  })

  // Chat/session reconciliation after every store rebuild: drop the attached
  // session when it vanished host-side (archived/deleted elsewhere), and
  // lazily remember the current workspace's newest session once per server
  // run (拆分后改懒加载：只侧栏高亮，等 panel 打开再落）。
  let autoAttachedUrl: string | null = null
  const reconcileChat = sessions.onDidChange(() => {
    const url = sessions.runningUrl
    if (!url) {
      autoAttachedUrl = null
      return
    }
    const current = chatView.currentSessionId
    if (current && !sessions.hasSession(current)) {
      chatView.setSession(null)
      return
    }
    if (!current && autoAttachedUrl !== url) {
      const latest = sessions.latestCurrentSessionId()
      if (latest) {
        autoAttachedUrl = url
        chatView.setLazyPending(latest)
        // 面板已开着（如服务重启后 controller 被清空）：立刻落地懒加载目标。
        if (chatView.isOpen) chatView.openPanel()
      }
    }
  })

  // 树空态（服务未运行/未安装/无工作区/搜索无结果）：原生 tree 用 message
  // 承载引导文案，交互按钮（启动/安装）走 editor 面板空态与 view/title 命令。
  const treeMessageSub = sessions.onDidChange(() => {
    const status = manager.getStatus()
    if (status.state === 'error' && status.reason === 'dshNotFound') {
      treeView.message = '未检测到 dsh 安装。点击「打开面板」查看安装指南。'
    } else if (status.state !== 'running') {
      treeView.message = 'dsh 服务未运行，暂无会话。可点击「打开面板」启动。'
    } else {
      const snap = sessions.snapshot()
      if (snap.query) {
        treeView.message =
          snap.workspaces.length === 0 ? `没有匹配「${snap.query}」的会话。` : undefined
      } else {
        treeView.message =
          snap.workspaces.length === 0
            ? '暂无工作区。点击上方 + 添加已有文件夹或创建工作区。'
            : undefined
      }
    }
  })

  context.subscriptions.push(
    logger,
    manager,
    statusBar,
    sessions,
    chatView,
    sessionsTree,
    treeView,
    reconcileChat,
    treeMessageSub,
    vscode.commands.registerCommand('dshOne.open', () => {
      void manager.ensureStarted()
      chatView.openPanel()
    }),
    // Status bar click: open the dsh web UI in the system browser (starting
    // the service first when needed).
    vscode.commands.registerCommand('dshOne.openExternal', async () => {
      const status = await manager.ensureStarted()
      if (status.url) await vscode.env.openExternal(vscode.Uri.parse(status.url))
    }),
    vscode.commands.registerCommand('dshOne.openInTab', () => {
      openInTab(manager)
    }),
    vscode.commands.registerCommand('dshOne.restart', async () => {
      await manager.restart()
    }),
    vscode.commands.registerCommand('dshOne.stop', async () => {
      await manager.stop()
    }),
    vscode.commands.registerCommand('dshOne.showLogs', () => {
      logger.show()
    }),
    vscode.commands.registerCommand('dshOne.sessions.refresh', async () => {
      await sessions.refresh()
    }),
    // Click a session in the tree: open (or reveal) the editor panel & attach.
    vscode.commands.registerCommand('dshOne.session.open', (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      if (sessionId) chatView.openSession(sessionId)
    }),
    vscode.commands.registerCommand('dshOne.session.new', async (arg?: unknown) => {
      const url = sessions.runningUrl
      if (!url) return
      const ws = workspaceElementOf(arg)
      const targetWorkspaceId = ws?.workspaceId ?? sessions.defaultWorkspaceId()
      if (!targetWorkspaceId) {
        vscode.window.showWarningMessage('没有可用的 workspace，请先在 VSCode 中打开文件夹。')
        return
      }
      let sessionId: string
      try {
        sessionId = await createSession(url, targetWorkspaceId)
      } catch (err) {
        vscode.window.showErrorMessage(`新建会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      chatView.openSession(sessionId)
    }),
    vscode.commands.registerCommand('dshOne.session.rename', async (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      const url = sessions.runningUrl
      if (!url || !sessionId) return
      const title = await vscode.window.showInputBox({
        title: '重命名会话',
        prompt: '输入新的会话标题',
        value: sessionLabelOf(arg) ?? '',
      })
      if (title === undefined) return
      try {
        await renameSession(url, sessionId, title)
      } catch (err) {
        vscode.window.showErrorMessage(`重命名会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
    }),
    vscode.commands.registerCommand('dshOne.session.archive', async (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      const url = sessions.runningUrl
      if (!url || !sessionId) return
      const label = sessionLabelOf(arg) ?? sessionId
      const pick = await vscode.window.showWarningMessage(
        `确认归档会话「${label}」？归档后会从列表中隐藏。`,
        { modal: true },
        '归档',
      )
      if (pick !== '归档') return
      try {
        await archiveSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(`归档会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      // Archiving the attached chat session drops the chat back to empty.
      if (chatView.currentSessionId === sessionId) chatView.setSession(null)
    }),
    vscode.commands.registerCommand('dshOne.session.fork', async (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      const url = sessions.runningUrl
      if (!url || !sessionId) return
      let newSessionId: string
      try {
        newSessionId = await forkSession(url, sessionId)
      } catch (err) {
        vscode.window.showErrorMessage(`分支会话失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
      chatView.openSession(newSessionId)
    }),
    // 会话右键菜单（view/item/context）：本地置顶/未读状态与剪贴板动作。
    vscode.commands.registerCommand('dshOne.session.pin', (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      if (!sessionId) return
      const pinned = arg && typeof arg === 'object' && (arg as { pinned?: unknown }).pinned === true
      sessions.setPinned(sessionId, !pinned)
    }),
    vscode.commands.registerCommand('dshOne.session.unread', (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      if (!sessionId) return
      const unread = arg && typeof arg === 'object' && (arg as { unread?: unknown }).unread === true
      sessions.setUnread(sessionId, !unread)
    }),
    vscode.commands.registerCommand('dshOne.session.copyReference', async (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      if (!sessionId) return
      const label = sessionLabelOf(arg) ?? sessionId
      await vscode.env.clipboard.writeText(formatSessionMention(label, sessionId))
      void vscode.window.showInformationMessage('已复制会话引用，粘贴到输入框即可 @ 这个会话')
    }),
    vscode.commands.registerCommand('dshOne.session.copyId', async (arg?: unknown) => {
      const sessionId = sessionIdOf(arg)
      if (!sessionId) return
      await vscode.env.clipboard.writeText(sessionId)
      void vscode.window.showInformationMessage('已复制会话 ID')
    }),
    // workspace 右键（view/item/context）：从列表软移除（只删注册记录，会话归未分组）。
    vscode.commands.registerCommand('dshOne.workspace.remove', async (arg?: unknown) => {
      const ws = workspaceElementOf(arg)
      const url = sessions.runningUrl
      if (!ws || !url) return
      const confirm = await vscode.window.showWarningMessage(
        `将把“${ws.label}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。`,
        { modal: true },
        '从列表移除',
      )
      if (!confirm) return
      try {
        await deleteWorkspace(url, ws.workspaceId)
      } catch (error) {
        vscode.window.showWarningMessage(`移除工作区失败：${errorText(error)}`)
        return
      }
      await sessions.refresh()
    }),
    // view/title：搜索、排序、折叠/展开全部。
    vscode.commands.registerCommand('dshOne.sessions.search', async () => {
      const q = await vscode.window.showInputBox({
        title: '搜索会话',
        prompt: '输入关键词过滤会话列表（清空恢复）',
        value: sessions.currentQuery ?? '',
      })
      if (q === undefined) return
      sessions.setQuery(q.trim() === '' ? null : q)
    }),
    vscode.commands.registerCommand('dshOne.sessions.sort', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '最近更新优先', order: 'updatedDesc' as const },
          { label: '最早更新优先', order: 'updatedAsc' as const },
          { label: '按标题排序', order: 'title' as const },
        ],
        { title: '排序方式' },
      )
      if (pick) sessions.setSortOrder(pick.order)
    }),
    vscode.commands.registerCommand('dshOne.sessions.collapseAll', () => {
      sessionsTree.collapseAll()
    }),
    vscode.commands.registerCommand('dshOne.sessions.expandAll', () => {
      sessionsTree.expandAll()
    }),
    // Editor/explorer 右键「发送到当前会话」：把当前文件作为附件暂存到当前
    // 活跃会话的 composer（等同点「添加附件」）。
    vscode.commands.registerCommand('dshOne.session.attachFile', (arg?: unknown) => {
      void chatView.attachFileToSession(arg)
    }),
    vscode.commands.registerCommand('dshOne.workspace.openFolder', async (arg?: unknown) => {
      // 当前工作区已在 VSCode 中打开，无需「打开文件夹」（webview 同款隐藏）。
      const ws = workspaceElementOf(arg)
      if (ws?.isCurrent) return
      const p = pathOfArg(arg)
      if (!p) return
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(p), {
        forceNewWindow: false,
      })
    }),
    vscode.commands.registerCommand('dshOne.workspace.openTerminal', (arg?: unknown) => {
      const p = pathOfArg(arg)
      if (!p) return
      const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
      vscode.window.createTerminal({ name, cwd: p }).show()
    }),
    vscode.commands.registerCommand('dshOne.openInstallPage', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DSH_INSTALL_URL))
    }),
    // Title-area "+": register a picked folder as a new dsh workspace.
    vscode.commands.registerCommand('dshOne.workspace.add', async () => {
      const url = sessions.runningUrl
      if (!url) return
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '添加为 workspace',
        title: '新建 workspace：选择文件夹',
      })
      const path = picked?.[0]?.fsPath
      if (!path) return
      try {
        await ensureWorkspace(url, path)
      } catch (err) {
        vscode.window.showErrorMessage(`新建 workspace 失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
    }),
    // Create a brand-new workspace: make a folder under the dsh global
    // directory (~/.dsh/workspaces/<name>) and register it in one step.
    vscode.commands.registerCommand('dshOne.workspace.create', async () => {
      const url = sessions.runningUrl
      if (!url) return
      const dshHome = path.join(os.homedir(), '.dsh')
      try {
        await fs.access(dshHome)
      } catch {
        vscode.window.showErrorMessage('未找到 dsh 全局目录 ~/.dsh，请先安装并运行一次 dsh 再创建工作区。')
        return
      }
      const workspacesDir = path.join(dshHome, 'workspaces')
      const name = await vscode.window.showInputBox({
        title: '创建工作区',
        prompt: '将在 ~/.dsh/workspaces/ 下创建同名目录，并注册为 dsh workspace。',
        placeHolder: '工作区名称',
        validateInput: async (value) => {
          const trimmed = value.trim()
          if (!trimmed) return '名称不能为空'
          if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..') return '名称不能包含路径分隔符'
          try {
            await fs.access(path.join(workspacesDir, trimmed))
            return '该名称的工作区已存在'
          } catch {
            return null
          }
        },
      })
      if (!name) return
      const dir = path.join(workspacesDir, name.trim())
      try {
        await fs.mkdir(dir, { recursive: true })
        await ensureWorkspace(url, dir)
      } catch (err) {
        vscode.window.showErrorMessage(`创建工作区失败：${errorText(err)}`)
        return
      }
      await sessions.refresh()
    }),
  )
}

export function deactivate(): void {
  // dsh 与 VSCode 生命周期解绑：reload/关窗不再终止 dsh（pidfile 记录身份，
  // 下个窗口 re-own；只有 dshOne.stop/restart 会杀）。本地资源由
  // context.subscriptions 自动 dispose，这里无事可做。
}
