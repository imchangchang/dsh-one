# 对话尾部产物文件行缺失（对齐 dsh web ProducedFiles）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 每轮 assistant 消息尾部渲染「产物」行（`dsh-client-ui-deliverables` `ProducedFiles`，lib/client.js:215-306，挂 `conversation.chat.turnTail`）：产物 label + 最多 6 个文件 chip（多余折叠成「+N 个文件」）+ 「在文件夹中显示」按钮。

dsh-one 无任何产物展示：对话流里产出文件没有聚合视，只能靠工具卡输出找。

## 现状

- dsh-one `chatContract.ts` 无 deliverables/turn-tail 相关字段（grep 无命中）；`renderAssistantActions`（webview.ts:2490）只有 copy/👍/👎/分支。
- 数据可用性待确认：host 的事件流里能否拿到本轮产物清单（`turn/end` 或 tool 输出聚合），确认前先当想法级。

## 涉及代码位置

- dsh web：`dsh-client-ui-deliverables`（ProducedFiles）
- dsh-one：`src/pure/chatContract.ts`（新增字段）、`src/pure/conversation.ts`（聚合）、`src/ui/chat/webview.ts`（turn 尾部渲染）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）

- 2026-09-01 开发完成，自测通过 → done（worktree: agent/deliverables-produced-files）
- 2026-09-01 用户 dev-ui-test 验收反馈：去掉「在 VSCode 中打开」按钮（产物 chip 打开文件已够用）→ 仍 done

## 开发完成说明（2026-09-01）

**调研结论**：host 数据链路可行。dsh 网关的 mux 流与 `session.history` 都携带 `ToolEventView`（dsh-one `chatSession.ts` 已在收 `payload.view`）；官方 web 的 ProducedFiles 数据源是工具事件的 call view——`tool/call` 时按 callId 快照 view，`tool/result`（非 error）时从 `card === 'diff'` 或 `card === 'generic' && kind === 'edit'` 的 `locations` 取路径，按 turn 累积去重保序，`turn/end` 时挂到 turnEnd 消息。dsh-one 的 `ToolEventViewLike` 镜像原本已有 `card`/`locations`，只补了 `kind`。

**实现**：
- `chatContract.ts`：`ChatAssistantMessage.producedFiles?: string[]`（只挂 turnEnd 消息）；`FromWebviewMessage` 加 `producedOpenFile`（chip 点击打开文件）。
- `conversation.ts`：per-turn 产物累积器（call view 快照 + 产物去重保序 + turn/end 挂载，对齐官方 deliverablesDefinition）。
- 新增 `src/pure/producedFiles.ts`：chip basename（兼容 / 与 \）。
- `webview.ts`：turnEnd 消息在操作栏前渲染产物行——label「产物」+ 最多 6 个 chip（点击在 VSCode 编辑器打开）+「+N 个文件」折叠。
- `chatView.ts`：产物行 CSS + `producedOpenFile` 宿主处理（`showTextDocument` 打开任意绝对路径）。
- 测试：`conversation.test.ts` 6 个折叠用例（diff/edit 提取、read/delete/terminal 排除、失败结果排除、去重保序、turn 切断、re-baseline 清空）+ `producedFiles.test.ts` basename 用例。
- 变更（用户 dev-ui-test 验收反馈）：官方 web 的「在文件夹中显示」按钮（曾实现为「在 VSCode 中打开」：工作区内 `revealInExplorer` / 未打开 `openFolder`）**已按用户确认去掉**——VSCode 里打开产物文件夹意义不大，chip 点击打开文件已够用；相应移除 `producedOpenFolder` 消息、宿主处理与公共文件夹计算。

**人工验收方法**（合入前 dev-ui-test 窗口验证，命令见下）：

```
cd /Users/cgeng/Workspaces/dsh-one/.worktrees/deliverables-produced-files && bash /Users/cgeng/Workspaces/dsh-one/scripts/dev-ui-test.sh
```

1. 弹出隔离 VSCode 窗口（标题 = 该 worktree 目录，user-data 在 /tmp/dsh-uidev/deliverables-produced-files/）
2. 左侧活动栏出现 DSH One 图标，点击打开 chat 面板，扩展激活无报错（输出面板「DSH One」）
3. 向 agent 发一条会写文件的指令（如「在当前目录写一个 hello.ts」），等 turn 结束后：
   - 该轮 assistant 消息尾部出现「产物」行，含文件 chip（basename 显示，悬停 title 为完整路径）
   - 点 chip → 该文件在 VSCode 编辑器打开
4. 多文件产出（>6 个）时行尾出现「+N 个文件」
5. 无文件产出的轮次（纯问答）不出现产物行
