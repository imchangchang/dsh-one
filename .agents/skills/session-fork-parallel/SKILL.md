---
name: session-fork-parallel
description: 主 session 通过网关 HTTP RPC（curl 直接调 /api/*，与 dsh-one 插件 dshRpc.ts 同一套协议）生成多个独立顶层 session 并行开发：每个任务一个 session，任务说明作为第一个 prompt 发出后主 session 撒手不管，人直接在 GUI 会话列表里点开每个 session 继续交互（审批、提问都弹给用户，不经主 session 转达）。当用户要并行开发多个任务、要求"每个 session 独立、人直接与每个 session 对话"、不想用子代理（子代理藏在主 session 内，人无法直接参与）时使用。
---

# 独立 session 并行开发（RPC 生成，人直接交互）

## 解决的问题

子代理（`subagent` / `workflow`）的对话都在主 session 内部：人看不到也插不进话，结果靠主 session 转达。当并行开发的每个任务需要**人直接与那个 session 对话**（追问、改需求、中途接手）时，要用真正的顶层 session——它会出现在 GUI 会话列表里，人可以随时点开。

dsh 网关暴露 HTTP RPC（`POST /api/<method>`），与 dsh-one 插件 `src/server/dshRpc.ts` 用的是同一套协议。用 curl 就能生成、驱动、读取独立 session。

## 两个 dsh 版本的 wire 差异（先判版本再写请求）

| | dsh 0.1.1（legacy） | dsh 0.1.2+（modern，如 0.1.2-rc.1） |
|---|---|---|
| 认证 | 无，直连 | browser-session auth：**必须换票**，见「前置条件」 |
| `method` | dot 名：`session.create` | namespace/path：`session/create` |
| `payload` | 直接 `{...}` | 包一层：`{"args":{"request":{...}}}`（`session/list` 等无参方法用 `{"args":{"_request":{}}}`；`session.prompt` 还要 mint `requestId`，见方法表） |
| 探测方法 | `host.describe` | **`host.describe` 已不存在**（返回 not found）；用 `session/list` 探测 |
| 版本判定 | 无 | `~/.dsh/dsh-owned.json` 的 `version` 字段（0.1.2+）；拿不到就两个形态都试 |

dsh-one 的完整映射表与 TS 封装在 `src/server/dshRpc.ts` 的 `MODERN_WIRE`，以它为准。

## 前置条件

### 1. 确定实例地址（端口不固定）

```bash
cat ~/.dsh/dsh-owned.json
# {"pid":33411,"port":3080,"token":"...","version":"0.1.2-rc.1",...}
```

端口 = `port`；**0.1.2+ 的 launch token 也在里面**（每次进程启动 mint，只此一份）。

### 2. 0.1.2+ 换认证 cookie（0.1.1 跳过）

token 只能换一次票，**不能用 token 直接调 API**：

```bash
TOKEN="<dsh-owned.json 里的 token>"
curl -s -m 5 -D /tmp/dsh-cookie-headers.txt -o /dev/null "http://127.0.0.1:3080/?token=${TOKEN}"
COOKIE=$(grep -i "set-cookie" /tmp/dsh-cookie-headers.txt | sed 's/^[Ss]et-[Cc]ookie: //' | sed 's/;.*//')
```

之后的每个 RPC 都带 `-H "cookie: $COOKIE"`。

### 3. 探测（验证认证 + 拿方法口径）

```bash
curl -s -m 5 -X POST http://127.0.0.1:3080/api/session/list \
  -H 'content-type: application/json' -H "cookie: $COOKIE" \
  -d '{"type":"client-request","rpcId":"probe-1","method":"session/list","payload":{"args":{"_request":{}}}}'
