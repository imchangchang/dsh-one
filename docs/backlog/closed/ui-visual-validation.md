# AI 视觉验证（chat webview 独立渲染 + mock 后台 + 期望描述核对）

记录于 2026-09-01。UI 类改动的视觉验收目前只能靠人工在 dev-ui-test 窗口做真机验收（headless 代理起不了 GUI），是人工测试量的大头，也是合入前卡得最久的一环。

## 背景与现象

- 插件 UI（`src/ui/chat/webview.ts`）是纯渲染函数：界面状态全部来自宿主推给它的 `ToWebviewMessage`（state / sessions / modelCatalog…）。
- 所以只要 mock 能构造对应消息，**任何 UI 状态都能在纯浏览器里确定性渲染、截图**——不需要 VS Code、不需要真实 dsh、不需要人开窗。
- 此前视觉验收只能人工；改 UI 后要看"这个状态渲染对不对"，没有可自动化的手段。

## 现状 / 方案

做成一套 AI 视觉验证能力（webview 独立渲染 + mock 后台 + 截图 + **期望描述核对**）：

- **每个场景带一份 `expect`**（该状态应呈现的逻辑与排版）。agent 读截图后**对照期望逐条核对**（语义判断），**不是图和图做像素 diff**（后者在不同机器/渲染下脆弱，也不符"理解层审核"定位）。
- **两层模型**：功能验收场景（worktree 开发 session 自写，合入前）＋ 基线冒烟集（`BASELINE_SCENARIOS`，主线预设，合入后冒烟）。
- 已实现：`test/ui/harness.html`（按 `?scenario=` 渲染任意状态）、`test/ui/scenarios.js`（11 个场景 + expect + BASELINE_SCENARIOS）、`test/ui/interactive.html`（可交互 mock host）、`scripts/ui-visual.sh`（起服务 + 逐场景 WebBridge 截图 + 打印期望清单）、`scripts/gen-ui-harness.mjs`（从源码抽 STYLE → style.css）。

## 涉及代码位置

- `test/ui/harness.html`、`test/ui/interactive.html`、`test/ui/scenarios.js`、`test/ui/style.css`
- `scripts/ui-visual.sh`、`scripts/gen-ui-harness.mjs`
- `.agents/skills/ai-visual-validation/SKILL.md`（给 agent 的视觉验证 skill）

## 备注

- **边界**：只验证 webview 内容的渲染与交互。它看不见 VS Code 窗口 chrome（活动栏图标/命令面板/侧边栏宿主/右键菜单），也测不了宿主逻辑（激活/命令注册/服务起复用/真实 dsh）。宿主逻辑走 `@vscode/test-electron` 或真机 dev-ui-test。
- 场景的 `expect` 按当前 UI 撰写，后续 UI 改动需同步更新对应场景与期望。

## 变更记录

- 2026-09-01 认领（worktree: agent/webview-render-test）→ doing
- 2026-09-01 开发完成（自测通过：typecheck/test/build 全绿）→ done
- 2026-09-01 合入 main（89fc712）+ 主线基线冒烟通过（11 场景出图，抽查 conversation/sessions 渲染正确）+ 人工确认 → closed
