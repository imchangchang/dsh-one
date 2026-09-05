/**
 * Turn 级 token 用量折叠：@deepseek-ai/dsh-token-meter 的 turn-usage 语义
 * （dsh 0.1.2-rc.1，src/usage/turn-usage.ts）按 dsh-one 的 loose 事件镜像
 * 口径移植成增量 fold。折叠 turn/start → turn/end 间每次尝试的
 * assistant/chunk（usage 块）+ assistant/message（data.usage）样本：
 * 样本必须由尝试生命周期包裹（step/start 开、assistant/message /
 * finish-error / step/end 关、llm/retry-started 重开同一步），计数必须
 * 安全（非负 safe integer），总量必须自洽（两种推导路径都验）。任何缺
 * 边界、缺样本、计数不安全或总量矛盾都让整项不可用——宁可不出，不虚报。
 *
 * 使用方（ConversationFolder）在窗口内看到 turn/start 时才建 fold，等价
 * 官方的「turn/start 不在窗口 → deriveTurnTokenUsage 不跑」；本 fold 不再
 * 重复判窗口边界，只负责边界之后的生命周期与数学一致性。
 */
import type { ChatTurnUsage, ChatTurnUsageRoute } from './chatContract.ts'
import type { SessionEventLike } from './conversation.ts'

/** One provider/model route that contributed a billed request attempt. */
export type TurnTokenUsageRoute = ChatTurnUsageRoute

/** Exact provider-reported token accounting for every attempt in one completed Turn. */
export type TurnTokenUsage = ChatTurnUsage

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeSum(values: number[]): number | undefined {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return undefined
  }
  return total
}

/** Extract {provider, model} from an assistant/message payload; undefined when unproven. */
function messageRoute(message: unknown): { provider: string; model: string } | undefined {
  if (!message || typeof message !== 'object') return undefined
  const source = (message as { source?: unknown }).source
  if (!source || typeof source !== 'object') return undefined
  const provider = (source as { provider?: unknown }).provider
  const model = (source as { model?: unknown }).model
  return typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0
    ? { provider, model }
    : undefined
}

/** One closed attempt's normalized usage (official normalizeUsage). */
interface NormalizedAttempt {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  route?: { provider: string; model: string }
}

function normalizeUsage(usage: unknown, route: { provider: string; model: string } | undefined): NormalizedAttempt | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const inputTokens = u.inputTokens
  const outputTokens = u.outputTokens
  const cacheReadTokens = u.cacheReadTokens
  const cacheWriteTokens = u.cacheWriteTokens
  const reasoningTokens = u.reasoningTokens
  const totalTokens = u.totalTokens
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) return undefined
  const knownPrompt = safeSum([
    inputTokens,
    ...(cacheReadTokens === undefined ? [] : [cacheReadTokens]),
    ...(cacheWriteTokens === undefined ? [] : [cacheWriteTokens]),
  ])
  if (knownPrompt === undefined) return undefined
  let exactTotal: number
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined
    const exactPrompt = totalTokens - outputTokens
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined
    if (cacheReadTokens !== undefined && cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) return undefined
    exactTotal = totalTokens
  } else {
    // 无 totalTokens 时必须两个缓存桶都在，才能由已知 prompt 推出精确 total。
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined
    const derivedTotal = safeSum([knownPrompt, outputTokens])
    if (derivedTotal === undefined) return undefined
    exactTotal = derivedTotal
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: exactTotal,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(route === undefined ? {} : { route }),
  }
}

/** Aggregate closed attempts (official aggregateAttempts). */
function aggregateAttempts(attempts: NormalizedAttempt[]): TurnTokenUsage | undefined {
  if (attempts.length === 0) return undefined
  const inputTokens = safeSum(attempts.map((a) => a.inputTokens))
  const outputTokens = safeSum(attempts.map((a) => a.outputTokens))
  const totalTokens = safeSum(attempts.map((a) => a.totalTokens))
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined
  const cacheRead = attempts.map((a) => a.cacheReadTokens)
  const cacheWrite = attempts.map((a) => a.cacheWriteTokens)
  const reasoning = attempts.map((a) => a.reasoningTokens)
  const cacheReadTokens = cacheRead.every(isCount) ? safeSum(cacheRead) : undefined
  const cacheWriteTokens = cacheWrite.every(isCount) ? safeSum(cacheWrite) : undefined
  const reasoningTokens = reasoning.every(isCount) ? safeSum(reasoning) : undefined
  // 有缓存桶就有安全的和（桶被精确 prompt 上界约束），safeSum 失败全组归无。
  let routes: TurnTokenUsageRoute[] | undefined
  const attributed = attempts.map((a) => a.route)
  if (attributed.every((r) => r !== undefined)) {
    const unique = new Map<string, TurnTokenUsageRoute>()
    for (const r of attributed) {
      if (r === undefined) continue
      unique.set(`${r.provider}\u0000${r.model}`, r)
    }
    routes = [...unique.values()]
  }
  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(routes === undefined ? {} : { routes }),
  }
}

type AttemptState =
  | { kind: 'idle' }
  | { kind: 'open'; sample: unknown }
  | { kind: 'finishClosed' }
  | { kind: 'settled'; by: 'message' | 'retry' }

