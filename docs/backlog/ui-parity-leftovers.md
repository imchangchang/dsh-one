# 官方 UI 对齐的零散遗留项

记录于 2026-08-31。

## 背景

对齐 dsh web 官方界面的过程中，有几处已知差异当时有意未做或缺数据源，统一记在这里，做完一项删一项。

## 条目

1. **会话行的「待交互 / 已完成」状态标记**：官方 StateDot 除运行中像素环外还有琥珀点（等批准/计划评审/等回答）和绿点（已完成），依赖 host 的 pendingInteraction / completed 投影；我们 session.list 基线目前没有这两个字段。等 RPC 暴露投影后补到行首状态槽（`src/ui/chat/webview.ts` renderSessionRow、`src/pure/sessionTree.ts`）。
2. **聊天内联的 live-jobs 横条与头部 chip 并存**：官方会话内似乎只有头部「N 个后台任务」chip；我们还留着聊天流里的运行中任务内联横条（`state.jobs`）。确认官方行为后决定删或留。
3. **头部/hero 的 preset chip 无 tooltip 描述**：官方 AgentPresetLabel 悬停显示 preset 描述；需要把 roster 的 description 带进头部 state（数据链路小改，`src/server/chatSession.ts` + `src/pure/chatContract.ts`）。
4. **chip chevron 打开态不旋转**：官方下拉打开时 chevron 转 180°；我们的 popover 开态不进渲染流水线，要做需要 popover 状态回流到 chip，代价大于收益，暂缓。
5. **hero 的 FishLogo 游动动画未做**：官方空态有 logo 动效，我们用的纯文字标题「探索未至之境」。如要品牌一致可后补。
6. **hero 的 workspace chip 只读**：官方是选择器（可给空会话换 workspace）；我们没有「blank 会话换 workspace」的链路（需要新建会话到目标 workspace 并切换附着）。属新功能而非样式对齐。
7. **后台 job 输出无预览**：任务下拉只到状态/耗时；host 没有读 job 输出的客户端 RPC（只有模型侧 job_output 工具），要做需要 host 支持。
8. **turn 中途被注入消息切断时操作栏重复出现**（2026-09-01 用户截图反馈）：官方一个 turn 一条 assistant 消息，复制/好/不好/分支栏只在 turn 结尾出现一次；我们的 ConversationFolder 同样一个 turn 折一条消息，但 turn 中间插入的 user/message（子代理完成通知等注入上下文）会切断 `current`，下一步另起一条消息，而 renderMessage 对每条 complete 的消息都渲染操作栏（`src/ui/chat/webview.ts` renderMessage 尾部 `if (m.complete && …)`），于是一个 turn 里出现多次操作栏。两个附带偏差：mid-turn 消息上的「分支」atSeq 落在 turn 中间（官方只能从已完成 turn 的最后一条消息分支）；反馈也按各 step 的 messageId 分散在多条消息上。建议：ChatAssistantMessage 加 `turnEnd` 标记，turn/end 时标上（`current` 可能已被切断为 null，可按 ensureAssistant 的 id 规则 `assistant-t${turn}` 从 msgs 尾部找回本 turn 最后一条），renderMessage 把操作栏条件从 `m.complete` 改为 `m.turnEnd`。注意 turn/end 落在历史窗口外的消息会因此没有操作栏（可接受，本来 fork 点也不可靠）。

涉及文件：见各条目。
