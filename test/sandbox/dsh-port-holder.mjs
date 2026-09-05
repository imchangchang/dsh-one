// 沙盒断连场景的端口占位器（容器内跑，见 test/sandbox/verify-driver.mjs 的
// reconnect 场景）：dsh 实例被 kill -9 后立刻占住它的端口，把健康探测与 mux
// 连接隔开——
//   - POST /api/host.describe 回 rpcId 回显（与 src/pure/envelope.ts 的
//     validateDescribeResponse 校验形状一致）：扩展 ServerManager 的 10s 健康
//     探测继续通过，manager 不会把服务标记 stopped、不会 detach 全部 controller
//     ——断连横幅的测试窗口不再受「探测最多 10s 后必然 detach」的竞态影响；
//   - 其余请求一律 404、WS upgrade 直接断连：扩展 mux 的每次 attach 立即失败，
//     重连按 1s 翻倍退避演进，横幅 connecting → failed 按阈值确定性出现。
// 用法：node dsh-port-holder.mjs <port> <pidfile>
import http from 'node:http'
import { rmSync, writeFileSync } from 'node:fs'

const port = Number(process.argv[2])
const pidFile = process.argv[3]
if (!Number.isInteger(port) || port <= 0 || !pidFile) {
  console.error('usage: node dsh-port-holder.mjs <port> <pidfile>')
  process.exit(2)
}
writeFileSync(pidFile, String(process.pid))

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/host.describe') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let rpcId = ''
      try {
        rpcId = String(JSON.parse(body).rpcId ?? '')
      } catch {
        // 解析失败按空串回显：探测方校验不过（rpcId 不匹配）→ 视为 foreign，
        // 不会误判成 dsh 存活——坏输入宁可不放行。
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ rpcId }))
    })
    return
  }
  // mux 的 WS upgrade 与其余 RPC：非 101 应答即断连，WebSocket 客户端
  // 收到后走 onerror/onclose → 扩展重连退避继续推进。
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('holder: dsh is down (sandbox reconnect scenario)')
})
server.on('upgrade', (_req, socket) => socket.destroy())
server.on('error', (err) => {
  console.error(`holder listen failed: ${err.message}`)
  process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
  console.log(`dsh-port-holder listening on 127.0.0.1:${port} pid=${process.pid}`)
})

const stop = () => {
  try {
    rmSync(pidFile, { force: true })
  } catch {
    // pidfile 清理失败不影响退出
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
