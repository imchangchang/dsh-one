# 会话菜单右键错位：列表重建/重排与用户瞄准时机不一致（命令对象错位）

记录于 2026-09-02。已核实 webview 侧代码路径；排序变化的确切触发来源部分待真机确认。

## 背景与现象

右键会话行（或点 ⋯）打开菜单后（或即将右键时），会话列表因状态变化重建；若会话排序随之变化（执行状态变化 → 列表重排），会出现"菜单执行的时候对应另一个 session 的命令"——菜单命令的执行对象与用户预期不符。用户为**默认排序（updatedDesc）**，补充的场景：**鼠标已经悬浮在某行上、点击右键之前排序变了**——此时也可能错位。用户认为最合适的做法：**拉住，等右键菜单释放后再变更位置**。

**用户提供的真实复现案例（默认排序）**：操作话题 A 时，话题 B 是最新的（列表第一）。用户与 A 对话发送后，A 变成最新并跳到列表最前。用户此时想归档 B，右键"B 的位置"（记忆中 B 在第一行），但第一行已被 A 占据 → 命中 A 的菜单 → 点"归档会话"→ **把 A 归档了**（B 还在）。随后用户提出：**每次发送就刷新一次列表**，让排序及时反映真实状态。

按窗口分三类，机理不同、防御不同：

- **W1（右键之前重排，用户本次补充的场景）**：列表重排发生在用户右键动作之前（悬浮期间）。`renderSessions` 收到快照**同步**全量重建（`oldList.remove()` + 新建，同一任务内完成、下次 paint 生效），**DOM 与屏幕始终一致，不存在"视觉旧、DOM 新"的错位帧**——重排后屏幕显示的就是新顺序（用户眼睛看得到）。错位来自**记忆锚定**：用户的目标锚在**记忆中的行位置**（"第一行是 B"），重排后该位置已是 A 行，`contextmenu` 命中的就是 A → 打开 A 的菜单。用户感知"我右键的 B，结果出了 A 的菜单"（与下方真实案例同一方向；用户案例正是：A send 后跳到最前，占据记忆中"B 的位置"）。"看得见 ≠ 感知到顺序变了"是 W1 的根子——案例里用户已"看到 A 跳到前面"仍误操作，同源。
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

**① 刷新基线触发点：发送后 + 窗口聚焦 + 侧栏从不可见到可见 + 会话状态变化**（用户定案：一切"列表可能过期"的可见/状态事件都刷新）
- **send 后**：`chatView.ts` `case 'send'` 里 `await target.send(...)` 落地后 `void this.store.refresh()`；低频手动动作，两次 RPC 成本可接受。
- **OS 窗口聚焦**：`vscode.window.onDidChangeWindowState`（`WindowState.focused` 为 true 时）→ `void sessions.refresh()`（注册在 `extension.ts`，`context.subscriptions`；失焦不刷）。
- **侧栏 view 从不可见到可见**（用户补充场景：打开文件管理器覆盖 dsh-one 侧栏、切回时）：
  - `WebviewView.onDidChangeVisibility`（`sessionsView.ts` 的 `SessionsViewProvider`）：`view.visible` 为 true 时 `void this.store.refresh()`——文档确认该事件覆盖"用户切换到侧栏/面板里另一个 view group"与折叠/展开；
  - `resolveWebviewView` 时也刷新（文档："called when a view first becomes visible... or when the user hides and then shows a view again"——webview 销毁重建场景；现 resolve 只 pushSessions 用缓存快照，加一行 `void this.store.refresh()`，新快照由现有 store.onDidChange → pushSessions 订阅链推送）。
  - （顺带，可选）editor chat 面板 `WebviewPanel.onDidChangeViewState`（`event.visible`）→ 同样刷新——与侧栏语义一致；用户当前场景是侧栏，先做侧栏，面板顺带做成本一致。
