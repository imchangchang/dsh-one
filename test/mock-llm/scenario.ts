/**
 * mock-LLM OpenAI 兼容端点：场景数据模型 + 类型导出 + 默认场景。
 *
 * 场景是「这条请求该回什么」的确定性编排。真 dsh 走全部真实逻辑（llm-pi-ai
 * provider 把 baseURL 指到本端点），只有模型响应按场景返回——用于确定性测试与
 * 宣发截图。
 *
 * 协议面：server.ts 消费本文件导出的 MockLlmScenario，模型 id 列表喂给
 * /v1/models，规则从上到下第一条命中生效（match 匹配「最后一条 user 消息」的文本）。
 */

/** 规则匹配上下文（content 是函数时由 server 构造传入）。 */
export interface MockRuleContext {
  /** 请求体 messages 里最后一条 role==='user' 的消息文本（无则空串）。 */
  lastUserMessage: string
  /** 请求体里声明的 model 字段。 */
  model: string
  /** 完整请求 body（scene 作者可按需读取 message / stream 等）。 */
  request: Record<string, unknown>
}

/**
 * respond.content 的三态：
 * - string：整段文本（stream:true 时单个 delta 块；stream:false 时整条）。
 * - string[]：流式分块（stream:true 时每元素一个 delta 块；stream:false 时拼接）。
 * - function：按请求动态生成（默认回显场景用它把最后一条 user 消息包进「收到：…」）。
 */
export type MockRuleContent = string | string[] | ((ctx: MockRuleContext) => string | string[])

/** 一次工具调用。arguments 是 JSON 串；流式时会被 server 分片推送。 */
export interface MockToolCall {
  id: string
  name: string
  arguments: string
}

/** 一条规则的响应编排（content 与 toolCalls 互斥，同给时以 toolCalls 为准）。 */
export interface MockRespond {
  /** 普通文本回复（流式分块或整段；默认回显用函数形式）。 */
  content?: MockRuleContent
  /** 工具调用（arguments 是 JSON 串）。 */
  toolCalls?: MockToolCall[]
  /** 注入 HTTP 错误（如 401/500/429），不走正常聊天响应。 */
  error?: { status: number; message: string }
  /** 附加 usage（stream:true 挂在末尾 finish 块上；stream:false 直接放进响应）。 */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/** 一条规则：match 命中就 respond，从上到下第一条生效。 */
export interface MockRule {
  /**
   * 匹配「最后一条 user 消息」的文本。
   * - '*'：匹配任意文本（兜底规则，应放最后）。
   * - { contains }：last user 消息包含该子串。
   * - { regex }：last user 消息命中该正则（RegExp 全局模式无 g 标志）。
   */
  match: { contains?: string; regex?: string } | '*'
  respond: MockRespond
}

/** 顶层场景：一次启动 mock-llm 的完整编排。 */
export interface MockLlmScenario {
  /** 声明的 model id；GET /v1/models 会逐条列出（pi-ai 的端点 interrogation 可能读它）。 */
  models: Array<{ id: string }>
  /** 匹配规则，从上到下第一条命中生效。 */
  rules: MockRule[]
}

/**
 * 默认场景。包含三类规则（顺序即优先级演示）：
 * 1. 「查天气」→ tool_calls（具体规则先于兜底命中）；
 * 2. 含「401」→ 注入 401 错误；
 * 3. '*' → 兜底：把最后一条 user 消息原样包进「收到：…」，stream:true 时分两段播。
 */
export function defaultScenario(): MockLlmScenario {
  return {
    models: [{ id: 'mock-llm' }],
    rules: [
      // 工具调用场景：user 说「查天气」触发一次 get_weather 调用。
      {
        match: { contains: '查天气' },
        respond: {
          toolCalls: [{ id: 'call-weather', name: 'get_weather', arguments: '{"city":"上海"}' }],
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
      // 401 注入场景：user 消息含「401」触发鉴权失败。
      {
        match: { contains: '401' },
        respond: { error: { status: 401, message: 'invalid api key' } },
      },
      // 兜底回显：把最后一条 user 消息原样包进「收到：…」，分两段流式播。
      {
        match: '*',
        respond: {
          content: (ctx: MockRuleContext) => [`收到：`, ctx.lastUserMessage],
        },
      },
    ],
  }
}
