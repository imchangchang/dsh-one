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
2. **没实测过**：这套重连 + re-baseline 从未在「杀实例重起」场景下验证过
3. **401 兜底只剩窄边**（2026-09-05 对照主线复核后修正）：凭证链比最初判断的完整——manager 的所有获票路径（spawn 就绪行换票 486、re-own/adopt 253/283、日志恢复 332/403、外部连接 164）都会 `exchangeToken` → `registerAuth` 更新 per-origin store；`remoteMux.ensureSocket` 每次重连都重读 `cookieHeader`。即 **manager 知情的重启路径，重连自动带新 cookie，链路闭环**。真正缺的兜底只剩两种 manager 不知情的场景：实例被外部替换（同端口新进程、健康检查照样通过）与 cookie 30 天过期（`cookieMaxAgeDays`）——此时重连反复 401，需要「重连连续失败 → 触发 manager 重新感知实例（probe/换票）」的联动

## 建议方案

**本期范围**（2026-09-05 用户收窄：只做前端体验部分，后端问题先不处理）：

1. **断连横幅**：host 在 reconnect 开始/成功/最终失败时 postMessage 通知 webview，显示/收起「连接中断，重连中…」横幅（含手动「立即重连」按钮）——对齐官方连接层设计了但未落地的 observable recovery state + immediate reconnect command
2. **沙盒实测**：起实例 → 开会话 → kill 实例 → respawn → 验证 webview 自愈（横幅出现→消失、消息流续上）；进 ledger。预期主线现有凭证链大概率已能自愈（见缺口 3），实测同时验证这一点

**暂缓项**（窄边，属 host 联动，随「后端先不处理」搁置，真踩到再单独立项）：

- 凭证兜底：重连连续失败 N 次（或明确 401）→ 触发 manager 重新感知实例（probe 端口 + 必要时重新换票/重 spawn）；复用 serverAuth 现有 `probeToken`/`exchangeToken` 原语。只在「实例被外部替换 manager 不知情」「cookie 30 天过期」时才需要

## 涉及代码位置

- `src/server/chatSession.ts`：onMuxClose / rebaseline / attach / clearOpenError
- `src/server/remoteMux.ts`：WS cookie 头（`cookieHeader`）
- `src/server/serverAuth.ts`：exchangeToken / cookieHeader / per-origin auth state
- `src/server/manager.ts`：当前 token 持有、实例身份变化事件
- `src/ui/chat/webview.ts`：横幅渲染

## 变更记录

- 2026-09-05 用户要求（讨论「我们自己能规避官方 GUI 冻结问题么」后确认的三条之一）：建条目（open/）
- 2026-09-05 用户要求（对照主线最新状态复核修改方案）：chat-column-layout 合入未触动本方案涉及的文件，方案主体不变；修正凭证兜底的问题描述与方案精度（manager 知情路径凭证链已闭环，兜底只剩外部替换/cookie 过期窄边），实测项同时验证自愈假设
- 2026-09-05 用户收窄范围（只做前端体验部分）：建议方案拆为「本期范围」（断连横幅+沙盒实测）与「暂缓项」（凭证兜底）
- 2026-09-05 认领（worktree: agent/chat-webview-reconnect-banner，只做断连横幅+沙盒实测，凭证兜底暂缓）→ doing
