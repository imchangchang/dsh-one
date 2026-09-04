# Windows 上派生子任务/后台任务可能弹出终端窗口

记录于 2026-09-04，用户观察：Windows 上给模型派生子任务（subagent）、跑后台任务（background jobs）时，有可能会闪现/显示一个终端（cmd/bash）窗口。

**状态：等待上游**（`@deepseek-ai/dsh-subprocess-local` 修复）。本仓库侧无干净绕过路径，已关闭归档；上游修复发布后按下方「验证步骤」重验，如需跟进可据此重开条目。

## 调研结论（已核实本机 @deepseek-ai/dsh 0.1.1-rc.2 + 嵌套 node_modules 源码）

**根因不在 dsh-one，在 dsh 包的 `@deepseek-ai/dsh-subprocess-local`**：

1. **dsh-one 侧启动链没有问题**。`spawnDsh.ts` 的 4 处 spawn（win32 node 直跑、cmd /c 回退、DSH_FORCE_PIPE、POSIX）和 `manager.ts` 的 `spawnViaLauncher` 全部带了 `windowsHide: true`，dsh 服务器进程被以无控制台方式拉起——这是对的。
2. **dsh 服务器内执行 bash 命令的前台/后台都走同一条链**：`dsh-bash-local`（`run`/`start`，lib/index.js:236、273）→ `ctx.subprocess.spawn` → `dsh-subprocess-local` 的 `spawnSubprocess()`（lib/index.js:797-806）：
   ```js
   const child = spawn(program, args, {
     cwd: spec.cwd,
     env,
     stdio: [...],
     detached: platform !== "win32"   // Windows 上 detached: false
   });
   ```
   这里**没有 `windowsHide: true`**（Node 默认 false），Windows 上也不是 detached。`dsh-pwsh-local`、`dsh-tool-fs-search`（ripgrep）同样经 `ctx.subprocess` 落到这里。
3. **机制**：父进程（dsh 服务器）无控制台时，Windows 上 spawn 控制台子系统程序（bash.exe / pwsh.exe / cmd.exe）若不带 CREATE_NO_WINDOW / DETACHED_PROCESS，系统会给子进程分配并显示一个新的控制台窗口。父进程无控制台正是 dsh-one 的正确启动方式造成的，所以问题只出现在经扩展启动的场景；用户在终端手动 `dsh web` 启动时子进程继承终端控制台，不弹窗——这解释了「有可能会显示」。上游讨论 #810 / #1564 同向：无控制台宿主每次 spawn 子进程都会新建控制台。
4. **附带点**：同文件 `taskkillProcessTree`（104-110）/`taskkillTree`（744-750）的 `spawnSync("taskkill", ...)` 也没带 `windowsHide`——taskkill 本身是控制台程序，杀树时会再闪一次窗口。
5. **受限令牌路径例外**：`dsh-sandbox-windows-acl` 的 CreateProcessAsUserW 注释明确 CREATE_NO_WINDOW/CREATE_NEW_CONSOLE 在 WRITE_RESTRICTED 令牌下导致 STATUS_DLL_INIT_FAILED（0xC0000142），所以该路径**故意不加**、子进程共享宿主控制台。ACL 沙箱启用时此条无法用同样方式修，属已知限制。

## 建议方案

1. **首选（上游修复）**：`@deepseek-ai/dsh-subprocess-local`（deepseek-harness `packages/subprocess/subprocess-local`）的 `spawnSubprocess()` 给 spawn 加 `windowsHide: process.platform === 'win32'`（同时给两处 taskkill `spawnSync` 加 `windowsHide: true`）。上游已有同向修复讨论：整合 #1344 + #1102 的「Windows 弹窗修复补丁」，见 [Discussion #1564](https://github.com/deepseek-ai/deepseek-harness/discussions/1564)。
2. **dsh-one 侧**：无干净的绕过路径（dsh 是外部进程，且其 spawn 行为不受扩展控制，全局 npm 包也不该 patch）。跟踪 dsh 新版本，升级后在 Windows 上验证：经扩展启动 → 派生子任务/后台任务不再弹窗；同时验证 taskkill 杀树不闪窗。

## 验证步骤（上游修复发布后执行）

前提：Windows 真机，**经 VS Code 扩展启动** dsh（终端手动 `dsh web` 启动时子进程继承终端控制台、本就不弹窗，不能作为对照/验证手段）。

1. 升级 `@deepseek-ai/dsh` 到含修复的版本（修点为 `dsh-subprocess-local` 的 `spawnSubprocess()` 加 `windowsHide`，及两处 taskkill `spawnSync`）。
2. 经扩展启动后，给模型派发一个 subagent（子任务），观察是否闪现 cmd/bash/pwsh 窗口。
3. 跑一个后台任务（background job），观察是否弹窗。
4. 触发杀树（taskkill 路径，如终止子任务/杀进程树），观察是否闪窗。
5. 附带：ACL 沙箱（`dsh-sandbox-windows-acl`）启用时 CREATE_NO_WINDOW 在受限令牌下会导致 STATUS_DLL_INIT_FAILED，属已知限制，不纳入上述验证范围。

## 涉及代码位置（将来验证/修复时）

- 上游（不在本仓库）：`packages/subprocess/subprocess-local` 的 `lib/types/spawn.ts`（spawnSubprocess 的 spawn 选项、taskkillProcessTree）、`lib/types/windows-inspector.ts`（taskkillTree）。
- 对照（无需改）：`src/server/spawnDsh.ts` 全部 spawn、`src/server/manager.ts` `spawnViaLauncher`——已正确。

## 变更记录

- 2026-09-04 用户报告 → 核实 dsh 0.1.1-rc.2 + 嵌套 node_modules 源码，定位根因在 dsh-subprocess-local 缺 windowsHide，dsh-one 侧启动链正确 → 记入 open/（未开始修改）。
- 2026-09-04 方案讨论确认：本仓库侧无干净修复路径、也不该 patch 全局 npm 包 → 关闭归档（open → closed），正文标注「等待上游」并记录验证步骤；上游修复发布后按验证步骤重验，需要时据此重开。
