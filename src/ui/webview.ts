import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { browserUrl } from '../server/serverAuth.ts'

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
  iframe { border: 0; width: 100%; height: 100%; display: block; }
  .page {
    height: 100%; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 12px; padding: 24px; box-sizing: border-box;
    font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    text-align: center;
  }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid var(--vscode-editorWidget-border, #555);
    border-top-color: var(--vscode-progressBar-background, #0a84ff);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  pre {
    max-width: 100%; max-height: 40vh; overflow: auto; text-align: left;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 8px; border-radius: 4px; font-size: 11px; white-space: pre-wrap;
  }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; border-radius: 4px; padding: 6px 14px; cursor: pointer;
  }
  .muted { opacity: 0.75; font-size: 12px; }
`

function shellHtml(n: string, body: string): string {
  const csp = [
    "default-src 'none'",
    'frame-src http://127.0.0.1:* http://localhost:*',
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
<body>${body}</body>
</html>`
}

function statusPage(n: string, status: ServerStatus): string {
  let inner: string
  if (status.state === 'error') {
    inner = `
      <div class="page">
        <div><strong>${vscode.l10n.t('DSH service error')}</strong></div>
        <pre>${escapeHtml(status.error ?? 'unknown error')}</pre>
        <button id="retry">${vscode.l10n.t('Retry')}</button>
      </div>`
  } else {
    const label = status.state === 'starting' ? vscode.l10n.t('Starting the DSH service…') : vscode.l10n.t('DSH service is not running')
    const hint =
      status.state === 'starting'
        ? vscode.l10n.t('First use downloads the Node.js runtime and dsh; please wait.')
        : vscode.l10n.t('Click the button below to start the service.')
    inner = `
      <div class="page">
        ${status.state === 'starting' ? '<div class="spinner"></div>' : ''}
        <div><strong>${label}</strong></div>
        <div class="muted">${hint}</div>
        <button id="retry">${status.state === 'starting' ? vscode.l10n.t('Retry') : vscode.l10n.t('Start')}</button>
      </div>`
  }
  const script = `<script nonce="${n}">
    const vscode = acquireVsCodeApi();
    // 窗口 reload 恢复凭据：给面板一个持久状态（serializer 恢复时重新 bind）。
    vscode.setState({});
    document.getElementById('retry').addEventListener('click', () => {
      vscode.postMessage({ type: 'retry' });
    });
  </script>`
  return shellHtml(n, inner + script)
}

function dshFrame(url: string): string {
  // 0.1.2 认证：webview iframe 与原浏览器一样必须先经 ?token= 换 cookie
  // （303 → 干净 /，cookie 按同源存储，后续渲染即无凭证）。
  const target = new URL(browserUrl(url))
  target.searchParams.set('dsh_embed', 'vscode')
  const src = target.href
  const n = nonce()
  const script = `<script nonce="${n}">
    acquireVsCodeApi().setState({});
  </script>`
  return shellHtml(
    n,
    `<iframe src="${escapeHtml(src)}" allow="clipboard-read; clipboard-write"></iframe>${script}`,
  )
}

function render(status: ServerStatus): string {
  return status.state === 'running' && status.url ? dshFrame(status.url) : statusPage(nonce(), status)
}

/** Binds one editor webview panel to the server status. */
function bind(webview: vscode.Webview, manager: ServerManager, onDidDispose: vscode.Event<void>): void {
  webview.html = render(manager.getStatus())
  const sub = manager.onDidChangeState((s) => {
    webview.html = render(s)
  })
  const msg = webview.onDidReceiveMessage((m: { type?: string }) => {
    if (m?.type === 'retry') void manager.ensureStarted()
  })
  onDidDispose(() => {
    sub.dispose()
    msg.dispose()
  })
}

/** Editor 面板的 viewType（窗口 reload 时 serializer 按它匹配恢复）。 */
export const DSH_TAB_VIEW_TYPE = 'dshOne.tab'

/** Open the dsh web UI as a full editor-area tab. */
export function openInTab(manager: ServerManager): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(DSH_TAB_VIEW_TYPE, 'DSH One', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })
  bind(panel.webview, manager, panel.onDidDispose)
  void manager.ensureStarted()
  return panel
}

/**
 * WebviewPanelSerializer 的 deserializeWebviewPanel：reload 后 VSCode 交回的
 * 面板（位置已还原）重新绑定服务状态与 retry 消息；内容随状态订阅刷新。
 */
export async function restoreDshWebTab(panel: vscode.WebviewPanel, manager: ServerManager): Promise<void> {
  bind(panel.webview, manager, panel.onDidDispose)
  void manager.ensureStarted()
}
