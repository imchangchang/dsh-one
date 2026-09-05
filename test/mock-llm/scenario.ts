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
 * 默认场景。分类规则（顺序即优先级演示）：
 * 1. 「查天气」→ get_weather 工具调用；
 * 2. 「慢命令」→ bash sleep 90（运行态/子代理慢任务）；
 * 3. 「审批测试」→ bash 带 sandbox_permissions 升级参数（触发真 dsh 审批）；
 * 4. 「提个问题」→ ask_user_question（真 dsh 提问面板）；
 * 5. 「派个子代理」→ subagent 后台任务；
 * 6. 「开两个后台任务」→ subagent ×2（多后台任务 chip）；
 * 7. 含「401」→ 注入 401 错误；
 * 8. '*' → 兜底回显：把最后一条 user 消息原样包进「收到：…」，分两段流式播。
 */
export function defaultScenario(): MockLlmScenario {
  return {
    // mock-flash 是沙盒 settings.yaml（entrypoint mock 模式）声明的模型 id；
    // mock-llm 保留别名一并列出，保证 /v1/models 与配置面一致。
    models: [{ id: 'mock-flash' }, { id: 'mock-llm' }],
    rules: [
      // 工具调用场景：user 说「查天气」触发一次 get_weather 调用。
      {
        match: { contains: '查天气' },
        respond: {
          toolCalls: [{ id: 'call-weather', name: 'get_weather', arguments: '{"city":"上海"}' }],
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
      // 审批：bash 带 sandbox_permissions + justification 升级参数，真 dsh 在
      // policy=ask 下会弹「Permission request」卡片（字段对齐 dsh-tool-bash）。
      {
        match: { contains: '审批测试' },
        respond: {
          toolCalls: [{
            id: 'call-approve',
            name: 'bash',
            arguments: '{"command":"echo approved","sandbox_permissions":"danger-full-access","justification":"测试审批路径"}',
          }],
        },
      },
      // 提问：ask_user_question（字段对齐 dsh-tool-ask-user 的 question schema）。
      {
        match: { contains: '提个问题' },
        respond: {
          toolCalls: [{
            id: 'call-ask',
            name: 'ask_user_question',
            arguments: JSON.stringify({
              questions: [{
                id: 'q-1',
                question: '继续执行吗？',
                header: '测试提问',
                options: [{ label: '继续 (Recommended)', description: '按编排继续' }, { label: '停止', description: '暂停此轮' }],
              }],
            }),
          }],
        },
      },
      // 子代理：subagent 默认后台执行（字段对齐 dsh-tool-subagent）。
      {
        match: { contains: '派个子代理' },
        respond: {
          toolCalls: [{
            id: 'call-sub',
            name: 'subagent',
            arguments: JSON.stringify({ prompt: '提个问题', description: '子代理测试' }),
          }],
        },
      },
      // 多后台任务：一次两个 subagent（各自跑「慢命令」子循环，job 保持 running）。
      {
        match: { contains: '开两个后台任务' },
        respond: {
          toolCalls: [
            { id: 'call-j1', name: 'subagent', arguments: JSON.stringify({ prompt: '提个问题', description: '后台任务 A' }) },
            { id: 'call-j2', name: 'subagent', arguments: JSON.stringify({ prompt: '提个问题', description: '后台任务 B' }) },
          ],
        },
      },
      // 定时计划（dsh >= 0.1.2 的 schedule_create；镜像基础 dsh 0.1.1-rc.2 无此
      // 工具，容器内升级 0.1.2-rc.1 后场景可用——见 chat-stage4-p2p3 沙盒环境）：
      // 远期单次提醒（2099 → 保持 active），到期后投影折叠 active=[]。
      {
        match: { contains: '设置一个提醒' },
        respond: {
          toolCalls: [{
            id: 'call-schedule',
            name: 'schedule_create',
            arguments: JSON.stringify({ prompt: '检查测试报告是否完成', at: '2099-01-01T09:00:00.000Z' }),
          }],
        },
      },
      // commit 卡演示（CLI 兜底验证）：回文本带固定提交 sha——sha 与沙盒
      // entrypoint 在 $HOME 建的演示仓库一致；窗口没打开该仓库，查询走 git CLI 兜底。
      {
        match: { contains: 'commit 演示' },
        respond: { content: ['参见提交 cb1f933e15289a00e30865e8dd3963ba90a96780（CLI 兜底演示）。'] },
      },
      // commit 卡未命中：回一个不存在的 sha（chip 保持灰显「Commit not found」）。
      {
        match: { contains: 'commit 不存在' },
        respond: { content: ['这个提交 deadbeef00112233445566778899aabbccddeeff 应该查不到。'] },
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
