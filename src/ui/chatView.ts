import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { ChatSessionController } from '../server/chatSession.ts'
import { executeCommand, renameSession, selectModel, sessionAttachment, sessionModels } from '../server/dshRpc.ts'
import type { SessionModelSelection } from '../server/dshRpc.ts'
import type { ChatState, FromWebviewMessage, OutgoingImage, ToWebviewMessage } from '../pure/chatContract.ts'

/** Media type by file extension (dsh ImageMediaType: png/jpeg/webp/gif). */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

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

/** Human byte size for limit warnings, e.g. "10 MB". */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
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

const STYLE = `
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  .chat-header {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 12px; font-weight: 600; flex: none;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .chat-header .chat-title {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
  }
  .chat-header .rename-session {
    flex: none; background: transparent; border: 0; color: inherit; opacity: 0.6;
    cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 12px; line-height: 1;
  }
  .chat-header .rename-session:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .chat-header .rename-input {
    flex: 1; min-width: 0; font: inherit; font-weight: 600;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; padding: 1px 6px; outline: none;
  }
  .messages {
    flex: 1; overflow-y: auto; padding: 8px 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .muted-hint { opacity: 0.6; font-size: 12px; text-align: center; }
  .command-notice {
    font-size: 0.9em; opacity: 0.8; white-space: pre-wrap; word-break: break-word;
    border-left: 2px solid var(--vscode-panel-border, rgba(127,127,127,.4));
    padding: 4px 10px;
  }
  .msg.user { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
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
  .question-options { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin-top: 6px; }
  .option-btn { text-align: left; display: flex; align-items: baseline; }
  .option-btn::before { content: '•'; flex: none; margin-right: 8px; opacity: 0.5; }
  .option-btn:hover:not(:disabled)::before,
  .option-btn.selected::before { opacity: 1; }
  .option-btn:hover:not(:disabled) { filter: brightness(1.2); outline: 1px solid var(--vscode-focusBorder); }
  .option-btn.selected { outline: 1px solid var(--vscode-focusBorder); }
  .question-detail { margin-top: 6px; }
  .question-detail summary { cursor: pointer; opacity: 0.75; font-size: 0.9em; }
  .question-detail .md {
    margin-top: 6px; max-height: 320px; overflow-y: auto; padding: 8px 10px;
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); border-radius: 6px;
  }
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
    flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .pending + .input-area { border-top: 0; }
  .queue {
    flex: none; padding: 6px 12px; display: flex; flex-direction: column; gap: 4px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .queue-item { display: flex; align-items: baseline; gap: 8px; font-size: 0.9em; }
  .queue-tag {
    flex: none; font-size: 11px; padding: 0 6px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .queue-text {
    opacity: 0.8; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .queue-actions { display: flex; gap: 4px; flex: none; margin-left: auto; }
  .queue-actions button.link {
    background: transparent; color: var(--vscode-textLink-foreground, #4da3ff);
    padding: 0 4px; font-size: 11px; border-radius: 4px;
  }
  .queue-actions button.link:hover { text-decoration: underline; }
  .queue-editor {
    flex: 1; min-width: 0; resize: none; box-sizing: border-box; padding: 4px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; font-family: inherit; font-size: 0.9em;
  }
  .queue + .input-area { border-top: 0; }
  .queue + .queue { border-top: 0; padding-top: 0; }
  .input-row { display: flex; gap: 8px; align-items: flex-end; }
  .input-footer { display: flex; gap: 6px; align-items: center; }
  .stats-row { display: flex; align-items: center; gap: 10px; }
  .stats-row .input-stats { flex: 1; min-width: 0; }
  .input-stats {
    font-size: 11px; opacity: 0.65; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 0; border-radius: 12px; padding: 2px 10px; font-size: 12px; line-height: 18px;
    cursor: pointer; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pill:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.3)); }
  .pill .glyph { display: inline-flex; flex: none; }
  .popover {
    position: fixed; z-index: 20; min-width: 200px; max-width: 340px; max-height: 50vh; overflow-y: auto;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    border-radius: 6px; padding: 4px; box-shadow: 0 4px 16px rgba(0,0,0,.4);
  }
  .menu-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .menu-item .check { width: 12px; flex: none; opacity: 0; }
  .menu-item.checked .check { opacity: 1; }
  .menu-item .glyph { display: inline-flex; flex: none; opacity: .85; }
  .menu-item .menu-right { margin-left: auto; padding-left: 16px; opacity: .65; font-size: .9em; }
  .menu-group { padding: 5px 6px 2px; font-size: .8em; opacity: .55; }
  .menu-hint { padding: 8px; opacity: .7; }
  .slash-popup { max-height: 40vh; }
  .slash-popup .menu-item.selected { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .slash-popup .menu-item.hint-row { cursor: default; opacity: .75; }
  .slash-popup .menu-item.hint-row:hover { background: none; color: inherit; }
  .command-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 2px 10px; font-size: 12px; opacity: .85; }
  .command-row .command-line { font-family: var(--vscode-editor-font-family, monospace); }
  .command-row .command-text { opacity: .75; white-space: pre-wrap; word-break: break-word; }
  .command-row.error .command-text { color: var(--vscode-errorForeground, #f66); opacity: 1; }
  .command-row .spinner { align-self: center; }
  .context-bar { flex: none; width: 72px; padding: 4px 2px; border: 0; background: none; cursor: pointer; }
  .context-bar-track {
    display: block; height: 4px; border-radius: 2px; overflow: hidden;
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.2));
  }
  .context-bar-fill {
    display: block; height: 100%; min-width: 2px; border-radius: 2px;
    background: var(--vscode-descriptionForeground);
  }
  .context-panel { width: 240px; font-size: 12px; line-height: 20px; }
  .context-panel .cp-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .context-panel .cp-percent { font-weight: 600; }
  .context-panel .cp-figures { font-variant-numeric: tabular-nums; opacity: .95; flex: none; }
  .context-panel .cp-bar {
    display: flex; gap: 1px; height: 4px; margin: 10px 0 8px; border-radius: 2px;
    overflow: hidden; background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.2));
  }
  .context-panel .cp-seg { height: 100%; min-width: 2px; border-radius: 1px; }
  .context-panel .cp-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .context-panel .cp-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .context-panel .cp-value { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .95; flex: none; }
  .image-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .image-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    border-radius: 10px; padding: 2px 4px 2px 8px; font-size: 12px;
    max-width: 200px;
  }
  .image-chip .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .image-chip .chip-remove {
    background: transparent; color: inherit; border: 0; padding: 0 4px;
    cursor: pointer; font-size: 12px; line-height: 1; opacity: 0.8;
  }
  .image-chip .chip-remove:hover { opacity: 1; }
  #input {
    flex: 1; resize: none; box-sizing: border-box; padding: 6px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    font-family: inherit; font-size: inherit; max-height: 160px;
  }
  #input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .send-button { flex: none; }
  .msg-images { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .msg-image-chip { cursor: zoom-in; padding-right: 8px; }
  .msg-image-chip:hover { filter: brightness(1.15); }
  .jump-latest {
    position: sticky; bottom: 4px; align-self: flex-end; flex: none;
    margin-bottom: -30px; z-index: 5;
    border-radius: 14px; padding: 4px 12px; font-size: 12px;
    background: var(--vscode-editorWidget-background, var(--vscode-button-secondaryBackground, rgba(127,127,127,.3)));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35));
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
  }
  .jump-latest:hover { filter: brightness(1.1); }
  .lightbox {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 30; cursor: zoom-out;
  }
  .lightbox img { max-width: 95%; max-height: 95%; }
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
    // Message attachments render as data: URLs fetched via session.attachment.
    "img-src data:",
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
    /** Fired after a chat-initiated session mutation (e.g. rename) so the tree can rebuild. */
    private readonly onSessionsChanged?: () => void,
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
          const images = Array.isArray(m.images) ? m.images : []
          if (!text && images.length === 0) return
          // Leading-slash lines are commands, not prompts (same routing as the
          // official web composer); session.prompt would leak them to the model.
          if (text.startsWith('/')) {
            await this.runCommand(controller, text, images)
            return
          }
          await controller.send(text, images, m.steer === true)
          return
        }
        case 'stop': {
          const restored = await controller.stop()
          if (restored.length > 0) {
            const message: ToWebviewMessage = { type: 'restoreDraft', text: restored.join('\n') }
            void this.view?.webview.postMessage(message)
          }
          return
        }
        case 'approval':
          await controller.respondApproval(m.rpcId, m.outcome)
          return
        case 'answer':
          await controller.answerQuestion(m.rpcId, m.answers)
          return
        case 'pickFiles':
          await this.pickFiles(controller)
          return
        case 'filesPasted':
          await this.stagePastedFiles(controller, Array.isArray(m.files) ? m.files : [])
          return
        case 'requestModels':
          await this.sendModelCatalog(controller)
          return
        case 'setModel':
          await this.applyModelSelection(controller, {
            provider: m.provider,
            model: m.model,
            reasoningEffort: m.reasoningEffort,
          })
          return
        case 'setPermission':
          await this.setPermission(controller, m.value)
          return
        case 'renameSession':
          await this.renameCurrentSession(controller, m.title)
          return
        case 'queueEdit':
          await controller.editQueued(m.itemId, m.text)
          return
        case 'queueSteer':
          await controller.steerQueued(m.itemId)
          return
        case 'queueRemove':
          await controller.removeQueued(m.itemId)
          return
        case 'requestAttachment':
          await this.sendAttachment(controller, m.attachmentId)
          return
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.logger.warn(`chat: ${m.type} failed — ${detail}`)
      vscode.window.showErrorMessage(`聊天操作失败：${detail}`)
    }
  }

  /** Fetch the session's model catalog and push it to the webview's model menu. */
  private async sendModelCatalog(controller: ChatSessionController): Promise<void> {
    try {
      const models = await sessionModels(controller.url, controller.sessionId)
      const message: ToWebviewMessage = {
        type: 'modelCatalog',
        catalog: {
          current: models.current,
          groups: models.groups.map((g) => ({
            id: g.id,
            name: g.name,
            models: g.models.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              efforts: m.reasoning?.efforts ?? [],
              defaultEffort: m.reasoning?.defaultEffort,
            })),
          })),
        },
      }
      void this.view?.webview.postMessage(message)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`获取模型列表失败：${detail}`)
    }
  }

  /** Fetch one attachment's bytes and push them to the webview for inline rendering. */
  private async sendAttachment(controller: ChatSessionController, attachmentId: string): Promise<void> {
    if (typeof attachmentId !== 'string' || !attachmentId) return
    try {
      const { mediaType, data } = await sessionAttachment(controller.url, controller.sessionId, attachmentId)
      const message: ToWebviewMessage = { type: 'attachmentData', attachmentId, mediaType, data }
      void this.view?.webview.postMessage(message)
    } catch (err) {
      // Thumbnail stays a placeholder; not worth an error popup.
      const detail = err instanceof Error ? err.message : String(err)
      this.logger.warn(`chat: attachment ${attachmentId} fetch failed — ${detail}`)
    }
  }

  private async applyModelSelection(
    controller: ChatSessionController,
    selection: SessionModelSelection,
  ): Promise<void> {
    try {
      await selectModel(controller.url, controller.sessionId, selection)
      await controller.refreshModels()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`切换模型失败：${detail}`)
    }
  }

  /**
   * Permission preset switch; rides the /permission slash command through the
   * dedicated command channel (session.prompt would not dispatch it). Mirrors
   * the web client: `danger-full-access` requires an explicit risk
   * confirmation first. The resulting permission/preset event refreshes the
   * footer pill through the permissions projection push.
   */
  private async setPermission(controller: ChatSessionController, value: string): Promise<void> {
    if (value === 'danger-full-access') {
      const confirm = await vscode.window.showWarningMessage(
        '确认启用 Full access？启用后 agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
        { modal: true },
        '启用 Full access',
      )
      if (!confirm) return
    }
    await this.runCommand(controller, `/permission ${value}`)
  }

  /**
   * Execute one slash-command line. Matched commands need no local echo: the
   * host logs command/run before the handler and command/done after it, and
   * those events render as flow nodes in the message stream (same as the
   * official web client). Only an unmatched line — which logs nothing
   * host-side — gets a composer notice here.
   */
  private async runCommand(
    controller: ChatSessionController,
    line: string,
    images?: OutgoingImage[],
  ): Promise<void> {
    const outcome = await executeCommand(controller.url, controller.sessionId, line, images)
    if (!outcome.matched) {
      const message: ToWebviewMessage = { type: 'commandResult', text: `未知或格式错误的命令：${line}` }
      void this.view?.webview.postMessage(message)
    }
  }

  /** Rename the attached session; the title projection push refreshes the header. */
  private async renameCurrentSession(controller: ChatSessionController, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      await renameSession(controller.url, controller.sessionId, trimmed)
      this.onSessionsChanged?.()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`重命名会话失败：${detail}`)
    }
  }

  /**
   * Attachment picker: images are read into base64 and staged via the shared
   * validator; any other file already lives on disk, so it is staged as a
   * path chip (no temp copy needed).
   */
  private async pickFiles(controller: ChatSessionController): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: '添加附件',
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
        skipped.push(`${name}（读取失败：${err instanceof Error ? err.message : String(err)}）`)
        continue
      }
      images.push({ mediaType, data: Buffer.from(data).toString('base64'), name })
    }
    this.stageImages(controller, images, skipped)
    if (paths.length > 0) {
      const message: ToWebviewMessage = {
        type: 'filesPicked',
        files: paths.map((p) => ({ name: path.basename(p), path: p })),
      }
      void this.view?.webview.postMessage(message)
    }
  }

  /**
   * Paste intake: every clipboard file becomes an attachment. Images (sniffed
   * from bytes, or a declared image/* type) go through the same staging and
   * limit validation as the picker; anything else is written to a temp file
   * and staged as a path chip for the agent to read.
   */
  private async stagePastedFiles(controller: ChatSessionController, files: OutgoingImage[]): Promise<void> {
    if (files.length === 0) return
    const images: OutgoingImage[] = []
    const staged: Array<{ name: string; path: string }> = []
    const skipped: string[] = []
    for (const file of files) {
      const name = file.name ?? '附件'
      const bytes = Buffer.from(file.data, 'base64')
      const mediaType = sniffImageMediaType(bytes) ?? file.mediaType.trim().toLowerCase()
      if (mediaType.startsWith('image/')) {
        images.push({ ...file, mediaType })
        continue
      }
      try {
        staged.push({ name, path: await this.saveTempAttachment(name, bytes) })
      } catch (err) {
        skipped.push(`${name}（写入临时文件失败：${err instanceof Error ? err.message : String(err)}）`)
      }
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(`已跳过 ${skipped.length} 个文件：${skipped.join('；')}`)
    }
    this.stageImages(controller, images)
    if (staged.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: staged }
      void this.view?.webview.postMessage(message)
    }
  }

  /** Persist a non-image paste under the OS temp dir; returns the file path. */
  private async saveTempAttachment(name: string, bytes: Buffer): Promise<string> {
    const dir = path.join(os.tmpdir(), 'dsh-one-attachments')
    await fs.mkdir(dir, { recursive: true })
    const safe = name.replace(/[^\w.-]+/g, '_') || 'attachment'
    const file = path.join(dir, `${Date.now()}-${safe}`)
    await fs.writeFile(file, bytes)
    this.logger.info(`chat: pasted file saved to ${file}`)
    return file
  }

  /**
   * Validate staged images (from the picker or a webview paste) against the
   * session's image limits, then post the accepted ones back to the webview.
   */
  private stageImages(controller: ChatSessionController, images: OutgoingImage[], skipped: string[] = []): void {
    if (images.length === 0 && skipped.length === 0) return
    const limits = controller.imageLimits
    const accepted: OutgoingImage[] = []
    let acceptedBytes = 0
    for (const image of images) {
      const name = image.name ?? '图片'
      const byteLength = Buffer.from(image.data, 'base64').byteLength
      const mediaType = image.mediaType.trim().toLowerCase()
      if (limits && !limits.mediaTypes.some((t) => t.trim().toLowerCase() === mediaType)) {
        skipped.push(`${name}（不支持的格式：${image.mediaType || '未知'}；支持 ${limits.mediaTypes.join('、')}）`)
        this.logger.warn(`chat: image rejected — mediaType=${JSON.stringify(image.mediaType)}, allowed=${JSON.stringify(limits.mediaTypes)}`)
        continue
      }
      if (limits) {
        if (accepted.length >= limits.maxImagesPerMessage) {
          skipped.push(`${name}（每条消息最多 ${limits.maxImagesPerMessage} 张图片）`)
          continue
        }
        if (byteLength > limits.maxImageBytes) {
          skipped.push(`${name}（超过单张 ${formatBytes(limits.maxImageBytes)} 限制）`)
          continue
        }
        if (acceptedBytes + byteLength > limits.maxMessageImageBytes) {
          skipped.push(`${name}（超过单条消息图片总大小 ${formatBytes(limits.maxMessageImageBytes)} 限制）`)
          continue
        }
      }
      accepted.push(image)
      acceptedBytes += byteLength
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(`已跳过 ${skipped.length} 个文件：${skipped.join('；')}`)
    }
    if (accepted.length > 0) {
      const message: ToWebviewMessage = { type: 'imagesPicked', images: accepted }
      void this.view?.webview.postMessage(message)
    }
  }

  dispose(): void {
    this.managerSub.dispose()
    this.controllerSub?.dispose()
    this.controller?.dispose()
    this.controller = null
  }
}