- **会话状态变化**（用户补充，2026-09-02）：状态标记（黄点/绿点/像素环）本身走增量帧即刻更新，**不需要刷新**；但**排序键 `updatedAt` 增量帧不更新**，而服务端在这些时刻很可能也更新了（turn 结束=完成较确定；pending 出现/解决属推测，待真机观察）——缓存不追平，排序滞后，与 send 场景同一个洞。挂点（都是低频：完成=每轮一次，pending=每次用户交互）：
  - **running 翻转**：`sessionsStore.ts` `applyFrame` 的 `host/session-status` 分支（`noteRunningFlip` 处，running 实际变化时）→ `void this.refresh()`；
  - **pending 变化**：`onMuxFrame` 的 `approval/question requested/resolved`（`trackPending`/`resolvePending` 返回 changed=true 时）→ `void this.refresh()`；
  - **循环规避（实现必读）**：`noteRunningFlip` 在 `refresh()` 内部也被调用（基线全量对比，601 行）——**只有增量路径（488 行，running 值实际翻转）触发 refresh**；refresh 内重放缓冲帧时 prev 已是最新值、不再翻转，天然不会递归。
- **统一入口与防抖（必须有，非可选）**：`refresh()` 有 `refreshInFlight` 缓冲（并发/在途帧安全），但**同一动作会连发多个触发点**——例如 send 后：send 触发 + `host/session-status` running 翻转触发，没有去抖必然一次操作两组全量 RPC；聚焦+侧栏可见也常同时到达。**必须包一个 500ms 级合并/去抖的 `refreshSessionsSoon()`**（低频事件，去抖成本为零；去抖后一回合最多一次全量 RPC）。
- 效果：A send 后立即变最新、列表立刻重排——**重排时机从"偶然落在用户右键前一瞬"挪到"事件发生时（用户注意力还在聊天/刚回到列表）"**。注意 refresh 异步落地前（localhost RPC 通常 <50ms，用户操作右键通常在其后）列表仍是旧顺序——**缩小危险窗口但未归零**（案例里用户已"看到 A 跳到前面"仍误操作，说明看得见≠会重新定位）——故与 ②③ 组合。

细节：
- `WebviewView.visible`（只读）+ `onDidChangeVisibility: Event<void>`（折叠/展开、切换 view group 触发；context menu 隐藏改为 dispose→resolve）；API 文档确认见 `@types/vscode` 10267-10283。
- 可选扩展（未定，见待确认）：点击打开/附着会话时刷新；turn 结束（running true→false）时刷新——先做上面三条，实测后按需补。

**② 按住右键 / 菜单打开期间冻结列表变更位置**：冻结窗口从 **pointerdown（右键按钮按下）开始 → 菜单关闭（closePopover）结束**（覆盖 W2 + W3；W1 在窗口之前，冻结救不了，靠 ①③ 减损）。窗口内 `renderSessions` 跳过列表重建（保留现有 DOM，或把快照挂起）；菜单释放时用最新快照一次性重建。窗口内到达的快照不丢（webview 保留最新 `sessionsSnapshot` 引用即可）。

- 落地要点：pointerdown（button 2 / ⋯ 点击）时记录锚（`menuOpenAnchorId` + 打开方式）；`renderSessions` 开头判断"冻结窗口内且快照中锚会话仍存在"→ 只更新 header/计数等不涉及行的部分，跳过列表重建；`closePopover` 里补一次 `renderSessions()`。
- 备选（不推荐）：菜单随新行重锚定（按 sessionId 定位新 DOM——行已重建，需要额外映射，复杂且菜单仍可能因行消失而无处可锚）；或菜单关闭时提示（UX 兜底，不解决错位）。

