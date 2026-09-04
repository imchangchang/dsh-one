# statusbar「Retry Starting / Start Service」绑定 dshOne.openExternal——label 与行为不符

记录于 2026-09-03。在调研 Remote-SSH 支持时发现：状态栏 tooltip 的「Retry Starting」「Start Service」按钮（src/ui/statusbar.ts:77,83）的 command 指向 `dshOne.openExternal`（src/extension.ts:120-123），而该命令的语义是「启动（如需）+ **打开系统浏览器**」。点击后除了启动/重试服务，还会弹系统浏览器访问 `http://127.0.0.1:<port>`。已核实，未开始修改。

## 背景与现象

- `dshOne.openExternal` 实现：`const status = await manager.ensureStarted(); if (status.url) openExternal(status.url)` —— 不是死链（ensureStarted 确实会执行），但动作是「启动 + 打开浏览器」的组合。
- 按钮 label 是「Retry Starting / Start Service」，用户预期只是重试/启动；实际额外被弹出系统浏览器。error 状态点「重试启动」后浏览器打开失败（127.0.0.1 本地无服务，Remote-SSH 下必失败；本地也可能弹了多余窗口）。
- 与「整块点击 = 打开浏览器（高频）」的设计（statusbar.ts:5-7、extension.ts:118 注释；statusbar.ts:94,107）对比：tooltip 按钮看起来是把整块点击的语义搬了过来，但 label 是启动动作，语义对不上。

## 已核实（现状）

- 非功能性 bug（不会坏启动流程）；是 **label 与行为不符** + Remote-SSH 下表现为报错弹窗。
- 可能是有意复用（「启动成功后直达 dsh web」），statusbar.ts 注释与 extension.ts:118 注释支持这一解读——是否按 bug 修需用户拍板（见「待确认」）。

## 建议方案（已拍板，只待实施）

- **方案 A（已确认）**：新增 `dshOne.start` 命令（只 `ensureStarted()`，不开浏览器），「Retry Starting / Start Service」改绑它；「Open in Browser」与整块点击保留 `dshOne.openExternal`。运行中态的「Restart Service」本就走 `dshOne.restart`（不弹浏览器），改后 Retry/Start 与之一致。
- ~~方案 B（保留现状，启动+弹浏览器为有意产品行为）~~：已否决。

## 涉及代码位置

- `src/ui/statusbar.ts:77,83`：两处按钮 command
- `src/extension.ts:120-123`：`dshOne.openExternal` 实现；新命令 `dshOne.start` 就近注册
- `src/server/manager.ts`：`ensureStarted`（被内部调用，无需改动）
- `package.json:41-51`：`contributes.commands` 需新增 `dshOne.start` 条目与 l10n title，否则命令无法绑定

## 待确认

已确认（2026-09-04 用户拍板）：「Retry Starting / Start Service」= 只启动/重试，**不开浏览器**（与我们「没时间讨论，直接启动 dsh」的表述一致）；弹浏览器保留给「Open in Browser」与整块点击。Remote-SSH 下弹浏览器必失败的问题随之在 Retry/Start 上消失，剩余入口归 remote-ssh-support 条目管。

## 变更记录

- 2026-09-03 Remote-SSH 调研时发现（statusbar.ts:77,83 与 extension.ts:120-123 核实）→ 记入 open/（未开始修改，定级待确认）。
- 2026-09-04 方案讨论拍板：走方案 A（新增 `dshOne.start` 只启动不开浏览器，Retry/Start 改绑），方案 B 否决；补充 package.json 命令注册与 remote-ssh-support 条目分工 → 条目更新（仍 open/，未开始开发）。
- 2026-09-04 认领：worktree slug `statusbar-start-command`，按方案 A 实施（新增 `dshOne.start` 只启动/重试不开浏览器，Retry Starting / Start Service 改绑；开发结果见条目完成时追加）。
- 2026-09-04 开发完成（doing → done）：方案 A 落地——新增 `dshOne.start` 命令（`src/extension.ts` 注册，只 `ensureStarted()` 不开浏览器），`src/ui/statusbar.ts:77,83` 的「Retry Starting / Start Service」改绑它；「Open in Browser」与整块点击保留 `dshOne.openExternal`，运行中态「Restart Service」仍走 `dshOne.restart` 不变；`package.json` contributes.commands 新增 `dshOne.start` 条目，`package.nls.json`/`package.nls.zh-cn.json` 补标题（Start Service / 启动服务）。
  自测：typecheck / test（386 pass）/ build 全绿；i18n 合入门禁自检通过；沙盒报告 `test/sandbox/verify.statusbar-start-command.report.html`（F-01 状态栏改绑与不弹浏览器、F-02 命令面板条目 pass；R-01 mock-LLM 回归 pass）；dev-finish 已打 `done/statusbar-start-command` 标记（分支 HEAD bcb94a6）。待主线 dev-merge 合入。
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed
