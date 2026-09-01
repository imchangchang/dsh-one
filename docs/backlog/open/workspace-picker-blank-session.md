# 空会话 hero 工作区 chip 只读，不能切换/新建工作区

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 空会话 hero 的文件夹 chip 是**选择器**（chevron）：点击弹 `WorkspacePicker`（工作区列表 + 「添加工作区」）→ `DirectoryBrowser` modal（面包屑 + 双列 + 新建文件夹 + 显示隐藏文件 + 打开）。

dsh-one hero 工作区 chip 只读展示（webview.ts:1902-1909，注释明确「我们没有更换 blank 会话所属 workspace 的链路」），无 chevron、无选择器。

## 现状

- 属于行为缺口而非 UI 形态：host 侧需要新建/切换 workspace 的命令（类似 `/workspace`?）或事件链路。
- 数据可用性待确认：host 是否有创建/打开工作区的 dsh 命令。

## 涉及代码位置

- dsh web：`dsh-client-ui-workspace`、`dsh-client-ui-directory-picker-browse`（modal）
- dsh-one：`src/ui/chat/webview.ts`（renderHero 的 ws chip）、host 侧（工作区命令）

## 变更记录

- 2026-09-01 记录 → open
