# 状态栏 tooltip 显示 dsh 版本

## 背景与需求

用户（2026-09-05）反馈：左下角状态栏「DSH: Running :3080」悬浮 tooltip 最好显示 dsh 的版本号，方便随时了解当前跑的是哪个 dsh 版本（排查问题/确认升级是否生效）。

## 现状（已核实）

`src/ui/statusbar.ts` `tooltip()`（:48-90）：running 态第一行 `**DSH One** — ${status.url}`，后接命令链接（Open in Browser / Restart / Stop / Show Logs）。无版本信息。`ServerStatus` 类型无 version 字段。

## 方案（方向，实现时细化）

1. 版本获取：扩展 spawn dsh 时执行一次 `dsh --version`（或从启动命令输出解析——spawnDsh/manager 已有 spawn 输出解析能力，取 `--version` 最直接），存到 manager/status（ServerStatus.version）。
   - **adopted（复用外部实例）**：可能来自不同安装，无法确定——选项：a) 不显示版本只显示「外部实例」；b) 用扩展自己 PATH 里的 dsh --version 近似并标注。以实现在哪，倾向 a（不显示或显示「external」，避免误导）。0.1.1/0.1.2 兼容。
2. UI：running 态 tooltip 首行加版本（如 `**DSH One** — http://…` 下一行 `dsh v0.1.2-rc.1`，或 URL 行内拼接）；starting/error/stopped 态可加可不加（error 的 dsh-not-found 已知无版本；其余态显示最近一次已知版本或无）。
3. 语言：中英 l10n（若版本行纯文本 `dsh v{0}` 不需 l10n；文案如需要则补 bundle）。

## 验收

- running 态 tooltip 含版本号；spawn 路径（0.1.1 与 0.1.2 都试）；adopted 路径行为明确（不误导）；harness/单测或沙盒验证（report 注明覆盖方式——tooltip 是宿主 UI，harness 不渲染，验证可能走单测 mock ServerStatus + 人工开窗）。

## 涉及代码位置

- `src/ui/statusbar.ts`（tooltip）
- `src/server/manager.ts` / `spawnDsh.ts`（spawn 时取版本、ServerStatus 扩展）
- `src/ui/chatMessages.ts` 或协议（若 ServerStatus 定义在那）

## 变更记录

- 2026-09-05 用户反馈（升级 0.1.2 后想随时确认版本）→ 核实现状 → 建条目（open/）

- 2026-09-05 认领（open → doing）：按条目方案开发；版本取 locateDsh 已执行的 `dsh --version`（spawnSync），经 pidfile 持久化供 re-own；adopted 不显示版本（外部实例，避免误导）。

- 2026-09-05 开发完成（doing → done）：版本取 locateDsh 已执行的 `dsh --version`，经 ServerStatus.version + pidfile 持久化；running 态 tooltip 标题下加 `dsh v{version}`（adopted 外部实例不显示，保留原 external 说明）。自测 typecheck/test(509)/build 全绿，单测 mock ServerStatus 逐态 9 项；报告 test/sandbox/verify.statusbar-dsh-version-tooltip.report.html（覆盖方式：宿主 tooltip 不随沙盒渲染 → 单测 + 本机人工开窗，验收命令已交付用户）。
