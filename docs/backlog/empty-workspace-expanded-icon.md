# 无会话 workspace 的组头图标显示为展开态

记录于 2026-08-31。

## 背景与现象

会话面板里，没有任何会话的 workspace 组头仍显示「打开的文件夹」图标（expanded 样式），视觉上像是组内有内容、已展开。截图中 `dsh-one` 即为打开图标，而下面几个 workspace 是闭合图标，但实际有会话的反而是别的组——图标态与内容不匹配，不合理。

## 根因

`src/ui/chat/webview.ts` 的 `renderWorkspaceGroup`（约 1483–1523 行）：图标和 expanded 类只看折叠状态 `sessions.collapsed`，默认不折叠，所以无论 `w.sessions` 是否为空都渲染 `PANEL_ICONS.folderOpen` 和 `workspace-row expanded`。空组展开后下面什么都没有，点击行头切换折叠也只改图标、无其他可见效果。

## 建议方案

空组（`w.sessions.length === 0`）时组头始终渲染闭合文件夹图标、不加 expanded 类；行头点击在空组时可以直接不响应（或照常记折叠状态但不影响图标）。hover 的三角指示也建议一并隐藏，因为空组无可展开内容。

涉及文件：`src/ui/chat/webview.ts`（renderWorkspaceGroup），CSS 侧是 `.ws-folder`/`.ws-arrow` 的 hover 切换规则。
