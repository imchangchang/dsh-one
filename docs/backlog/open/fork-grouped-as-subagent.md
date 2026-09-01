# dsh-one 把 fork 出来的会话当成子代理（dsh web 不这样）

记录于 2026-09-01。已核实 + 已定位根因；方案未定，待本条目内确认。

## 背景与现象

`session.fork` 从一个父会话叉出子会话后，dsh-one 会把它和「子代理」混为一谈：

- 看 fork 出来的那个会话，标题栏出现「父会话标题 / 子会话标题」面包屑。
- 看父会话，头部多出一个「N 个子代理」chip，把 fork 出来的会话算进去。

同样的操作在官方 dsh web 里不会这样——fork 出来的会话就是普通独立会话，标题栏不出现父标题，父会话也不会把它当子代理列出。

## 根因（已核实）

服务端 `session.fork` 会在子会话的 header 写一条**血缘** `parentSession`（指向源会话，用于 lineage 追踪 / 继承 workspace），但**不写** `origin: "subagent"`。只有真正的子代理（subagent）spawn 出来时才同时写 `parentSession` 和 `origin: "subagent"`（`dsh-session` 的 `SessionStore.fork` 只设 `parentSession`；`dsh-subagent` 的 spawn 逻辑设 `origin: "subagent"`）。

所以 `parentSessionId` 是所有 fork 都有，`origin` 才是「真子代理 / 普通 fork」的区分字段。

- **dsh web**：判断要不要显示父 / 子面包屑、要不要进 lineage 目录，靠 `origin === "subagent"`；回溯祖先链遇到 `origin !== "subagent"` 就停（`dsh-client-ui-conversation` 的 `deriveAncestry`）。普通 fork 因 `origin` 缺失，直接当普通会话。
- **dsh-one**：面包屑、子代理树、血缘行隐藏三处都只看 `parentSessionId` 有没有值，不看 `origin`，于是把普通 fork 当成子代理。

## 方案（想法：未确认，待本条目内探索）

目标行为：与 dsh web 对齐——把三处判定从「有 `parentSessionId`」收紧成「`origin === "subagent"`」；普通 fork 保持独立会话，不显示父标题、不进「子代理」chip、不在血缘里被隐藏成子行。

改动点（三处判断字段一致收紧）：
1. 头部面包屑（`composeHeader` → `parentSession`）。
2. 头部「N 个子代理」树（`buildSubagentTree`）。
3. session 树的行隐藏 / 运行中后代判定（`buildSessionTree` 的「血缘子行」逻辑）。

需评估：`buildSessionTree` 目前用 `parentSessionId` 把子代理行从列表隐藏、只贡献 `descendantRunning`。若只对 `origin === "subagent"` 隐藏，则普通 fork 会重新出现在列表行里（对齐 dsh web——fork 会话是正常会话，应出现在列表），需要确认这不会引入重复 / 归属问题。

## 涉及代码位置

- `src/ui/chatView.ts`（`composeHeader`：`parentSessionId` 决定面包屑 `parentSession`）
- `src/pure/sessionTree.ts`（`buildSubagentTree` 与 `buildSessionTree` 的血缘子行逻辑，均按 `parentSessionId`）
- `src/pure/chatContract.ts`（`ChatState.parentSession` / `subagents` 的注释）
- `src/ui/sessionsStore.ts`（`toSessionInput` 已透传 `origin`，无需改）
- 参照（不改动的官方实现）：
  - `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（`deriveAncestry`：`if (summary.origin !== "subagent") break`）
  - `node_modules/@deepseek-ai/dsh-session/lib/index.js`（`SessionStore.fork` 只写 `parentSession`）
  - `node_modules/@deepseek-ai/dsh-subagent/lib/index.js`（spawn 设定 `origin: "subagent"`）

## 变更记录

- 2026-09-01 记录问题，核实根因 → open
