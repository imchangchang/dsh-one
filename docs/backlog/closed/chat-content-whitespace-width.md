# 聊天内容留白（748px 居中）+ 代码块复制按钮重叠（限宽修复）

## 背景与现象

用户反馈：① 聊天对话左右满宽（dsh web 留空、748px 居中；讨论于 session 55c489e9，认同留空更好，社区 dsh-chat-width 有可拖拽 748→1040）；② 代码块「复制」按钮与右侧对话条（滚动条/窗格边缘）重叠——`.md-code-bar` 复制按钮右对齐到代码块右缘，满宽布局下直接压右缘。

## 方案（已确认实施）

内容列限宽居中：`.messages > * { width:100%; max-width:748px; margin auto }`——宽屏 748 居中留白（对齐官方；不做社区可拖拽），窄屏 width100% 自适应；代码块头部按钮随列右对齐，距右缘有留白，重叠消失。

## 涉及代码位置

- `src/ui/chatViewHtml.ts`（.messages 样式）、`test/ui/style.css`（harness 同步）

## 变更记录

- 2026-09-05 用户反馈（代码块复制按钮与右侧对话条重叠 + 追问留白是否记录——核查：留白讨论在 session 55c489e9 有结论但从未落 backlog，记录习惯缺口）→ 建条目（open/，两条合并）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree chat-content-width）；纯 CSS 限宽（748px 居中 + 窄屏自适应）；harness 1280/700px 渲染核对（Copy 按钮分离、工具卡/消息布局不破）
- 2026-09-05 开发完成（doing -> done）：typecheck/567 单测/build 全绿；ledger 4 项全过；真机 reload 复核由用户完成

- 2026-09-05 合入（done -> closed）：dev-merge 合入 main；ledger 4 项全过、审查通过（1280/700px 截图核对）；真机 reload 复核交用户。版本归属待用户定：1.2.0 修复集合与发布节奏由用户另行指示。
