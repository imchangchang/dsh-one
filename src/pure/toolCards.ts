/**
 * skill / cordis 专用工具卡的派生模型（对齐官方 dsh-client-ui-skill 的
 * SkillRow 与 dsh-client-ui-cordis 的 cordisDefineCard/cordisRunCard/
 * cordisActionCard）。纯逻辑，无 vscode 依赖，node --test 可测。
 *
 * 数据全部来自折叠后的 ChatToolBlock：args（tool/call 的 arguments 原始
 * JSON）、output（tool/result 的文本）、meta（tool/result 的 meta 原样透传，
 * cordis 的 pluginId/packageId 在这里）。dsh web 端这两类卡的运行时状态
 * （inventory 插件清单、client-loaded、run 业务视图）依赖 cordis 面板数据
 * 链路，dsh-one 没有——本模型只投影卡自身冻结的调用切片，状态 readout 与
 * 业务视图一律不做（静态版）。
 */
import type { ChatToolBlock } from './chatContract.ts'

/** 卡生命周期状态（dsh-one 的 status 三态映射，无 web 的 stopped 细分）。 */
export type ToolCardState = 'running' | 'ok' | 'error'

/** 首行（折叠态错误摘要 / args 退化的展示用）。 */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function parseArgs(argsRaw: string | undefined): Record<string, unknown> | null {
  if (!argsRaw || !argsRaw.trim()) return null
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function stringAt(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function objectAt(source: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = source?.[key]
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** 错误且带输出时的折叠态摘要（输出首行）；其余状态 null。 */
function errorSummaryOf(state: ToolCardState, output: string | null): string | null {
  return state === 'error' && output !== null ? firstLine(output) : null
}

/** tool/result 的 meta 收窄为对象（非对象/缺省 → null）。 */
function metaObject(meta: unknown): Record<string, unknown> | null {
  return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : null
}

function stateOf(status: ChatToolBlock['status']): ToolCardState {
  return status === 'running' ? 'running' : status === 'error' ? 'error' : 'ok'
}

/**
 * skill 卡模型（对齐 web SkillRow）：skill 名从 args 的 `name` 字段解析
 * （非字符串/空 → args 原文首行；无 args → callId），输出 = 指令全文
 * （skill 工具的 result 文本就是指令内容，web 展开区原样展示）。
 */
export interface SkillCardModel {
  name: string
  /** 指令全文；running 或 result 无文本时为 null（此时卡不可展开）。 */
  output: string | null
  errorSummary: string | null
  state: ToolCardState
}

export function skillCardModel(block: Pick<ChatToolBlock, 'args' | 'output' | 'status' | 'callId'>): SkillCardModel {
  const args = parseArgs(block.args)
  const raw = block.args && block.args.trim() ? firstLine(block.args) : block.callId
  const name = stringAt(args, 'name') === null ? raw : firstLine(stringAt(args, 'name') as string)
  const output = block.output && block.output.trim() ? block.output : null
  const state = stateOf(block.status)
  return { name, output, errorSummary: errorSummaryOf(state, output), state }
}

/** cordis_define 卡模型（对齐 web cordisDefineCard）。 */
export interface CordisDefineCardModel {
  pluginId: string | null
  packageId: string | null
  /** args 的 `name`；缺省回退 args 原文首行。 */
  name: string
  /** args 的 `purpose`；缺省 null（UI 显示「(未填写用途)」）。 */
  purpose: string | null
  /** args.code.host / args.code.client，未声明的半边为 null。 */
  hostCode: string | null
  clientCode: string | null
  output: string | null
  errorSummary: string | null
  state: ToolCardState
}

export function cordisDefineCardModel(
  block: Pick<ChatToolBlock, 'args' | 'output' | 'status' | 'meta'>,
): CordisDefineCardModel {
  const args = parseArgs(block.args)
  const code = objectAt(args, 'code')
  const meta = metaObject(block.meta)
  const output = block.output && block.output.trim() ? block.output : null
  const state = stateOf(block.status)
  return {
    pluginId: stringAt(meta, 'pluginId'),
    packageId: stringAt(meta, 'packageId'),
    name: stringAt(args, 'name') ?? (block.args && block.args.trim() ? firstLine(block.args) : ''),
    purpose: stringAt(args, 'purpose'),
    hostCode: stringAt(code, 'host'),
    clientCode: stringAt(code, 'client'),
    output,
    errorSummary: errorSummaryOf(state, output),
    state,
  }
}

/** cordis_run 卡模型（对齐 web cordisRunCard 的冻结切片部分）。 */
export interface CordisRunCardModel {
  pluginId: string | null
  packageId: string | null
  pluginRunId: string | null
  /** args 的 `mode`（run/update），其它值/null 时 UI 按 run 处理。 */
  mode: 'run' | 'update' | null
  output: string | null
  errorSummary: string | null
  state: ToolCardState
}

export function cordisRunCardModel(
  block: Pick<ChatToolBlock, 'args' | 'output' | 'status' | 'meta'>,
): CordisRunCardModel {
  const args = parseArgs(block.args)
  const meta = metaObject(block.meta)
  const argsPluginId = stringAt(args, 'pluginId')
  const argsPackageId = stringAt(args, 'packageId')
  const rawMode = stringAt(args, 'mode')
  const output = block.output && block.output.trim() ? block.output : null
  const state = stateOf(block.status)
  return {
    pluginId: meta === null ? argsPluginId : stringAt(meta, 'pluginId') ?? argsPluginId,
    packageId: meta === null ? argsPackageId : stringAt(meta, 'packageId') ?? argsPackageId,
    pluginRunId: meta === null ? null : stringAt(meta, 'pluginRunId'),
    mode: rawMode === 'run' || rawMode === 'update' ? rawMode : null,
    output,
    errorSummary: errorSummaryOf(state, output),
    state,
  }
}

/** cordis_stop / cordis_undefine 卡模型（对齐 web cordisActionCard）。 */
export interface CordisActionCardModel {
  pluginId: string | null
  output: string | null
  errorSummary: string | null
  state: ToolCardState
}

export function cordisActionCardModel(
  block: Pick<ChatToolBlock, 'args' | 'output' | 'status'>,
): CordisActionCardModel {
  const args = parseArgs(block.args)
  const output = block.output && block.output.trim() ? block.output : null
  const state = stateOf(block.status)
  return {
    pluginId: stringAt(args, 'pluginId') ?? stringAt(args, 'id'),
    output,
    errorSummary: errorSummaryOf(state, output),
    state,
  }
}
