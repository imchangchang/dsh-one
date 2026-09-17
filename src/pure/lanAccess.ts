/**
 * 局域网访问（backlog：statusbar-lan-access）的纯逻辑：局域网地址挑选、
 * 带 token 的访问链接拼装、`--trusted-host` 的版本门槛。
 * 不 import vscode / node:os 由调用方传入数据，可直接 `node --test`。
 *
 * 上游约束（为什么不是 dsh 自己监听 0.0.0.0）：dsh-web-app 的启动解析里写明
 * `--host 0.0.0.0 is intentionally not supported yet for safety: it would
 * expose remote code execution to the network`——所以 dsh 永远只听 127.0.0.1，
 * 局域网可达性由 dsh-one 自己的转发器提供（见 src/server/lanForwarder.ts），
 * 并在 spawn 时追加官方的 `--trusted-host <局域网IP>`（网关的 Host 信任栏，
 * 局域网来的请求不带它会被拒）。
 */
import { gte, parse } from './semver.ts'

/**
 * `--trusted-host` 旗标的最低可用版本 = 0.1.5-rc.1。取证（2026-09-17，从 npm registry
 * 拉 tarball 逐版核对，不靠推断）：
 * - `@deepseek-ai/dsh-web-app` 的 `lib/startup.js` 里 `--trusted-host` 旗标在
 *   0.1.3-alpha.2 / 0.1.5-rc.1 / 0.1.5-rc.2 / 0.1.6-alpha.1 都存在，
 *   `cordis.patch.yml` 也都有 `trustedHosts` 接线；
 * - `@deepseek-ai/dsh-client-connection` 的栅栏 `isTrustedAuthority`
 *   （0.1.5-rc.1 `lib/index.js:188-194`）语义与 0.1.6-alpha.1 一致：**不带端口的
 *   条目按主机名匹配任意端口**（源码注释原文「port-less `host` matching any port」）
 *   ——这正是端口回退（findFreePort 换端口）时还能连通的依据。
 * 更低版本（0.1.2-rc.1 等）没有该旗标，传了会让 spawn 直接失败，所以必须有门槛。
 */
export const TRUSTED_HOST_MIN_VERSION = '0.1.5-rc.1'

/** 该 dsh 版本是否支持 `--trusted-host`；版本解析不出（unknown）按不支持处理。 */
export function supportsTrustedHost(version: string | undefined): boolean {
  if (!version || version === 'unknown' || !parse(version)) return false
  return gte(version, TRUSTED_HOST_MIN_VERSION)
}

/** 网卡地址的最小形状（兼容 os.networkInterfaces 的 family 字符串/数字两种形态）。 */
export interface InterfaceAddress {
  address: string
  family: string | number
  internal: boolean
}

/** IPv4 私网段：10/8、172.16/12、192.168/16（局域网链接只对同网段设备有意义）。 */
export function isPrivateIPv4(address: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address)
  if (!match) return false
  const [a, b] = [Number(match[1]), Number(match[2])]
  if (a > 255 || b > 255) return false
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/**
 * 挑一个用来拼局域网链接/绑定转发器的 IPv4：
 * 优先私网段（同网段才可达），没有私网段就退回第一个非 internal 的 IPv4，
 * 再没有（纯 IPv6 / 无网络）返回 null——调用方据此提示「无法识别局域网地址」。
 */
export function pickLanIPv4(
  interfaces: Record<string, readonly (InterfaceAddress | undefined)[] | undefined>,
): string | null {
  const all = Object.values(interfaces)
    .flat()
    .filter((info): info is InterfaceAddress => info !== undefined)
  const ipv4 = all.filter((info) => !info.internal && (info.family === 'IPv4' || info.family === 4))
  return ipv4.find((info) => isPrivateIPv4(info.address))?.address ?? ipv4[0]?.address ?? null
}

/** 局域网访问的 origin（不带 token；token 由调用方按 serverAuth 的规则追加）。 */
export function lanOrigin(ip: string, port: number): string {
  return `http://${ip}:${port}`
}

/** 在 origin 上拼带 token 的访问链接（与 serverAuth.browserUrl 同一形状）。 */
export function tokenizedUrl(origin: string, token: string): string {
  return `${origin}/?token=${encodeURIComponent(token)}`
}
