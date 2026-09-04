/**
 * mock-LLM OpenAI 兼容端点：零依赖，全程 node:http / node:crypto / node:url。
 *
 * 目的：让真 dsh 走全部真实逻辑，只有模型响应由本端点按场景编排返回——用于
 * 确定性测试与宣发截图。dsh 的 llm-pi-ai provider 原生支持 baseURL，把
 * settings.yaml 里某条 provider 的 baseURL 指到本端点即可（零 patch）。
 *
 * 协议面（openai-completions wire，pi-ai 用 openAICompletionsApi 打它）：
 * - POST /v1/chat/completions：匹配场景规则（从上到下第一条命中），返回普通文本
 *   或 tool_calls 或注入 HTTP 错误；stream:true 走 SSE，stream:false 走 JSON。
 * - GET /v1/models：返回场景声明的模型 id 列表（pi-ai endpoint interrogation 可能读）。
 * - Authorization 头不校验（pi-ai 会带 key，这里收下即可）。
 *
 * 简化边界（注释即验收口径）：
 * - 规则里的 content 与 toolCalls 互斥，同给时以 toolCalls 为准。
 * - stream:true 时 content 的 string[] 每元素一个 delta 块；toolCalls 的 arguments
 *   按 code point 每 6 个一段分片推送（客户端按 index 累加 function.arguments 拼回）。
 * - usage 若在规则里声明，stream:true 挂在末尾 finish 块上、stream:false 直接放响应。
 *
 * 运行方式：
 *   node test/mock-llm/server.ts                    # 默认场景 + 端口 9009
 *   node test/mock-llm/server.ts --port 9009
 *   node test/mock-llm/server.ts --scenario <路径>  # 动态 import 一个 .ts 场景模块
 */
import * as http from 'node:http'
import * as crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { Socket } from 'node:net'
import {
  defaultScenario,
  type MockLlmScenario,
  type MockRespond,
  type MockRule,
  type MockRuleContext,
  type MockToolCall,
} from './scenario.ts'

// ---------------------------------------------------------------------------
// 小工具：请求体读取 / 文本抽取 / 错误类型 / 参数分片
// ---------------------------------------------------------------------------

/** 读取一个 JSON 请求体（mock 的 body 都很小，单次读入即可）。 */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * 提取「最后一条非注入 user 消息」的文本，供规则匹配。
 * 真实 dsh 会把 skill/运行上下文作为 user 消息注入给模型，wire 判别见
 * {@link isInjectedContext}（dsh 注入分两类：带 <system-reminder> 标签的
 * agent-instructions，与不带标签的 runtime context 快照——两者顺序也不固定，
 * 文本启发式是 dsh 0.1.1-rc.2 的实测 discriminant，新增注入样式会在这里失效，
 * 表现为回复回显注入内容（fail 看得见，不会静默）。
 */
function lastUserText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (typeof msg !== 'object' || msg === null) continue
    const m = msg as Record<string, unknown>
    if (m.role !== 'user') continue
    const content = m.content
    const text = userTextOf(content)
    if (isInjectedContext(text)) continue
    if (text.trim().length === 0) continue
    return text
  }
  return ''
}

/**
 * dsh 注入上下文的两类已知 wire 形式（dsh 0.1.1-rc.2）：
 * 1. agent-instructions 的 `SYSTEM_REMINDER_OPEN`（<system-reminder> 包裹）；
 * 2. dsh-system-prompt 的 runtime context 快照：无标签纯文本，以
 *    `Current runtime context.` 开头（joinContextSections 拼的）。
 */
function isInjectedContext(text: string): boolean {
  const t = text.trim()
  if (t.includes('<system-reminder>')) return true
  if (t.startsWith('Current runtime context.')) return true
  return false
}

/** user 消息 content 的纯文本提取：字符串直取，块数组只取 text 块。 */
function userTextOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: unknown } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text')
      .map((b) => (typeof b.text === 'string' ? b.text : ''))
      .join('\n')
  }
  return ''
}

/** OpenAI 风格错误 type（按状态码映射，未列出的走 invalid_request_error）。 */
function errorType(status: number): string {
  switch (status) {
    case 401:
      return 'authentication_error'
    case 403:
      return 'permission_error'
    case 404:
      return 'not_found_error'
    case 429:
      return 'rate_limit_error'
    case 500:
    case 502:
    case 503:
    case 504:
      return 'server_error'
    default:
      return 'invalid_request_error'
  }
}

/** 把 arguments JSON 串按 code point 分片（每 size 个一段），客户端拼接还原。 */
function splitArguments(s: string, size = 6): string[] {
  const cps = Array.from(s)
  const out: string[] = []
  for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size).join(''))
  return out.length > 0 ? out : ['']
}

/** 把请求体转成可读 model id（缺省用场景第一个）。 */
function modelOf(body: Record<string, unknown>, scenario: MockLlmScenario): string {
  const declared = body.model
  return typeof declared === 'string' && declared.length > 0
    ? declared
    : (scenario.models[0]?.id ?? '')
}

// ---------------------------------------------------------------------------
// 端点核心
// ---------------------------------------------------------------------------

class LlmEndpoint {
  private readonly scenario: MockLlmScenario
  private static readonly CHUNK_OBJECT = 'chat.completion.chunk'

  constructor(scenario: MockLlmScenario) {
    this.scenario = scenario
  }

