# 状态栏 tooltip：adopted / external 实例也显示 dsh 版本

## 背景与现象

statusbar-dsh-version-tooltip（closed）实现后，spawn 实例 tooltip 显示 `dsh v{version}`，但 **adopted（另一窗口 spawn）/ external（token 粘贴连接）实例一律不显示版本行**。用户反馈：外部启动的实例没显示版本（截图：tooltip 只有「复用外部启动的实例，不会被插件停止」，无版本行）。

旧理由：外部实例来自哪个安装无法确认，显示会误导。但实际有两条准确通路被忽略：
- **shared 记录**（`~/.dsh/dsh-owned.json`）在 spawn 时已存 `version`（`dsh --version` 结果）——另一窗口 adopt 时可直接展示；
- **命令行探测**：实例进程命令行含真实入口（`node .../bin/dsh web …` 等），可对该入口执行 `--version`——与扩展 PATH 无关，多安装也不会错。

## 方案（已按讨论拍板）

1. adopted（另一窗口 spawn）：`version = owned.version ?? 探测`——记录优先（准确且零成本），旧记录无 version 时探测。
2. external（token 连接，记录无 version）：pid（记录里有）→ 命令行 → 解析入口 → 执行 `--version`。
3. 无记录的纯探测 adopt（0.1.1 无认证）：`findListenerPid(port)` → 同探测。
4. 探测失败/命令行解析不出入口 → 缺省不显示（不用扩展 PATH 的 `dsh --version` 近似）。
5. 解析与探测实现：`src/pure/dshCommandLine.ts`（纯函数 parse / extractDshVersion，可单测）+ `externalDsh.probeDshVersionFromCommandLine`（spawnSync 执行，env 清理同 locateDsh）。

## 涉及代码位置

- `src/pure/dshCommandLine.ts`（新）、`src/pure/statusTooltip.ts`（注释）
- `src/server/externalDsh.ts`（probeDshVersionFromCommandLine）、`src/server/manager.ts`（4 处 setStatus 接入）、`src/server/locateDsh.ts`（extractVersion 纯层化）

## 变更记录

- 2026-09-05 用户反馈（截图：外部启动实例 tooltip 无版本行）+ 讨论拍板「从实例命令行解析真实入口执行 --version 查询」→ 建条目（open/）
- 2026-09-05 认领（open -> doing）：主线直接开发（worktree statusbar-adopted-version）；实现如上；新增单测 13 项（parse 形态 9 + probe 执行 1 + tooltip 3），全量 567 通过

