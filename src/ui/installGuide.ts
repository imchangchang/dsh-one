import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { Logger } from '../log.ts'
import { createPanelSlot } from '../pure/panelSlot.ts'
import {
  DSH_OFFICIAL_INSTALL_URL,
  INSTALL_SCRIPT_OS_LABEL,
  INSTALL_SCRIPT_OS_ORDER,
  hostOsFromPlatform,
  installCommandFor,
  installOsOrDefault,
  type HostOs,
} from '../pure/installScript.ts'

/**
 * 安装引导 tab（#100）：安装方式单独开一个编辑器 tab（像设置页那样），侧栏只在
 * 这种情况下显示「未安装」状态——窄侧栏放不下平台下拉 + 命令条 + 复制按钮。
 *
 * 页面是**宿主侧普通 HTML**（我们的 HTML + CSS + 内联脚本，文案走
 * `vscode.l10n.t`），不参与装配树：dsh 没装时网关起不来，装配页组装不了。
 * 单例：已开则聚焦（`pure/panelSlot.ts`），不再开第二个 tab。
 */

export const INSTALL_GUIDE_VIEW_TYPE = 'dshOne.installGuide'

/** 单例槽位：面板被用户关掉后槽位自动空出来，下次打开再新建。 */
const guideSlot = createPanelSlot<vscode.WebviewPanel>()

/** 打开（或聚焦）安装引导 tab。 */
export function openInstallGuide(logger: Logger): void {
  const existing = guideSlot.current() !== undefined
  guideSlot.open(() => createGuidePanel(logger))
  logger.info(`install guide tab ${existing ? 'revealed' : 'opened'}`)
}

function createGuidePanel(logger: Logger): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    INSTALL_GUIDE_VIEW_TYPE,
    vscode.l10n.t('Install dsh'),
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  const sub = panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return
    const message = msg as { type?: unknown; os?: unknown }
    if (message.type === 'installGuide:copy') {
      // 命令文本由宿主按平台现算（页面只回一个平台名），剪贴板里落的是本机的
      // 权威版本，不把页面传回的字符串当命令。
      const os = INSTALL_SCRIPT_OS_ORDER.find((candidate) => candidate === message.os)
      if (os === undefined) return
      void vscode.env.clipboard.writeText(installCommandFor(os)).then(
        () => void panel.webview.postMessage({ type: 'installGuide:copied', ok: true }),
        (err: unknown) => {
          logger.warn(`install guide: copy failed: ${err instanceof Error ? err.message : String(err)}`)
          void panel.webview.postMessage({ type: 'installGuide:copied', ok: false })
        },
      )
      return
    }
    if (message.type === 'installGuide:openDocs') {
      void vscode.env.openExternal(vscode.Uri.parse(DSH_OFFICIAL_INSTALL_URL))
    }
  })
  panel.onDidDispose(() => {
    sub.dispose()
    guideSlot.close(panel)
  })
  panel.webview.html = installGuideHtml(hostOsFromPlatform(process.platform))
  return panel
}

/** 各平台命令的页内表：平台下拉切换时页面自己换文案，不用往返宿主。 */
function commandsJson(): string {
  const table: Record<string, string> = {}
  for (const os of INSTALL_SCRIPT_OS_ORDER) table[os] = installCommandFor(os)
  return JSON.stringify(table).replace(/</g, '\\u003c')
}