/**
 * 每次尝试的（turn, step）坐标；同一步重试（llm/retry-started）是另一次计费
 * 尝试，仍用同一坐标。
 */
interface AttemptCoords {
  turn: number
  step: number
}

function sameAttempt(state: AttemptCoords, turn: number, step: number): boolean {
  return state.turn === turn && state.step === step
}

/**
 * 增量版 deriveTurnTokenUsage：从 turn/start 开始逐事件 fold，turn/end 后
 * result() 给出精确聚合或 undefined（不可证明）。fold 不保留原始事件，只
 * 推进尝试状态机与归一化样本。
 */
export class TurnUsageFold {
  private turn: number | undefined
  private state: AttemptState = { kind: 'idle' }
  private coords: AttemptCoords = { turn: -1, step: -1 }
  private attempts: NormalizedAttempt[] = []
  private sawEnd = false
  private invalid = false

  /** Fold one turn-scoped event (stream order; unknown types are no-ops). */
  fold(event: SessionEventLike): void {
    if (this.invalid) return
    // 官方：turn/end 之后再出现任何事件（同 turn 的残留 step 等）即不可证明。
    if (this.sawEnd) {
      this.invalid = true
      return
    }
    const data = (event.data ?? {}) as Record<string, unknown>
    const rawTurn = data.turn
    const rawStep = data.step
    const foldAttempt = (): AttemptCoords | undefined =>
      isCount(rawTurn) && isCount(rawStep) ? { turn: rawTurn, step: rawStep } : undefined
    const same = (): boolean => this.coords.turn === rawTurn && this.coords.step === rawStep
    const closeOpen = (route: { provider: string; model: string } | undefined): boolean => {
      if (this.state.kind !== 'open') return false
      const normalized = normalizeUsage(this.state.sample, route)
      if (normalized === undefined) return false
      this.attempts.push(normalized)
      return true
    }
    switch (event.type) {
      case 'turn/start': {
        if (this.turn !== undefined || this.state.kind !== 'idle') this.invalid = true
        else if (isCount(rawTurn)) this.turn = rawTurn
        else this.invalid = true
        return
      }
      case 'turn/end': {
        if (this.turn === undefined || rawTurn !== this.turn || this.state.kind !== 'idle' || this.sawEnd) {
          this.invalid = true
        } else {
          this.sawEnd = true
        }
        return
      }
      case 'step/start': {
        const coords = foldAttempt()
        if (coords === undefined || coords.turn !== this.turn || this.state.kind !== 'idle') {
          this.invalid = true
        } else {
          this.coords = coords
          this.state = { kind: 'open', sample: undefined }
        }
        return
      }
      case 'llm/retry-started': {
        const coords = foldAttempt()
        const settledByRetry = this.state.kind === 'settled' && this.state.by === 'retry'
        if (coords === undefined || coords.turn !== this.turn || !settledByRetry || !same()) {
          this.invalid = true
        } else {
          this.state = { kind: 'open', sample: undefined }
        }
        return
      }
      case 'assistant/chunk': {
        const coords = foldAttempt()
        if (coords === undefined || coords.turn !== this.turn || this.state.kind !== 'open' || !same()) {
          this.invalid = true
          return
        }
        const chunk = data.chunk as { type?: unknown; usage?: unknown; reason?: unknown } | undefined
        if (chunk?.type === 'usage') {
          this.state = { kind: 'open', sample: chunk.usage }
        } else if (chunk?.type === 'finish') {
          const reasonKind = (chunk.reason as { kind?: unknown } | undefined)?.kind
          if (reasonKind === 'error' || reasonKind === 'aborted') {
            if (!closeOpen(undefined)) this.invalid = true
            else this.state = { kind: 'finishClosed' }
          }
        }
        return
      }
      case 'assistant/message': {
        const coords = foldAttempt()
        if (coords === undefined || coords.turn !== this.turn || this.state.kind !== 'open' || !same()) {
          this.invalid = true
          return
        }
        const route = messageRoute(data.message)
        if (data.usage !== undefined) this.state = { kind: 'open', sample: data.usage }
        if (!closeOpen(route)) this.invalid = true
        else this.state = { kind: 'settled', by: 'message' }
        return
      }
      case 'llm/retry': {
        const coords = foldAttempt()
        if (coords === undefined || coords.turn !== this.turn || this.state.kind === 'idle' || !same()) {
          this.invalid = true
          return
        }
        if (this.state.kind === 'settled' || (this.state.kind === 'open' && !closeOpen(undefined))) {
          this.invalid = true
          return
        }
        this.state = { kind: 'settled', by: 'retry' }
        return
      }
      case 'step/end': {
        const coords = foldAttempt()
        if (
          coords === undefined ||
          coords.turn !== this.turn ||
          this.state.kind === 'idle' ||
          !same()
        ) {
          this.invalid = true
          return
        }
        if (this.state.kind === 'open' && !closeOpen(undefined)) {
          this.invalid = true
          return
        }
        this.state = { kind: 'idle' }
        return
      }
      default:
        return
    }
  }

  /** Closed-fold aggregate, or undefined when the turn cannot be proven. */
  result(): TurnTokenUsage | undefined {
    return this.invalid || !this.sawEnd || this.state.kind !== 'idle' ? undefined : aggregateAttempts(this.attempts)
  }
}
