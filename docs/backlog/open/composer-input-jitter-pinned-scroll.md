# 输入长文本时上方对话区随每次按键跳动（贴底态瞬态 clamp + 补偿竞态）

## 现象

用户在主线实机（已发生对话、等待输入、消息列表贴底跟随）输入长文本时：

- 即使**输入行未换行、输入框高度没变**，每次按键上方已显示对话都会跳一下；
- 高频率连续输入时表现为「上面内容一直在不停刷新/跳动」。

## 核实结论（harness + Playwright 真实按键复现，可见代码在 `src/ui/chat/webview.ts`）

**结论：不是渲染重建**（`reconcileFlow` 增量更新下 `.messages` 子节点零 MutationObserver 事件），
**是滚动位置在每键发生一次「瞬态塌缩 clamp → 恢复后补偿」的往返**。三层机制叠加：

### 1. 瞬态塌缩 clamp（根源）

`autoGrow()`（webview.ts L7171）每键执行：

```ts
input.style.height = 'auto'
input.style.height = `${Math.min(input.scrollHeight, 160)}px`
```

读 `scrollHeight` 前浏览器被迫以 `height:auto` 完成一次布局。此时 textarea 塌回
1 行（30px），`.chat-col` 是 flex 列、`.messages` 是 `flex:1` 弹性项——**消息区
瞬间变高**（560px 宽实测 508→576），浏览器把 `.messages.scrollTop` **立即 clamp 到
新上限**（1810 = 576 高时的 max，贴底态原值为 1878）。之后 `height` 恢复原值、消息区
缩回，但 **scrollTop 不会自动弹回**，同步阶段 `bottomGap=68px`（一次塌缩的幅度 =
textarea 当前行数 × 行高）。

实测序列（同任务内逐步采样）：

```
bottom-pinned   st=1878 ch=508 gap=0     <- 贴底态
A-collapsed     st=1810 ch=576 gap=0     <- height:auto 强制布局，scrollTop 被 clamp
C-restored-sync st=1810 ch=508 gap=68    <- height 恢复，scrollTop 停在 clamp 点
E-after-300ms   st=1878 ch=508 gap=0     <- 补偿逻辑最终拉回
```

### 2. 恢复后每键一次「漂 → 吸」往返

- `ResizeObserver`（L3358）观测到消息区尺寸变化：滚动活动锁在 `scrollActiveRecently()`
  窗口内走 `deferSettlePin()`，窗口外同帧钉底——但同帧 RO 的钉底写回之后，塌缩产生的
  96px 悬空已在离线 layout 中形成，**paint 前补偿与塌缩 clamp 竞态**；
- 实测 `maybeSettlePin` 在塌缩后 ~140ms（`SETTLE_IDLE_MS`）把 `st` 从 1810 拉回 1878，
  与 RO 各写一次（捕获到 6 次 `writeMessagesScrollTop`，栈：RO / maybeSettlePin×5）；
- 于是每键呈现「内容下沉 68px → 140ms 后回弹」，渲染上是**上方已显示对话不停地跳**。

### 3. 第一键的额外一跳

首键之前 input 是原生 `rows=1` 高度（49px，占位符两行），首键后塌缩/恢复让
`inputH 49→30`、`mST 1015→1000`，即第一次按键额外有一次位置跳变（mCH 561→576）。

## 触发条件

- 输入框已多行（`scrollHeight` 恢复高度 > 首行高）或有长占位符——单行首键也跳一次；
- 消息区贴底跟随（等待输入的常态）：塌缩使消息区变高、max scrollTop 变小才会 clamp；
  翻历史（非贴底）时塌缩增大的是 max，无 clamp 但若 rollback 仍会被补偿路径拉底。

## 修复方向（备忘，未实施）

- 治本：autoGrow 不再对存活 textarea 做 `height:auto` 塌缩——用隐藏镜像元素测量
  （同宽/同 padding/同字体，`visibility:hidden` 或绝对定位下测量 `scrollHeight`），
  或把 `height:auto` 的强制布局用 `contain: layout` 框住，不让它传导成兄弟尺寸变化。
- 或次选：autoGrow 塌缩前后把 `.messages` 的 `scrollTop`/`stickToBottom` 记下来，
  `height` 恢复后如果 `stickToBottom` 且被 clamp 过，同步一次 `writeMessagesScrollTop`
  回新 max（不再等 140ms settle）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`autoGrow()`（L7171-7174）、`renderInput` 的 input 事件链（L7008-7017）、
  `ResizeObserver` 观测（L3358-3368）、`maybeSettlePin`/`deferSettlePin`（L246-278）
- `src/ui/chatViewHtml.ts`：`.chat-col` flex 列 / `.messages` `flex:1` / `.input-area`（L1114-1117）

## 变更记录

- 2026-09-06 用户主线实机报告「输入长文本上方对话区不断跳动」→ harness+Playwright 复现与机制验证 → 确认（瞬态塌缩 clamp + 补偿竞态，非渲染重建）→ open
