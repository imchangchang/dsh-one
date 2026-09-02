/**
 * 模型→上下文窗口学习映射（src/server/chatSession.ts `MODEL_CONTEXT_WINDOW`）
 * 的持久化格式。纯函数，无 vscode 依赖，node --test 可测。
 *
 * 背景：学习映射只从「会话历史尾部窗口的事件扫描 + 本进程实时流」学习，扩展
 * 进程重启（或重开长会话）后即为空——切回此前用过的模型也会进「窗口未知」
 * 占位。持久化到 globalState 后，观察过一次的窗口跨进程/跨会话/跨服务重启
 * 都可用，切回时映射必命中、立即恢复比例。
 *
 * 存储为 `Record<provider/model, contextWindow>`；解析时过滤畸形条目
 * （窗口非有限正数），不让脏数据污染映射；坏数据按空映射处理——缓存本就是
 * 尽力而为，坏了丢一次学习即可，不影响主流程。
 */

/** 把学习映射序列化为可存进 globalState 的 JSON 记录。 */
export function modelWindowRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(map)
}

/** 解析存储记录为映射；畸形条目跳过，非对象输入返回空映射。 */
export function parseModelWindowRecord(value: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return map
  for (const [key, contextWindow] of Object.entries(value as Record<string, unknown>)) {
    if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) continue
    map.set(key, contextWindow)
  }
  return map
}
