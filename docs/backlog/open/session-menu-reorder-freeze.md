# 会话菜单打开期间列表重建/重排：菜单与行的视觉锚断开（命令对象错位）

记录于 2026-09-02。已核实 webview 侧代码路径；排序变化的确切触发来源部分待真机确认。

## 背景与现象

右键会话行（或点 ⋯）打开菜单后，会话列表因状态变化重建；若会话排序随之变化（执行状态变化 → 列表重排），会出现"菜单执行的时候对应另一个 session 的命令"——菜单命令的执行对象与用户预期不符。用户认为最合适的做法：**拉住，等右键菜单释放后再变更位置**。

## 已核实（代码路径）

- 菜单项动作是闭包，捕获**打开菜单那一刻**的 `SessionNodeModel`（`buildSessionMenuBody(s)`），`sessionId` 不会真的串台——命令确实作用于右键的那个会话；
- 但有两个**视觉/语义锚断链**：
  1. **⋯ 按钮菜单（锚在行内，`showPopover(more, ...)`）**：列表重建 → `popoverAnchor.isConnected === false` → `closePopover()`，菜单被**直接关掉**；用户点击时菜单已不在，点击落到下方行的位置 → 触发该行 click → **打开另一个会话 / 进入该行重命名**（用户感知"点了菜单项，执行的是别的会话的命令"）。
  2. **右键菜单（坐标定位，`showPopoverAt`，`popoverAnchor = null`）**：重建**不关闭、不回位**（`renderSessions` 明确保留）——会话行移动后，菜单视觉停在原坐标（贴在新行的旁边），用户以为菜单属于新行；实际点击作用于原会话 — 命令对不上用户的视觉预期。
- 触发条件：**任何快照都会全量重建列表**（`renderSessions`：`oldList.remove()` + 新建）。快照来源包括流式推送（真实 100ms/帧）、mux pending 帧、60s 相对时间 tick、手动刷新/重连基线重拉——菜单打开期间行 DOM 几乎必然被销毁。**排序真正变化**需要排序键变化：`updatedDesc` 下 `host/session-status` 帧与 mux `session/projection` 帧都不改 `updatedAt`（`hostFrames.ts` 注释明确"status mutation 不碰排序键"）；`title` 排序下流式/自动命名的 title 投影帧会改 label → 重排；`refresh()` 基线重拉时服务端 `updatedAt` 变化也会重排。**用户在哪种排序模式下遇到，待真机确认**。

## 用户方案（推荐）

**菜单打开期间冻结列表变更位置**：`popover` 打开且锚是会话行（右键坐标菜单 / ⋯ 按钮菜单）时，`renderSessions` 跳过列表重建（保留现有 DOM，或把快照挂起）；菜单释放（closePopover）时用最新快照一次性重建。菜单期间到达的快照不丢（webview 保留最新 `sessionsSnapshot` 引用即可）。

- 落地要点：菜单打开时记录锚（`menuOpenAnchorId` + 打开方式）；`renderSessions` 开头判断"菜单打开且快照中锚会话仍存在"→ 只更新 header/计数等不涉及行的部分，跳过列表重建；`closePopover` 里补一次 `renderSessions()`。
- 备选（不推荐）：菜单随新行重锚定（按 sessionId 定位新 DOM——行已重建，需要额外映射，复杂且菜单仍可能因行消失而无处可锚）；或菜单关闭时提示（UX 兜底，不解决错位）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`renderSessions`（479-553，全量重建 + popover 锚处理 481-488）、`renderSessionRow` 的 ⋯/右键（712-729）、`buildSessionMenuBody`（835-911）、`showPopover`/`showPopoverAt`/`closePopover`（135-182）
- `src/ui/sessionsStore.ts`：`onDidChange` 触发链（`applyFrame` / `onMuxFrame` / 60s tick / `refresh` → `rebuildModel()` + fire）
- `src/ui/sessionsView.ts`：`pushSessions`（324-336，store 每次变更即推快照到 webview）

## 待确认

- 用户实际排序模式（`updatedDesc` 流式期间不重排；`title` 排序下流式标题帧会重排；`updatedAsc` 同理）→ 真机确认后细化复现步骤。
- 冻结范围：仅会话行菜单，还是覆盖排序菜单/添加菜单等（后者锚在 header，header 不重建，无此问题——冻结只对会话行菜单需要）。

## 变更记录

- 2026-09-02 记录问题，核实 webview 侧两处锚断链路径与快照触发链；用户方案（菜单期间冻结重排）记为推荐方向 → open
