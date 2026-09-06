# 会话行尾状态标记：标签组内行右缘左偏 4px，与顶层行不对齐

## 背景与现象

侧栏会话列表的行尾状态标记（运行中像素环 / 待交互黄点 / 未读绿点 / 相对时间）在标签组内的行上整体左偏 4px：顶层行行尾内容缘在面板 −10px，组内行在 −14px。用户截图对比「现在ESC…」「调查一个问题…」（顶层行）与「进行中」组内的「dev: client-state-dsh-home…」，运行中符号明显不在一条竖线上。已完成组内的时间文本同样左偏 4px，只是没有参照物不显眼。

垂直方向和动画相位都正常（逐像素核实过），只有水平方向这一处。

## 根因

行的水平盒模型由「行自己」+「包它的容器」共同决定，容器加了水平 inset 就会打破行尾对齐：

- `.session-row { margin: 0 4px; padding: 0 6px 0 20px }`（`src/ui/sessionsView.ts:408`）→ 右内容缘 = 面板 −10px
- `.tag-group { margin: 4px 4px 2px }`（`src/ui/sessionsView.ts:553`）→ 组块水平 margin 与行的 4px 叠加，组内行右缘变 −14px

扫过全部包行容器，只有 `.tag-group` 一个犯规：`.sessions-list` / `.recycle-list` padding 仅垂直，`.workspace-row` 无 margin 且右缘也在 −10px（说明「行尾对齐到固定列」本就是设计意图）。左侧缩进已是正确模式（组内行缩进由行自己的 `.session-row.tagged { padding-left: 24px }` 承担），右侧漏了对应约束。

## 建议方案（已与用户确认方向：容器不加水平 inset）

原则：**行的水平盒模型完全归行自己管；容器只负责垂直节奏和装饰（色条、pill），永不加水平 margin/padding。** 行尾状态列的 x 由结构保证，以后新增容器不会再犯。

1. `.tag-group` margin 改 `4px 0 2px`（去掉水平 margin）。
2. 组内 pill/竖线原来隐含吃了组块的 4px 左 margin，补回它们自己身上保持视觉位置不动：`.tag-head padding-left 12→16px`、`.tag-line left 12→16px`。
3. 折叠组头计数角标（`.tag-counts`）右缘顺手对齐到状态列：`.tag-head` 加 `padding-right: 10px`（与 workspace 组头 badge 同列）。
4. 在 `.session-row` CSS 注释里写下不变量（行尾内容缘 = 面板 −10px，容器不得加水平 inset），防回归。

只动 `src/ui/sessionsView.ts` 的 CSS，不改 TS 逻辑。验证：ai-visual-validation 出「组内行 + 顶层行混合」截图，对照行尾右缘共线。

## 涉及代码位置

- `src/ui/sessionsView.ts`（`.tag-group` 约 553 行、`.tag-head` 约 555 行、`.tag-line` 约 577 行、`.tag-counts` 约 593 行、`.session-row` 约 407 行、`.session-rear` 约 450 行）
- `src/ui/sessionsWebview.ts`（行尾标记 `sessionStatusMarker` 约 2364 行，仅供理解，不需改）

## 变更记录

- 2026-09-06 用户截图报告运行中符号没对齐；逐像素核实为组内行右缘左偏 4px，定位根因为 `.tag-group` 水平 margin 与行 margin 叠加；用户确认走「容器不加水平 inset」的彻底改法 → open
