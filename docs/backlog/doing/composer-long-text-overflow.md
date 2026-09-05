# composer 输入超长文本溢出卡片（ref-token-layer 滚动同步平移整个层）

## 背景与现象

用户在空白（hero）对话页输入很长的文字后，文字整体溢出 composer 大圆角卡片**上方**：卡片上方出现一截文本块（底部被裁成半行），卡片内部顶部只剩一条半行，其余区域为空。普通对话页共用同一份 `renderInput`，同样受影响（溢出方向为消息区，更显眼）。

## 根因（已用 harness 复现并定位）

`#input` 是**透明文字** textarea（`color: transparent`），可见文本由 `.ref-token-layer` 高亮层绘制（DOM 内与 textarea 同字体流叠加，`position: absolute; inset: 1px; overflow: hidden`）。长文本超过 `max-height: 160px` 后 textarea 内部滚动（`scrollTop > 0`），滚动同步三处（`src/ui/chat/webview.ts` renderRefLayer 两个分支 + `scroll` 监听）都执行：

```ts
refLayer.style.transform = `translateY(${-input.scrollTop}px)`
```

问题：transform 加在**层元素本身**（盒子）上。`overflow: hidden` 只把文本裁进盒子内部，但盒子整体上移了 `scrollTop` px，离开 `.composer-frame` 与卡片（`.input-area` 无 overflow clip），于是文本画到卡片上方，底部被盒子的下边缘裁成半行。这正好是截图里的形态：文本块在卡片上方 + 卡片内顶部一条半行 + 卡片主要为空。

注：正确行为是只平移层**内容**（与 textarea 滚动窗口对齐），盒子必须锚定在 textarea 上不动。现在把盒子一起平移，越界就漏出来了。

## 复现方法

harness：`test/ui/harness.html?scenario=empty` → `#input` 填入超长文本（如 320+ 汉字）→ 聚焦并把 `scrollTop` 设为 `scrollHeight`（或真实打字至 textarea 滚动）→ 截图。核对：`.ref-token-layer` 的 `getBoundingClientRect().top` 低于 `.hero .input-area` 的 top（越界），文字画在卡片上方。

## 全量输入框审计结论

同类「透明文字 + 叠加层 + scrollTop 平移」模式**只有 chat composer 一处**。其余输入控件均为原生滚动：

- question 面板「其他」自定义输入（`.question input[type='text']`）、plan-review「在聊天里说」输入行：单行原生 input，水平滚动在框内。
- queue 编辑框（`.queue-editor`）、goal 条幅编辑：原生 textarea / input。
- sessions 搜索框（`.sessions-search`）、workspace 分组新建/改名（`.wsg-*`）、会话改名（`.rename-input`）：原生 input，且都有 maxLength。

原生控件内容不会溢出自身盒子，均不受影响。

## 建议方案

盒子锚定与内容平移分离：在 `.ref-token-layer` 内加一层内容 wrapper（如 `.ref-token-scroll`），文本节点/token span 挂到 wrapper，`translateY(-scrollTop)` 加在 wrapper 上；层盒子保持 `absolute; inset: 1px; overflow: hidden` 不动。改动点：`src/ui/chat/webview.ts` renderRefLayer（清空/追加节点目标 + transform 目标）与 scroll 监听；`src/ui/chatViewHtml.ts` 补 wrapper 规则。composing/display 控制与 hover 联动（querySelectorAll 仍在层内搜）不受影响。

## 涉及代码位置

- `src/ui/chat/webview.ts` L6650-6711（refLayer 创建 + renderRefLayer）、L6744-6746（scroll 监听）
- `src/ui/chatViewHtml.ts` L1527-1555（`#input` / `.ref-token-layer` 样式）
- 对齐参考：dsh web 官方 composer 无此问题（无此类自绘层）

## 变更记录

- 2026-09-05 主线复现并定位根因（ai-visual-validation harness 截图对照用户报告），输入框全量审计完成 → open

- 2026-09-05 认领（worktree: agent/composer-long-text-overflow）→ doing
