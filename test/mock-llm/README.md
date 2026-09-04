# mock LLM（OpenAI 兼容端点）

一个零依赖的「假模型」HTTP 端点，让真 dsh 走全部真实逻辑——后端 `llm-pi-ai`
provider 原生支持 `baseURL`（schema 有 `baseURL`/`api` 字段，已核实 0.1.1-rc.2
源码），把某条 provider 的 `baseURL` 指到本端点即可，**零 patch**。只有模型响应
按场景编排返回（通用回显、tool_calls、401 注入……），用于确定性测试与宣发截图。

它不碰 dsh 的请求/工具/上下文逻辑：dsh 自己把 `messages`（含历史/工具结果）拼好
POST 过来，本端点只负责回一段编排好的文本或工具调用。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.ts` | 核心端点：`node:http` 处理 `/v1/chat/completions`、`/v1/models`。零依赖（只用内置模块）。 |
| `scenario.ts` | 场景数据模型（`MockLlmScenario`/`MockRule`/`MockRespond`… 类型导出）+ 默认场景 `defaultScenario()`。 |
| `scenario.test.ts` | `node --test` 场景结构断言。 |
| `server.test.ts` | `node --test` 协议面测试（SSE / tool_calls 分片 / stream:false / 401 / models / 匹配优先级 / 404）。 |

运行：

```sh
node --test test/mock-llm/*.test.ts     # 在仓库根跑（node 24 直接执行 .ts）
node test/mock-llm/server.ts            # 起一个真实 mock，端口 9009
node test/mock-llm/server.ts --port 9009
node test/mock-llm/server.ts --scenario my-scenario.ts
```

## 协议实现清单

### `POST /v1/chat/completions`

请求 JSON `{ model, messages, stream, ... }`。mock 取 `messages` 里**最后一条
`role==='user'` 的消息文本**作为匹配输入，从 `scenario.rules` 里**自上而下找第一条
命中的规则**（`match` 详解见下）。

| respond | stream:true | stream:false |
| --- | --- | --- |
| `content` | `text/event-stream`，SSE 每块 `data: <json>`，`choices[0].delta` `{role,content}`；`string[]` 每元素一个 delta 块；末尾空 delta + `finish_reason:'stop'`；结尾 `data: [DONE]`。 | 整段 JSON，`message.content` 为拼接后的字符串，`finish_reason:'stop'`。 |
| `toolCalls` | 每 tool_call 一个 delta；`id/type/name` 只在该调用首块出现，`arguments` 按 code point 每 6 个一段分片推送（后续块只补 `function.arguments`），客户端按 `tool_calls[index].function.arguments` 累加还原；末尾 `finish_reason:'tool_calls'`。 | `message.tool_calls`（含 `id/type/function`），`message.content:null`，`finish_reason:'tool_calls'`。 |
| `error` | 直接 HTTP `status` + `{error:{message,type,code}}`（不走聊天响应）。 | 同上。 |
| `usage`（可选） | 挂在末尾 finish 块上（`delta:{}` + `finish_reason` 同一块）。 | 直接放进响应顶层。 |

- **无匹配规则** → HTTP 404 + `{error:{code:'missing_rule',...}}`，dsh 会当错误——场景作者用来
  显式触发「这条请求不该成功」。
- `Authorization`/`apiKey` 头**不校验**（pi-ai 会带 key，这里收下即可）。
- `content` 与 `toolCalls` 互斥，同给时以 `toolCalls` 为准。
- 请求里其他字段（`tools`、`max_tokens`、`stream_options` 等）忽略——mock 只看
  `model`/`messages`/`stream`。

### `GET /v1/models`

返回 `{ object:'list', data:[{id, object:'model'}] }`，把 `scenario.models` 里声明的
`id` 逐条列出（pi-ai 的 endpoint interrogation 可能读它）。

### 其它路径

`POST /v1/chat/completions` 之外的路径 → 404。

### 错误 type 映射

规则里的 `error.status` 按 OpenAI 惯例映射 `type`：401→`authentication_error`、
403→`permission_error`、404→`not_found_error`、429→`rate_limit_error`、
500/502/503/504→`server_error`，其余→`invalid_request_error`。`code` = `String(status)`。

## 场景怎么加

场景是 `test/mock-llm/scenario.ts` 里的 `MockLlmScenario`，最省事往
`defaultScenario()` 里加，或自己拼好传给 `createMockLlm({ scenario })`。

```ts
import type { MockLlmScenario } from './scenario.ts'

export default {
  models: [{ id: 'mock-llm' }],
  rules: [
    // 具体规则放前面，兜底 '*' 放最后（自上而下第一条命中生效）。
    { match: { contains: '查天气' }, respond: { toolCalls: [{ id: 'c1', name: 'get_weather', arguments: '{"city":"上海"}' }] } },
    { match: { regex: '^/greet' }, respond: { content: 'greet 命令' } },
    { match: '*', respond: { content: (ctx) => [`收到：`, ctx.lastUserMessage] } },
  ],
} satisfies MockLlmScenario
```

**规则字段**：

- `match`：`'*'` 匹配任意文本；`{ contains }` 命中子串；`{ regex }` 命中正则
  （匹配对象是「最后一条 user 消息」的文本）。
- `respond.content`：`string`（整段）｜`string[]`（流式分块）｜`(ctx) => string|string[]`
  （按请求动态生成，`ctx` 带 `lastUserMessage`、`model`、`request`）。
- `respond.toolCalls`：`[{ id, name, arguments }]`，`arguments` 是 JSON 串。
- `respond.error`：`{ status, message }` 注入 HTTP 错误。
- `respond.usage`：`{ promptTokens, completionTokens, totalTokens }` 可选。

自定场景文件就是一个 `.ts` 模块 `export default` 你的 `MockLlmScenario`，用
`--scenario <路径>` 指向它（相对路径按 cwd 解析）。

## 怎么对接 dsh

1. 先让 mock 占住端口：
   `node test/mock-llm/server.ts`（默认 9009），或
   `node test/mock-llm/server.ts --scenario my-scenario.ts`。
2. 在 dsh 的 settings（user layer）里声明 provider 并把它设为默认模型：

```yaml
llm-pi-ai:
  providers:
    mock-llm:
      displayName: Mock LLM
      api: openai-completions            # 对应 pi-ai 的 openAICompletionsApi
      baseURL: http://127.0.0.1:9009/v1  # 关键：末尾要带 /v1
      apiKeyEnv: DSH_MOCK_LLM_KEY        # mock 不校验；pi-ai 会按它取 key 放 Authorization
      models:
        - id: mock-llm
agent-default-model:
  provider: mock-llm
  model: mock-llm
```

**`baseURL` 必须带 `/v1`**：pi-ai 用 OpenAI SDK 打端点，SDK 在 `baseURL` 后面直接拼
`/chat/completions`（`openai/resources/chat/completions` 的 `post('/chat/completions')`）
与 `/models`。所以 `http://127.0.0.1:9009/v1` → 才命中本端点的
`/v1/chat/completions`、`/v1/models`；漏了 `/v1` 会打到 `/chat/completions` 得 404。

以上字段（`llm-pi-ai.providers.<route>.{api,baseURL,models}`、
`agent-default-model.{provider,model}`）按安装的 dsh **0.1.1-rc.2** 源码核实。`models`
里只需 `id`（`contextWindow`/`maxTokens`/`input` 走 route 的默认值），`id` 须与
`agent-default-model.model` 对应。

## 验证边界

**单元测试已覆盖**（`node --test test/mock-llm/*.test.ts`，15 条）：

- `stream:true` 回显：两段 delta 拼成「收到：你好」，首块带 `role`，末尾
  `finish_reason:'stop'` + `data: [DONE]`；
- `stream:true` tool_calls：`arguments` 确实分片（>1 段）且拼接还原完整 JSON 串，
  首块带 `id`/`name`，末尾 `finish_reason:'tool_calls'`；
- `stream:false` 回显与 tool_calls（`message.content:null` + `usage`）；
- 规则注入 401（HTTP 401 + OpenAI 风格 `error` 结构）；
- Authorization 头不校验；
- `GET /v1/models`（`object:'list'` / 每项 `object:'model'`）；
- 规则匹配优先级（具体规则先于兜底 `'*'` 命中）；
- 自定义场景的 `regex` 规则；无匹配场景 404（`code:'missing_rule'`）；未知路径 404；
- 场景结构断言（三类规则与顺序、tool_calls 内容、401 内容、回显函数求值）。

**未覆盖 / 不在本任务范围**：

- 「真 dsh 把它当 LLM 端点」需要真 dsh 进程 + 真实会话（llm-pi-ai 拼 `messages`、
  处理流式、工具循环回填），本 mock 单元测试不涉及；这是下一步对上一步的真实对拍。
- `tools` 多轮工具循环、多 `choices`、`n`>1、图像/多模态输入未编排——mock 只按
  `messages` 最后一条 user 文本匹配，不做多轮状态机。

## 已知边界

- SSE 分块粒度：`content` 的 `string[]` 每元素一块；`toolCalls` 的 `arguments` 每
  6 个 code point 一块（`Array.from` 按 code point 切，不会切开代理对，拼接可还原）。
- 工具参数分片的注意点：`id`/`type`/`name` 只在该 tool_call 的**首块**出现，后续块只
  补 `function.arguments`；客户端拿到 `tool_calls[index]` 后按 `index` 累加
  `function.arguments` 即可还原完整 JSON 串（首块 `arguments` 是分片的第一段，
  不是完整串）。单次一个 tool_call 也会分片。
- `usage` 在 `stream:true` 时挂在末尾 finish 块上（`delta:{}` + `finish_reason` 同一
  块），不是 OpenAI 标准的独立 `choices:[]` 块——这是简化，多数 SSE 解析器并发
  `finish_reason` 不影响；pi-ai 若开了 `stream_options.include_usage` 会读这个 `usage`。
- 场景 `models` 为空时 `/v1/models` 返回 `data:[]`；请求没带 `model` 时响应回退到
  场景第一个模型 id。
- mock 不校验 Authorization、不实现多轮工具对话、不返回真实 token 用量。
