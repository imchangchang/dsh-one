# hero 空态 FishLogo 游动动画

记录于 2026-08-31。从 ui-parity-leftovers 拆分。

## 背景与现象

官方 dsh web 空态有 FishLogo 动效；dsh-one 空态是纯文字标题「探索未至之境」，无 logo。

## 现状

空态 hero 区域只渲染文字；仓库内无 FishLogo 资产（图标集是 dsh web 的 `dsh-client-ui-primitives`，需确认是否有 fish logo 的 SVG path 可用）。

## 建议方案

品牌一致可后补：找官方 fish logo 的 SVG path（从 `@deepseek-ai/dsh-web-frontend` dist bundle 反查，参考 chat-icons-from-dsh-web 的做法），空态渲染 logo + 轻量游动动画（CSS/SVG），别影响空态加载性能。

## 涉及代码位置

- `src/ui/chat/webview.ts`（空态 hero 渲染）
- 图标来源：`dsh-client-ui-primitives`（打进 `@deepseek-ai/dsh-web-frontend` dist bundle）