**③ 菜单顶部显示会话标题**（操作对象显式化）：打开菜单时在菜单体中放一行"会话：<标题>"（或置灰标题行），即使用户瞄错也能立刻发现，点击前可收回。**低成本、通用，建议与①②一起做**。
- **强度诚实评估（重要）**：破坏性动作（归档）**已有** modal 二次确认（`dshOne.session.archive`：`确认归档会话「标题」？`，modal 显示的是被归档对象的标题）——用户案例里**仍然误操作了**，说明现有 modal 没拦住（用户预期是 B 但 modal 显示 A 的标题时没注意到/手快）。③（菜单标题）与 modal 同强度——**是弱防线（依赖用户留意），别高估**；主防线是 ①（排序及时正确，用户产生正确预期）、兜底 ②（防操作过程中再变）。若实测 ③ 仍拦不住误操作，考虑在**确认动作**上加强（如 modal 强化/操作可撤销——归档有恢复路径但入口隐蔽，另议）。

（可选④）**重排可感知提示**：顺序变化帧（对比排序键而非每个快照）给移动的行加短暂高亮/位移动画，避免流式期间列表持续闪。优先级最低。

## 涉及代码位置

- `src/ui/chatView.ts`：`case 'send'`（1805-1826，send 后无 refresh——方案①加在这里）；`attach()` 的 `controller.onDidChange`（标题变化触发 `store.refresh()`，即现状 A 跳前面的路径）
- `src/ui/sessionsWebview.ts`：`renderSessions`（479-553，全量重建 + popover 锚处理 481-488）、`renderSessionRow` 的 ⋯/右键（712-729）、`buildSessionMenuBody`（835-911，方案③加标题行）、`showPopover`/`showPopoverAt`/`closePopover`（135-182）
- `src/ui/sessionsStore.ts`：`onDidChange` 触发链（`applyFrame` / `onMuxFrame` / 60s tick / `refresh` → `rebuildModel()` + fire）
- `src/ui/sessionsView.ts`：`pushSessions`（324-336，store 每次变更即推快照到 webview）

## 与置顶（pinned）的关系（2026-09-02 用户提问后核实）

- **数据无冲突**：pinned 是 store 本地持久化状态（`this.pinned`，`PINNED_STATE_KEY`，dsh 无置顶概念/无 API）；`refresh()` 只重拉服务端基线（`rawSessions`/`rawWorkspaces`），`rebuildModel()` 把 pinned 原样传入 `buildSessionTree`——**刷新完全不碰置顶集合**。
- **置顶不受排序变化影响**：`buildSessionTree` 排序先比 `aPinned !== bPinned`（置顶恒在前），再按 sort 键——**置顶会话不会被非置顶会话（含最新）挤下去**，refresh 后置顶组仍在顶部。
- **置顶组内已定案为绝对固定**（用户确认："置顶就是绝对优先"；规则：新置顶放最前）。**置顶组内不再按 updatedAt 调整**——排序键变化只影响非置顶组；本条目（菜单错位）在**置顶组内随之消除**。实现见独立条目 `session-pin-absolute-order`。
- **方案②（冻结）与置顶无冲突**：冻结只是挂起列表重建（渲染层），置顶数据不动；菜单关闭后重建，置顶行图标/状态从快照正常恢复。

## 待确认

- 刷新触发集是否覆盖用户期望的全部"不可见→可见"路径：OS 窗口聚焦（onDidChangeWindowState）、侧栏 view 可见性（onDidChangeVisibility）、webview 重建（resolveWebviewView）三条已定；VS Code 窗口内部点击其他编辑器/面板算不算"回来"（不算——侧栏 view 未变化时不刷，用户语义是侧栏被覆盖/窗口失焦，已覆盖）。
- 方案①落地前的基准行为：当前 A send 后跳到最前的实际时机（自动命名标题投影触发的 refresh？手动刷新？重连？）——建议修复时在案例场景（A 无标题 + send + 随后右键 B）真机验证用户方案是否覆盖。
- 官方 host 事件集是否有带 updatedAt 的增量帧（有则增量更新替代整表 refresh，更优；本地无官方 events.d.ts，待查 dsh 官方仓库）。
- 冻结窗口是否需要在 pointerdown 前再前移（比如悬停超过 N ms 也冻结）——权衡：悬停冻结会阻塞流式期间列表状态更新（pending/运行中标记不刷新），**默认不做**，除非真机确认用户错位更接近"悬停"而非"右键前一刻"。
- 冻结范围：仅会话行菜单（右键/⋯），覆盖排序菜单/添加菜单等（后者锚在 header，header 不重建，无此问题）。

