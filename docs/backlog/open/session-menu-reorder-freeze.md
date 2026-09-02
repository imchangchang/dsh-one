# 会话菜单右键错位：列表重建/重排与用户瞄准时机不一致（命令对象错位）

记录于 2026-09-02。已核实 webview 侧代码路径；排序变化的确切触发来源部分待真机确认。

## 背景与现象

右键会话行（或点 ⋯）打开菜单后（或即将右键时），会话列表因状态变化重建；若会话排序随之变化（执行状态变化 → 列表重排），会出现"菜单执行的时候对应另一个 session 的命令"——菜单命令的执行对象与用户预期不符。用户为**默认排序（updatedDesc）**，补充的场景：**鼠标已经悬浮在某行上、点击右键之前排序变了**——此时也可能错位。用户认为最合适的做法：**拉住，等右键菜单释放后再变更位置**。

**用户提供的真实复现案例（默认排序）**：操作话题 A 时，话题 B 是最新的（列表第一）。用户与 A 对话发送后，A 变成最新并跳到列表最前。用户此时想归档 B，右键"B 的位置"（记忆中 B 在第一行），但第一行已被 A 占据 → 命中 A 的菜单 → 点"归档会话"→ **把 A 归档了**（B 还在）。随后用户提出：**每次发送就刷新一次列表**，让排序及时反映真实状态。

按窗口分三类，机理不同、防御不同：

- **W1（右键之前重排，用户本次补充的场景）**：列表重排发生在用户右键动作之前（悬浮期间）。`renderSessions` 收到快照**同步**全量重建（`oldList.remove()` + 新建，同一任务内完成、下次 paint 生效），**DOM 与屏幕始终一致，不存在"视觉旧、DOM 新"的错位帧**；错位来自**用户的瞄准时机**：用户凭旧视觉位置（A 行所在）右键，重排后鼠标下已是 B 行，`contextmenu` 命中的就是 B → 打开 B 的菜单。用户感知"我右键的 A，结果出了 B 的菜单"。
- **W2（菜单打开之后重排）**：见下文"两种锚断链"。
- **W3（右键事件序列进行中）**：mousedown（右键按钮）与 contextmenu 之间若跨任务，重排快照可插入 → contextmenu 命中重排后的行。Chrome 中二者通常同任务派发（未见跨任务证据），未实测；冻结窗口从 pointerdown 起可无成本覆盖。

## 已核实（代码路径）

- 菜单项动作是闭包，捕获**打开菜单那一刻**的 `SessionNodeModel`（`buildSessionMenuBody(s)`），`sessionId` 不会真的串台——命令确实作用于右键命中的那个会话；**"错位"来自命中行与用户瞄准行不一致**（W1/W3），或**菜单视觉锚与行断链**（W2），不是菜单逻辑串台。
- W2 的两个**视觉/语义锚断链**：
  1. **⋯ 按钮菜单（锚在行内，`showPopover(more, ...)`）**：列表重建 → `popoverAnchor.isConnected === false` → `closePopover()`，菜单被**直接关掉**；用户点击时菜单已不在，点击落到下方行的位置 → 触发该行 click → **打开另一个会话 / 进入该行重命名**（用户感知"点了菜单项，执行的是别的会话的命令"）。
  2. **右键菜单（坐标定位，`showPopoverAt`，`popoverAnchor = null`）**：重建**不关闭、不回位**（`renderSessions` 明确保留）——会话行移动后，菜单视觉停在原坐标（贴在新行的旁边），用户以为菜单属于新行；实际点击作用于原会话 — 命令对不上用户的视觉预期。
