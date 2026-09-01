# 头部「N 个子代理」chip 改树形缩进列表（支持子代理再开子代理）

记录于 2026-09-01。需求来自用户：子代理可再开子代理（多层嵌套血缘），头部子代理区域要能看到并进入这些嵌套层，不能是平铺列表。

## 背景与现象

dsh web / dsh-one 的会话树里，子代理可通过 `parentSessionId` 形成血缘链（子代理再开子代理 = 孙一辈）。但 dsh-one 头部「N 个子代理」chip 只列出**当前会话的直接子代理**（`parentSessionId === 当前会话`），平铺进下拉，看不到「子代理的子代理」。

## 现状

- `src/pure/chatContract.ts:283`：`subagents?: Array<{sessionId, title, running, totalTokens, updatedAt}>`——扁平结构。
- `src/ui/chatView.ts:1010-1014`（composeHeader）：`raw.filter(s => s.parentSessionId === state.sessionId)`，只取直接子代理。
- `src/ui/chat/webview.ts:975-1004`（openSubagentMenu）：平铺 for 渲染，无缩进、无嵌套。
- 会话树侧（sessionTree.ts 的 `hasRunningDescendant`，:152）已递归支持多层血缘 busy 传导，但 UI 展示停留一层。

## 方案

三处改动，`subagents` 从扁平数组改成树形节点：

1. `src/pure/chatContract.ts`：`SubagentNode { sessionId, title, running, totalTokens?, updatedAt, children? }`，`subagents?: SubagentNode[]`。
2. `src/ui/chatView.ts` composeHeader：从 `session.list` 基线**递归**组装血缘子树（每层按 运行中优先 + 新近优先 排序），带回环保护。
3. `src/ui/chat/webview.ts` openSubagentMenu：递归渲染缩进树（每级缩进、状态点保留），行点击附着对应子会话，补每级缩进样式。

## 已确认的语义（用户拍板）

- 形态：点开子代理 chip 后是**树形缩进列表**。
- chip 上的「N 个子代理」**只算直接子代理**（对齐官方），下拉里再缩进展示各自后代。

## 涉及代码位置

- `src/pure/chatContract.ts`（subagents 类型）
- `src/ui/chatView.ts`（composeHeader 递归组装）
- `src/ui/chat/webview.ts`（openSubagentMenu 递归渲染 + 样式）
- `test/`（chatContract / 相关纯逻辑测试，补嵌套用例）

- 2026-09-01 认领（worktree: agent/subagent-header-tree）→ doing

- 2026-09-01 开发完成，自测通过（typecheck+test+build）→ done

- 2026-09-01 主线合入测试通过（merge 2d3b47f 无冲突，175 测试过）→ 等待人工确认转 closed

- 2026-09-01 人工实测发现问题，退回 open（代码已合入 main，保留；待修问题见下节，后续重新开 worktree 基于现状继续）

## 实测发现的问题（done→open 退回原因）

第一轮实现已合入 main（`2d3b47f`），人工实测发现三个问题，重新开 worktree 时基于现状继续修，**不要重做已合入的树形骨架**：

1. **弹层在输出时被刷新消失（硬伤，优先修）**。根因：每次收到新 ChatState，`render()` 都会整个重建 header（`webview.ts:1332` 起，header 不在 keepMessages/keepComposer 保留名单里，无条件 `el('div','chat-header')` 新建再 append）。子代理 chip 是 popover 锚点，header 重建后旧 chip 被 `remove()`，`popoverAnchor.isConnected` 变 false，render 末尾的保活逻辑（`webview.ts:1284-1288`）随即 `closePopover()`。输出时 token 流式推 state → header 高频重建 → chip 一直被换 → 弹层刚开就关。修法：把 header 纳入 render 的保留/就地修补逻辑（对齐 composer/messages 的 keep 模式），让 chip 锚点在 state 更新时稳定；判断 header 内容实质没变就不重建。

2. **嵌套显示成了平铺（嵌套没生效）**。用户确认那两个「会话 xxx」子代理**本应有父子嵌套**但显示成平铺。需排查：是数据侧 `buildSubagentTree` 没收到 `parentSessionId` 指向子代理的行（即 `session.list` 基线里孙一辈的 `parentSessionId` 字段是否真存在/正确），还是组装/渲染链路问题。先核实 dsh host 在"子代理再开子代理"时是否真的给孙一辈上报了 `parentSessionId = 子代理会话`（排查点：`src/ui/sessionsStore.ts` 的 `toSessionInput` 与 host 帧 `parentSessionId` 字段，`src/server/dshRpc.ts` 的 `SessionSummary`）。

3. **可读性差**。两小点：(a) 缩进用了**绝对值** `paddingLeft = depth*16px`，而 `.menu-item` 基础左内边距已 10px，子级实际只比父级多 6px，层级几乎看不出——需改成相对增量或加大每级缩进，并加层级连接线/引导线（用户点名要，参考 dsh web 阶段/成员树的竖线）；(b) 子代理标题初始是「会话 xxxxxx」代号，后续会自动更新为真实标题，但 dsh-one 前端刷新慢、不及时同步（用户补充），需查会话标题更新（host 帧 → SessionsStore 基线 → composeHeader 重推）的时延链路。
