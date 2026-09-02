/**
 * Pure helpers for resolving the resource a context-menu command was invoked
 * on. VSCode passes different argument shapes per menu location — the
 * explorer hands the resource `Uri` directly, `editor/context` may hand an
 * args object like `{ resourceUri }` — and the host falls back to the active
 * editor. No vscode import; duck-typed so it stays unit-testable.
 */

/** The local file a context-menu command should act on. */
export interface ContextMenuResource {
  /** Absolute on-disk path (Uri.fsPath semantics). */
  fsPath: string
  /**
   * Declared URI scheme when the source carried one ('file' for local files);
   * undefined for bare { fsPath } blobs with no scheme info.
   */
  scheme?: string
}

/** Whether a value looks like a VSCode Uri (fsPath string, optional scheme). */
function isUriLike(v: unknown): v is { fsPath: string; scheme?: string } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.fsPath === 'string' && (o.scheme === undefined || typeof o.scheme === 'string')
}

/**
 * Resolve the resource from a context-menu command's first argument. Accepts
 * the `Uri` itself, an args object carrying `resourceUri` / `uri` (the two
 * shapes VSCode actually passes), or a bare `{ fsPath }` blob; undefined when
 * none of them names a local path. The caller falls back to the active editor.
 */
export function contextMenuResource(arg: unknown): ContextMenuResource | undefined {
  if (isUriLike(arg)) {
    return { fsPath: arg.fsPath, scheme: arg.scheme }
  }
  if (arg && typeof arg === 'object') {
    const o = arg as Record<string, unknown>
    for (const key of ['resourceUri', 'uri'] as const) {
      if (isUriLike(o[key])) {
        const target = o[key]
        return { fsPath: target.fsPath, scheme: target.scheme }
      }
    }
  }
  return undefined
}

/**
 * chat 面板编辑器 tab 的资源 URI 前缀（VS Code 内部实现：webview panel 的 tab
 * 资源 path 形如 `webview-panel/webview-<viewType>-<id>`，见 webviewEditorInput.ts；
 * package.json 的 editor/title/context 菜单 when 用同款正则匹配它）。失效时菜单
 * 不出现（优雅降级），这里仅作命令侧的防御校验。
 */
const CHAT_TAB_URI_PREFIX = 'webview-panel/webview-dshOne.chatPanel-'

/** 命令参数是否指向 chat 面板 tab（editor/title/context 传的是被右键 tab 的资源 URI）。 */
export function isChatPanelTabArg(arg: unknown): boolean {
  if (!arg || typeof arg !== 'object') return false
  const o = arg as Record<string, unknown>
  if (o.scheme !== 'webview-panel') return false
  const p = typeof o.path === 'string' ? o.path : typeof o.fsPath === 'string' ? o.fsPath : ''
  return p.startsWith(CHAT_TAB_URI_PREFIX)
}
