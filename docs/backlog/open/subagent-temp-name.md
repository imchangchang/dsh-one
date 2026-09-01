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
