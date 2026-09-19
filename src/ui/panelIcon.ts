import * as vscode from 'vscode'
import { PANEL_TAB_ICON_PATH } from '../pure/panelTab.ts'

/**
 * webview 面板标签页的图标（#212）：**dsh 官方品牌 favicon**（`assets/dsh-favicon.svg`），
 * 与 #68 之前那一版实现用的同一份资源（出处 `14fbb136`）。
 *
 * 为什么一份资源就够、不需要 `{ light, dark }` 一对：这份 svg 是彩色实心图形（鲸鱼那抹蓝），
 * 浅色与深色主题下都看得见；而且它就是当年一直在用的那一份，没出过主题下的可见性问题。
 * 深色线条 + 透明底那种资源才需要按主题换一份；真要做变体时请从矢量源重新导出
 * （别手改二进制），并在这里换成一对。
 */
export function panelTabIconPath(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, PANEL_TAB_ICON_PATH)
}
