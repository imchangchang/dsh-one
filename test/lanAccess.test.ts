import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
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

test('supportsTrustedHost：0.1.6-alpha.1 起，unknown / 旧版 / 乱串都不支持', () => {
  assert.equal(supportsTrustedHost('0.1.6-alpha.1'), true)
  assert.equal(supportsTrustedHost('0.1.6'), true)
  assert.equal(supportsTrustedHost('0.1.5-rc.2'), false)
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
