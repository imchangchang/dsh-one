/**
 * 插件持久状态的**宿主侧实现**（#82）：`state.read` / `state.write` / `state.delete`
 * 三个调用名的落地逻辑。
 *
 * 单一实现、单一数据家：本模块直接用宿主半包里的 `stateStore`
 * （`packages/dsh-host-capabilities/src/`）——官方 web 侧的宿主半调的就是同一组函数，
 * 所以两个 shell（VS Code / 官方 web）读写的是同一份文件 `~/.dsh/dsh-one/<键>.json`、
 * 走同一套原子写。AGENTS.md 铁律「插件状态按官方惯例存储」要的是这个结果：**同一份
 * 用户数据不许有第二个家**；VS Code 侧之所以由扩展宿主代行（而不是把调用转发给
 * 网关上的宿主半），是因为宿主半还没进 VS Code 用的那个 profile（#84 的已知遗留①），
 * 转发会在没装它的实例上 404、插件状态当场失效。宿主半随扩展分发落地后，这条
 * 代行可以退化成纯转发，插件侧一行都不用改。
 *
 * 放在 `src/pure/`（而不是 hostBridge.ts 里）的理由：hostBridge 依赖 `vscode`
 * 模块、在 node 测试里跑不起来，而这三个调用的校核与错误口径恰恰是最该被单测盯住的
 * 部分（键的形状是唯一的路径穿越闸门）。本模块不碰 vscode，可在 node 里直接测。
 */
import { parseStateKey, parseStateValue, type HostCapabilityError } from './hostCapabilities.ts'
import { deleteState, readState, writeState } from '../../packages/dsh-host-capabilities/src/stateStore.ts'

/** 状态三件套的调用名（与 `HOST_CALLS` 白名单里的名字一致）。 */
export type HostStateCall = 'state.read' | 'state.write' | 'state.delete'

/** 回执载荷：读给 `value`，删给 `deleted`，写给空对象。 */
export interface HostStateResult {
  value?: unknown
  deleted?: boolean
}

/**
 * 执行一次状态调用。参数是**页面送来的不可信输入**：键先过 `parseStateKey`
 * （只允许 `[a-z0-9._-]`，禁 `..`——它直接决定文件名），值先过 `parseStateValue`
 * （必须能过 JSON 往返）。
 *
 * @param call - 三件套之一。
 * @param args - 页面送来的参数（`{ key }` 或 `{ key, value }`）。
 * @param home - dsh 家目录（`~/.dsh`；测试注入临时目录）。
 * @returns 成功给载荷，失败给结构化错误（不抛——见 hostBridge 的统一收口）。
 */
export async function runStateCall(
  call: HostStateCall,
  args: unknown,
  home: string,
): Promise<HostStateResult | HostCapabilityError> {
  if (typeof args !== 'object' || args === null) {
    return { code: 'invalid-args', message: 'expected an object argument' }
  }
  const record = args as Record<string, unknown>
  const key = parseStateKey(record.key)
  if (typeof key !== 'string') return key
  try {
    if (call === 'state.read') return { value: await readState(key, home) }
    if (call === 'state.delete') return { deleted: await deleteState(key, home) }
    const serialized = parseStateValue(record.value)
    if (typeof serialized !== 'string') return serialized
    await writeState(key, serialized, home)
    return {}
  } catch (err) {
    return { code: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}
