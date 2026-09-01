# dsh-one 子代理菜单显示临时名字（dsh web 显示任务描述）

记录于 2026-09-01。已核实 + 已定位根因；修复方案未定，待本条目内确认。

## 背景与现象

dsh web 里委托子代理后，头部「N 个子代理」下拉里的每一行显示的是委托时给的那个任务描述（如「开发 sidebar sessions 树改造」）。dsh-one 的页面同样场景下，这一行显示的却总是「会话 xxxxxxxx」这种临时名字，等不到真正的标题。

## 根因（已核实）

两者取名的**数据源不同**：

- dsh web 的子代理名字走 `subagent.list` RPC（`entry.label`），显示时用 `label ?? entry.id`。`label` 是子代理建立时写进 `subagent/descriptor` 的（`dsh-tool-subagent` 的 `label: args.description`），稳定、即时。
  - 渲染处：`node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`（`CatalogRows`：`const label = entry.label ?? entry.id`）。
  - 数据源：`node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js` 的 `subagentsByParent`，由 `api.subagents.list`（=`subagent.list` RPC）填充。
  - schema：`node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/subagents.schema.js`（`label: z.string().optional()`，continuable 必填）。

- dsh-one 的子代理列表从 `session.list` 基线按 `parentSessionId` 拼血缘树，显示名用的是会话 `title`。
  - `src/pure/sessionTree.ts` 的 `buildSubagentTree`：`title: s.title ?? \`会话 ${s.sessionId.slice(0, 8)}\``。
  - `src/ui/chatView.ts` 的 `composeHeader`：`buildSubagentTree(raw, state.sessionId)`。
  - `src/server/dshRpc.ts` 的 `SessionSummary`：读 `projections.values.title`（`titleOf`）。

而子代理会话的 `title` 是 dsh 标题服务异步生成（`dsh-session-title-llm` / `title-first-prompt-llm`），建立时为空（`childSessionMeta` 不写 title），所以 dsh-one 长期兜底「会话 xxxxxxxx」。值得注意的是 dsh-one 的 sessionsStore/chatView 已有「子代理自动命名」的投影 title 消费逻辑，但依赖的是这条异步、可能不来的 LLM 标题，与 dsh web 的即时 label 是两条不同路径。

## 方案（想法：未确认，待本条目内探索）

目标行为：dsh-one 的子代理菜单与 dsh web 一致，用委托时的任务描述（descriptor label）。

候选方向：
1. dsh-one 新增 `subagent.list` RPC 客户端，按父会话逐个取 catalog，用 `entry.label ?? entry.id` 作为树节点名字，替代现有的 `session.title` 兜底；血缘嵌套结构仍可按 `session.list` 的 `parentSessionId` 或 catalog 的 `hasChildren` 组织。
2. 仅在 `subagent.list` 拿不到 label（one-shot 的可选 label 缺失）时回退到会话 title / id。

需评估点：`subagent.list` 是按父会话一次一个请求，子代理再开子代理的嵌套场景下要按需取多层；dsh-one 目前是一次 `session.list` 基线全量拼树，改成 per-parent 的话要处理刷新/缓存时机（对齐 dsh web 的按展开懒加载 + catalog 缓存）。

## 涉及代码位置

- `src/pure/sessionTree.ts`（`buildSubagentTree`：`title: s.title ?? \`会话 …\``）
- `src/ui/chatView.ts`（`composeHeader`：`buildSubagentTree`）
- `src/pure/chatContract.ts`（`SubagentNode`）
- `src/server/dshRpc.ts`（`SessionSummary` / `titleOf` / `listSessions`）
- 参照（不改动的官方实现）：
  - `node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`（`label = entry.label ?? entry.id`）
  - `node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`（`subagentsByParent` ← `api.subagents.list`）
  - `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/subagents.schema.js`（`subagent.list` 响应 `label`）
  - `node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js`（`label: args.description`）
