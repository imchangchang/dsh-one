# mock dsh

一个零依赖的「假 dsh」网关，让 dsh-one 扩展把它当真正的 dsh 后端接管，按
**场景文件**编排出一套确定性的 UI 状态（正常对话、approval/question、todos、
子代理、错误态、流式回复等），用于扩展的自动化测试与宣传截图。

它不需要假的可执行文件：扩展启动时会先 `POST /api/host.describe` 探测
（`src/pure/envelope.ts` 的 `validateDescribeResponse` 只校验回包是 JSON 对象且
`rpcId` 等于请求值）。mock 只要在扩展配置的端口（默认 3080）监听、把这一发探测
验过，扩展就认定「这是 dsh」并直接 adopt——之后所有 RPC 与 WS 都打到本 mock。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.ts` | 核心网关：`node:http` RPC + 手写最小 RFC6455 WS（`/api/events.host`、`/api/events.mux`）。零依赖。 |
| `scenario.ts` | 场景数据模型 + 帧构造 helper + 三个示例场景。 |
| `ws-client.ts` | 测试用原生 WebSocket 客户端（独立于 server.ts 实现）。 |
| `*.test.ts` | `node --test` 单元测试，只连本地 loopback，不依赖 docker/扩展/vscode。 |

运行：

```sh
node --test test/mock-dsh/*.test.ts     # 在仓库根跑（node 24 直接执行 .ts）
node test/mock-dsh/server.ts            # 起一个真实 mock，端口 3080
node test/mock-dsh/server.ts --port 3099
```

## 协议实现清单

### RPC（`POST /api/<method>`）

信封严格按 `src/server/dshRpc.ts` 的 `callRpc`：请求
`{"type":"client-request","rpcId","method","payload"}`，回包 echo rpcId，
`{"rpcId","result":{"ok":true,"value"}}` 或 `{"result":{"ok":false,"error":{...}}}`。

| method | 状态 | 说明 |
| --- | --- | --- |
| `host.describe` | 完整 | 只验收 rpcId 回声（扩展 adopt 的判据），value 是占位对象。 |
| `workspace.list` | 完整 | 返回场景 workspaces + 归档会话 id。 |
| `session.list` | 完整 | 场景会话摘要（含 projections.title 供列表显示标题）。 |
| `workspace.create` / `delete` / `archiveSession` | 完整 | 改状态并推响应的 `host/*` 帧（`workspace-changed`/`workspace-removed`/`workspace-order-changed`/`archived-sessions-changed`）。 |
| `session.create` / `fork` | 完整 | 建空白会话，推 `host/session-added`（fork 带 parentSessionId）。 |
| `session.rename` | 完整 | 改 title 投影，返回 `{title, seq}`。 |
| `session.history` | 完整 | 返回场景 `history`（尾页）+ `projections` 基线；支持 `beforeSeq` 翻页。 |
| `session.prompt` | 完整 | 编排入口：按场景 `onPrompt`（否则默认流）向 mux 推一序列 `session/event` 帧。 |
| `session.cancel` | 完整 | 清该会话未完成的帧定时器。 |
| `session.updateQueue` | 最小 | 只回 `{ok:true}`，不维护持久队列（mock 没有真实 inbox）。 |
| `session.models` | 完整 | 返回场景 `models` 或通用目录。 |
| `session.selectModel` | 完整 | 更新所选模型，返回 `{selected}`。 |
| `session.search` | 最小 | 返回空结果（mock 无索引）。 |
| `session.attachment` | 最小 | 返回 `{attachment:{mediaType:'image/png'}, data:''}`（不存真实附件字节）。 |
| `session.export` | 完整 | `GET /api/session.export?sessionId=...&includeDescendants=true` 返回任意字节（扩展原样存文件）。 |
| `agentPreset.list` | 完整 | 场景 `presets` 花名册（默认 preset 名）。 |
| `subagent.list` | 最小 | 返回空目录（mock 不 spawn 子代理）。 |
| `messageFeedback/list` / `put` / `delete` | 最小 | 空反馈；put/delete 返回内层 `{ok:true,value:{}}`（对齐 `unwrapRemote`）。 |
| `fileReferences/list` | 最小 | 返回 `[]`（无 `@` 文件候选）。 |
| `commands/execute` | 简化 | 一律当已识别命令返回 `{commandId,result:{kind:'success',text}}`；不真正执行命令。 |
| `goals/pause` / `resume` / `edit` / `clear` | 完整 | 改 goal 投影并推 `session/projection`，返回匹配的 `GoalStateLike`/`GoalRef`。 |

`/api/respond`：只接受曾在 `approval/requested` 或 `question/requested` 帧里下发过的
rpcId（`pendingRpcIds` 去重登记），返回 `{"accepted":true}`；未知/已答的 rpcId 返回
`{"accepted":false,"reason":"not-pending"}`——保证应答的 rpcId 与请求对上。

### WebSocket

- `/api/events.mux`：最重要的流。扩展侧 `ChatSessionController` 用它 fold 出
  `ChatState`（`src/server/chatSession.ts`）。mock 下推帧
  `{"type":"server-request",["rpcId"],"method","payload"}`，method 覆盖
  `session/subscribed`、`session/event`、`session/projection`、`session/queue`、
  `session/jobs`、`approval/requested`、`approval/resolved`、`question/requested`、
  `question/resolved`、`stream/error`。每帧 payload 都带 `sessionId`；`session/event`
  的 seq 保证单调递增（场景给了显式 seq 则沿用，否则自动补）。
- `/api/events.host`：下推帧 `{"method":"host/*","payload":{...}}`，method 与字段
  严格按 `src/pure/hostFrames.ts` 的 `parseHostFrame` 窄化规则（字段不齐会变 null
  被忽略）。mock 在状态变更（建会话/workspace、归档等）时推送。

### 手写 WS 的简化边界

- 只处理单帧、`FIN=1`、无分片（扩展客户端只发/收小帧，测试也如此）。
- 客户端→服务端按 RFC 必须掩码，服务端→客户端不掩码。
- 控制帧（close/ping/pong）要求 payload ≤ 125 字节（RFC 硬性要求）。
- 对收到的文本帧原样回显（方便「文本帧收发」测试）；真实 dsh 不会这么做，扩展
  客户端也从不向 mux/host 发文本帧，所以不影响接管。

## 场景怎么加

场景都是 `test/mock-dsh/scenario.ts` 里的数据结构，最省事是往 `defaultScenario()` 里
加一个 `ScopedSession`，或自己拼好 `MockScenario` 传给 `createMockServer(scenario)`。

一个 `ScopedSession` 最小构成：

```ts
{
  sessionId: 'scn-xxx',
  summary: { sessionId, updatedAt, running, blank, cwd },   // session.list 行
  history: [/* HistoryEntryLike[]：session.history 尾页，折叠成消息流 */],
  projections: { asOfSeq, values: { title, sessionStats, todos } },  // 基线
  models: { current, routable, groups },                     // session.models
  onPrompt: [/* MuxFrameSpec[]：session.prompt 后的编排时间线 */],
  pendingRequests: [/* PendingRequestSpec[]：未应答的服务器请求（approval/question）走这 */],
}
```

用 `scenario.ts` 导出的 helper 少打字：`ev(type, seq, data, time)`、
`sessionEvent(event, view?, delayMs?)`、`projection(seq, key, value)`、`queue(items)`、
`jobs(list)`。三个现成场景可直接用：

- `completeConversationScenario()`：一条已完成的天单（用户消息 + 思考 + 文本 + 工具卡）
  的 `history` + `projections`，再 prompt 走 `conversationContinueTimeline()` 演示流式续写。
- `approvalScenario()`：半截 turn（工具卡 running）+ `pendingRequests` 声明未应答
  `approval/requested`，打开该会话即见待批准态（应答前一直存在）。
- `emptyScenario()`：blank 会话 + 空历史 + preset 花名册（空会话 hero 选择 chip 可见）。

想让 mock 被扩展「看到」更多会话，把多个 `ScopedSession` 一起放进 `sessions`，
并把它们的 `sessionId` 挂到某个 workspace 的 `sessionIds`。

## 怎么对接扩展

1. 先让 mock 占住扩展配置的端口（`dshOne.port`，默认 **3080**）
   `node test/mock-dsh/server.ts`。
2. 启动 VS Code（加载本扩展）。扩展 `ServerManager` 先探测 3080：
   `POST /api/host.describe`，rpcId 回声通过即认定「这是 dsh」，**adopt** 而不是 spawn。
3. 之后扩展的 `session.list` / `workspace.list` / `session.history` 等 RPC 与本 mock
   交互，`events.mux` / `events.host` 两个 WS 订阅事件流——所有 UI 状态都由场景编排
   决定。

后续（本任务范围外）要给 Dockerfile 加 `--build-arg SCENARIO=xxx` 的画面：让容器
内直接 `node /app/test/mock-dsh/server.ts --port 3080`，`--build-arg` 指定场景文件，
`server.ts` 里按需 `--scenario <path>` 动态 `import()` 那个 .ts 并 `createMockServer()`。

## 验证边界

**单元测试已覆盖**（`node --test test/mock-dsh/*.test.ts`，13 条）：

- WS 握手：`101` + `Sec-WebSocket-Accept` 正确；
- WS 文本帧收发（含 >125 字节的 16 位长度前缀）、`ping`→`pong`；
- WS 非 `/api/events.*` 路径被拒绝（不升级）；
- `host.describe` 的 rpcId 回声（用扩展的 `validateDescribeResponse` 判定）；
- `session.list` 信封往返（`rpcId` echo + `result.value.items`）；
- `/api/respond`：已下发 approval 的 rpcId 返回 `accepted:true`，未知返回 `false`；
- 编排：`session.prompt` 后 mux 收到 `session/event`，首帧 `seq=1` 且后续单调递增；
- `events.host` 的 `workspace.create` 帧经 `parseHostFrame` 解析非 null（证明帧格式
  与扩展解析器兼容）；
- 场景数据用真实 `ConversationFolder` 折叠成预期消息（完整对话 / 半截 turn / 空会话）。

**未覆盖 / 不再本任务范围**：

- 「扩展真实接管」需要真 VS Code 窗口（Extension Host 跑 `ServerManager` + 多个
  `ChatSessionController`），本 mock 单元测试不涉及；这是下一步对上一步的真实对拍。
- mux 的「重连 gap 检查 / re-baseline」「`session/jobs` 后台任务卡」「`question` 多问
  回答」「子代理血缘树」等只在场景里做了数据铺垫，未逐条断言——它们依赖扩展宿主
  的折叠状态机，单测层面只能验证帧格式兼容。
- mock 不会真跑模型/工具/子代理，`commands/execute` 只受理不执行，`session.search`
  恒为空——它们只是「让 UI 不抛错」的最小响应。

## 已知边界

- `onPrompt` 在 mock 里是一次性的：场景给了显式 seq 的编排只会在首个 prompt 播放；
  之后的 prompt 走默认流（保证 seq 始终单调）。这符合「一次 prompt 出一张确定性截图」。
- `pendingRequests`（approval/question 待批准）是**会话状态**而非一次性事件：任何 mux
  连接进来都会随订阅基线一起下发、rpcId 稳定不变、`/api/respond` 应答后移除并广播
  `*-resolved` 帧——对齐真实 dsh 的行为（pending 是状态不是事件，不做任何时序猜测，
  扩展的消费者按 `payload.sessionId` 过滤帧，只有对应会话的 chatSession 折叠进面板）。
- 手写 WS 不支持分片/超大帧/部分控制帧的完整语义（见「简化边界」）。