  /** 在建立的 http server 上挂载 request 路由。 */
  mount(server: http.Server): void {
    server.on('request', (req, res) => {
      this.handleRequest(req, res).catch(() => {
        try {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'internal', type: 'server_error', code: '500' } }))
        } catch {
          // socket 可能已断。
        }
      })
    })
    // 无效请求头（如 HTTP/0.9）直接 400，避免挂起。
    server.on('clientError', (_err, socket) => {
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      } catch {
        socket.destroy()
      }
    })
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]

    if (req.method === 'GET' && path === '/v1/models') {
      this.writeJson(res, 200, {
        object: 'list',
        data: this.scenario.models.map((m) => ({ id: m.id, object: 'model' })),
      })
      return
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      await this.handleChatCompletions(req, res)
      return
    }

    this.writeJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error', code: 'not_found' } })
  }

  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: Record<string, unknown>
    try {
      body = await readJson(req)
    } catch {
      this.writeJson(res, 400, { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'parse_error' } })
      return
    }

    const messages = Array.isArray(body.messages) ? body.messages : []
    const stream = body.stream === true
    const lastUserMessage = lastUserText(messages)
    const model = modelOf(body, this.scenario)

    // 工具结果后的续拍（最后一条消息是 tool 角色）：真实模型会基于工具结果继续
    // 对话而不是再次要求同一个工具——mock 若继续命中工具编排规则会引导 dsh 无限
    // 重试同一调用（实测：bash/subagent ×3 直至 dsh 重复保护报错）。所以续拍一律
    // 走兜底回显，让 turn 正常收尾。
    const lastMsg = messages[messages.length - 1]
    const isToolFollowup =
      typeof lastMsg === 'object' &&
      lastMsg !== null &&
      (lastMsg as Record<string, unknown>).role === 'tool'
    const rule = isToolFollowup
      ? this.scenario.rules.find((r) => r.match === '*')
      : this.matchRule(lastUserMessage)
    if (!rule) {
      // 场景专门不给兜底规则时，用 404 显式触发「dsh 当错误」。
      this.writeJson(res, 404, { error: { message: 'no matching rule for last user message', type: 'invalid_request_error', code: 'missing_rule' } })
      return
    }

    const respond = rule.respond
    if (respond.error) {
      const { status, message } = respond.error
      this.writeJson(res, status, { error: { message, type: errorType(status), code: String(status) } })
      return
    }

    const ctx: MockRuleContext = { lastUserMessage, model, request: body }
    const content = this.resolveContent(respond.content, ctx)
    const toolCalls = respond.toolCalls ?? []
    const usage = respond.usage

    const response = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      created: Math.floor(Date.now() / 1000),
      model,
    }

    if (stream) this.respondStream(res, { ...response, content, toolCalls, usage })
    else this.respondJson(res, { ...response, content, toolCalls, usage })
  }

  /** 匹配「最后一条 user 消息」文本，返回第一条命中的规则（无则 undefined）。 */
  private matchRule(text: string): MockRule | undefined {
    return this.scenario.rules.find((r) => this.ruleMatches(r, text))
  }

  private ruleMatches(rule: MockRule, text: string): boolean {
    if (rule.match === '*') return true
    const m = rule.match
    if (m.contains !== undefined && text.includes(m.contains)) return true
    if (m.regex !== undefined) {
      try {
        return new RegExp(m.regex).test(text)
      } catch {
        return false
      }
    }
    return false
  }

  /** 把 respond.content 归一成字符串数组（字符串→单元素；函数→调用求值）。 */
  private resolveContent(content: MockRule['respond']['content'], ctx: MockRuleContext): string[] {
    let value = content
    if (typeof value === 'function') value = value(ctx)
    if (value === undefined) return []
    if (typeof value === 'string') return [value]
    return value.map((c) => String(c))
  }

  // ----- 非流式 JSON 响应 -----

  private respondJson(
    res: http.ServerResponse,
    { id, created, model, content, toolCalls, usage }: { id: string; created: number; model: string; content: string[]; toolCalls: MockToolCall[]; usage?: MockRespond['usage'] },
  ): void {
    const isTool = toolCalls.length > 0
    const message: Record<string, unknown> = {
      role: 'assistant',
      content: isTool || content.length === 0 ? null : content.join(''),
    }
    if (isTool) {
      message.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }))
    }
    const response: Record<string, unknown> = {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message, finish_reason: isTool ? 'tool_calls' : 'stop' }],
    }
    if (usage) response.usage = usage
    this.writeJson(res, 200, response)
  }

  // ----- 流式 SSE 响应 -----

  private respondStream(
    res: http.ServerResponse,
    { id, created, model, content, toolCalls, usage }: { id: string; created: number; model: string; content: string[]; toolCalls: MockToolCall[]; usage?: MockRespond['usage'] },
  ): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const base = { id, object: LlmEndpoint.CHUNK_OBJECT, created, model }

    if (toolCalls.length > 0) this.emitToolCallStream(res, base, toolCalls)
    else this.emitContentStream(res, base, content)

    // 末尾 finish 块：空 delta + finish_reason；usage 若声明则挂这里。
    const finish: Record<string, unknown> = { choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' }] }
    if (usage) finish.usage = usage
    this.sse(res, { ...base, ...finish })
    this.sseDone(res)
    res.end()
  }

  private emitContentStream(res: http.ServerResponse, base: Record<string, unknown>, content: string[]): void {
    if (content.length === 0) return
    this.sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: content[0] }, finish_reason: null }] })
    for (let i = 1; i < content.length; i++) {
      this.sse(res, { ...base, choices: [{ index: 0, delta: { content: content[i] }, finish_reason: null }] })
    }
  }

  /**
   * 流式推送 tool_calls。每个 tool_call 的 id/name 只在其首个 delta 块出现，
   * arguments 按 code point 分片，后续块只补 function.arguments——客户端按
   * tool_calls[index].function.arguments 累加即可还原完整 JSON 串。
   */
  private emitToolCallStream(res: http.ServerResponse, base: Record<string, unknown>, toolCalls: MockToolCall[]): void {
    for (let idx = 0; idx < toolCalls.length; idx++) {
      const tc = toolCalls[idx]
      const args = splitArguments(tc.arguments)
      const first: Record<string, unknown> = {
        index: idx,
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: args[0] },
      }
      const delta: Record<string, unknown> = idx === 0
        ? { role: 'assistant', tool_calls: [first] }
        : { tool_calls: [first] }
      this.sse(res, { ...base, choices: [{ index: 0, delta, finish_reason: null }] })
      for (let f = 1; f < args.length; f++) {
        this.sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, function: { arguments: args[f] } }] }, finish_reason: null }] })
      }
    }
  }

  private sse(res: http.ServerResponse, value: unknown): void {
    res.write(`data: ${JSON.stringify(value)}\n\n`)
  }

  /** SSE 终止标记：OpenAI 约定是裸 `data: [DONE]`（不是 JSON 串）。 */
  private sseDone(res: http.ServerResponse): void {
    res.write('data: [DONE]\n\n')
  }

  private writeJson(res: http.ServerResponse, status: number, value: unknown): void {
    const body = JSON.stringify(value)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
}

