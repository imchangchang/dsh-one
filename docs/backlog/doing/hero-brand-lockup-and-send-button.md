# 空态 hero 品牌区与发送按钮对齐官方（去掉标题）

记录于 2026-09-02。用户反馈（附截图，Chat 空态 hero 页）：三点要求——① 发送按钮做成官方 dsh web 那样；② 鲸鱼图标区改成「官方鲸鱼 × DSH One 像素鲸鱼 logo」组合，联同 x 分隔符一起浮动；③ 去掉「探索未至之境 预览版」标题。2026-09-02 补充：发送按钮改动范围不限 hero 空态，**非空白对话（普通消息流态）的 composer 同样改成官方交互**。

## 现状（已核实）

- **发送按钮**：`src/ui/chat/webview.ts:4573` `buttonEl('send-button', '发送')`，是通用文字按钮（样式 `src/ui/chatViewHtml.ts:828-836` 的 `button`，vscode 变量配色、4px 圆角）。
  官方 dsh web：hero 与非 hero（普通消息流态）是**同一个 `InputBar` 组件**（`uV2eYG_*`），主按钮 `.uV2eYG_primary` 完全一致（dsh-client-ui-conversation bundle `css$17`）——34×34 圆形（`border-radius:999px`，`display:grid;place-items:center`），背景 `var(--dsw-alias-button-info-fill)`、hover `--dsw-alias-button-info-hover`、disabled `opacity:.4`，白色 `IconSendOutline16` 16px 图标（无文字），`transform:translateY(-2px)`；**运行中（`primaryStops = running && subagent === null`）同一按钮变停止方块图标**（`<rect x=3 y=3 width=10 height=10 rx=3>`，viewBox 0 0 16 16，无 Tooltip 文案，aria-label `input.stop`），点击即 `stop()`，旁边不再有独立停止按钮。官方发送图标 path（`IconSendOutline16`，viewBox 0 0 16 16）：
  `M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z`
- **hero 鲸鱼**：`src/ui/chat/webview.ts:2428` 只渲染官方 `FISH_LOGO`（dsh-web-frontend FishLogo path，56px，`.hero-fish` 游动动画，样式 `chatViewHtml.ts:1269-1280`）。官方 web hero 的 `conversation.hero.brand.mark` 槽也给 FishLogo（品牌包 dsh-client-ui-brand-official），即 dsh-one 现状与官方一致；用户要求在此之上加 DSH One 自己的品牌元素。
- **标题**：`src/ui/chat/webview.ts:2429-2432` 渲染「探索未至之境」+「预览版」徽章（官方 hero 本身就有这两个文案，`hero.headline`/`hero.preview`，dsh-one 是对齐官方做的）。用户要求整个标题行去掉。

## 建议方案（想法：未确认）

1. **发送按钮**（hero 与非 hero 统一）：composer 发送按钮改成官方圆形图标按钮——34×34 圆、`IconSendOutline16`（上面 path，加入 `src/ui/chat/icons.ts`）、品牌蓝底白图标、hover 变深、disabled 半透明、`translateY(-2px)`；**同一按钮在 `state.running` 时切换成停止方块图标（viewBox 0 0 16 16 的 rx=3 rect），点击发 `stop`**，替代现在「发送」+ 旁边独立「停止」按钮的并排交互（webview.ts:4756-4758 的 `secondary stop-button` 随之删除，停止能力并入主按钮）。保留现有 disabled 判定逻辑不变。
2. **hero 品牌区**：鲸鱼位置渲染「官方 FishLogo ×（分隔符）DSH One 像素鲸鱼 logo（`assets/icon.svg` 的像素鲸，原作者：Recraft 生成 + 像素提取，`#2563EB`）」组合，一起用现有 `.hero-fish` 游动动画浮动；分隔符用 x/× 字形或细笔画图标（具体样式未定）。需要确认组合尺寸比例与分隔符号样式，以及 DSH One logo 以 SVG 内联还是 `assets/icon.svg` 引用（webview CSP 限制内联缓存，参考 `api/images` 处理方式）。
3. **去掉标题**：`renderHero` 删除 headline 两行；随 ② 重排 hero-stack 的布局间距（`.hero-stack` gap 等）。

## 涉及代码位置

- `src/ui/chat/webview.ts` — `renderHero`（:2423-2468）、`renderInput` 发送按钮（:4573）与运行中独立停止按钮（:4756-4758）
- `src/ui/chatViewHtml.ts` — `.hero-fish`、`.hero-headline*`、`.hero-badge`、`.hero-stack`、`button`/`.send-button`/`.stop-button`
- `src/ui/chat/icons.ts` — 新增 `SEND_ICON`（官方 IconSendOutline16 path）
- 官方对照：全局 `@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（`InputBar` `primaryStops`/`onPrimary` :3872-3885、主按钮渲染 :4128-4164、`.uV2eYG_primary` 样式 css$17）

## 变更记录

- 2026-09-02 记录 → open（想法：未确认，x 分隔符语义已向用户确认）
- 2026-09-02 用户补充：发送按钮改动覆盖非空白对话（普通消息流态），与官方交互一致（运行中主按钮变停止、取消独立停止按钮）；官方 InputBar 主按钮细节已核实
- 2026-09-02 认领（worktree: agent/hero-brand-lockup-and-send-button）→ doing
