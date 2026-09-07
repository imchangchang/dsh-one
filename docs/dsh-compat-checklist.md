# dsh 上游版本兼容性测试清单

dsh-one 是 dsh 的客户端（gateway HTTP/WS RPC + webview 嵌入），上游每个 release 都可能动 wire 协议。本清单是对上游新版本的完整测试项，分两层：

- **自动化探针**（`.github/workflows/dsh-upstream-watch.yml` 每日 04:00 UTC+8 跑 `scripts/dsh-upstream-watch/probe.mjs`，覆盖 wire 面，结果见 `upstream-watch` label 的 issue 与 README 徽章）
- **人工/补充项**（探针覆盖不到的模型行为与端到端，由认领该版本测试 issue 的人执行）

## 自动化探针项（probe.mjs，14 项）

| id | 检查内容 | dsh-one 依赖点 |
|---|---|---|
| version-parse | `dsh --version` 输出可解析出 semver | `src/server/locateDsh.ts`、`--no-open` 版本 gate |
| ready-line | `dsh web` 就绪行 `dsh web: <url>?token=` | `src/pure/readyLine.ts` |
| auth-401-fingerprint | 无凭证 POST /api/* → 401 + 正文 `unauthorized` | `src/server/portProbe.ts`（authDsh 指纹） |
| token-exchange-cookie | `GET /?token=` → 303 + `dsh-auth-*` cookie | `src/server/serverAuth.ts` |
| rpc-session-list | `session/list`：信封、rpcId 回显、`{items}` 行形状 | `src/server/dshRpc.ts` listSessions |
| rpc-model-catalog | `session/modelCatalog`：`groups/default` 目录 | `src/server/modelCatalog.ts` |
| rpc-agent-presets | `agentPresets/list`：预设数组 | `src/pure/agentPreset.ts` |
| rpc-workspace-ops | `workspace/create` + `workspace/delete` | `src/server/dshRpc.ts` ensureWorkspace |
| rpc-session-create | `session/create` → `{sessionId}` | 同上 createSession |
| rpc-commands-list | `commands/list` 名册 | 同上 listCommands |
| commands-execute-args | `commands/execute` 接受 dsh-one 现发 args 形状（`{agentId, line, images}`；0.1.3 上游已改名 `submittedAttachments`，此项会暴露） | 同上 executeCommand |
| ws-mux-connect | WS `/api/remote.mux` 带 cookie 建连 | `src/server/remoteMux.ts` |
| ws-session-follow | `session/follow` snapshot 帧（cursor/records/hasMore/projections；detail 记录 header 键与 version、是否有 chunkRows——0.1.3 起 header 与 records 形状变化在这里现形） | `src/server/modernStreams.ts`、`src/pure/chunkRows.ts` |
| ws-session-control | `session/control` baseline 帧 | `src/server/modernStreams.ts` |

探针环境：ubuntu-latest + Node 24，临时 `DSH_HOME` 隔离数据目录，只读/无副作用。

## 人工/补充项（探针覆盖不了）

对新版本逐项过：

1. **流式渲染**：发一条消息，assistant 文本逐字增量出现（0.1.3 起增量改为 `session/follow` 的 `assistantStream: true` opt-in 侧信道，未适配前此项失败表现为「转圈后整段蹦出」）。
2. **工具卡**：跑一个带工具调用的任务，`tool/call`、`tool/result` 卡片渲染与展开正常。
3. **斜杠命令真跑**：`/compact` 等命令端到端执行（探针只验证 args 形状被网关接受）。
4. **审批/提问瀑布**：触发一次权限审批与 `ask_user_question` 提问卡，应答后 agent 继续。
5. **历史迁移**：用旧版本建过会话的 `~/.dsh` 起新版本（session format v2 迁移），历史渲染完整；再回滚旧版本确认可读。
6. **沙盒容器回归**：沿用 `test/sandbox/` 的容器内升级配方（镜像 pin 旧版 → 容器内 `npm i -g` 升新版 → mock-llm 场景回归），跑基线 ledger。
7. **release notes 破坏性变更段**：逐条对照 dsh-one 源码引用点（`grep -rn "0.1.2\|0.1.3" src/` 的注释标注了所有版本相关分支）。

完成后在对应 `upstream-watch` issue 里 comment 结论；发现破坏项按 backlog 流程单独立 issue 修复。

## 徽章数据

README 两个徽章由 workflow 回写 `.github/dsh-compat/`：

- `upstream-latest.json`：上游最新 release tag（每轮更新）
- `compat.json`：最近一次探针实测的版本与结论（仅探针执行时更新；npm 未发布的 GitHub-only 版本不会覆盖上次实测结果）
