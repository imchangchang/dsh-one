# 748 限宽一刀切：浮标撑通栏、压缩/workflow 卡贴左、与其余区域不对齐

## 背景与现象

a0c0d17（chat-content-whitespace-width，v1.1.0 后合入）给 `.messages > *` 加了
`width:100%; max-width:748px; margin: 0 auto`。宽屏（chat tab 拖宽 / 编辑器区）下聊天区整体错乱：

1. **「↓ Back to latest」浮标从小 pill 撑成 748px 通栏**（已 harness 实测：宽 748、居中）——
   原来 `align-self:flex-end` 收缩包裹、右对齐吸底，现在是一条横贯内容列的宽条。
2. **compaction 卡 / workflow 运行卡 748 宽但贴左，与居中的消息行错位**——同屏里
   消息居中、这两类卡顶到面板左缘（harness compaction-cards 场景截图可见）。
3. **turn-rail 回合轨道栏从面板右缘内移到内容列右缘**，刻度压/贴消息文字
   （turn-navigator 场景可见刻度与用户气泡文字相贴）。
4. **只有 .messages 被限宽，其余区域仍满宽**：chat-header、todo 卡、goal 条幅、
   queue dock、pending 接管面板、composer 都是 chatCol 直接子项未受影响——宽屏下
   消息列居中窄条、其余通栏，左右缘全对不上（goal-stack 场景可见）。

## 根因

- `.messages` 的直接子项不只是消息行：还混着浮层（`.jump-latest` sticky、
  `.turn-rail-slot` sticky）和自带 margin 的卡（`.compaction`/`.compaction-row`/
  `.workflow-run` 都是 `margin: 2px 0`）。通配选择器把浮层一并卷进来（问题 1、3）。
- `.messages > *` 与 `.compaction` 等单类选择器同优先级（0,1,0）且位置在前，
  子项自身的 `margin: 2px 0` 把 `margin: 0 auto` 盖掉 → max-width 生效但居中失效（问题 2）。
- 原问题只是「代码块复制按钮贴右缘」一个局部对齐问题，却用了全局通配修；
  dsh web 的 748 是整列（含 composer）收敛，这里只收 .messages（问题 4）。
- 验收盲区：当时只核了 conversation / json-message-fenced / tool-cordis-run 三场景；
  jump-latest 在 harness 默认隐藏（stickToBottom=true）从未出现在截图里，
  compaction-cards / turn-navigator 场景也没复查。

## 建议方案

二选一（倾向 B）：
- A. 回退 a0c0d17，改用局部修法解决原问题（如给 `.md-code-bar` 加右留白），不做整列限宽。
- B. 保留 748 居中但修对：① 限宽范围扩到整个 chat-col 内容区（header/docks/composer 同列对齐，
  与 dsh web 一致）；② 浮层豁免——`.jump-latest`、`.turn-rail-slot` 排除在限宽规则外
  （`:not()` 或恢复 align-self 收缩）；③ compaction/workflow 卡的 margin 改为只设垂直方向
  （`margin: 2px auto` 或 margin-block），不盖水平 auto。
- 无论哪个方案：验收必须补 compaction-cards / workflow-running / turn-navigator /
  jump-latest 可见态（滚动上翻触发）四类场景的截图核对。

## 涉及代码位置

- `src/ui/chatViewHtml.ts`：`.messages > *`（~L218）、`.jump-latest`（~L1582）、
  `.turn-rail-slot`（~L959）、`.compaction`/`.compaction-row`（~L818/L838）、`.workflow-run`（~L551）
- `test/ui/style.css`（harness 同步副本）
- `src/ui/chat/webview.ts`：buildFlowItems（.messages 直接子项清单，~L4788）

## 变更记录

- 2026-09-06 用户反馈「当前 chat 区域界面非常乱」（1.1.0 后宽度提交引入）→ 核实：
  harness 全场景截图 + jump-latest 强制显示实测（748 通栏）+ CSS 优先级分析定位四处问题，
  建条目（open/，仅记录，修改待确认）
- 2026-09-06 视觉回归实测（v1.1.0 worktree 构建 vs 当前，138 场景全量 before/after + 像素 diff 分类 + 关键场景逐张核对）：
  ① 106/140 对有像素差，绝大多数是「内容居中」的预期位移；sessions-selection-modal 两张 99.5% 来自 e104bee（多选改动，与宽度无关）；
  ② 实锤破坏两处：jump-latest 由 107px 右下 pill（x=1369）撑成 748px 居中通栏（x=370）；
  compaction-cards / workflow-running 的卡片 748 宽贴面板左缘，与居中消息列明显错位（before 全宽一致布局对照）；
  ③ commit-hash-card-bottom-flip 22% 像素差核查为居中位移，非破坏；
  ④ 34 对完全一致（多为 sessions 面板场景，符合预期）。
  流程反思（为何当时能过验）：验收只截 3 个自证场景未全量回归；jump-latest 无任何可见场景；
  compaction/workflow 的 expect 只写内容不写对齐，错位不违字面；compaction-cards/turn-navigator 不在 BASELINE_SCENARIOS，
  合入后也无 baseline 冒烟记录。改进项随修复一并落地（隐藏态场景 + expect 版式断言 + 布局改动必跑全量 before/after）。
- 2026-09-06 认领（open -> doing）：用户指示彻底修改（不治标）、布局对齐 dsh web 最新源码。
  dsh web 0.1.2-rc.1 布局模型已从线上 GUI 扒取：单一居中列容器（.EvIC1a_column，
  width:100% + max-width:var(--dsh-chat-content-width) + margin auto，流内元素全部为其统一子项）；
  内容宽 clamp(680px, 会话列宽×64%, 920px) + 拖拽手柄；composer 卡 = 内容宽+32 居中；
  pending/dock = 内容宽居中；回到底部 pill 贴内容列右缘；回合轨道栏贴滚动面板右缘（不随列内移）。
- 2026-09-06 开发完成（doing -> done）：列容器化重构（.flow-col 统一居中列 + jump-latest toBottomSlot
  结构 + turn-rail 回面板右缘 + dock/composer 内容收列宽，全对齐 dsh web 0.1.2 实测规则）；
  ledger verify.chat-column-layout 8 项全过（141 场景全量截图 + v1.1.0 before 像素 diff 分诊 +
  关键场景逐张核对）；真机 reload 复核交用户。另发现 `.worktrees/fix-jump-latest-width` 有早前
  未提交的 jump-latest 单点补丁（治标），本修复已覆盖其作用，该 worktree 可丢弃。
