/**
 * 「取网关上的一条内容交给用户」与「把一段内容落盘」两项宿主能力的**纯逻辑**
 * （#84）：不含 `vscode` import，宿主侧（hostBridge）注入 VS Code 的三件套
 * （取内容 / 选位置 / 写盘）后调用，所以能在单测里用假件跑完整流程。
 *
 * 为什么不放在 hostBridge 里：那个文件 import 了 `vscode`，单测里进不来——
 * 而这条路径正是「会话导出」在 VS Code 侧的落地，安全与取消语义必须被测到。
 *
 * 安全边界（两条，都在这里）：
 * 1. 取数目标必须是**本站绝对路径**（`parseDownloadArgs` 校核），且拼出来的 URL
 *    源必须与网关源一致（这里再复核一次，防协议相对 URL 之类的手法跳源）；
 * 2. 写盘目标由**用户选择**（宿主弹框），页面给的建议文件名只定默认名，不决定路径。
 */
import { parseDownloadArgs, parseSaveFileArgs, type DownloadArgs, type HostCapabilityError, type SaveFileArgs } from './hostCapabilities.ts'
import { isHostCallError } from './hostCallError.ts'

/** 两项能力的宿主侧依赖（hostBridge 给 VS Code 实现，测试给假件）。 */
export interface DownloadDeps {
  /** 网关源（loopback mirror 的 origin）；取不到时返回 unsupported。 */
  gatewayOrigin?: () => string | undefined
  /** 取内容（缺省全局 fetch）。 */
  fetchImpl?: (url: string, init: { method: string }) => Promise<Response>
  /** 选保存位置；返回 null = 用户取消（缺省由 hostBridge 弹 VS Code 保存框）。 */
  chooseSavePath: (suggestedName: string) => Promise<string | null>
  /** 落盘。 */
  writeBytes: (target: string, data: Uint8Array) => Promise<void>
}

/**
 * 取网关内容并保存到用户选的位置。
 * @param args - `{ path, suggestedName }`（页面来的外部输入，这里先校核）。
 * @param deps - 宿主侧三件套。
 * @returns 落盘路径；失败返回结构化错误（用户取消是 `cancelled`，不是失败）。
 */
export async function performGatewayDownload(
  args: unknown,
  deps: DownloadDeps,
): Promise<{ path: string } | HostCapabilityError> {
  const parsed = parseDownloadArgs(args)
  if (isHostCallError(parsed)) return parsed
  const origin = deps.gatewayOrigin?.()
  if (origin === undefined || origin === '') {
    return { code: 'unsupported', message: 'the dsh gateway is not reachable from this window' }
  }
  let url: URL
  try {
    url = new URL(parsed.path, origin)
  } catch {
    return { code: 'invalid-args', message: 'the download path is not a valid URL path' }
  }
  if (url.origin !== new URL(origin).origin) {
    return { code: 'invalid-args', message: 'the download path must stay on the connected gateway' }
  }
  const doFetch = deps.fetchImpl ?? ((input: string, init: { method: string }) => fetch(input, init))
  let response: Response
  try {
    response = await doFetch(url.href, { method: 'GET' })
  } catch (err) {
    return { code: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
  if (!response.ok) return { code: 'not-found', message: `HTTP ${response.status} while fetching ${url.pathname}` }
  const target = await deps.chooseSavePath(parsed.suggestedName)
  if (target === null) return { code: 'cancelled', message: 'the user cancelled the save dialog' }
  try {
    await deps.writeBytes(target, new Uint8Array(await response.arrayBuffer()))
  } catch (err) {
    return { code: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
  return { path: target }
}

/** 把页面给的 base64 内容保存到用户选的位置。 */
export async function performSaveContent(
  args: unknown,
  deps: Pick<DownloadDeps, 'chooseSavePath' | 'writeBytes'>,
): Promise<{ path: string } | HostCapabilityError> {
  const parsed = parseSaveFileArgs(args)
  if (isHostCallError(parsed)) return parsed
  const target = await deps.chooseSavePath(parsed.suggestedName)
  if (target === null) return { code: 'cancelled', message: 'the user cancelled the save dialog' }
  try {
    await deps.writeBytes(target, new Uint8Array(Buffer.from(parsed.base64, 'base64')))
  } catch (err) {
    return { code: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
  return { path: target }
}

/** 导出参数齐全时用这个类型（避免调用方各自再拆一遍）。 */
export type { DownloadArgs, SaveFileArgs }
