/**
 * 实验室「起不来」这条路径的单测（#88）。
 *
 * 浏览器验证的入口（`test/assembly-lab/verify.ts`）在实验室端口被占时必须
 * **立刻**说清「是谁占的」再退出，而不是静默挂住——#88 里浪费掉的那十几分钟
 * 就出在这里。这里只测能离线测的两段：找占用者、拼人话报错。整条退出路径
 * （自行退出、退出码、不留孤儿）由 `npm run verify:lab` 实测覆盖，见该目录
 * README 的「收尾与退出码」。
 *
 * Windows（#235 的定性结论）：原来的 `portHolder` 只用 `lsof` + `ps`，这两个命令
 * Windows 上没有，所以这条诊断在 windows-latest 上**真的不工作**（不是测试环境
 * 差异）——CI 上看到的就是「占用者：查不到是谁」。修法是产品侧按平台分派：
 * Windows 走 `netstat -ano` + `tasklist`（`test/assembly-lab/portHolderWindows.ts`）。
 * 上面两条用例在 CI 的 windows-latest 上真跑一遍这条分支；下面是它对 netstat 输出的
 * 解析（纯函数，样本在本机也测得到）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import { describeListenFailure, portHolder } from './assembly-lab/labServer.ts'
import { parseWindowsListeners } from './assembly-lab/portHolderWindows.ts'

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

/**
 * Windows 的 `netstat -ano` 样本（IPv4/IPv6、同名端口的不同进程、同端口的
 * ESTABLISHED 连接、以及只在前缀上相同的另一个端口）。
 */
const NETSTAT_SAMPLE = `
活动连接

  协议  本地地址          外部地址        状态           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1040
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:50145        0.0.0.0:0              LISTENING       4688
  TCP    [::]:50145             [::]:0                 LISTENING       4321
  TCP    127.0.0.1:5014         0.0.0.0:0              LISTENING       9999
  TCP    127.0.0.1:50145        127.0.0.1:52344        ESTABLISHED     4688
`

test('parseWindowsListeners：只认监听该端口的行，前缀相同的端口不算', () => {
  assert.deepEqual(parseWindowsListeners(NETSTAT_SAMPLE, 50145), ['4688', '4321'])
  // 5014 与 50145 只在数字前缀上相同：比整行找端口号会把它们认混
  assert.deepEqual(parseWindowsListeners(NETSTAT_SAMPLE, 5014), ['9999'])
  // 没人监听这个端口时返回空数组（调用方据此报「查不到是谁」）
  assert.deepEqual(parseWindowsListeners(NETSTAT_SAMPLE, 50146), [])
})
