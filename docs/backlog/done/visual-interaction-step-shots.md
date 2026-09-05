# 视觉交互场景支持分步截图（interact 阶段化）

## 背景（workspace-groups-submenu-hover 复盘结论）

harness 交互场景的 `interact` 是一段同步 JS 字符串，navigate 后只截一张终态图。「打开主菜单 → hover/点击」被压成一步，中间帧不存在——「顶层菜单消失」类 bug 在单张终态截图里无从对照；即使期望写了「保持存在」，核对也缺少「发生前的状态」证据。

实例：`sessions-workspace-menu-groups` 场景交互是「右键打开主菜单 + 点 Groups…」连续同步执行，截图只见二级菜单，顶层 6 项菜单被移除的 bug 态与一个合法的「新菜单打开」终态在单张图上无法区分。

## 建议方案（待确认做法）

- `scenarios.js` 场景支持 `interactSteps: [{ name, script }]`（替代/兼容现有 `interact` 字符串）：harness 每步执行后推送一个「步骤完成」信号（如 `window.__interactStepDone = name` 或 postMessage）。
- `ui-visual.sh` 对每个步骤各截一张：`<scenario>-<step name>.png`；交互场景默认两步起（打开前 / 打开后），对照即见差异。
- 兼容：无 `interactSteps` 的场景行为不变（单张 `<scenario>.png`）。

## 涉及代码位置

- `test/ui/scenarios.js`（场景格式）
- `test/ui/harness.html`（interactSteps 执行与步骤信号）
- `scripts/ui-visual.sh`（按步骤截图）

## 变更记录

- 2026-09-05 记录（open）：workspace-groups-submenu-hover 复盘提出的缺口之一，本次仅记录不开发。
- 认领（open → doing）：方案确认开工——`interactSteps: [{name, script, settle?}]`，harness 每步执行后置 `window.__interactStepDone = name`，ui-visual.sh 轮询到信号后截 `<scenario>-<step>.png` 并调 `window.__interactStepAdvance()` 放行下一步；兼容：无 interactSteps 场景行为不变。演示场景：`sessions-workspace-menu-groups` 拆成「右键开主菜单 → hover 分组…展开二级」两步。worktree：agent/visual-step-shots。
- 开发完成（doing → done，worktree agent/visual-step-shots HEAD a0af296）：① scenarios.js 支持 `interactSteps: [{name, script, settle?}]`（与 interact 二选一，同时存在时 interactSteps 优先），`sessions-workspace-menu-groups` 拆两步，expect 按每张截图一个子状态重写；② harness.html 步进执行器：每步脚本 + settle（默认 500ms）后置 `window.__interactStepDone = name`，`window.__interactStepAdvance()` 放行下一步；③ ui-visual.sh 对含 interactSteps 的场景逐步：轮询完成信号到位 → 截 `<scenario>-<step>.png` → advance（bash 3.2 兼容：无关联数组；daemon 响应取 `data.value`）；无 interactSteps 场景行为不变（单张）。④ 文档：ai-visual-validation skill 补 interactSteps 用法，scenarios.js/harness.html 头注释同步。自测 typecheck + 537 tests + build 全绿；ui-visual 全量 135 场景回归 + 基线 34 场景（分步场景两张对照图确认：menu 帧仅顶层菜单 6 项、groups 帧二级菜单 + 顶层并存）；报告 test/sandbox/verify.visual-interaction-step-shots.report.html（F-01 分步对照 + R-01 单张兼容 + R-02 全量回归 + R-03 typecheck/test/build，全 pass）。webview 产品代码无改动，沙盒 E2E 不适用。
