# statusbar「Retry Starting / Start Service」绑定 dshOne.openExternal——label 与行为不符

记录于 2026-09-03。在调研 Remote-SSH 支持时发现：状态栏 tooltip 的「Retry Starting」「Start Service」按钮（src/ui/statusbar.ts:77,83）的 command 指向 `dshOne.openExternal`（src/extension.ts:120-123），而该命令的语义是「启动（如需）+ **打开系统浏览器**」。点击后除了启动/重试服务，还会弹系统浏览器访问 `http://127.0.0.1:<port>`。已核实，未开始修改。

## 背景与现象

- `dshOne.openExternal` 实现：`const status = await manager.ensureStarted(); if (status.url) openExternal(status.url)` —— 不是死链（ensureStarted 确实会执行），但动作是「启动 + 打开浏览器」的组合。
- 按钮 label 是「Retry Starting / Start Service」，用户预期只是重试/启动；实际额外被弹出系统浏览器。error 状态点「重试启动」后浏览器打开失败（127.0.0.1 本地无服务，Remote-SSH 下必失败；本地也可能弹了多余窗口）。
- 与「整块点击 = 打开浏览器（高频）」的设计（statusbar.ts:5-7、extension.ts:118 注释；statusbar.ts:94,107）对比：tooltip 按钮看起来是把整块点击的语义搬了过来，但 label 是启动动作，语义对不上。

## 已核实（现状）

- 非功能性 bug（不会坏启动流程）；是 **label 与行为不符** + Remote-SSH 下表现为报错弹窗。
- 可能是有意复用（「启动成功后直达 dsh web」），statusbar.ts 注释与 extension.ts:118 注释支持这一解读——是否按 bug 修需用户拍板（见「待确认」）。

## 建议方案（待确认后实施）

- 新增 `dshOne.start` 命令（只 `ensureStarted()`，不开浏览器），「Retry Starting / Start Service」改绑它；「Open in Browser」与整块点击保留 `dshOne.openExternal`。
- 若产品意图就是「启动 + 打开」：则不修 command，只在 Remote-SSH 下把打开失败改为提示（否则用户在本地报错弹窗外摸不着头脑）。

## 涉及代码位置

- `src/ui/statusbar.ts:77,83`：两处按钮 command
- `src/extension.ts:120-123`：`dshOne.openExternal` 实现
- `src/server/manager.ts`：`ensureStarted`（被内部调用，无需改动）

## 待确认

- 「启动后自动打开浏览器」是否为有意产品行为；「Retry Starting」场景要不要开浏览器。

## 变更记录

- 2026-09-03 Remote-SSH 调研时发现（statusbar.ts:77,83 与 extension.ts:120-123 核实）→ 记入 open/（未开始修改，定级待确认）。
