import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { ServerManager, ServerStatus } from '../server/manager.ts'

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
        <div><strong>DSH 服务出错了</strong></div>
        <pre>${escapeHtml(status.error ?? 'unknown error')}</pre>
        <button id="retry">重试</button>
      </div>`
  } else {
    const label = status.state === 'starting' ? 'DSH 服务启动中…' : 'DSH 服务未运行'
    const hint =
      status.state === 'starting'
        ? '首次使用需要下载 Node.js 与 dsh 运行时，请耐心等待。'
        : '点击下方按钮启动服务。'
    inner = `
      <div class="page">
        ${status.state === 'starting' ? '<div class="spinner"></div>' : ''}
        <div><strong>${label}</strong></div>
        <div class="muted">${hint}</div>
        <button id="retry">${status.state === 'starting' ? '重试' : '启动'}</button>
      </div>`
  }
  const script = `<script nonce="${n}">
    const vscode = acquireVsCodeApi();
    document.getElementById('retry').addEventListener('click', () => {
      vscode.postMessage({ type: 'retry' });
    });
  </script>`
  return shellHtml(n, inner + script)
}

function dshFrame(url: string): string {
  const src = `${url}/?dsh_embed=vscode`
  return shellHtml(
    nonce(),
    `<iframe src="${escapeHtml(src)}" allow="clipboard-read; clipboard-write"></iframe>`,
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

/** Open the dsh web UI as a full editor-area tab. */
export function openInTab(manager: ServerManager): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel('dshOne.tab', 'DSH One', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })
  bind(panel.webview, manager, panel.onDidDispose)
  void manager.ensureStarted()
  return panel
}
