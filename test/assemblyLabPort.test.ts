/**
 * 实验室「起不来」这条路径的单测（#88）。
 *
 * 浏览器验证的入口（`test/assembly-lab/verify.ts`）在实验室端口被占时必须
 * **立刻**说清「是谁占的」再退出，而不是静默挂住——#88 里浪费掉的那十几分钟
 * 就出在这里。这里只测能离线测的两段：找占用者、拼人话报错。整条退出路径
 * （自行退出、退出码、不留孤儿）由 `npm run verify:lab` 实测覆盖，见该目录
 * README 的「收尾与退出码」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import { describeListenFailure, portHolder } from './assembly-lab/labServer.ts'

/** 起一个只跑在本机的监听服务器，返回它占的端口与关闭函数。 */
async function listenOnFreePort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => res.end('x'))
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address !== 'object') {
        reject(new Error('no loopback address'))
        return
      }
      resolve(address.port)
    })
  })
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

test('portHolder：端口被占时报出占用进程的 pid 与命令行', async () => {
  const { port, close } = await listenOnFreePort()
  try {
    const holder = portHolder(port)
    assert.ok(holder !== undefined, '占用中的端口应查到占用者')
    assert.match(holder, new RegExp(`pid ${String(process.pid)}`))
  } finally {
    await close()
  }
})

test('portHolder：端口空闲时返回 undefined（查不到不是错误）', async () => {
  const { port, close } = await listenOnFreePort()
  await close()
  assert.equal(portHolder(port), undefined)
})

test('describeListenFailure：EADDRINUSE 报出端口、占用者与换端口提示', async () => {
  const { port, close } = await listenOnFreePort()
  try {
    const err = Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${String(port)}`), {
      code: 'EADDRINUSE',
    })
    const described = describeListenFailure(err, port)
    assert.match(described.message, new RegExp(`端口 ${String(port)} 已被占用`))
    assert.match(described.message, new RegExp(`pid ${String(process.pid)}`))
    assert.match(described.message, /LAB_PORT=/)
  } finally {
    await close()
  }
})

test('describeListenFailure：非 EADDRINUSE 的错误原样返回（不添油加醋）', () => {
  const err = new Error('lab: no launch token')
  assert.equal(describeListenFailure(err, 3179), err)
})
