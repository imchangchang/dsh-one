import * as vscode from 'vscode'
import { existsSync, readFileSync } from 'node:fs'

/**
 * 当前 locale 的 webview 译文 map（JSON 串，注入 HTML）。key=英文默认串，
 * 与宿主 l10n 的 bundle 同文件：非 en 语言读 l10n/bundle.l10n.<locale>.json
 * （VS Code 对默认语言不加载 bundle，en 直接不注入，webview 用 key 本身）；
 * 无对应文件/读失败时同样返回 null。locale 变化只能在窗口 reload 后生效：
 * 面板重建时按当时 env.language 重新读，无需持久化。
 * 侧栏 sessions webview 与装配页探针注入同形态（见 ui/assembly/pageHtml.ts）。
 */
export function loadWebviewL10n(extensionUri: vscode.Uri): string | null {
  const locale = vscode.env.language
  if (!locale || locale === 'en') return null
  const file = vscode.Uri.joinPath(extensionUri, 'l10n', `bundle.l10n.${locale}.json`)
  try {
    if (!existsSync(file.fsPath)) return null
    return JSON.stringify(JSON.parse(readFileSync(file.fsPath, 'utf8')) as Record<string, string>)
  } catch {
    return null
  }
}
