---
name: session-fork-parallel
description: 主 session 通过网关 HTTP RPC（curl 直接调 /api/*，与 dsh-one 插件 dshRpc.ts 同一套协议）生成多个独立顶层 session 并行开发：每个任务一个 session，任务说明作为第一个 prompt 发出后主 session 撒手不管，人直接在 GUI 会话列表里点开每个 session 继续交互（审批、提问都弹给用户，不经主 session 转达）。当用户要并行开发多个任务、要求"每个 session 独立、人直接与每个 session 对话"、不想用子代理（子代理藏在主 session 内，人无法直接参与）时使用。
---

# 独立 session 并行开发（RPC 生成，人直接交互）

## 解决的问题

子代理（`subagent` / `workflow`）的对话都在主 session 内部：人看不到也插不进话，结果靠主 session 转达。当并行开发的每个任务需要**人直接与那个 session 对话**（追问、改需求、中途接手）时，要用真正的顶层 session——它会出现在 GUI 会话列表里，人可以随时点开。

dsh 网关暴露 HTTP RPC（`POST /api/<method>`），与 dsh-one 插件 `src/server/dshRpc.ts` 用的是同一套协议。用 curl 就能生成、驱动、读取独立 session。

## 前置条件

- 网关可达。当前实例是 `http://127.0.0.1:3080`；端口不固定，先探测：

```bash
curl -s -m 5 -X POST http://127.0.0.1:3080/api/host.describe \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"probe-1","method":"host.describe","payload":{}}'
```

返回 `"result":{"ok":true,...}`（rpcId 必须回显）即通。

## RPC 信封

```json
{"type":"client-request","rpcId":"<任意唯一串>","method":"<method>","payload":{...}}
```

响应：`{"type":"server-response","rpcId":"<同串>","result":{"ok":true,"value":...}}`，失败时 `"result":{"ok":false,"error":{"code","message"}}`。

## 常用方法

| method | payload | 说明 |
|---|---|---|
| `workspace.list` | `{}` | 拿 workspace 列表，按 `path` 匹配目标仓库，取 `workspaceId` |
| `session.create` | `{workspaceId}` | 建空白顶层 session，返回 `sessionId` |
| `session.fork` | `{sessionId, atSeq?}` | 带历史 fork 出子 session（继承到 `atSeq`，省略=尾部）。**需要源 session 至少有一个完成的 turn（`turn/end`），否则服务端拒绝**；一般并行开发用 create + 任务 prompt 更干净 |
| `session.rename` | `{sessionId, title}` | 起标题，GUI 列表里好认；空标题服务端拒绝 |
| `session.prompt` | `{sessionId, mode:"queue"\|"steer", content:[{type:"text",text:"..."}]}` | 发一条消息；`content` 是块数组，文本块 `{type:"text",text}`，图片块 `{type:"image",mediaType,data}` |
| `session.history` | `{sessionId, beforeSeq?}` | 读事件流（`events[]`，每项 `{event:{seq,type,data}}`）；不带 `beforeSeq` 读尾部。看 `turn/end` 判断回合完成 |
| `session.cancel` | `{sessionId}` | 停当前 turn |
| `workspace.archiveSession` | `{sessionId}` | 归档，从 GUI 列表隐藏（可逆） |

## 流程

1. 探测网关 → `workspace.list` 拿目标仓库的 `workspaceId`。
2. 每个任务一个 session：
   - `session.create` 建 session
   - `session.rename` 起标题（任务名，用户能在 GUI 里认出）
   - `session.prompt` 把任务说明作为第一个 prompt 发过去（任务要写完整：目标、约束、仓库约定如 AGENTS.md、验收标准——这是这个 session 唯一能拿到的"交接文档"）
3. 把 session 清单（标题 + 短 id）交给用户：这些是顶层 session，GUI 会话列表可见，直接点开交互，不再经主 session 转达。
4. 可选：`session.history` 轮询确认 turn 已开始跑（出现 `turn/start`）即可撒手。**不要长期轮询等结果**——agent 没有完成回调，后续跟进是人在 GUI 里的事；如果主 session 需要统一收结果、编排、汇总，那是子代理/workflow 的场景，不是本 skill。

## 注意

- 新 session 继承网关默认配置（当前实例：kimi preset、`workspace-write` 沙箱、`ask` 审批策略）。审批/提问帧会在 GUI 弹给用户，由人应答——这正是本方案的目的。
- session 挂哪个 workspace 就干哪个 workspace 的活（cwd = workspace 路径）。
- 并行改同一仓库的代码仍要按 AGENTS.md 走 worktree（`worktree-dev-flow`），RPC 只管会话，不隔离代码，多个 session 直接改同一目录会互相踩。
- 测试/一次性 session 用完归档，别堆列表。
- 网关探测/调用的完整 TS 封装见 `src/server/dshRpc.ts`（`createSession` / `forkSession` / `renameSession` / `promptSession` / `sessionHistory`），curl 示例和它行为一致。
