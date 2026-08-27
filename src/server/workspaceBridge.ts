import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import { newWorkspacePaths, type WorkspaceEntry } from '../pure/workspace.ts'
import { callRpc } from './dshRpc.ts'
import type { ServerManager } from './manager.ts'

/**
 * Fusion bridge for empty VSCode windows. dsh's own "open directory" flow
 * (OS-native picker → workspace.create) cannot call back into VSCode, so we
 * watch the host event stream instead: when a new workspace appears in dsh
 * while this window has no folder open, offer to open its path in VSCode —
 * after the reload this window is in the "has folder" state and the
 * preseed path takes over.
 */
export class WorkspaceBridge implements vscode.Disposable {
  private socket: WebSocket | null = null
  private known: WorkspaceEntry[] | null = null
  private readonly prompted = new Set<string>()

  constructor(
    manager: ServerManager,
    private readonly logger: Logger,
  ) {
    manager.onDidChangeState((status) => {
      if (status.state === 'running' && status.url) this.connect(status.url)
      else this.disconnect()
    })
    const current = manager.getStatus()
    if (current.state === 'running' && current.url) this.connect(current.url)
  }

  private connect(url: string): void {
    this.disconnect()
    const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/events.host`)
    this.socket = socket
    socket.onopen = () => {
      this.logger.info('workspace bridge: subscribed to host events')
      void this.refresh(url, true)
    }
    socket.onmessage = (event) => {
      // Frames are {type:'server-request', rpcId, method:<frame type>, payload}.
      if (typeof event.data !== 'string') return
      let method: string | undefined
      try {
        method = (JSON.parse(event.data) as { method?: string }).method
      } catch {
        return
      }
      if (method === 'host/workspace-changed') void this.refresh(url, false)
    }
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
    }
    socket.onerror = () => {
      this.logger.warn('workspace bridge: host event stream errored')
    }
  }

  private disconnect(): void {
    this.socket?.close()
    this.socket = null
    this.known = null
  }

  private async refresh(url: string, baseline: boolean): Promise<void> {
    let items: WorkspaceEntry[]
    try {
      const value = await callRpc<{ items: WorkspaceEntry[] }>(url, 'workspace.list', {})
      items = value.items
    } catch (err) {
      this.logger.warn(`workspace bridge: workspace.list failed — ${err instanceof Error ? err.message : err}`)
      return
    }
    const fresh = this.known && !baseline ? newWorkspacePaths(this.known, items) : []
    this.known = items
    for (const path of fresh) void this.offerOpenFolder(path)
  }

  private async offerOpenFolder(path: string): Promise<void> {
    if (this.prompted.has(path)) return
    this.prompted.add(path)
    // Only empty windows follow dsh — with a folder open we never interrupt.
    if (vscode.workspace.workspaceFolders?.length) return
    const pick = await vscode.window.showInformationMessage(
      `dsh 中打开了目录 ${path}，是否在 VSCode 中打开该文件夹？`,
      '打开',
      '忽略',
    )
    if (pick === '打开') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), { forceNewWindow: false })
    }
  }

  dispose(): void {
    this.disconnect()
  }
}