- 触发条件：**任何快照都会全量重建列表**（`renderSessions`：`oldList.remove()` + 新建）。快照来源包括流式推送（真实 100ms/帧）、mux pending 帧、60s 相对时间 tick、手动刷新/重连基线重拉——菜单打开期间行 DOM 几乎必然被销毁。
- **默认排序（updatedDesc）下"排序真正变化"的触发源**：`host/session-status` 帧与 mux `session/projection` 帧都**不改** `updatedAt`（`hostFrames.ts` 注释明确"status mutation 不碰排序键"），流式推送本身不重排。**send 分支也不刷新**（`chatView.ts` 1805-1826 `case 'send'`：`target.send(...)` 后直接 return）。**A send 后跳到最前的真实路径**：① `attach()` 的 `controller.onDidChange` 里 `state.sessionTitle !== lastSessionTitle` 时 `store.refresh()`（自动命名/标题投影变化触发，A 无标题时 send 后 turn 开始即触发）；② 手动刷新；③ host 流重连。**即"刷新发生"与"用户右键"的先后是偶然的**——案例里刷新恰好落在了用户右键之前，重排把 A 顶到 B 的位置，用户凭旧位置右键 B → 命中 A。**官方 host 事件集是否带 updatedAt 的增量帧未查实**（本地无官方 events.d.ts），按现有注释判断没有；增量路径若有，比整表 refresh 更优，但当前无依据，以 send 时 refresh 为主。

- **refresh()（RPC 拉基线：workspace.list + session.list）触发点全集**（2026-09-02 调研，无轮询机制）：
  1. 服务状态变为 running（初始化连接）— `sessionsStore.ts:418`
  2. host 流重连成功后 — `sessionsStore.ts:466`
  3. **标题变化**（attach 的 `controller.onDidChange`：`sessionTitle` 变化时）— `chatView.ts:1603`（现状 A 跳前面的路径）
  4. 手动刷新：侧栏刷新按钮（`sessionsView.ts:380`）/ 命令 `dshOne.sessions.refresh`（`extension.ts:111`）
  5. 显式动作后：新建/未分组新建/改名/归档/分叉（extension.ts 各命令）、行内重命名（`sessionsView.ts:431`）、移除 workspace（`sessionsView.ts:455`）、workspace 添加/创建（`chatView.ts:2062/2071`）、chat 侧 fork/rename（`onSessionsChanged` 回调，`extension.ts:36` → `chatView.ts:2172/2186`）
  6. **send 后不刷新**（本条目方案①的落点）
  - 近似但不刷数据的机制：**60s 本地 tick**（`sessionsStore.ts:413`，`RELATIVE_TIME_TICK_MS`）仅 `rebuildModel()` 刷新"N 分钟前"文案，**不发 RPC、不改排序键**；30s 健康检查（`manager.ts:299`）是服务存活探测，与列表无关。**没有 2 分钟定时刷新**。

## 用户方案（推荐）

**send 等明确动作后刷新基线（列表排序及时追平真实状态）**（用户提案）+ **按住右键/菜单打开期间冻结列表变更位置**。

**① send 时 `store.refresh()`**（用户提案：`case 'send'` 里 `target.send(...)` 后补一行；低频手动动作，两次 RPC 成本可接受）。效果：A send 后立即变最新、列表立刻重排——**重排时机从"偶然落在用户右键前一瞬"挪到"send 时（用户注意力还在聊天与输出上）"**；refresh 异步落地前的窗口里列表还是旧顺序（B 第一），右键 B 命中 B（安全）。**缩小危险窗口，但异步落地后用户凭旧位置右键仍可能命中 A**（案例里用户已"看到 A 跳到前面"仍误操作，说明看得见≠会重新定位）——故与 ②③ 组合。

**② 按住右键 / 菜单打开期间冻结列表变更位置**：冻结窗口从 **pointerdown（右键按钮按下）开始 → 菜单关闭（closePopover）结束**（覆盖 W2 + W3；W1 在窗口之前，冻结救不了，靠 ①③ 减损）。窗口内 `renderSessions` 跳过列表重建（保留现有 DOM，或把快照挂起）；菜单释放时用最新快照一次性重建。窗口内到达的快照不丢（webview 保留最新 `sessionsSnapshot` 引用即可）。

