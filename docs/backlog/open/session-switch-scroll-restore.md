# 换会话时滚动位置不恢复（自渲染聊天面板缺 per-session 滚动记忆）

## 背景与现象

在 dsh-one 自渲染聊天面板（`dshOne.chat` webview）里切换会话，再切回某个会话时，滚动位置不是离开时的位置。举例：在会话 A 向上翻到历史某处 → 切到会话 B → 再切回 A，A 不会停在之前读到的位置，而是落到底部（或串到 B 的某个位置）。

期望行为（对齐官方 dsh web 的 `chatScrollPositions` 语义）：每个会话记住自己的滚动位置，切走再切回能恢复；贴底状态与翻历史位置按会话分别记忆。

## 根因（已在代码中定位）

`src/ui/chat/webview.ts` 没有按 session 的滚动记忆，且滚动状态全部全局化，换会话时还会跨会话串位置：

1. **无 per-session 滚动记录**。全代码没有任何 `Map<sessionId, scroll>` 一类的存档（官方 dsh web 用的是 `chatScrollPositions` Map，这里不存在对应物）。
2. **单例滚动容器跨会话复用 + 全局跟随态**。`#messages` 容器换会话不销毁（`keepMessages`），`stickToBottom` 是全局布尔，换会话也不重置——`state` 消息处理（webview.ts 281-292 行）只清了 `stagedForSession` 等，没碰 `stickToBottom`。
3. **跨会话串位置**。恢复滚动用的是 `prevScrollTop = oldMessages.scrollTop`（webview.ts 1182 行），而 `oldMessages` 恰好是上一个会话的容器，其 scrollTop 是上个会话的位置；落地分支（1505-1508 行）在 `stickToBottom === false` 时直接把它套到新会话内容上，且 1512 行 `pinnedScrollTop` 随后把错误位置固化。切回原会话时又无存档，于是永远回不到离开时位置。

### 与旧条目「chat-scroll-restore-fallback」的澄清

已删除的 `chat-scroll-restore-fallback` 条目只核实了**官方 dsh web** 的刷新/断线重连路径（客户端 `resync()` 窗口塌缩 → 锚点丢失 → 套用失效 scrollTop 并固化），并据此判定「dsh-one 自渲染面板不走那条路径、不受影响」。该判定是对的，但**没有检查 dsh-one 自己面板的换会话滚动**——这里存在一个独立、一直存在的 bug。所以「对我们无影响」未覆盖到本问题。

## 建议方案

在 `src/ui/chat/webview.ts` 增加 per-session 滚动记忆，对齐官方语义（贴底存 `null`，翻历史才存位置）：

- `Map<sessionId, { scrollTop, atBottom }>`（或按 anchor/比例，抗内容增长）。
- 换会话时先存旧会话位置，再按新会话存档恢复；无存档默认贴底。
- 换会话时 `stickToBottom` 改为按会话记忆，不要复用全局值，也**不要**把上一个会话的 `prevScrollTop` 套到新内容上。

## 涉及代码位置

- `src/ui/chat/webview.ts` — 聊天 webview：`stickToBottom`（68 行）、`pinnedScrollTop`（76 行）、会话切换重置（281-292 行）、`prevScrollTop`（1182 行）、`keepMessages`（1259 行）、滚动落地（1505-1512 行）

## 变更记录

- 2026-09-01 核实并定位根因（源码核对 dsh-one webview.ts 与官方 dsh-client-ui-conversation/lib/client.js），写入 open→open
