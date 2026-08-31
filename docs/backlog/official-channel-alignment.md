# 数据渠道对齐官方的四个优化项（审计遗留）

记录于 2026-08-31。

## 背景

2026-08-31 对 dsh-one 全部数据获取路径做了合规性审计（对照官方 `@deepseek-ai/dsh@0.1.1-rc.2` 客户端 bundle），结论是**所有渠道合规**，但有 4 处「合规却比官方绕」的写法，对齐后更省流量/更准确。均非缺陷，属于优化。

## 条目

1. **session.history 改为窗口分页**：官方 `Session.doOpen` 用 `maxMessages: 50` 窗口 + 用户上翻时按需 loadOlder；我们是 beforeSeq 全量翻页到 MAX_HISTORY_PAGES 上限。长会话首屏会多拉大量历史。对齐可省流量，工作量中等（sessionHistory 加窗口参数 + 消息列表加「加载更早」UI）。涉及 `src/server/dshRpc.ts`、`src/server/chatSession.ts` init、`src/ui/chat/webview.ts`。
2. **running/blank 状态改读服务段位**：官方 runtime 直接中继 session.list 摘要的 `running`/`blank` 字段 + host 流 `host/session-status` 帧；我们 `chatSession.ts` 的 `folder.hasOpenTurn()` 是从已消费的 mux 事件折叠出来的，history 未落地或纯排队期间可能偏差。涉及 `src/server/chatSession.ts` getState、`src/ui/sessionsStore.ts`。
3. **events.host 升级为逐帧增量**：官方 host 帧含 session-added/removed/status、workspace-changed，足以增量维护会话列表；我们现在只取 method 字符串后 500ms 防抖全量重拉 session.list。涉及 `src/ui/sessionsStore.ts`、`src/server/dshRpc.ts`（host 帧解析）。
4. **session.prompt 补 `clientTimeZone`**：官方 prompt 会带用户时区（schema optional），影响服务端相对时间类文案；我们不发不违规，补上更对齐。涉及 `src/server/dshRpc.ts` promptSession。

## 建议

四项互相独立，可单独立项；第 1 项收益最大（长会话首屏流量），第 2 项能消掉一类状态偏差。