```

返回 `"result":{"ok":true,...}`（rpcId 必须回显）即通。未经认证时返回纯文本 `unauthorized`。

## RPC 信封

```json
{"type":"client-request","rpcId":"<任意唯一串>","method":"<方法>","payload":<形态>}
```

响应：`{"type":"server-response","rpcId":"<同串>","result":{"ok":true,"value":...}}`，失败时 `"result":{"ok":false,"error":{"code","message"}}`。

## 常用方法（modern 形态；legacy 去掉 args 包装、method 用 dot 名）

| method | modern payload（`args` 内） | 说明 |
|---|---|---|
| `session/list` | `{"_request":{}}` | 会话列表（items[]）；行里 `cwd`、`running`、`projections.values.title` 可用。**也用它确认 turn 在跑**（running + updatedAt 变化） |
| `session/create` | `{"request":{"workspaceId":"..."}}` | 建空白顶层 session，返回 `sessionId`。**必须用 `workspaceId`，不要用 `cwd`**（见「注意」第一个） |
| `session/rename` | `{"request":{"sessionId","title"}}` | 起标题，GUI 列表里好认；空标题服务端拒绝 |
| `session/prompt` | `{"request":{"requestId":"<uuid>","sessionId","mode":"queue"\|"steer","content":[{"type":"text","text":"..."}]}}` | 发消息；`requestId` 必须客户端 mint（crypto.randomUUID()），落进用户消息头；`content` 是块数组，文本块 `{type:"text",text}`，图片块 `{type:"image",mediaType,data}` |
| `session/fork` | `{"request":{"sessionId","atSeq?"}}` | 带历史 fork 出子 session（继承到 `atSeq`，省略=尾部）。**需要源 session 至少有一个完成的 turn（`turn/end`），否则服务端拒绝**；一般并行开发用 create + 任务 prompt 更干净 |
| `session/cancel` | `{"request":{"sessionId"}}` | 停当前 turn |
| `workspace/create` | `{"request":{"path":"/abs/path"}}` | **幂等注册 workspace**，返回 workspace（含 `workspaceId`、`sessionIds`）。既是拿 workspaceId 的手段，也是验证 session 归属的手段（见流程） |
| `workspace/archiveSession` | `{"request":{"sessionId"}}` | 归档，从 GUI 列表隐藏（可逆；测试/一次性 session 用完归档） |
| `session/history` | 未在 modern wire 实测 | legacy 用 `session.history`（`{sessionId}`，看 `turn/end` 判断回合完成）；modern 下读事件流参考 `src/server/dshRpc.ts`（`historyWindowRequest` / `$events/result` 通道），不确定就靠 `session/list` 的 running/updatedAt 判断 |

## 流程

1. 判版本 + 探测：读 `~/.dsh/dsh-owned.json` → 0.1.2+ 换 cookie → `session/list` 探测。
2. 拿目标仓库的 `workspaceId`：`workspace/create` 幂等注册（`{"request":{"path":"<仓库绝对路径>"}}`），从返回的 `workspace.workspaceId` 取。
3. 每个任务一个 session：
   - `session/create` 建 session（**带 `workspaceId`**）
   - `session/rename` 起标题（任务名，用户能在 GUI 里认出）
   - `session/prompt` 把任务说明作为第一个 prompt 发过去（任务要写完整：目标、约束、仓库约定如 AGENTS.md、验收标准——这是这个 session 唯一能拿到的"交接文档"）
   - **验证归属**：立刻再调一次 `workspace/create` 幂等查询，确认新 `sessionId` 在返回的 `sessionIds` 里；**不在 = 没挂上 workspace，GUI 主列表看不到**——把它 `cancel` + `archiveSession` 清掉，重新 create（attach 偶发失败但重试即成功，见「注意」）。
4. 把 session 清单（标题 + 短 id）交给用户：这些是顶层 session，GUI 会话列表可见，直接点开交互，不再经主 session 转达。
5. 可选：`session/list` 确认 running=true 即可撒手。**不要长期轮询等结果**——agent 没有完成回调，后续跟进是人在 GUI 里的事；如果主 session 需要统一收结果、编排、汇总，那是子代理/workflow 的场景，不是本 skill。

## 复用脚本（推荐：批量建 session 直接用）

`references/scripts/` 下有按 dsh 版本分的便捷脚本（python3 标准库，零依赖），把「换票/探测/拿 workspaceId/create+rename+prompt/attach 验证」整条链路做完，返回 session 清单：

| 脚本 | 适用 | 备注 |
|---|---|---|
| `references/scripts/mk-sessions-modern.py` | dsh 0.1.2+ | 自动读 `~/.dsh/dsh-owned.json` 换票；可 `--base/--token/--owned` 覆盖；attach 验证不通过自动 cancel+archive 重建一次 |
| `references/scripts/mk-sessions-legacy.py` | dsh 0.1.1 | 无认证；`workspace.list` 按 path 匹配 workspace，未注册则 `workspace.create` |

两者输入一致：`--tasks` 指向 JSON 文件 `[{"title": "...", "prompt": "任务说明..."}, ...]`，`--repo <仓库绝对路径>`（默认 cwd）。加 `--dry-run` 只解析与验证不建 session。跑完把输出清单交给用户即可。

```bash
python3 .agents/skills/session-fork-parallel/references/scripts/mk-sessions-modern.py \
  --tasks /tmp/tasks.json --repo /Users/me/workspace
```

## 注意

- **`session/create` 用 `cwd` 建的 session 归入「未分组」，不出现在 workspace 组的会话列表**——用户会以为没建成功（实际在跑，只是列表看不到）。务必带 `workspaceId` 建（`cwd` 语义是「不注册 workspace 的裸会话」，只有建「未分组对话」时才用，且那也要预分配临时 cwd）。
- **attach 偶发失败**：`session/create` 返回 ok、session 在跑，但 `workspace.sessionIds` 里没有它——表现是 GUI 里「一瞬间出现又消失」（前端推送过、快照重建时按注册表过滤掉）。判定：create 后立刻幂等查 `sessionIds`；失败则清掉重建，重试即成功。
- **authorization 状态**：`dsh-owned.json` 的 token 是当前进程的；若网关重启过（pid/port 变），重读该文件。cookie 也有过期（Set-Cookie 里 Max-Age=2592000）。
- 新 session 继承网关默认配置（当前实例：kimi preset、`workspace-write` 沙箱、`ask` 审批策略）。审批/提问帧会在 GUI 弹给用户，由人应答——这正是本方案的目的。
- session 挂哪个 workspace 就干哪个 workspace 的活（cwd = workspace 路径）。
- 并行改同一仓库的代码仍要按 AGENTS.md 走 worktree（`worktree-dev-flow`），RPC 只管会话，不隔离代码，多个 session 直接改同一目录会互相踩。
- 测试/一次性 session 用完归档（先 `session/cancel` 再 `workspace/archiveSession`），别堆列表。
- 网关探测/调用的完整 TS 封装见 `src/server/dshRpc.ts`（`createSession` / `forkSession` / `renameSession` / `promptSession` / `sessionHistory`），curl 示例和它行为一致；脚本化批量创建时**小心 importlib/来源文件顶层副作用**（本次出现过来源脚本顶层又建了一批 session）。
