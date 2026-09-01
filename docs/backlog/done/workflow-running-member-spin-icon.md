# workflow 进行中成员图标改成转圈

记录于 2026-09-01。

## 背景与现象

workflow 运行卡片里，「进行中」的成员（member）状态图标现在是 4×4 扫描矩阵渐变动画（workflow-run-card 实现时照搬官方 StateDot 的 ongoing 形态），和会话列表里「正在运行」的转圈像素环（spinSvg）不一致。用户希望统一成转圈图标。

## 现状

- workflow-run-card 的 MemberRow：running 状态画 4×4 扫描矩阵动画（蓝色）。
- 会话行 / 头部 chip 的「运行中」用 spinSvg 转圈像素环。
- 两种「运行中」图标不一致。

## 方案

workflow 卡里 running 状态成员改用 spinSvg 转圈（和会话运行中一致），不用扫描矩阵。注意聚合文案（运行中 N）不受影响；确认 phase/run 行的 running 状态点是否也要统一（对照官方是否也是转圈）。

## 涉及代码位置

- `src/ui/chat/webview.ts`（workflow 卡 MemberRow / StateDot 渲染，running 分支）
- 2026-09-01 认领（worktree: agent/workflow-running-member-spin-icon）→ doing

- 2026-09-01 开发完成 → done