export function installGuideHtml(hostOs: HostOs | undefined): string {
  const nonce = crypto.randomBytes(16).toString('base64')
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
  ].join('; ')
  const defaultOs = installOsOrDefault(hostOs)
  const options = INSTALL_SCRIPT_OS_ORDER.map(
    (os) =>
      `<option value="${os}"${os === defaultOs ? ' selected' : ''}>${INSTALL_SCRIPT_OS_LABEL[os]}</option>`,
  ).join('')
  const title = vscode.l10n.t('Install dsh')
  const lead = vscode.l10n.t('This sidebar needs dsh. Pick your platform and run the command in a terminal:')
  const platform = vscode.l10n.t('Platform')
  const noteUnofficial = vscode.l10n.t('The script is maintained by dsh-one (unofficial).')
  const noteAfter = vscode.l10n.t('Install it and come back here to start automatically.')
  const docs = vscode.l10n.t('Official installation guide')
  const copy = vscode.l10n.t('Copy')
  const copied = vscode.l10n.t('Copied')
  const copyFailed = vscode.l10n.t('Copy failed')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${title}</title>
    <style>
      body {
        margin: 0; padding: 20px 24px;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: 13px; line-height: 1.6;
        color: var(--vscode-foreground, #ccc);
        background: var(--vscode-editor-background, transparent);
      }
      .page { max-width: 720px; display: flex; flex-direction: column; gap: 10px; }
      h1 { font-size: 16px; font-weight: 600; margin: 0; }
      p { margin: 0; }
      .lead { color: var(--vscode-descriptionForeground, #888); }
      .note { font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; margin: 2px 0; }
      select {
        flex: 0 0 auto; padding: 3px 8px; border-radius: 12px; cursor: pointer;
        font-family: inherit; font-size: 12px; font-weight: 500;
        background: var(--vscode-dropdown-background, var(--vscode-button-background));
        color: var(--vscode-dropdown-foreground, var(--vscode-button-foreground));
        border: 1px solid var(--vscode-dropdown-border, transparent);
      }
      .cmd {
        flex: 1 1 320px; min-width: 0;
        display: flex; align-items: center; gap: 6px;
        background: var(--vscode-editorWidget-background, rgba(127,127,127,.12));
        border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
        border-radius: 12px; padding: 2px 4px 2px 12px;
      }
      code {
        flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px; color: var(--vscode-foreground);
      }
      button {
        padding: 4px 12px; border: 0; border-radius: 4px; cursor: pointer;
        font-family: inherit; font-size: 12px;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      }
      button:hover { background: var(--vscode-button-hoverBackground); }
      button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
      #copy {
        flex: none; padding: 3px 10px; border-radius: 8px; white-space: nowrap;
        background: transparent; color: var(--vscode-descriptionForeground, #888);
      }
      #copy:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); color: var(--vscode-foreground); }
      #docs { align-self: flex-start; }
    </style>
  </head>
  <body>
    <div class="page">
      <h1>${title}</h1>
      <p class="lead">${lead}</p>
      <div class="row">
        <select id="os" aria-label="${platform}">${options}</select>
        <div class="cmd">
          <code id="cmd"></code>
          <button id="copy" type="button">${copy}</button>
        </div>
      </div>
      <p class="note">${noteUnofficial}</p>
      <p class="note">${noteAfter}</p>
      <button id="docs" type="button">${docs}</button>
    </div>
    <script nonce="${nonce}">
      const vscode = globalThis.__DSH_ONE_VSCODE__ || acquireVsCodeApi()
      const COMMANDS = ${commandsJson()}
      const osSelect = document.getElementById('os')
      const code = document.getElementById('cmd')
      const apply = () => {
        const text = COMMANDS[osSelect.value] || ''
        code.textContent = text
        code.title = text
      }
      osSelect.addEventListener('change', apply)
      apply()
      const copyButton = document.getElementById('copy')
      const copyLabel = copyButton.textContent
      copyButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'installGuide:copy', os: osSelect.value })
      })
      document.getElementById('docs').addEventListener('click', () => {
        vscode.postMessage({ type: 'installGuide:openDocs' })
      })
      window.addEventListener('message', (event) => {
        const msg = event.data
        if (!msg || msg.type !== 'installGuide:copied') return
        copyButton.textContent = msg.ok ? ${JSON.stringify(copied)} : ${JSON.stringify(copyFailed)}
        setTimeout(() => { copyButton.textContent = copyLabel }, 2000)
      })
    </script>
  </body>
</html>
`
}
