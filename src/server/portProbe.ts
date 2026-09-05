import * as crypto from 'node:crypto'
import { makeDescribeRequest, validateDescribeResponse } from '../pure/envelope.ts'
import type { Logger } from '../log.ts'

/**
 * 端口身份探测（modeled on dsh-vscode's probeService）：POST /api/host.describe
 * 并验证 rpcId 回显。0.1.2 认证起，认证 dsh 对无凭证的 RPC 回
 * 401 + 正文 `unauthorized`（网关认证层先于路由——实测 0.1.2-rc.1 即此响应），
 * 作为「认证 dsh 无凭证」的指纹单独返回（见 external-dsh-manage-012）。
 *
 * 不 import vscode，便于 node --test 直接单测（stub fetch）。
 */

const PROBE_TIMEOUT_MS = 3_000

export { PROBE_TIMEOUT_MS }

/**
 * 端口探测四态：
 * - 'dsh'：端口说 dsh Gateway RPC（host.describe 回 rpcId echo）——安全 adopt；
 * - 'authDsh'：401 + `unauthorized` 指纹——认证 dsh、无凭证（外部启动或记录失效）；
 * - 'foreign'：有 HTTP 应答但校验失败——被别的程序占用；
 * - 'down'：无应答——可以 spawn。
 */
export type PortProbe = 'dsh' | 'authDsh' | 'foreign' | 'down'

export async function probePort(port: number, logger: Logger): Promise<PortProbe> {
  const rpcId = crypto.randomUUID()
  const url = `http://127.0.0.1:${port}/api/host.describe`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeDescribeRequest(rpcId)),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = await res.text()
    if (res.ok && validateDescribeResponse(text, rpcId)) {
      logger.info(`probe: ${url} answered host.describe (rpcId echoed)`)
      return 'dsh'
    }
    if (res.status === 401 && text.includes('unauthorized')) {
      logger.info(`probe: ${url} answered 401 with the dsh auth fingerprint (authenticated dsh without credentials)`)
      return 'authDsh'
    }
    logger.info(`probe: ${url} responded but failed rpcId validation (foreign service)`)
    return 'foreign'
  } catch {
    logger.info(`probe: ${url} no response (down)`)
    return 'down'
  }
}

/** POST /api/host.describe 并仅在端口是「无认证 dsh」时返回 base URL。 */
export async function probeDsh(port: number, logger: Logger): Promise<string | null> {
  return (await probePort(port, logger)) === 'dsh' ? `http://127.0.0.1:${port}` : null
}
