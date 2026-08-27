import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { ChatSessionController } from '../server/chatSession.ts'
import type { ChatState, FromWebviewMessage, ToWebviewMessage } from '../pure/chatContract.ts'

/** Pushed when no session is attached; the webview renders the empty state. */
const EMPTY_STATE: ChatState = {
  sessionId: null,
  messages: [],
  pending: [],
  running: false,
  canSend: false,
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

const STYLE = `
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  .chat-header {
    padding: 4px 12px; font-weight: 600; flex: none;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .messages {
    flex: 1; overflow-y: auto; padding: 8px 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .muted-hint { opacity: 0.6; font-size: 12px; text-align: center; }
  .msg.user { display: flex; justify-content: flex-end; }
  .msg.user .bubble {
    max-width: 85%; padding: 6px 10px; border-radius: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    white-space: pre-wrap; word-break: break-word;
  }
  .msg.assistant { display: flex; flex-direction: column; gap: 6px; }
  .md { line-height: 1.5; word-break: break-word; }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md pre {
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 8px; border-radius: 4px; overflow-x: auto;
  }
  .md code {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em;
  }
  .reasoning {
    border-left: 2px solid var(--vscode-panel-border, rgba(127,127,127,.4));
    padding-left: 8px;
  }
  .msg.context {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.25));
    border-radius: 6px; padding: 4px 10px; opacity: 0.8; font-size: 0.9em;
  }
  .msg.context summary { cursor: pointer; }
  .context-body {
    white-space: pre-wrap; word-break: break-word; margin-top: 6px;
    max-height: 300px; overflow-y: auto; opacity: 0.85;
  }
  .reasoning summary { cursor: pointer; opacity: 0.75; font-size: 0.9em; }
  .reasoning-body { white-space: pre-wrap; font-size: 0.9em; opacity: 0.8; margin-top: 4px; }
  .tool {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    border-radius: 6px; padding: 6px 10px; font-size: 0.92em;
  }
  .tool-head { display: flex; align-items: center; gap: 6px; }
  .tool-name { font-weight: 600; font-family: var(--vscode-editor-font-family, monospace); }
  .tool-title { opacity: 0.85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-detail {
    opacity: 0.7; margin-top: 2px; font-size: 0.88em;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tool-status-done { color: var(--vscode-testing-iconPassed, #73c991); }
  .tool-status-error { color: var(--vscode-testing-iconFailed, #f14c4c); }
  .spinner {
    width: 12px; height: 12px; border-radius: 50%; flex: none;
    border: 2px solid var(--vscode-editorWidget-border, #555);
    border-top-color: var(--vscode-progressBar-background, #0a84ff);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tool-output summary { cursor: pointer; opacity: 0.75; margin-top: 4px; }
  .tool-output pre {
    max-height: 200px; overflow: auto; white-space: pre-wrap;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 6px; border-radius: 4px; font-size: 0.88em;
  }
  .diff {
    margin-top: 4px; border-radius: 4px; overflow: hidden;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.88em;
  }
  .diff-line { white-space: pre-wrap; padding: 0 6px; }
  .diff-line.del { background: var(--vscode-diffEditor-removedTextBackground, rgba(255,80,80,.18)); }
  .diff-line.del::before { content: '- '; }
  .diff-line.add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(80,255,80,.14)); }
  .diff-line.add::before { content: '+ '; }
  .streaming { opacity: 0.6; }
  .interrupted { opacity: 0.6; font-size: 0.85em; }
  .pending {
    flex: none; padding: 6px 12px; display: flex; flex-direction: column; gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .pending-card {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35));
    border-radius: 6px; padding: 8px 10px;
    background: var(--vscode-editorWidget-background, transparent);
  }
  .pending-title { font-weight: 600; }
  .pending-reason { opacity: 0.8; font-size: 0.9em; margin-top: 2px; white-space: pre-wrap; }
  .pending-actions { display: flex; gap: 8px; margin-top: 8px; }
  .question + .question { margin-top: 10px; }
  .question-header { font-size: 0.8em; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
  .question-text { white-space: pre-wrap; }
  .question-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .option-btn.selected { outline: 1px solid var(--vscode-focusBorder); }
  .question label.checkbox {
    display: flex; gap: 6px; align-items: baseline; margin-top: 4px; cursor: pointer;
  }
  .question input[type='text'] {
    width: 100%; box-sizing: border-box; margin-top: 6px; padding: 4px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
  }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; border-radius: 4px; padding: 4px 12px; cursor: pointer;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .input-area {
    flex: none; display: flex; gap: 8px; padding: 8px 12px; align-items: flex-end;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .pending + .input-area { border-top: 0; }
  #input {
    flex: 1; resize: none; box-sizing: border-box; padding: 6px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    font-family: inherit; font-size: inherit; max-height: 160px;
  }
  #input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .send-button { flex: none; }
  .empty {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 8px; padding: 24px; text-align: center;
  }
  .empty-title { font-weight: 600; }
  .empty-hint { opacity: 0.7; font-size: 0.9em; }
`

function chatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const n = nonce()
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'chatWebview.js'))
  // Same CSP discipline as ui/webview.ts: nonce-gated scripts, no remote resources.
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
<style>${STYLE}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${escapeHtml(scriptUri.toString())}"></script>
</body>
</html>`
}

/**
 * Native chat view (`dshOne.chat`): owns the current ChatSessionController,
 * pushes its (throttled) ChatState snapshots to the webview verbatim and
 * routes user actions back. With no session — or a non-running server — the
 * webview gets EMPTY_STATE and shows its placeholder copy.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null
  private controller: ChatSessionController | null = null
  private controllerSub: vscode.Disposable | null = null
  private readonly managerSub: vscode.Disposable

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.managerSub = manager.onDidChangeState((s) => this.onServerState(s))
  }

  /** Session currently shown, null when the view is in its empty state. */
  get currentSessionId(): string | null {
    return this.controller?.sessionId ?? null
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    }
    view.webview.html = chatHtml(view.webview, this.extensionUri)
    const msg = view.webview.onDidReceiveMessage((m: FromWebviewMessage) => void this.onMessage(m))
    view.onDidDispose(() => {
      msg.dispose()
      if (this.view === view) this.view = null
    })
    // A late-resolved view still needs the state attached before it appeared.
    this.push(this.controller?.getState() ?? EMPTY_STATE)
  }

  /**
   * Attach a session: the old controller is disposed, a new one is created
   * and its current state is pushed immediately. `null` returns to the
   * empty state.
   */
  setSession(sessionId: string | null): void {
    if (sessionId !== null && sessionId === this.currentSessionId) return
    if (!sessionId) {
      this.attach(null)
      return
    }
    const status = this.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (!url) {
      this.logger.warn(`chat: setSession(${sessionId}) ignored — server not running`)
      this.attach(null)
      return
    }
    this.attach(new ChatSessionController(url, sessionId, this.logger))
  }

  private attach(controller: ChatSessionController | null): void {
    this.controllerSub?.dispose()
    this.controllerSub = null
    this.controller?.dispose()
    this.controller = controller
    if (controller) {
      this.controllerSub = controller.onDidChange((state) => this.push(state))
    }
    this.push(controller?.getState() ?? EMPTY_STATE)
  }

  private onServerState(status: ServerStatus): void {
    // Server down → empty state; restarted under a new URL → the old
    // controller talks to a dead server, drop it too.
    if (status.state !== 'running' || !status.url) {
      this.attach(null)
    } else if (this.controller && this.controller.url !== status.url) {
      this.attach(null)
    }
  }

  private push(state: ChatState): void {
    const message: ToWebviewMessage = { type: 'state', state }
    void this.view?.webview.postMessage(message)
  }

  private async onMessage(m: FromWebviewMessage): Promise<void> {
    const controller = this.controller
    if (!controller || !m || typeof m.type !== 'string') return
    try {
      switch (m.type) {
        case 'send': {
          const text = typeof m.text === 'string' ? m.text.trim() : ''
          if (!text) return
          await controller.send(text)
          return
        }
        case 'stop':
          await controller.stop()
          return
        case 'approval':
          await controller.respondApproval(m.rpcId, m.outcome)
          return
        case 'answer':
          await controller.answerQuestion(m.rpcId, m.answer)
          return
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.logger.warn(`chat: ${m.type} failed — ${detail}`)
      vscode.window.showErrorMessage(`聊天操作失败：${detail}`)
    }
  }

  dispose(): void {
    this.managerSub.dispose()
    this.controllerSub?.dispose()
    this.controller?.dispose()
    this.controller = null
  }
}
