# composer 局部上 Lexical 编辑器（消灭透明 textarea + 叠加层高亮层）

## 背景

2026-09-06 前端问题归因讨论（见 webview-framework-eval 的三层分析）核实：
我们的 composer 是「透明文字 textarea + `.ref-token-layer` 叠加层画 @ token」
的自造结构，autoGrow 手写塌缩测量。由此产生的补丁链：
`composer-long-text-overflow`（叠加层平移越界）、`composer-caret-follow-sync`
（光标跟随叠加层要 rAF 兜底）、`composer-ghost-after-send`（透明文字残留）、
`composer-input-jitter-pinned-scroll`（autoGrow 塌缩 clamp）。

官方 dsh web 实证（`dsh-client-ui-conversation/package.json` deps +
bundle 核实）：composer 是 **Lexical** 编辑器，@ 引用是编辑器原生节点
（bundle 内有 `ReferenceChipNode` / `TextRefNode` 两个 Lexical Node 类），
自动高度无 JS（全文 0 次 `style.height`），叠加层/塌缩测量这类负担整体不存在。

## 建议

- 只换 composer，不动消息流渲染。官方 composer 就是独立包
  （`dsh-client-ui-conversation` 依赖 `lexical@^0.49.0` + `@lexical/plain-text`
  等四个子包），迁移面可控。
- 需要重建的能力：@ token 高亮/hover 联动 chip、mentionBindings 展开、
  paste 折叠、IME 组合、clear-all/recall 草稿恢复、占位符。全部在 Lexical
  节点模型里有对应物（DecoratorNode + registerCommand + registerPasteCommand）。
- 打包：Lexical 五包合计约 ~400KB min（gzip ~120KB），webview 本地加载可接受；
  用 `@lexical/plain-text`（官方同款），不要富文本。

## 前置

- composer-sticky-in-scroller-layout（结构先稳定，再换编辑器；本条目做完后
  autoGrow/ref-layer 两套自研代码整体删除）。

## 变更记录

- 2026-09-06 前端问题归因讨论（核实官方 bundle 后确认官方 composer=Lexical
  且 @ token 为原生节点）→ 作为中期评估条目 → open
