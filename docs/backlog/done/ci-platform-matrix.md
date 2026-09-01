# CI 平台矩阵（3 OS + package + spawn 冒烟）

记录于 2026-09-01。

## 背景与现象

dsh-one 的平台差异是真实存在的，但集中在 `src/server/` 的进程管理上；而现有 CI 只跑 `ubuntu-latest` 的 `typecheck + test + build`，恰好绕开了真正有分歧的那段代码，等于「假安心」——单测全绿，但 Windows 的 `.cmd` 分派、mac 的 launchd 收养都没在任何要发布的 OS 上验证过。

## 现状

- `.github/workflows/ci.yml`：单 job `ubuntu-latest`，步骤 `npm ci → typecheck → test → build`，无 Windows/macOS、无打包、无 spawn 冒烟。
- 平台分歧点（`src/server/`）：
  - `locateDsh.ts:42`、`spawnDsh.ts:21`：`npm i -g @deepseek-ai/dsh` 在 Windows 装出来的是 `dsh.cmd` 批处理 shim，`spawn('dsh')` 跑不动，必须 `shell: process.platform === 'win32'` 绕；macOS/POSIX 装的是可直接 spawn 的 POSIX 脚本。
  - `manager.ts:438`（`killOwned`）：Windows `taskkill /pid X /T /F`，POSIX `process.kill(-pid, SIGTERM)` 再升级 SIGKILL，整个一分为二。
  - `spawnDsh.ts` / `manager.ts`：短命启动器让 dsh 被 launchd 收养、脱离扩展宿主进程树，是 macOS/POSIX 概念；Windows 靠 `detached` + `taskkill /T`，机制不同。
- `src/pure/` 与 `src/ui/` 为纯 Node 逻辑 / webview（浏览器环境），平台无关，一次干净环境即可。

## 方案

按 ROI 排序：

1. `ci.yml` 扩成三 OS 矩阵 `[ubuntu-latest, macos-latest, windows-latest]`，步骤加 `npm run package`。每平台验证编译 + 打包，纯逻辑 `npm test` 三平台全跑。
2. 加 spawnDsh 冒烟：CI 里 `npm i -g @deepseek-ai/dsh@next` + `node dist/spawnDsh.js`，验证 Windows `.cmd` 分派与 detached spawn，把第 1 条的差异点补实。
3. 人工 GUI 沙盒验收：mac 本地即可；Windows 若无真机，首次发 Windows 前做一次性人工冒烟（装 vsix → 找 dsh → 复用服务 → webview），或长期验证再上 VM，平时不必养 VM。
4. `@vscode/test-electron` 先不上：能在 CI 拉起真 VS Code 跑集成，但对这个「要 spawn dsh + webview UI」的插件偏重、CI 易 flaky；把 1+2 做实已覆盖自动化绝大部分。

## 涉及代码位置

- `.github/workflows/ci.yml`
- `src/server/locateDsh.ts`、`src/server/spawnDsh.ts`、`src/server/manager.ts`

- 2026-09-01 认领（worktree: agent/ci-platform-matrix）→ doing

- 2026-09-01 开发完成，本地 mac 自测通过（typecheck/test 205/build/package/spawn 冒烟），done 标记 61ba52f
- 2026-09-01 主线合入测试通过（merge 1165c63），无 UI 变化跳过人工窗口验收，待 push 后 CI 三平台验证 → closed
- 2026-09-01 CI 验证发现问题 → open（fix-forward）: 已合入 merge 1165c63（push 3ce7fe1）；ubuntu/macos-latest 全绿；**windows-latest 的 spawn 冒烟失败**——dsh spawn 出 pid 但 3s 内日志文件为空（无版本输出）。疑点：Windows 冷启动 >3s（该 runner 装 454 包都花了 5m），或 .cmd 分派/PDATH 问题。剩余：改 CI 冒烟脚本（等待轮询 + 失败诊断输出）从最新 main 新开 worktree 修复，推 CI 验证。

- 2026-09-01 认领（worktree: agent/ci-windows-spawn-smoke）→ doing
- 2026-09-01 开发完成：ci.yml 冒烟改「轮询等待（~20s）+ 失败诊断（which dsh / npm prefix -g / node -v / PATH / log 大小 / 对照 dsh --version）」，mac 本地演练通过（typecheck/test 208/build 全绿），ci 修复 commit 3cefcd9；done 标记见 dev-finish → done
