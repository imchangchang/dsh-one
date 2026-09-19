/**
 * 实验室的假模型端点（#177）：让**自起的隔离实例**里的会话能有真实状态。
 *
 * 为什么需要它：隔离实例是空的，而套件要的是「树上有一条真会话」——dsh 的
 * `session/list` 里 `blank: true` 的会话**不上树**（`pure/workspaceTreeView.ts` 的
 * `sessionVisible` 只在它是当前会话时才放行），而 `blank` 是「这条会话从没被发过
 * 提示词」，光靠 `session/create` 改不掉。要造出真会话（以及真跑着的、真在等回答的），
 * 就得让实例真跑一轮对话，那就要一个模型端点。
 *
 * 端点本体复用仓库既有的 `test/mock-llm/`（零依赖的 OpenAI 兼容假端点，沙盒那条线
 * 也用它）：dsh 走全部真实逻辑（真会话、真回合、真审批/提问通道），只有模型响应
 * 按场景编排。提示词 → 编排的对照表就是 {@link LAB_PROMPTS}，播种（`seed.ts`）按它
 * 造状态，套件按同一份常量认会话。
 *
 * 用法：`startLabLlm()` 现起一个（端口由内核分配、只监听 127.0.0.1），跑完 `close()`。
 */
import { createMockLlm, type MockLlm } from '../mock-llm/server.ts'
import type { MockLlmScenario } from '../mock-llm/scenario.ts'

export type { MockLlm }

/**
 * 播种用的提示词（也是套件认会话的依据：会话标题由 `session/rename` 定死，但**状态**
 * 由这几句提示词在实例里真造出来）。每条都带「实验室」前缀，免得与兜底规则撞上。
 */
export const LAB_PROMPTS = {
  /** 普通对话：很快跑完，会话因此是非 blank 的空闲会话。 */
  idle: (n: number): string => `实验室：普通对话 ${String(n)}，回一句话就结束。`,
  /** 保持运行中：假模型把首个流式块推得极晚，这一轮在整个验证期间不会结束。 */
  running: '实验室：保持运行中，先别回。',
  /** 等审批：bash 带提权参数，真 dsh 在 policy=ask 下会挂起等审批。 */
  approval: '实验室：等审批，跑一条需要提权的命令。',
  /** 等回答：ask_user_question，真 dsh 会挂起等回答。 */
  question: '实验室：等回答，问我一个问题。',
}

/**
 * 实验室场景（自上而下第一条命中）。
 *
 * 「保持运行中」那条要**足够慢**：`deltaDelayMs` 是**块与块之间**的间隔（第一块立刻发），
 * 所以「一块 + 超长间隔」这种写法只会让这一轮当场跑完、间隔根本没机会生效（实测：播种完
 * 几秒后会话就落回空闲）。这里给 400 块 × 3 秒 ≈ 20 分钟，整轮验证期间它一直挂在运行态；
 * 每块只有几行字，流量可忽略。
 */
export function labScenario(): MockLlmScenario {
  return {
    models: [{ id: 'mock-flash' }, { id: 'mock-llm' }],
    rules: [
      {
        match: { contains: '保持运行中' },
        respond: {
          deltaDelayMs: 3_000,
          content: Array.from({ length: 400 }, (_, i) => `（实验室：运行中第 ${String(i + 1)} 块）`),
        },
      },
      {
        match: { contains: '等审批' },
        respond: {
          toolCalls: [
            {
              id: 'call-lab-approve',
              name: 'bash',
              arguments: JSON.stringify({
                command: 'echo lab-approved',
                sandbox_permissions: 'danger-full-access',
                justification: '实验室：这一条用来造「等待审批」会话',
              }),
            },
          ],
        },
      },
      {
        match: { contains: '等回答' },
        respond: {
          toolCalls: [
            {
              id: 'call-lab-ask',
              name: 'ask_user_question',
              arguments: JSON.stringify({
                questions: [
                  {
                    id: 'lab-q-1',
                    question: '实验室：继续执行吗？',
                    header: '实验室提问',
                    options: [
                      { label: '继续', description: '实验室用，不会被作答' },
                      { label: '停止', description: '实验室用，不会被作答' },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      },
      { match: '*', respond: { content: '实验室：收到。' } },
    ],
  }
}

/** 起一个假模型端点（端口由内核分配）。 */
export async function startLabLlm(): Promise<MockLlm> {
  const llm = await createMockLlm({ scenario: labScenario() })
  await llm.listen(0)
  return llm
}