## 变更记录

- 2026-09-02 记录问题，核实 webview 侧两处锚断链路径与快照触发链；用户方案（菜单期间冻结重排）记为推荐方向 → open
- 2026-09-02 用户补充：默认排序（updatedDesc）+「鼠标悬浮、右键之前排序变了」场景——核实 W1 机理（同步重建、命中行=重排后行、瞄准时机错位），冻结窗口改为 pointerdown 起（覆盖 W2/W3），补 W1 防御（菜单标题显式化 + 重排可感知提示）
- 2026-09-02 用户给出真实复现案例（A send 后变最新跳前 → 右键"B 的位置"命中 A 误归档）并提案「每次发送就刷新」：核实 send 分支无 refresh、A 跳前面的现状路径为标题变化触发的 refresh；方案定为①send 时 refresh（用户提案）+②pointerdown 起冻结+③菜单首行显示会话名，附加待确认真机基准行为
- 2026-09-02 调研 refresh 触发点全集：无轮询（无 2min 定时刷新）；近似机制 60s 本地 tick 仅刷相对时间文案（不发 RPC）；确认方案①为新增显式触发点（send 后追平 updatedAt），非替代轮询
- 2026-09-02 用户定案刷新触发点：send 后 + VS Code 窗口聚焦时（onDidChangeWindowState focused=true）；可选扩展（打开/附着会话、turn 结束）列为待定；待确认焦点粒度（窗口级 vs 面板级）
- 2026-09-02 用户扩展触发语义：一切让 dsh-one 侧栏从不可见（焦点丢失、被文件管理器等覆盖）到可见的事件都刷新——补 onDidChangeVisibility（view.visible）+ resolveWebviewView（webview 重建）两个事件源，editor 面板 onDidChangeViewState 列为顺带候选；建议统一入口加 500ms 级去抖
- 2026-09-02 用户补充状态变化触发：待交互（approval/question 请求/解决）与完成（running 翻转）时刻也刷新——状态标记走增量帧即时显示（无需刷），但排序键 updatedAt 增量帧不更新（服务端同一时刻更新了）；挂点：applyFrame 的 session-status 实际翻转处 + onMuxFrame 的 track/resolvePending changed=true 处；固化循环规避要点（仅增量路径触发，refresh 内重放不递归）
- 2026-09-02 用户提问与置顶冲突：核实无数据冲突（pinned 为本地持久化状态，refresh 不碰；置顶恒在非置顶前），置顶组内仍按最新优先（既有语义+官方同款，非 refresh 引入）；产品语义待确认（组内最新优先 vs 绝对固定——后者为新需求，可单独立项）
- 2026-09-02 用户定案置顶语义：绝对优先（组内固定，新置顶放最前）——详见独立条目 session-pin-absolute-order；本条目置顶组内的错位关注随之消解
- 2026-09-02 review 修正：①W1 示例方向反了（应为"瞄 B 的位置命中 A"）并改述机理——错位来自"记忆锚定"（屏幕显示新顺序、用户看得见但没感知），非视觉-逻辑错位帧；②"基本必然"改"很可能"（pending 时刻服务端 updatedAt 更新属推测）；③统一去抖从"建议"升为"必须有"（send + running flip 等连发，无去抖一回合多组全量 RPC）；④补③的强度诚实评估（归档已有 modal 确认仍被跳过——③同强度为弱防线，主防线是①）


- 2026-09-02 认领（worktree: agent/session-menu-reorder-freeze）→ doing

- 2026-09-02 开发完成（分支自测通过 + done 标记），主线合入（merge ok）测试通过，用户人工验收通过 → closed