- 落地要点：pointerdown（button 2 / ⋯ 点击）时记录锚（`menuOpenAnchorId` + 打开方式）；`renderSessions` 开头判断"冻结窗口内且快照中锚会话仍存在"→ 只更新 header/计数等不涉及行的部分，跳过列表重建；`closePopover` 里补一次 `renderSessions()`。
- 备选（不推荐）：菜单随新行重锚定（按 sessionId 定位新 DOM——行已重建，需要额外映射，复杂且菜单仍可能因行消失而无处可锚）；或菜单关闭时提示（UX 兜底，不解决错位）。

**③ 菜单顶部显示会话标题**（操作对象显式化）：打开菜单时在菜单体中放一行"会话：<标题>"（或置灰标题行），即使用户瞄错也能立刻发现，点击前可收回。**低成本、通用，建议与①②一起做**——它是防"看见了但手快了"的最后一道确认。

（可选④）**重排可感知提示**：顺序变化帧（对比排序键而非每个快照）给移动的行加短暂高亮/位移动画，避免流式期间列表持续闪。优先级最低。

## 涉及代码位置

- `src/ui/chatView.ts`：`case 'send'`（1805-1826，send 后无 refresh——方案①加在这里）；`attach()` 的 `controller.onDidChange`（标题变化触发 `store.refresh()`，即现状 A 跳前面的路径）
- `src/ui/sessionsWebview.ts`：`renderSessions`（479-553，全量重建 + popover 锚处理 481-488）、`renderSessionRow` 的 ⋯/右键（712-729）、`buildSessionMenuBody`（835-911，方案③加标题行）、`showPopover`/`showPopoverAt`/`closePopover`（135-182）
- `src/ui/sessionsStore.ts`：`onDidChange` 触发链（`applyFrame` / `onMuxFrame` / 60s tick / `refresh` → `rebuildModel()` + fire）
- `src/ui/sessionsView.ts`：`pushSessions`（324-336，store 每次变更即推快照到 webview）

## 待确认

- 方案①落地前的基准行为：当前 A send 后跳到最前的实际时机（自动命名标题投影触发的 refresh？手动刷新？重连？）——建议修复时在案例场景（A 无标题 + send + 随后右键 B）真机验证用户方案是否覆盖。
- 官方 host 事件集是否有带 updatedAt 的增量帧（有则增量更新替代整表 refresh，更优；本地无官方 events.d.ts，待查 dsh 官方仓库）。
- 冻结窗口是否需要在 pointerdown 前再前移（比如悬停超过 N ms 也冻结）——权衡：悬停冻结会阻塞流式期间列表状态更新（pending/运行中标记不刷新），**默认不做**，除非真机确认用户错位更接近"悬停"而非"右键前一刻"。
- 冻结范围：仅会话行菜单（右键/⋯），覆盖排序菜单/添加菜单等（后者锚在 header，header 不重建，无此问题）。

## 变更记录

- 2026-09-02 记录问题，核实 webview 侧两处锚断链路径与快照触发链；用户方案（菜单期间冻结重排）记为推荐方向 → open
- 2026-09-02 用户补充：默认排序（updatedDesc）+「鼠标悬浮、右键之前排序变了」场景——核实 W1 机理（同步重建、命中行=重排后行、瞄准时机错位），冻结窗口改为 pointerdown 起（覆盖 W2/W3），补 W1 防御（菜单标题显式化 + 重排可感知提示）
- 2026-09-02 用户给出真实复现案例（A send 后变最新跳前 → 右键"B 的位置"命中 A 误归档）并提案「每次发送就刷新」：核实 send 分支无 refresh、A 跳前面的现状路径为标题变化触发的 refresh；方案定为①send 时 refresh（用户提案）+②pointerdown 起冻结+③菜单首行显示会话名，附加待确认真机基准行为
- 2026-09-02 调研 refresh 触发点全集：无轮询（无 2min 定时刷新）；近似机制 60s 本地 tick 仅刷相对时间文案（不发 RPC）；确认方案①为新增显式触发点（send 后追平 updatedAt），非替代轮询