// ---------------------------------------------------------------------------
// 公开 API：createMockLlm / MockLlm / CLI 入口
// ---------------------------------------------------------------------------

export interface MockLlm {
  /** 底层 http.Server（测试可在另起监听前建连接用）。 */
  readonly server: http.Server
  /** 实际监听端口（listen(0) 由系统分配）。 */
  port: number
  /** http://127.0.0.1:<port> 基地址。 */
  url: string
  /** 监听并更新 port/url；默认 9009。 */
  listen(port?: number): Promise<MockLlm>
  close(): Promise<void>
}

/** 构造并（可选）启动一个 mock-LLM 端点。默认场景见 scenario.defaultScenario。 */
export async function createMockLlm(opts?: { scenario?: MockLlmScenario }): Promise<MockLlm> {
  const endpoint = new LlmEndpoint(opts?.scenario ?? defaultScenario())
  const server = http.createServer()
  endpoint.mount(server)
  let activeSockets = new Set<Socket>()

  const wrap: MockLlm = {
    server,
    port: 0,
    url: '',
    listen(port = 9009): Promise<MockLlm> {
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          const address = server.address()
          const p = typeof address === 'object' && address ? address.port : port
          wrap.port = p
          wrap.url = `http://127.0.0.1:${p}`
          resolve(wrap)
        })
      })
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const s of activeSockets) s.destroy()
        activeSockets = new Set()
        server.close(() => resolve())
      })
    },
  }

  server.on('connection', (socket) => {
    activeSockets.add(socket)
    socket.on('close', () => activeSockets.delete(socket))
    socket.on('error', () => activeSockets.delete(socket))
  })

  return wrap
}

/** 动态 import 一个 .ts 场景模块并取 default（相对路径按 cwd 解析）。 */
async function importScenario(path: string): Promise<MockLlmScenario> {
  const mod = await import(pathToFileURL(path).href)
  const scenario = (mod as { default?: unknown }).default
  if (typeof scenario !== 'object' || scenario === null) {
    throw new Error(`--scenario 模块必须 export default 一个 MockLlmScenario：${path}`)
  }
  return scenario as MockLlmScenario
}

/** CLI 入口：起一个真实 mock-LLM，供真 dsh 把 baseURL 指过来。 */
export function main(): void {
  const args = process.argv.slice(2)
  let port = 9009
  let scenarioPath: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]) || 9009
    else if (args[i] === '--scenario') scenarioPath = args[++i]
  }
  const boot = scenarioPath ? importScenario(scenarioPath) : Promise.resolve(undefined)
  boot.then(async (scenario) => {
    const mock = await createMockLlm(scenario ? { scenario } : undefined)
    await mock.listen(port)
    console.log(`[mock-llm] listening on ${mock.url}${scenarioPath ? ` (scenario: ${scenarioPath})` : ''}`)
  })
}

// 让 `node test/mock-llm/server.ts`（或 --port/--scenario）真正把服务拉起来；
// 被测试 import 时不会触发（createMockLlm 是纯工厂）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
