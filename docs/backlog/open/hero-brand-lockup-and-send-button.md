# 空态 hero 品牌区与发送按钮对齐官方（去掉标题）

记录于 2026-09-02。用户反馈（附截图，Chat 空态 hero 页）：三点要求——① 发送按钮做成官方 dsh web 那样；② 鲸鱼图标区改成「官方鲸鱼 × DSH One 像素鲸鱼 logo」组合，联同 x 分隔符一起浮动；③ 去掉「探索未至之境 预览版」标题。

## 现状（已核实）

- **发送按钮**：`src/ui/chat/webview.ts:4573` `buttonEl('send-button', '发送')`，是通用文字按钮（样式 `src/ui/chatViewHtml.ts:828-836` 的 `button`，vscode 变量配色、4px 圆角）。
  官方 dsh web：composer 右下主按钮 `.uV2eYG_primary`（dsh-client-ui-conversation bundle `css$17`）——34×34 圆形（`border-radius:999px`，`display:grid;place-items:center`），背景 `var(--dsw-alias-button-info-fill)`、hover `--dsw-alias-button-info-hover`、disabled `opacity:.4`，白色 `IconSendOutline14` 14px 图标（无文字），`transform:translateY(-2px)`；运行中变停止按钮（`primaryStops`，文案 `input.stop`）。官方发送图标 path（`IconSendOutline14`，viewBox 0 0 14 14）：
  `M7.24707 1.01771C7.52897 1.07653 7.77619 1.19694 8.00391 1.38001C8.19202 1.53136 8.39884 1.73784 8.61914 1.95814L12.6396 5.9806L11.6299 6.99134L7.71484 3.0763V13.0001H6.28516V3.0763L2.36914 6.99134L1.35938 5.9806L5.38086 1.95814C5.60116 1.73784 5.80798 1.53136 5.99609 1.38001C6.19476 1.22027 6.4385 1.06739 6.75195 1.01771C6.91296 0.992304 7.07471 0.997504 7.24707 1.01771Z`
- **hero 鲸鱼**：`src/ui/chat/webview.ts:2428` 只渲染官方 `FISH_LOGO`（dsh-web-frontend FishLogo path，56px，`.hero-fish` 游动动画，样式 `chatViewHtml.ts:1269-1280`）。官方 web hero 的 `conversation.hero.brand.mark` 槽也给 FishLogo（品牌包 dsh-client-ui-brand-official），即 dsh-one 现状与官方一致；用户要求在此之上加 DSH One 自己的品牌元素。
- **标题**：`src/ui/chat/webview.ts:2429-2432` 渲染「探索未至之境」+「预览版」徽章（官方 hero 本身就有这两个文案，`hero.headline`/`hero.preview`，dsh-one 是对齐官方做的）。用户要求整个标题行去掉。

## 建议方案（想法：未确认）

1. **发送按钮**：hero 与非 hero composer 的发送按钮统一改成官方圆形图标按钮——34×34 圆、`IconSendOutline14`（上面 path，可加入 `src/ui/chat/icons.ts`）、品牌蓝底白图标、hover 变深、disabled 半透明；运行中变停止按钮（现有 `STOP_ICON` 可用）。保留现有 disabled 判定逻辑不变。
2. **hero 品牌区**：鲸鱼位置渲染「官方 FishLogo ×（分隔符）DSH One 像素鲸鱼 logo（`assets/icon.svg` 的像素鲸，原作者：Recraft 生成 + 像素提取，`#2563EB`）」组合，一起用现有 `.hero-fish` 游动动画浮动；分隔符用 x/× 字形或细笔画图标（具体样式未定）。需要确认组合尺寸比例与分隔符号样式，以及 DSH One logo 以 SVG 内联还是 `assets/icon.svg` 引用（webview CSP 限制内联缓存，参考 `api/images` 处理方式）。
3. **去掉标题**：`renderHero` 删除 headline 两行；随 ② 重排 hero-stack 的布局间距（`.hero-stack` gap 等）。

## 涉及代码位置

- `src/ui/chat/webview.ts` — `renderHero`（:2423-2468）、`renderInput` 发送按钮（:4573）
- `src/ui/chatViewHtml.ts` — `.hero-fish`、`.hero-headline*`、`.hero-badge`、`.hero-stack`、`button`/`.send-button`
- `src/ui/chat/icons.ts` — 新增 `SEND_ICON`/`STOP_ICON` 复用检查
- 官方对照：全局 `@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（`.uV2eYG_primary` 样式、`IconSendOutline14`）

## 变更记录

- 2026-09-02 记录 → open（想法：未确认，x 分隔符语义已向用户确认）
