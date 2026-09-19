import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as net from 'node:net'
import { LanForwarder } from '../src/server/lanForwarder.ts'
import type { Logger } from '../src/log.ts'

/** 哑日志：LanForwarder 只用到 info/warn。 */
const logger = { info: () => {}, warn: () => {} } as unknown as Logger

/** 回显上游服务（扮演 127.0.0.1 上的 dsh 网关），统一留引用供测试收尾。 */
const servers: net.Server[] = []
async function listenEchoKeep(): Promise<number> {
  const server = net.createServer((socket) => socket.pipe(socket))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as net.AddressInfo).port
}

/** 在 <host>:<port> 上连一次、发 payload、收回应答（带超时）。 */
function roundTrip(host: string, port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('round trip timeout'))
    }, 3_000)
    let received = ''
    socket.on('connect', () => socket.write(payload))
    socket.on('data', (chunk) => {
      received += String(chunk)
      if (received.includes(payload)) {
        clearTimeout(timer)
        socket.destroy()
        resolve(received)
      }
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * 拿一个空闲端口（macOS 的 loopback 只有 127.0.0.1，测试用不同端口隔离）。
 * 探完立即释放——占着不关，转发器就没法绑这个端口了。
 */
async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

test('LanForwarder：绑一个地址透传到本机上游，stop 后不再可达', async (t) => {
  const upstreamPort = await listenEchoKeep()
  const forwarderPort = await freePort()
  const forwarder = new LanForwarder(logger)
  t.after(() => {
    forwarder.stop()
    for (const server of servers) server.close()
  })

  // 上游直连可达（基线）。
  assert.equal(await roundTrip('127.0.0.1', upstreamPort, 'ping'), 'ping')

  // 转发器绑到另一个端口，透传到上游：内容原样过线（生产里这里绑局域网 IPv4）。
  await forwarder.start('127.0.0.1', forwarderPort, upstreamPort)
  assert.equal(forwarder.isActive, true)
  assert.equal(forwarder.boundIp, '127.0.0.1')
  assert.equal(await roundTrip('127.0.0.1', forwarderPort, 'hello-lan'), 'hello-lan')

  // stop 之后转发端口不再可达（连接被拒）。
  forwarder.stop()
  assert.equal(forwarder.isActive, false)
  await assert.rejects(() => roundTrip('127.0.0.1', forwarderPort, 'nope'))
})

test('LanForwarder：重复 start 先停旧的；绑定失败即不在监听态', async (t) => {
  const upstreamPort = await listenEchoKeep()
  const forwarder = new LanForwarder(logger)
  const portA = await freePort()
  const portB = await freePort()
  t.after(() => {
    forwarder.stop()
    for (const server of servers) server.close()
  })

  await forwarder.start('127.0.0.1', portA, upstreamPort)
  // 换端口重启（生产里对应 IP/端口变化）：旧监听撤掉、新监听生效。
  await forwarder.start('127.0.0.1', portB, upstreamPort)
  assert.equal(forwarder.boundIp, '127.0.0.1')
  assert.equal(await roundTrip('127.0.0.1', portB, 'again'), 'again')
  await assert.rejects(() => roundTrip('127.0.0.1', portA, 'stale'))

  // 用一个 blocker 占住 portA 之后再 start 到 portA：应报 EADDRINUSE，
  // 且 start 失败即转发器不在监听态（连 portB 也已撤），调用方据此提示。
  const blocker = net.createServer()
  servers.push(blocker)
  await new Promise<void>((resolve) => blocker.listen(portA, '127.0.0.1', resolve))
  await assert.rejects(() => forwarder.start('127.0.0.1', portA, upstreamPort))
  assert.equal(forwarder.isActive, false)
})

test('LanForwarder：绑定失败后重试能成功（对端退出后接管）', async (t) => {
  const upstreamPort = await listenEchoKeep()
  const forwarderPort = await freePort()
  const forwarder = new LanForwarder(logger)
  t.after(() => {
    forwarder.stop()
    for (const server of servers) server.close()
  })

  // 先让别的进程占住该端口（模拟另一个窗口已在这个地址上转发）。
  const blocker = net.createServer()
  servers.push(blocker)
  await new Promise<void>((resolve) => blocker.listen(forwarderPort, '127.0.0.1', resolve))
  await assert.rejects(() => forwarder.start('127.0.0.1', forwarderPort, upstreamPort))
  assert.equal(forwarder.isActive, false)

  // 「对端窗口退出」后重试：应当接管成功、透传恢复。
  await new Promise<void>((resolve) => blocker.close(() => resolve()))
  await forwarder.start('127.0.0.1', forwarderPort, upstreamPort)
  assert.equal(forwarder.isActive, true)
  assert.equal(await roundTrip('127.0.0.1', forwarderPort, 'taken-over'), 'taken-over')
})

test('LanForwarder：并发 start 只监听一次（in-flight 复用）', async (t) => {
  const upstreamPort = await listenEchoKeep()
  const forwarderPort = await freePort()
  const forwarder = new LanForwarder(logger)
  t.after(() => {
    forwarder.stop()
    for (const server of servers) server.close()
  })

  await Promise.all([
    forwarder.start('127.0.0.1', forwarderPort, upstreamPort),
    forwarder.start('127.0.0.1', forwarderPort, upstreamPort),
  ])
  assert.equal(forwarder.isActive, true)
  assert.equal(await roundTrip('127.0.0.1', forwarderPort, 'once'), 'once')
})

test('LanForwarder：stop 会断开已建立的连接', async (t) => {
  const upstreamPort = await listenEchoKeep()
  const forwarderPort = await freePort()
  const forwarder = new LanForwarder(logger)
  t.after(() => {
    forwarder.stop()
    for (const server of servers) server.close()
  })

  await forwarder.start('127.0.0.1', forwarderPort, upstreamPort)
  // 建一条长连接（连上后不发完就不关），stop 后它应被断开。
  const socket = net.connect({ host: '127.0.0.1', port: forwarderPort })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('error', reject)
  })
  const closed = new Promise<boolean>((resolve) => socket.once('close', () => resolve(true)))
  forwarder.stop()
  const timedOut = await Promise.race([
    closed,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  socket.destroy()
  assert.equal(timedOut, true, 'stop 之后已建立连接应被断开')
})
