/**
 * `src/pure/dshWire.ts`（#37 的单一事实源）的单测。
 *
 * 这份模块存在的理由就是「协议知识不能有两份拷贝」：运行时
 * （`src/server/dshRpc.ts` 的 `executeCommand`）与上游探针
 * （`scripts/dsh-upstream-watch/probe.mjs`）import 的是同一个函数。所以这里同时钉两件事：
 *
 * 1. 分叉边界本身（0.1.2 及以前 `images`、0.1.3 起 `submittedAttachments`；
 *    版本未知/解析不出来时保守走老路径）；
 * 2. `serverAuth.is013Wire(origin)`（按 origin 取版本号的那层）与纯函数判定**一致**
 *    ——两处判定一旦分家，就会重新长出「探针与运行时各说各话」的老问题。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { commandsExecuteArgs, is013WireVersion } from '../src/pure/dshWire.ts'
import { is013Wire, registerVersion, clearVersion, dshVersion } from '../src/server/serverAuth.ts'

test('is013WireVersion：0.1.3 是分叉点，含 prerelease 与之后的版本', () => {
  assert.equal(is013WireVersion('0.1.2'), false)
  assert.equal(is013WireVersion('0.1.2-rc.1'), false)
  assert.equal(is013WireVersion('0.1.1'), false)
  assert.equal(is013WireVersion('0.1.3'), true)
  assert.equal(is013WireVersion('0.1.3-alpha.1'), true)
  assert.equal(is013WireVersion('0.1.6-alpha.1'), true)
  assert.equal(is013WireVersion('1.0.0'), true)
})

test('is013WireVersion：版本未知或解析不出来时保守走老路径', () => {
  assert.equal(is013WireVersion(undefined), false)
  assert.equal(is013WireVersion(''), false)
  assert.equal(is013WireVersion('not-a-version'), false)
})

test('commandsExecuteArgs：0.1.2 线发 images，0.1.3+ 发 submittedAttachments（带 type: image）', () => {
  const old = commandsExecuteArgs('0.1.2-rc.1', 'sess-1', '/compact', [
    { mediaType: 'image/png', data: 'AAA', name: 'a.png' },
  ])
  assert.deepEqual(old, {
    agentId: 'sess-1',
    line: '/compact',
    images: [{ mediaType: 'image/png', data: 'AAA', name: 'a.png' }],
  })

  const next = commandsExecuteArgs('0.1.3-alpha.1', 'sess-1', '/compact', [
    { mediaType: 'image/png', data: 'AAA', name: 'a.png' },
  ])
  assert.deepEqual(next, {
    agentId: 'sess-1',
    line: '/compact',
    submittedAttachments: [{ type: 'image', mediaType: 'image/png', data: 'AAA', name: 'a.png' }],
  })
})

test('commandsExecuteArgs：两个键不能同时出现（网关 assertExactArguments 拒多余键）', () => {
  for (const version of ['0.1.2-rc.1', '0.1.6-alpha.1']) {
    const keys = Object.keys(commandsExecuteArgs(version, 's', '/x', []))
    assert.deepEqual(keys, ['agentId', 'line', version === '0.1.2-rc.1' ? 'images' : 'submittedAttachments'])
  }
})

test('serverAuth.is013Wire 与纯函数判定一致（同一份知识，不是两份拷贝）', () => {
  const cases: [string, boolean][] = [
    ['0.1.2-rc.1', false],
    ['0.1.3-alpha.1', true],
    ['0.1.6-alpha.1', true],
    ['garbage', false],
  ]
  for (const [version, expected] of cases) {
    registerVersion('http://127.0.0.1:1', version)
    assert.equal(dshVersion('http://127.0.0.1:1'), version)
    assert.equal(is013Wire('http://127.0.0.1:1'), expected, `is013Wire(${version})`)
    assert.equal(is013Wire('http://127.0.0.1:1'), is013WireVersion(version))
    clearVersion('http://127.0.0.1:1')
  }
  // 没注册过版本的 origin（探针/页面侧还没拿到 `dsh --version`）保守走老路径。
  assert.equal(is013Wire('http://127.0.0.1:9'), false)
  assert.equal(is013Wire('http://127.0.0.1:9'), is013WireVersion(undefined))
})
