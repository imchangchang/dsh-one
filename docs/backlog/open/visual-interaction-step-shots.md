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
