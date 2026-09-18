/**
 * 面板标签页的共用口径（#212）：标题格式与图标路径。三处 webview 面板（对话 /
 * 设置 / 安装引导）都从这里取，改口径只改这一处。
 *
 * 标题格式 `dsh · <主体>`：
 * - 带上产品名：VS Code 标签页上只有标题，带 `dsh` 用户才认得出这个标签页是谁开的
 *   （官方 dsh web 的浏览器标签同样带产品名）；
 * - 用中点 `·` 分隔：标签页很窄，中点比 `:`、`-` 视觉重量轻，也不会跟标题里本来就有的
 *   连字符打架；
 * - 主体取**人话**：会话标题 / 工作区名 / 「对话」这类词。**绝不放会话 id 片段**——那是
 *   一串对用户没有信息量的字符（#212 之前标题未知时显示的就是 `session-47…` 这样的片段）。
 */

/** 标题前缀：产品名（官方品牌写作小写 `dsh`）。 */
export const PANEL_TAB_PRODUCT = 'dsh'

/** 标题分隔符：空格 + 中点 + 空格。 */
export const PANEL_TAB_SEPARATOR = ' · '

/**
 * 标签页图标相对扩展根的位置（`assets/` 不在 `.vscodeignore` 里，随 vsix 一起发布）。
 * 与 `package.json` 的扩展图标是同一份资源。
 */
export const PANEL_TAB_ICON_PATH = 'assets/icon.png'

/** 三个面板共用的标题格式：`dsh · <主体>`。 */
export function panelTabTitle(subject: string): string {
  return `${PANEL_TAB_PRODUCT}${PANEL_TAB_SEPARATOR}${subject}`
}

/** 对话面板标题的主体：会话标题 → 工作区名 → 「对话」。 */
export function chatPanelSubject(params: {
  /** 页面（session-boot 插件）报上来的会话标题；未知或空串都算「还不知道」。 */
  sessionTitle?: string | undefined
  /** 当前窗口的工作区名（VS Code 单文件夹 / 多根工作区的名字）。 */
  workspaceName?: string | undefined
  /** 「对话」的本地化串（宿主侧由调用方 `vscode.l10n.t` 取）。 */
  chatLabel: string
}): string {
  for (const candidate of [params.sessionTitle, params.workspaceName]) {
    const trimmed = candidate?.trim()
    if (trimmed !== undefined && trimmed !== '') return trimmed
  }
  return params.chatLabel
}

/**
 * 对话面板的完整标题。
 *
 * 会话标题由页面在会话数据到达后才上报（`dshOne.sessionMeta`），所以面板刚建出来的
 * 那一小段通常落到后两级：有工作区名就显示工作区名（比「对话」更能说明这个标签页是
 * 哪个窗口的），实在没有才用「对话」把标题撑住。
 */
export function chatPanelTabTitle(params: {
  sessionTitle?: string | undefined
  workspaceName?: string | undefined
  chatLabel: string
}): string {
  return panelTabTitle(chatPanelSubject(params))
}
