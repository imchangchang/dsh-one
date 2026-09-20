import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  TRUSTED_HOST_MIN_VERSION,
  isPrivateIPv4,
  lanOrigin,
  pickLanIPv4,
  supportsTrustedHost,
  tokenizedUrl,
  type InterfaceAddress,
} from '../src/pure/lanAccess.ts'

const addr = (address: string, family: string | number = 'IPv4', internal = false): InterfaceAddress => ({
  address,
  family,
  internal,
})

test('pickLanIPv4：优先私网段 IPv4，跳过 loopback 与 IPv6', () => {
  const interfaces = {
    lo0: [addr('127.0.0.1', 'IPv4', true), addr('::1', 'IPv6', true)],
    en0: [addr('fe80::1', 'IPv6'), addr('192.168.1.23', 'IPv4')],
  }
  assert.equal(pickLanIPv4(interfaces), '192.168.1.23')
})

test('pickLanIPv4：多个私网段取第一个；10/8 与 172.16/12 也算私网', () => {
  assert.equal(
    pickLanIPv4({ en0: [addr('10.0.0.5')], en1: [addr('192.168.0.2')] }),
    '10.0.0.5',
  )
  assert.equal(pickLanIPv4({ en0: [addr('172.16.3.9')] }), '172.16.3.9')
  // 172 无论如何不能落到 172.32+（那已是公网段）。
  assert.equal(pickLanIPv4({ en0: [addr('172.32.0.9')] }), '172.32.0.9')
})

test('pickLanIPv4：没有私网段退回第一个非 internal IPv4；全无则 null', () => {
  assert.equal(pickLanIPv4({ en0: [addr('203.0.113.7')] }), '203.0.113.7')
  assert.equal(pickLanIPv4({ lo0: [addr('127.0.0.1', 'IPv4', true)] }), null)
  assert.equal(pickLanIPv4({ en0: [addr('fe80::1', 'IPv6')] }), null)
})

test('isPrivateIPv4：段边界与非法输入', () => {
  assert.equal(isPrivateIPv4('10.255.0.1'), true)
  assert.equal(isPrivateIPv4('172.15.0.1'), false)
  assert.equal(isPrivateIPv4('172.16.0.1'), true)
  assert.equal(isPrivateIPv4('172.31.255.255'), true)
  assert.equal(isPrivateIPv4('192.168.0.0'), true)
  assert.equal(isPrivateIPv4('192.169.0.1'), false)
  assert.equal(isPrivateIPv4('not-an-ip'), false)
  assert.equal(isPrivateIPv4('999.1.1.1'), false)
})

test('supportsTrustedHost：门槛 0.1.5-rc.1（取证见 pure/lanAccess.ts 注释）', () => {
  // 门槛两侧：0.1.5-rc.1 及以上支持；0.1.5-alpha.1 及以下不支持（旧版没有该旗标，
  // 传了会让 spawn 直接失败）。
  assert.equal(supportsTrustedHost('0.1.5-rc.1'), true)
  assert.equal(supportsTrustedHost('0.1.5-rc.2'), true)
  assert.equal(supportsTrustedHost('0.1.6-alpha.1'), true)
  assert.equal(supportsTrustedHost('0.1.6'), true)
  assert.equal(supportsTrustedHost('0.1.5-alpha.2'), false)
  assert.equal(supportsTrustedHost('0.1.2-rc.1'), false)
  // 版本解析不出（unknown / 空）按不支持处理——不许拿未知版本去赌旗标存在。
  assert.equal(supportsTrustedHost('unknown'), false)
  assert.equal(supportsTrustedHost(undefined), false)
  assert.equal(supportsTrustedHost(''), false)
})

test('链接拼装：origin 与带 token 的形状和 browserUrl 一致', () => {
  assert.equal(lanOrigin('192.168.1.23', 3080), 'http://192.168.1.23:3080')
  assert.equal(
    tokenizedUrl('http://192.168.1.23:3080', 'abc/123='),
    'http://192.168.1.23:3080/?token=abc%2F123%3D',
  )
})

/**
 * #217：`--trusted-host` 的门槛曾经在 `src/server/manager.ts` 里被写死成
 * `'0.1.6-alpha.1'`（判定 + 日志 + 警告文案三处），与 `pure/lanAccess.ts` 的
 * 真实门槛常量分叉——结果是支持区间内的 0.1.5-rc.1 / rc.2 被误判成「版本太旧」。
 *
 * 门槛这种东西实验室里照不出来（要拿真网关跑老版本 dsh），所以判据是源码级静态扫描：
 * 局域网访问那一段必须读常量、不许再出现版本号字面量。查的是 `manager.ts`
 * （判定所在）与两份 nls（文案所在），负向对照见文件末尾的说明。
 */
const ROOT = path.join(import.meta.dirname, '..')

/** manager.ts 里负责 `--trusted-host` 的那一段：从注释标记到 lanIp 定稿。 */
const LAN_BLOCK = ((): string => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'server', 'manager.ts'), 'utf8')
  const start = source.indexOf('// 局域网访问（backlog statusbar-lan-access）')
  const end = source.indexOf('this.currentLanIp = lanIp', start)
  assert.ok(start >= 0 && end > start, '定位不到 manager.ts 的局域网访问段（注释标记或 currentLanIp 变了）')
  return source.slice(start, end)
})()

test('manager 的 --trusted-host 门槛读常量，不写死版本号（#217）', () => {
  // 判定、日志、警告文案共用同一个来源。负向对照：把 `'0.1.6-alpha.1'`（或任何
  // 带引号的版本号字面量）写回这一段，下面两条断言必红。
  assert.match(LAN_BLOCK, /supportsTrustedHost\(dsh\.version\)/)
  assert.ok(
    LAN_BLOCK.includes('TRUSTED_HOST_MIN_VERSION'),
    '局域网访问段没有引用 TRUSTED_HOST_MIN_VERSION',
  )
  assert.doesNotMatch(LAN_BLOCK, /['"`]\d+\.\d+\.\d+/, '局域网访问段出现了写死的版本号字面量')
})

test('配置项文案里写的门槛与 TRUSTED_HOST_MIN_VERSION 一致（#217）', () => {
  // 负向对照：把常量改回旧值（如 '0.1.6-alpha.1'），这份 description 没跟着改 → 红。
  for (const file of ['package.nls.json', 'package.nls.zh-cn.json']) {
    const nls = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as Record<string, unknown>
    const desc = nls['dshOne.lanAccess.description']
    assert.equal(typeof desc, 'string', `${file} 缺 dshOne.lanAccess.description`)
    assert.ok(
      (desc as string).includes(TRUSTED_HOST_MIN_VERSION),
      `${file} 写的门槛与常量 ${TRUSTED_HOST_MIN_VERSION} 不一致`,
    )
  }
})