- 2026-09-01 评审确认：做（用户标注）

## 实现方案（2026-09-01 定案：候选 1，候选 2 自然融合）

**定案**：走候选 1——新增 `subagent.list` RPC 客户端，按父会话取子代理目录，用 `entry.label ?? entry.id` 作为菜单行显示名；血缘嵌套结构仍按 `session.list` 的 `parentSessionId` 拼（`buildSubagentTree` 不改结构，只改显示名）。候选 2 作为回退融入同一取名链（`entry.label ?? entry.id ?? (title ?? id)`），无独立分支。

**RPC 客户端**：`src/server/dshRpc.ts` 新增 `listSubagents(baseUrl, parentSessionId)`，wire 方法 `subagent.list`（已核实的官方 method 名），请求 `{ parentSessionId }`，响应 `{ entries, parentAvailable }`；`SubagentListEntry` 按官方 `subagents.d.ts` loose 镜像（label 对 continuable 必填、one-shot 可选，diagnostic 行不带 label）。

**label 取值链**：`buildSubagentTree(sessions, rootId, labelOf?)` 新增可选 `labelOf(s): string | null`——返回非空字符串（`entry.label ?? entry.id`）则作为行名，返回 null（目录没拉到 / 该子代理不在目录）则回退既有 `title ?? 会话 xxxxxxxx`。`labelOf` 由 `SubagentCatalogStore.labelFor()` 提供：扫已缓存目录找该 session 的 child entry，label 有值用 label，否则 entry.id。

**缓存/刷新策略**：新增 `src/ui/subagentsStore.ts` `SubagentCatalogStore`（仿 JobsStore 生命周期，跟随 manager url）。目录按父会话缓存，靠 `subagentTreeSignature()`（root 子树内每个父会话 + 排好序的子代理 id 集）判定失效——签名不变（如 60s 相对时间 tick）不重拉，签名变化（附着切换 / 新子代理 spawn / 子树重排）重拉该子树全部父目录，不做死缓存。服务 url 变化/停止清空缓存。`subagentCatalogRoots()` 返回需要拉目录的父会话集合（含 rootId 当它有子代理、及每个有子代理子节点且在 root 子树内的节点），叶子不拉。

**刷新时机**：`ChatViewProvider` 的 store.onDidChange 里调 `subagents.ensure(currentSessionId, rawList())`（新子代理 spawn → 基线变化 → 签名变 → 重拉）；`attach()` 里对新 root 也 ensure 一次。目录拉到后 `subagents.onDidChange` 重推 state，composeHeader 用最新 label 重组成下拉行。首次 attach 时 label 可能还没到，先走 title/id 回退，目录到位即更新——不闪错名。

**嵌套取舍**：官方是「按展开懒加载」（展开某分支才拉该分支目录）。dsh-one 的下拉是一次性渲染整棵血缘树，故这里对当前子树的全部父会话**一次性 eager 拉取**（简化实现），不引入展开状态。取舍：子树大时一次多几个 RPC（子代理数通常个位数，可接受），换来所有层级显示名即时、代码无展开状态机。不需要 `hasChildren`/`parentAvailable` 字段（嵌套结构由 session.list 拼，非目录驱动）。

**自动命名不移除**：子代理会话自身 title 照旧经 title 投影生成（sessionsStore 的 session/projection 帧消费链不动）；改的只是菜单行显示名（`SubagentNode.title` 的取值源）。

- 2026-09-01 认领（worktree: agent/subagent-temp-name）→ doing
- 2026-09-01 开发完成：走候选 1 实现（新增 `subagent.list` RPC 客户端 + `SubagentCatalogStore` 按父会话缓存目录，`buildSubagentTree` 经 `labelOf` 用 `entry.label ?? entry.id` 取名，回退既有 title/短 id；子树签名判定目录失效、eager 一次性取深层）。typecheck/test(228)/build 全绿；done 标记见 dev-finish → done
