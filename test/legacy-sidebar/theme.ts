/**
 * VS Code 默认深色主题里那几个 `--vscode-*` token 的取值。
 *
 * 为什么需要：旧侧栏只认 VS Code 主题变量（`sessionsView.ts` 顶部那条注释写明了这个
 * 依赖），而 harness 里没有 VS Code——不给这组变量，`font-family` / `font-size` /
 * `color` 全部落到浏览器初值，截图与几何都对不上真窗口里的样子。
 *
 * 值从哪儿来：本体沿用仓库里既有的那份表（`test/install-guide/smoke.mjs` 的
 * `THEMES.dark`，那是同一类「宿主侧页面在浏览器里的底色」问题），旧侧栏另用到、
 * 那份表里没有的 token 按 VS Code 内置默认深色主题的取值补齐。
 *
 * 一处 VS Code 宿主行为也照抄：webview 的**默认样式**（内置 `defaultStyles`）会给
 * `body` 上编辑器底色，所以下面的 CSS 里也带上——旧侧栏自己不设背景。
 */
const NATIVE_DARK_THEME: Readonly<Record<string, string>> = {
  // 字形与基准字号：VS Code 的 `editor.fontFamily` / `editor.fontSize` 默认档。
  '--vscode-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  '--vscode-font-size': '13px',
  '--vscode-editor-font-family': "'Droid Sans Mono', 'monospace', monospace",

  '--vscode-foreground': '#cccccc',
  '--vscode-descriptionForeground': 'rgba(204,204,204,0.7)',
  '--vscode-errorForeground': '#f85149',
  '--vscode-focusBorder': '#0078d4',

  '--vscode-editor-background': '#1e1e1e',
  '--vscode-editorWidget-background': '#202020',
  '--vscode-sideBar-background': '#252526',
  '--vscode-panel-border': 'rgba(128,128,128,0.35)',

  '--vscode-badge-background': '#4d4d4d',
  '--vscode-badge-foreground': '#ffffff',
  '--vscode-button-background': '#0e639c',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-secondaryBackground': '#3a3d41',
  '--vscode-button-secondaryForeground': '#ffffff',
  '--vscode-checkbox-background': '#313131',
  '--vscode-checkbox-border': '#3c3c3c',
  '--vscode-dropdown-background': '#313131',
  '--vscode-dropdown-foreground': '#cccccc',
  '--vscode-dropdown-border': '#3c3c3c',
  '--vscode-input-background': '#313131',
  '--vscode-input-foreground': '#cccccc',
  '--vscode-input-border': '#3c3c3c',

  '--vscode-list-activeSelectionBackground': '#04395e',
  '--vscode-list-activeSelectionForeground': '#ffffff',
  '--vscode-list-hoverBackground': '#2a2d2e',

  '--vscode-menu-background': '#1f1f1f',
  '--vscode-menu-foreground': '#cccccc',
  '--vscode-menu-border': '#454545',
  '--vscode-menu-selectionBackground': '#0078d4',
  '--vscode-menu-selectionForeground': '#ffffff',
  '--vscode-toolbar-hoverBackground': 'rgba(90,93,94,0.31)',

  '--vscode-charts-blue': '#75beff',
  '--vscode-charts-green': '#89d185',
  '--vscode-charts-orange': '#d18616',
  '--vscode-charts-purple': '#b180d7',
  '--vscode-charts-red': '#f14c4c',
  '--vscode-charts-yellow': '#cca700',
}

/** 贴到旧侧栏页面上的那段 CSS（主题变量 + webview 默认底色）。 */
export function vscodeThemeCss(): string {
  const vars = Object.entries(NATIVE_DARK_THEME)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
  return `:root {\n${vars}\n}\nbody { background-color: var(--vscode-editor-background); }`
}
