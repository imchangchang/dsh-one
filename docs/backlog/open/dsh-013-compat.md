# dsh 0.1.3 适配：assistant 流改 opt-in 侧信道 + commands/execute 参数改名

## 背景（2026-09-06 调研，对照 dsh-v0.1.2-rc.1 → dsh-v0.1.3-alpha.1 源码逐文件核实）

上游 2026-09-04 发布 v0.1.3-alpha.1（GitHub tag，**npm 尚未发布**，latest/next 仍是 0.1.2-rc.1）。Session 存储格式升级 v2，wire 有两处硬破坏。当前 dsh-one（验证基线 0.1.2-rc.1）直连 0.1.3 会有两处功能失效；其余面（认证/启动/unary/WS/各流）经源码 diff 确认兼容。0.1.3-alpha.1 官方自述有已知性能回退（历史 session 加载），等 rc 再适配即可。

## 破坏点 1：assistant 实时增量不再走 durable 事件流（流式渲染失效）

- 0.1.3 把 `assistant/chunk` 从持久化事件里移除，按 attempt 聚合成 `assistant/message.data.stream`（已完成的尝试）或新事件 `assistant/attempt`（被中断的尝试）。
- `session/follow` 的实时 chunk 改为**显式 opt-in**：请求加 `assistantStream: true`（上游 `packages/api/session-controller/src/types.ts:438`），之后 snapshot 帧多 `assistantStream` baseline（revision + activeAttempt），后续交织 `{type:'assistant-stream', frame}`（start/chunk/end，end 带 committed/abandoned outcome）。
- **不传该参数的旧客户端能跑，但 assistant 文本在每个 attempt 落盘前完全不出现**——表现为「转圈很久 → 整段回答突然蹦出来」。turn/step/tool 事件不受影响。
- 附带：`chunkrow/*` 打包记录整体删除（`SessionHistoryRecord` 只剩 `SessionEventEntry`），`src/pure/chunkRows.ts` 的展开逻辑对 0.1.3 成为死代码；snapshot header 的 `seedLength` 改为 `isSeeded: boolean`（dsh-one 未读该字段，无感）；`assistant/message` 的 data 新增必需成员 `stream`。

适配点：`src/server/modernStreams.ts:362`（follow 请求加 `assistantStream: true`）、`parseFollowStreamFrame`（接 snapshot.assistantStream baseline + assistant-stream 帧，revision 断档需 rebaseline，参考上游 `client/sessions/assistant-stream.ts` 的 fold）、渲染侧改为消费新帧或展开 `data.stream` 紧凑行（行词汇 text-chunks/reasoning-chunks/tool-call-chunks 沿用，但行内无 seq）。

## 破坏点 2：commands/execute 第三参数改名（斜杠命令全被拒）

- 旧 `execute(agent, line, images: EncodedImageAttachment[])` → 新 `execute(agent, line, submittedAttachments: CommandSubmitAttachment[])`，图片元素须加 `type:'image'`（上游 `commands/src/index.ts:356`、`commands/src/types.ts:14`）。
- gateway `assertExactArguments` 拒绝多余 args 键（两版相同），照发 `images` 键（即使空数组）会被 `gateway/arguments-invalid` 拒掉——**dsh-one 所有斜杠命令（含 /compact）在 0.1.3 上全部失败**。

适配点：`src/server/dshRpc.ts:425`（args 键 `images` → `submittedAttachments`，元素加 `type:'image'`）。

## 行为变化（非 schema，无需改代码，留意即可）

- `session/list`：0.1.3 删掉冷 session ≤1KB 全量 projection 探测，改纯 cache + predecessor-title 兜底；冷行 projections 可能缺、`asOfSeq` 可能为新哨兵值 -1。dsh-one 全部 `?.` 读取，无害。
- session lock 新增（`$DSH_HOME/sessions/<id>/session.lock`，flock）：两个 0.1.3 进程同时写同一 session，后者抛 `SessionAlreadyOwnedError`。扩展本就有单实例防护（owned record + 探测复用），无新风险。
- session format v2 自动迁移（不可变相邻 generation）。dsh-one 不直接读 session 日志，无感；**迁移后回滚 0.1.2 是否可读未验证**。

## 已核实兼容的面（无需动作）

- 启动/认证：`dsh web --host/--port/--no-open`、就绪行 `?token=`、GET /?token= 换 cookie、无凭证 401+`unauthorized` 指纹、WS `/api/remote.mux`、`dsh --version` 输出——全部未变。
- unary：session/list|create|rename|fork|cancel|search|attachment|updateQueue|selectModel|prompt|modelCatalog、workspace/*、subagents/list、agentPresets/*、commands/list、goals/*、messageFeedback/*、fileReferences/list——全部兼容（prompt 新增 `{type:'file',receiptId}` content 变体，纯增量）。
- 流：session/control、session/page（方法/游标不变，仅 records 不再有 chunks）、workspace/follow、$events waterfall 与 $events/result——全部未变。
- 测试隔离手段：起 0.1.3 实测时用 `DSH_HOME=/tmp/xxx dsh web ...` 隔离数据目录（bootstrap-only env，不能写 .env）。

## 建议方案

等 0.1.3 上 npm（或转 rc）后认领：按上面两个适配点改 + 沙盒容器内升级 dsh 验证（沿用 chat-stage4 的容器内升级配方）。前置：无。

## 变更记录

- 2026-09-06 用户要求调研最新 release 兼容性：源码 diff 核实（三个并行子代理分查 unary/流式/启动认证），建条目（open/）
