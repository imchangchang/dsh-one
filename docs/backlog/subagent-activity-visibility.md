# 子代理运行时的状态可见性

记录于 2026-10-29。

## 背景与现象

用户反馈：子代理正在运行时，父会话在 sessions 面板里没有任何忙碌指示，看起来像已经空闲；且头部「N 个子代理」下拉看不出每个子代理是进行中还是已完成，官方 dsh web 两者都有。

实测取证（2026-10-29，本机 host）：起一个 sleep 100s 的后台子代理后轮询 `session.list`，父会话轮结束（挂载等待子代理通知）后 `running` 跳为 **false**，而子代理仍 `running=true`，该状态持续了约 80 秒——这段时间 dsh-one 的会话行确实无像素环。子代理 settle 通知唤醒父会话后 `running` 恢复 true。

## 根因

1. **父会话行无忙碌指示**：host 的 `session.list` 里 `running` = agent 自身相位（`dsh-agent-loop` 的 `kick()` 跑完即置 `idle`），不考虑子代理是否还在跑。dsh-one 的会话树只渲染 `workspace.list` 成员（实测 `sessionIds` 只含 `session-` 根会话，子代理不在其中），行首状态槽只看自己的 `running`（`src/ui/chat/webview.ts` renderSessionRow），父一 idle 整组就显得空闲。官方 dsh web 按 `parentSessionId` 血缘把子代理渲染成父会话下的缩进行（`dsh-client-runtime` flattenLineage），子行各自带 spinner，父等待时整组仍可见活动。
   - 注意：带 goal 的父会话因自动续轮相位恒为 running，会掩盖此问题（用户截图里 dsh web 那个会话就是这种情况）。
2. **子代理下拉无状态区分**：dsh-one 的头部 chip 数据来自 `session.list` 基线里 `parentSessionId` 指向附着会话且 `running=true` 的行（`src/ui/chatView.ts` composeHeader），只含运行中的子代理，下拉里也没有状态标记，子代理完成后直接从列表消失。官方走专用 RPC `subagents.list`，返回全部 continuable 子代理并带 `activity: "running" | "inactive"` 字段，弹层里绿点=进行中、蓝块=已完成（ready）。

## 建议方案

- 条目 1：渲染会话行时把「有运行中后代」并入忙碌判定——`SessionsStore` 的 `rawSessions` 里已有全部子代理行（含 `parentSessionId`），`buildSessionTree` 或展示层按血缘聚合即可，不需要新 RPC。是否同时把子代理渲染成缩进行（进一步对齐官方）可另行决定。
- 条目 2：头部 chip 改用 host 的 `subagents.list` RPC（`dsh-host-apiproxy` 已提供，payload `{parentSessionId}`，返回 entries + `activity`），下拉列出全部子代理并加状态点；或简化为在现有 session.list 渠道里去掉 `s.running` 过滤、用 running 字段画状态点。

## 涉及代码位置

- `src/ui/chat/webview.ts`：renderSessionRow（行首状态槽）、openSubagentMenu（子代理下拉）
- `src/ui/chatView.ts`：composeHeader（runningSubagents 的过滤）
- `src/pure/sessionTree.ts`：buildSessionTree（血缘聚合点）
- `src/ui/sessionsStore.ts`：rawSessions 基线（已含子代理行）
- 参考：`dsh-client-runtime` flattenLineage、`dsh-host-apiproxy` subagents.list
