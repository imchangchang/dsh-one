# 当前工作区在 dsh 里被删除后，重新载入插件会复活成一个空行

记录于 2026-09-01。用户截图实证，机制已在代码里核实（2026-09-01 对运行中的 dsh 实例 + 扩展源码逐链路验证）。修复方向同日拍板：去掉 preseed 的注册行为，见「建议方案」。

## 背景与现象

用户反馈：把当前 VS Code 工作目录对应的 workspace 在 dsh（web GUI）里删除后，重新载入插件会出现问题——会话列表面板里多出一个只有文件夹图标、没有任何会话的分组行，刷新和重载都在，"去不掉"。

## 根因

两条已核实的机制叠加：

1. **删除会复活**。扩展每次激活（`extension.ts:29` `activate` → `manager.ensureStarted()`）无论走 adopt 还是 spawn 分支，都会执行 `preseedWorkspace`（`src/server/manager.ts:203、253、301-311`）：无条件把当前 VS Code 文件夹 `workspace.create` 回 dsh，并 `ensureSession` 补一个 blank 会话。所以在 dsh 侧删掉当前工作区后，插件 reload 必复活——这就是"去不掉"。（dsh 侧的 history bootstrap 只在注册表首次初始化时跑，非当前工作区删了不会复活，已核实 `dsh-workspace/lib/types/index.js:92-95` 的 `!this.state.initialized` 分支。）

2. **复活出来的一定是空组**。复活的 workspace 只挂一个 blank 会话，而 blank 会话在会话树里被隐藏（`src/pure/sessionTree.ts:181` 的 `!s.blank` 过滤）；空组恒按闭合态渲染——只剩一个文件夹图标，不能展开、点击不响应（`src/ui/chat/webview.ts:1530-1535` 的 `empty` 分支）。实测当前 dsh 数据里 "resume" 工作区（唯一会话是 blank）就处于用户截图中空行的位置。

补充的防御缺口：组标签直接用 `w.title`，没有空值兜底（`sessionTree.ts:185`、`webview.ts:1545`）。dsh 侧 title 取 `basename(path)`（`dsh-workspace/lib/types/index.js:251`），正常不会为空，但扩展渲染层对此没有任何保护。

## 相关边缘场景（同一目录从磁盘被删的情况）

如果当前 VS Code 文件夹是从**磁盘**上删掉的（VS Code 仍持有过期路径）：

- `manager.ts:222` 把 `workspaceRoot` 直接用作 spawn 的 cwd（`manager.ts:247`），目录不存在时 posix_spawn ENOENT，dsh 服务起不来；
- adopt 已有实例时不走 spawn，但 `preseedWorkspace` 的 `ensureWorkspace` 会被 dsh 的 `realpath` 拒绝，仅 catch 记日志。

## 建议方案（方向已拍板，2026-09-01）

拍板：**影响方向是 dsh → VS Code 单向**。dsh 可以通过"在 VSCode 中打开文件夹"改变 VS Code 的当前工作区，但 VS Code 的当前工作区是什么不应该反向影响 dsh。具体：

1. **去掉 `preseedWorkspace` 的注册行为**：当前 VS Code 文件夹不在 dsh 工作区列表里就什么都不做，不注册、不建会话——被用户删掉的工作区因此不再复活。dsh 侧只需匹配：当前 VS Code 工作区在 dsh 工作区列表里，就把对应工作区标记为「当前」（`buildSessionTree` 的 `isCurrent` 已经是纯展示匹配，不用动）。
2. 配套影响（已确认有回退，不是阻塞项）：不再预建会话后，当前文件夹不是 dsh 工作区时 `sessionsStore.latestCurrentSessionId()` 返回 null，聊天面板停在空态（`extension.ts:51-57` 的 auto-attach 逻辑天然跳过），用户手动选会话即可。`preseedWorkspace` 里的 `ensureSession` 随注册一起去掉。
3. 展示层兜底（防御，可顺手做）：`buildSessionTree` 的 label 改为 `w.title || basename(w.path) || w.path`，空 title 不至于渲染成无名行。
4. spawn 前检查 `workspaceRoot` 是否仍存在（`fs.stat`），不存在则回退 `os.homedir()` 并记日志，避免目录被删后整个服务起不来（防御，独立于上面的拍板）。

## 涉及代码位置

- `src/extension.ts:29`：激活即 `ensureStarted`。
- `src/server/manager.ts`：adopt 分支 preseed（203 行）、spawn 分支 preseed（253 行）、`preseedWorkspace`（301-311 行）、spawn cwd（222、247 行）。
- `src/pure/sessionTree.ts:181、185`：blank 会话过滤、label 无兜底。
- `src/ui/chat/webview.ts:1530-1571`：空组渲染与"从列表移除"入口（hover 才出现）。
- `src/ui/chatView.ts:1182-1199`：`removeWorkspace` 软移除流程。
- dsh 包（参考）：`dsh-workspace/lib/types/index.js:121-128`（create 要求目录存在）、`:251`（title=basename）、`:92-95`（bootstrap 仅一次）。
