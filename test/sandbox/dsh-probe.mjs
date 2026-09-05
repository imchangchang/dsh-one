// 沙盒断连场景：容器内 dsh 健康探测（POST /api/host.describe + rpcId 回显校验，
// 与扩展 src/pure/envelope.ts 同款判定）。等待重拉后的 dsh 就绪 / cleanup 判断
// 用——占位器（dsh-port-holder.mjs）同样能通过这个探测，所以调用方必须保证
// 探测时占位器已停。
// 用法：node dsh-probe.mjs <label> <port> <timeoutMs>
import http from 'node:http'

const label = process.argv[2] ?? 'probe'
const port = Number(process.argv[3])
const timeoutMs = Number(process.argv[4] ?? 30000)
if (!Number.isInteger(port) || port <= 0 || !Number.isFinite(timeoutMs)) {
  console.error('usage: node dsh-probe.mjs <label> <port> <timeoutMs>')
  process.exit(2)
}
const rpcId = `${label}-${Date.now()}`

const tryOnce = () =>
  new Promise((resolve) => {
    const body = JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} })
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/host.describe',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeout: 2000,
      },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => {
          let ok = false
          try {
            ok = JSON.parse(text).rpcId === rpcId
          } catch {
            // 非 dsh 响应：不算就绪
          }
          resolve(ok)
        })
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end(body)
  })

const deadline = Date.now() + timeoutMs
for (;;) {
  if (await tryOnce()) {
    console.log('ready')
    process.exit(0)
  }
  if (Date.now() >= deadline) {
    console.error(`${label}: dsh not ready in ${timeoutMs}ms on port ${port}`)
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 250))
}
