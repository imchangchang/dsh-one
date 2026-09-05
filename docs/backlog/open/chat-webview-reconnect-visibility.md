# chat webview 断连可见性 + 凭证兜底 + 重启实测

## 背景与现象

2026-09-05 实例重启事故（见 `upstream-web-chat-stream-silent-freeze`）暴露的同类风险在我们自己的 chat webview 同样存在：事件流断线后用户毫无感知（假死）。我们的链路比官方 GUI 好——已有重连 + re-baseline——但有两个缺口且未经实例重启实测。

## 现状

已有（`src/server/chatSession.ts`）：

- 断线重连：`onMuxClose` → 1s 翻倍退避（上限 `RECONNECT_MAX_MS`）→ 重新 attach
- re-baseline：重连后重拉历史/投影基线（`loadBaseline`），期间缓存的 live 事件补放；语义对齐官方 `Session.doOpen` resync（reset window + rerun open）
- 凭证可跨重启：dsh 签名密钥持久化在 `$DSH_HOME/.credentials.yaml`（dsh-client-connection `initializeSecret`），cookie 默认 30 天（`cookieMaxAgeDays`），实例重启后旧 cookie 仍有效

缺口：

1. **重连状态不透出 UI**：断线只 `logger.warn`，webview 无任何提示——和官方 GUI 一样的假死感
2. **无 401 兜底**：重连路径只用内存里的旧 cookie（`remoteMux.ts` 的 `cookieHeader(origin)`），cookie 过期或意外失效后无限静默重试；没有任何「重新 token 交换」路径
3. **没实测过**：这套重连 + re-baseline 从未在「杀实例重起」场景下验证过

## 建议方案

1. **断连横幅**：host 在 reconnect 开始/成功/最终失败时 postMessage 通知 webview，显示/收起「连接中断，重连中…」横幅（含手动「立即重连」按钮）——对齐官方连接层设计了但未落地的 observable recovery state + immediate reconnect command
2. **凭证兜底**：重连连续失败 N 次（或明确 401）→ 用 manager 持有的当前实例 token 重新 `exchangeToken` 换 cookie 再重连；manager 实例身份变化（re-own/spawn 新实例）时主动失效旧凭证
3. **沙盒实测**：起实例 → 开会话 → kill 实例 → respawn → 验证 webview 自愈（横幅出现→消失、消息流续上）；进 ledger

## 涉及代码位置

- `src/server/chatSession.ts`：onMuxClose / rebaseline / attach / clearOpenError
- `src/server/remoteMux.ts`：WS cookie 头（`cookieHeader`）
- `src/server/serverAuth.ts`：exchangeToken / cookieHeader / per-origin auth state
- `src/server/manager.ts`：当前 token 持有、实例身份变化事件
- `src/ui/chat/webview.ts`：横幅渲染

## 变更记录

- 2026-09-05 用户要求（讨论「我们自己能规避官方 GUI 冻结问题么」后确认的三条之一）：建条目（open/）
