import * as vscode from 'vscode'
import type { Logger } from '../log.ts'
import { createPanelSlot } from '../pure/panelSlot.ts'
import {
  DSH_OFFICIAL_INSTALL_URL,
  INSTALL_SCRIPT_OS_ORDER,
  hostOsFromPlatform,
  installCommandFor,
  type HostOs,
} from '../pure/installScript.ts'
import { installGuidePageHtml, type InstallGuideTexts } from '../pure/installGuidePage.ts'

/**
 * 安装引导 tab（#100 落地、#105 改版）：安装方式单独开一个编辑器 tab（像设置页那样），
 * 侧栏只在「未安装」状态下指向它——窄侧栏放不下平台下拉 + 命令条 + 复制按钮。
 *
 * 页面是**宿主侧普通 HTML**（我们的 HTML + CSS + 内联脚本，文案走
 * `vscode.l10n.t`，拼装在 `pure/installGuidePage.ts`），不参与装配树：dsh 没装时
 * 网关起不来，装配页组装不了。单例：已开则聚焦（`pure/panelSlot.ts`）。
 *
 * 页面只回「平台名」或一个动作名，命令文本一律由宿主现算后写剪贴板（#100 定的口径）。
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
      return
    }
    if (message.type === 'installGuide:openWeb') {
      // 官方 dsh web 地址与启动/鉴权细节都在既有命令里（它会先确保服务在跑，
      // 再开带 token 的本机地址）——引导页不另起一套 URL 拼装。
      void vscode.commands.executeCommand('dshOne.openExternal')
    }
  })
  panel.onDidDispose(() => {
    sub.dispose()
    guideSlot.close(panel)
  })
  panel.webview.html = installGuideHtml(hostOsFromPlatform(process.platform))
  return panel
}

/** 宿主侧文案（英文默认串走 `vscode.l10n.t`，翻译在 l10n/bundle.l10n.zh-cn.json）。 */
function guideTexts(): InstallGuideTexts {
  return {
    heroTitle: vscode.l10n.t('Install dsh'),
    heroLead: vscode.l10n.t(
      'dsh powers this sidebar. Pick your platform, run one command, then come back here.',
    ),
    installButton: vscode.l10n.t('Install dsh'),
    platformLabel: vscode.l10n.t('Platform'),
    copy: vscode.l10n.t('Copy command'),
    copied: vscode.l10n.t('Copied'),
    copyFailed: vscode.l10n.t('Copy failed'),
    docsLink: vscode.l10n.t('Official installation guide'),
    terminalTab: vscode.l10n.t('Terminal install'),
    editorTab: vscode.l10n.t('Editor setup'),
    terminalSteps: [
      vscode.l10n.t('Open a terminal in VS Code (or your system terminal).'),
      vscode.l10n.t('Paste the command above and press Enter.'),
      vscode.l10n.t('The first run takes a minute or two — dsh prepares profiles and dependencies.'),
    ],
    unofficialNote: vscode.l10n.t('The script is maintained by dsh-one (unofficial).'),
    editorLead: vscode.l10n.t(
      'Back in VS Code, DSH One starts the dsh service and loads your sessions automatically — no extra setup.',
    ),
    editorNote: vscode.l10n.t('You can also use the official dsh web interface in a browser.'),
    openWeb: vscode.l10n.t('Open dsh web'),
  }
}

export function installGuideHtml(hostOs: HostOs | undefined): string {
  return installGuidePageHtml(hostOs, guideTexts())
}
