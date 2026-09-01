# 开启未分组对话

记录于 2026-08-31。

> 想法：未确认——具体做法未定，先记录需求。

## 背景与现象

dsh-one 的会话创建以 workspace 为起点：先选工作区，再在某个工作区里开始对话（hero 的 workspace chip 只读也源于此）。希望可以开启一个不挂任何 workspace 的「未分组」对话。

## 现状

- 数据/展示层已有「未分组」分组：`sessionTree.ts` 把不被任何 workspace 引用的会话归入「未分组」组（排在最后），说明会话模型允许无 workspace 归属。
- 缺的是创建入口/链路：当前新建会话都会落到某个 workspace，没有"开启未分组对话"的路径。

## 建议方案（未定，待澄清需求）

具体做法再说：可能的起点是会话创建链路（新建会话时允许不带 workspace），或空态/新建入口加「未分组对话」选项。先澄清需求再定方案。

## 涉及代码位置

- `src/ui/chatView.ts` / `src/pure/chatContract.ts`（会话创建/附着链路）
- `src/pure/sessionTree.ts`（未分组逻辑）

## 需求澄清（2026-09-01 与用户确认）

- 入口：Sessions 面板「未分组」组行加「+ 新建会话」（与普通 workspace 行对称），创建后自动打开。
- 「未分组」组恒显示：无未分组会话时也渲染空组头——组只在有会话时出现会让首次创建不可达。
- cwd：允许完全不挂 workspace 的会话。创建时预分配会话 id，在 `os.tmpdir()`（跨平台等价 /tmp）下建「日期+会话id」命名的临时目录作为 cwd 传给 `session.create`，不注册 workspace。
- 范围：只做创建链路；「未分组会话挂到某 workspace」的归属迁移留给 workspace-picker-blank-session。

## 实现

- `src/pure/sessionTree.ts`：未分组组恒渲染（空组保留），非空 query 下仍被末尾空组过滤丢弃。
- `src/server/dshRpc.ts`：`createSession` 改为 opts 对象（workspaceId / cwd 二选一 + 预分配 sessionId）。数据链路已核实：host 的 `session.create` schema 本就允许两者都可选（dsh-host-apiproxy），cwd 缺失时 host 回退默认目录，`ensureSession` 会 `mkdir(cwd, {recursive: true})`。
- `src/extension.ts`：新命令 `dshOne.session.newUngrouped`（预分配 sessionId → 临时目录 cwd → session.create → 刷新 + 打开）。
- `src/pure/chatContract.ts` / `src/ui/sessionsView.ts`：新 webview 消息 `sessionNewUngrouped`。
- `src/ui/sessionsWebview.ts`：未分组组头加「+ 新建会话」；无真实 workspace 时保留「添加工作区」引导、同时渲染未分组组头。

## 已知取舍

- 未分组会话 cwd 在临时目录：系统清理临时目录会连会话日志一起清掉（会话从列表消失）——用户选定的「临时文件夹」方案的固有属性。
- 每次点「+」都新建 blank 会话（不复用 blank），与右键「发送到当前会话」的兜底行为一致；blank 会话在列表隐藏，不产生视觉堆积。
- 未分组会话 attach 后 hero 显示「未分组」chip（workspaceLabelFor 既有行为），与面板分组一致。

## 变更记录

- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 253 tests + build）→ done
  - 人工验收方法：`cd dsh-one/.worktrees/start-ungrouped-conversation && bash dsh-one/scripts/dev-ui-test.sh`，弹出隔离 VSCode 后：① 侧栏 DSH One 面板出现「未分组」组行（即使没有任何未分组会话）；② hover 未分组组行出现「+」，点击后聊天面板打开一个空会话 hero（hero 显示「未分组」chip）；③ 侧栏未分组组此时仍为空（blank 会话隐藏，发送第一条消息后出现在未分组组下）；④ 发送一条消息，会话出现在未分组组内；⑤ 终端 `ls $TMPDIR/dsh-ungrouped-*` 能看到以日期+会话id 命名的临时目录。
