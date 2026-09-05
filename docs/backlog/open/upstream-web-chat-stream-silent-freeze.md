# 上游 issue：dsh web GUI 聊天事件流静默卡死（实例重启后不恢复、无提示）

## 现象（2026-09-05 实机事故，dsh 0.1.2-rc.1）

浏览器标签页打开 session「开发主线大管家」（session-52b21d61，dsh-one workspace）。13:21 dsh 实例重启（杀旧进程 + 新 spawn）后，该标签页：

- **聊天内容冻结在重启那一刻**（最后渲染的是 13:15-13:21 的重启脚本消息），之后约 4 小时的对话全部不渲染
- **页面其它区域仍然实时**：侧栏会话列表更新时间正常走、底部 stats（336 轮）正常走——页面看起来完全正常
- 17:04 在该标签页执行 `/compact`，命令正常到达服务端并执行（跑了 4.5 分钟后失败：`Anthropic stream ended without a stop reason`），但**失败结果页面上完全看不到**——只有输入框旁的转圈
- **新标签页打开同一 session 一切正常**：完整对话 + 失败红字行（`compact · Compaction could not produce a useful summary…`）都渲染

## 根因方向（已查代码）

- 传输层重连是有的（`dsh-client-connection`：connection generation + `ConnectionController` retry policy）——侧栏/stats 活着证明传输层恢复了
- 死的是**会话聊天流订阅**：重启后没有重新订阅/resync，且静默
- 官方连接层设计了 **observable recovery state** 和 **immediate reconnect command**，但翻遍 `dsh-client-ui-chat` / `ui-conversation` / `ui-layout` / `ui-session`，**没有任何组件渲染恢复状态**——设计存在、UI 未落地

## 证据清单（提 issue 时附）

- session 日志：`compaction/start` seq 659908（17:04:43）→ `compaction/end` seq 659909（17:09:12，error）→ `command/done` error；日志本身完整无损坏
- 旧标签页 DOM：全页无任何 compact 相关文本；聊天 scrollBody 贴底但内容是 13:21 前的
- 新标签页同 session 渲染完整（对照实验）

## 诉求（issue 内容）

1. 会话聊天事件流断开后自动重订阅 + resync（对齐 `Session.doOpen` 的 reset window + rerun open）
2. 恢复状态渲染：断连/重连中横幅，至少让用户知道页面不再是实时

## 动作

整理成 issue 提到 deepseek-harness 上游（或内部渠道）。**这是跟踪条目，改动发生在上游，不在本仓库**；上游修复发布后验证关闭。

## 变更记录

- 2026-09-05 用户要求（compact 失败提示排查事故复盘）：建条目（open/）
