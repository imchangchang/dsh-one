import * as vscode from 'vscode'
import { PANEL_TAB_ICON_PATH } from '../pure/panelTab.ts'

/**
 * webview 面板标签页的图标（#212）：dsh-one 自己的图标，与扩展图标（`package.json`
 * 的 `icon`）是同一份资源，不另造图。
 *
 * 为什么一份资源就够、不需要 `{ light, dark }` 一对：`assets/icon.png` 实际只有两种
 * 像素——全透明底 + 不透明 `#2563EB`（鲸鱼那抹蓝），是**彩色实心图形**而不是深色线条，
 * 两种主题下都看得见（浅色主题背景对比 ≈5.2:1，深色主题的标签栏 `#252526` 下 ≈3.0:1）。
 * 深色线条 + 透明底才需要按主题换一份，那种情况才用 `{ light, dark }`；真要做变体时请
 * 从矢量源重新导出（别手改二进制），并在这里换成一对。
 */
export function panelTabIconPath(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, PANEL_TAB_ICON_PATH)
}
