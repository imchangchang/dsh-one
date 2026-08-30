# mux 事件流断线无重连

记录于 2026-08-30。

## 背景与现象

聊天面板的实时更新全部依赖 WebSocket `/api/events.mux`（流式 chunk、`session/projection` 投影、`session/queue` 快照、审批/提问请求等）。`src/server/muxEvents.ts:21` 的 `subscribeMuxEvents()` 在 `ChatSessionController.init()`（`src/server/chatSession.ts:465`）里只订阅一次，`onclose`/`onerror` 仅记日志，**没有重连逻辑**（注释里自己写明 "No reconnect logic"）。

WS 一旦断开（dsh host 重启、dsh 自身插件热更新、网络抖动、系统休眠唤醒等），面板静默失明：

- HTTP RPC（发消息、停止、切模型）不受影响，消息能发出去，host 也在正常跑；
- 但流式输出、用量、排队状态全部收不到，界面看起来像卡死；
- 切换会话再切回来会重新拉历史基线，内容"突然出现"。

2026-08-30 排查"发送消息后没有流式输出"时确认过该隐患；当次的实际根因是 kimi-coding k3 大上下文下首 token 延迟约 111 秒（已通过 turn 等待状态行缓解，见 `8aec516`），mux 断连不是当次诱因，但缺口真实存在。

## 官方行为

dsh web 官方客户端（`dsh-client-connection`）对事件流有完整的指数退避重连，重连后重新同步（"client sees both streams close -> reconnect + resync path"），断线对用户无感。

## 建议方案

1. `subscribeMuxEvents` 的 close/error 回调通知上层，而不是只记日志。
2. `ChatSessionController` 收到断线后按指数退避重订阅（如 1s、2s、4s…封顶 30s），dispose 时停止。
3. 重连后必须重新拉历史基线：断线期间的事件已丢失，只接新事件会让对话状态出现空洞。可用 `session/subscribed` 帧里的 `lastSeq` 与本地已折叠的最大 seq 比较判断缺口，有缺口才重拉。

涉及文件：`src/server/muxEvents.ts`、`src/server/chatSession.ts`（`init()` / `onFrame()` 的 subscribed 分支）。`src/server/hostEvents.ts` 也是同样的一次性订阅模式，可一并评估。
