# composer 移入滚动容器（sticky-bottom 流内布局，对齐官方 dsh web）

## 背景

`composer-multiline-input-jitter` 调查（2026-09-05）中逆向官方 dsh web 0.1.2-rc.1 聊天滚动实现（未压缩源码 `dsh-client-ui-chat` / `dsh-client-ui-conversation`）得出的布局层治本方向。机制层修复（ResizeObserver 统一补偿，见 composer-multiline-input-jitter）已先行落地；本条目是后续可选的布局重构。

## 官方布局（值得对齐的形态）

```
滚动容器 [data-conversation-scroll]（唯一，overflow-y:auto）
├─ ChatView 内容列 [data-chat-flow]（消息行）
└─ composer seat [data-composer-seat]（position:sticky; bottom:0，顶部 36px 渐变遮罩）
```

composer 是滚动容器**内部最后一项**（sticky bottom），不是容器外的 flex 兄弟。dock 家族（todo/queue/goal，`input.dock`）也都在 composer seat 内。

一个布局决定消掉三类问题：

1. **composer/dock 增高不再压缩消息区 clientHeight**——增高天然把滚动内容往上顶，V 类扰动在布局层消失（RO 补偿仍保留作兜底，官方也保留）。
2. **「回到最新」按钮定位**：`bottom: calc(var(--dsh-composer-height) + 16px)`，纯 CSS 变量联动（RO 把 composer 高度写成 scroller 的 CSS 变量），无 JS 重排；按钮本身是 height:0 sticky 槽 + 负 margin 浮起，零布局成本。
3. **底部留白/遮挡**：sticky seat 天然处理，不需要 padding-bottom 补偿。

## 我们现状的差异（要动的面）

- `.chat-col` flex 列：header / .messages(flex:1) / todo / goal / queue / pending / .input-area 全是 flex:none 兄弟 → 全部要搬入滚动容器（或至少 composer + dock 家族搬入）。
- jump-latest 现是 .messages 内 sticky 末位项，bottom 写死 4px——要改成跟 composer 高度联动的定位。
- @补全弹窗/slash 弹窗锚定 input（positionSlashPopup）——input 搬进容器后随滚动移动，弹窗锚定要跟随（官方用 floating-ui；我们手写锚点，需重估）。
- pending 面板接管 composer 区的相对关系、hero 空态布局、send-button/clear-all 布局都要重排。
- 三个历史滚动补丁（贴底判定/惯性门控/回声剔除）的语义要在新结构上重验。

## 建议

- 不做「为修 bug 而做」——机制层（RO 补偿）已能整类消灭跳动；本条目的价值是**布局简化与后续维护成本**（按钮定位、底部留白、dock 增减都不用 JS 关心滚动）。
- 做时参考官方源码：`~/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js`（ChatView L1858-2510 滚动段）与 `dsh-client-ui-conversation/lib/client.js`（ConversationRoot 布局 + `--dsh-composer-height` 变量链路）。
- 前置：composer-multiline-input-jitter（RO 统一补偿应先落地，本布局里 RO 仍是跟随核心）。

## 变更记录

- 2026-09-05 由 composer-multiline-input-jitter 调查产出，用户拍板作为后续改进方向 → open
- 2026-09-06 官方 bundle 实证补全（composer-input-jitter-pinned-scroll 调查）：
  `dsh-client-ui-conversation/lib/client.js` L14476-14489 确认 `composerSeat`
  是 `scrollBody`（`data-conversation-scroll`）的直接子项，CSS
  `.wSkVaW_composerSeat{position:sticky;bottom:0}`；`--dsh-composer-height` 由
  ResizeObserver 观测 seat 后写到 scroller（L14338），jump-latest 类浮标
  `bottom: calc(var(--dsh-composer-height,152px) + 16px)` 纯 CSS 联动；
  官方 composer **没有任何 `style.height` JS 测量**（全文 0 次），输入框是
  Lexical 编辑器（`ReferenceChipNode`/`TextRefNode` 原生渲染 @ token）。
  另实证：输入框跳动（composer-input-jitter-pinned-scroll）根因是
  autoGrow 塌缩 clamp + 补偿竞态，在本布局里整类消失（消息区尺寸不再被压缩）。
  与本条目合并开发（同一 worktree）。
- 2026-09-06 认领（worktree: agent/composer-sticky-in-scroller-layout；与 composer-input-jitter-pinned-scroll 合并开发）→ doing
- 2026-09-06 开发完成（worktree: agent/composer-sticky-in-scroller-layout，已 rebase 到 cf8e1c9+）：探针实测逐字输入消息区像素级静止；自测通过；ledger: test/sandbox/verify.composer-sticky-in-scroller-layout.ledger.json → done
