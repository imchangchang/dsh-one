import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { SidebarStatusView } from '../pure/sidebarStatus.ts'

/**
 * 侧栏状态页（#100）：三态各自的宿主侧普通 HTML——不参与装配树，也就不依赖
 * dsh 网关（dsh 未安装时网关起不来，装配页组装不了，只能由宿主直接给页面）。
 *
 * 页面上只有文案与按钮，动作经 postMessage 回宿主：`assembly:openInstallGuide`
 * 开安装引导 tab、`assembly:start` 起服务、`assembly:retry` 重试装配。
 */

/** 文案过 HTML 转义（装配失败详情来自错误字符串，可能含尖括号）。 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 三态 → { 标题?, 说明, 次要说明?, 详情?, 按钮? }。 */
function contentOf(view: SidebarStatusView): {
  title?: string
  hint: string
  note?: string
  detail?: string
  button?: { label: string; message: string }
} {
  if (view.kind === 'notInstalled') {
    return {
      title: vscode.l10n.t('dsh is not installed'),
      hint: vscode.l10n.t('Install it and come back here to start automatically.'),
      button: { label: vscode.l10n.t('View install guide'), message: 'assembly:openInstallGuide' },
    }
  }
  if (view.kind === 'assemblyFailed') {
    return {
      hint: vscode.l10n.t('DSH sidebar failed to load: {0}', view.detail),
      button: { label: vscode.l10n.t('Retry'), message: 'assembly:retry' },
    }
  }
  if (view.starting) {
    return {
      hint: vscode.l10n.t('Starting the dsh service…'),
      // 首次启动（刚装完 dsh）要初始化 profile/依赖，时间长——显式告诉用户是在
      // 准备而非卡死（与旧侧栏空态同一句话）。
      note: vscode.l10n.t('The first start may take a while (preparing profiles and dependencies).'),
    }
  }
  return {
    hint: vscode.l10n.t('The dsh service is not running. Start it to load this sidebar.'),
    ...(view.detail === undefined ? {} : { detail: view.detail }),
    button: { label: vscode.l10n.t('Start the dsh service'), message: 'assembly:start' },
  }
}

export function sidebarStatusHtml(view: SidebarStatusView): string {
  const nonce = crypto.randomBytes(16).toString('base64')
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
  ].join('; ')
  const content = contentOf(view)
  const button =
    content.button === undefined
      ? ''
      : `<button id="dsh-action" type="button" data-message="${escapeHtml(content.button.message)}">${escapeHtml(content.button.label)}</button>`
  const title = content.title === undefined ? '' : `<div class="title">${escapeHtml(content.title)}</div>`
  const note = content.note === undefined ? '' : `<div class="note">${escapeHtml(content.note)}</div>`
  const detail = content.detail === undefined ? '' : `<div class="detail">${escapeHtml(content.detail)}</div>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>DSH One</title>
    <style>
      body {
        margin: 0; padding: 14px 12px;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: 13px;
        color: var(--vscode-foreground, #ccc);
      }
      .box { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .title { font-weight: 600; }
      .hint { color: var(--vscode-descriptionForeground, #888); }
      .note { font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
      .detail {
        max-height: 40vh; overflow: auto; max-width: 100%; box-sizing: border-box;
        padding: 6px 8px; border-radius: 4px;
        background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.1));
        border-left: 2px solid var(--vscode-textBlockQuote-border, rgba(127,127,127,.4));
        font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
        white-space: pre-wrap; word-break: break-word;
      }
      button {
        padding: 4px 12px; border: 0; border-radius: 2px; cursor: pointer;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      }
      button:hover { background: var(--vscode-button-hoverBackground); }
      button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    </style>
    <script nonce="${nonce}">
      const vscode = globalThis.__DSH_ONE_VSCODE__ || acquireVsCodeApi()
      document.addEventListener('click', (e) => {
        const target = e.target && e.target.closest ? e.target.closest('#dsh-action') : null
        if (target) vscode.postMessage({ type: target.dataset.message })
      })
    </script>
  </head>
  <body>
    <div class="box">
      ${title}
      <div class="hint">${escapeHtml(content.hint)}</div>
      ${note}
      ${detail}
      ${button}
    </div>
  </body>
</html>
`
}
