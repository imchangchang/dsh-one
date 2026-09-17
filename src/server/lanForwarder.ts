import * as net from 'node:net'
import type { Logger } from '../log.ts'

/**
 * 局域网转发器：在 `<局域网IP>:<端口>` 上收 TCP 连接，原样透传给
 * `127.0.0.1:<同端口>` 的 dsh 网关。
 *
 * 为什么存在：dsh 上游拒绝 `--host 0.0.0.0`（安全策略，见 src/pure/lanAccess.ts
 * 头注），dsh 永远只听 127.0.0.1；局域网可达性由这层纯 TCP 透传提供——不做任何
 * HTTP 解析，Host 头、Cookie、WebSocket 升级都原样过线，网关侧的 token/Host
 * 信任栏照常生效（spawn 时要带 `--trusted-host <局域网IP>`，否则局域网请求会被
 * 网关拒掉）。
 *
 * 生命周期：manager 在实例 running 且具备能力（记录里有 lanIp = spawn 时带了
 * trusted-host）时调用 start；状态离开 running / dispose 时 stop。绑定失败
 * （端口被占等）只记日志 + 抛给调用方提示，不影响 dsh 本身。
 */
export class LanForwarder {
  private server: net.Server | null = null
  /** 在飞的 start（并发调用复用同一个 promise，避免重复 listen 撞 EADDRINUSE）。 */
  private starting: Promise<void> | null = null
  private activeIp: string | undefined
  private activePort: number | undefined
  private listening = false

  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /** 转发器是否在监听（绑定成功后为 true）。 */
  get isActive(): boolean {
    return this.listening
  }

  /** 当前绑定的局域网地址；未监听时 undefined。 */
  get boundIp(): string | undefined {
    return this.listening ? this.activeIp : undefined
  }

  /**
   * 在 `<lanIp>:<port>` 监听并透传到 `127.0.0.1:<targetPort>`（生产里 targetPort
   * 与 port 相同——同端口、不同地址；拆开参数是为了能在纯 loopback 环境单测）。
   * 重复 start 先停旧的（换 IP / 换端口时走这里）。绑定失败抛错——调用方决定
   * 怎么提示。
   */
  async start(lanIp: string, port: number, targetPort: number = port): Promise<void> {
    // IP 或端口任一变化都要重绑（只看 IP 会把「换端口」短路成 no-op）。
    if (this.listening && this.activeIp === lanIp && this.activePort === port) return
    // 并发 start：复用同一个在飞 promise。少了这道守卫，后到者会再 listen 一次
    // （撞 EADDRINUSE），进而把一次正常的争用报成绑定失败。
    if (this.starting) await this.starting.catch(() => undefined)
    if (this.listening && this.activeIp === lanIp && this.activePort === port) return
    const run = this.listen(lanIp, port, targetPort)
    this.starting = run
    try {
      await run
    } finally {
      if (this.starting === run) this.starting = null
    }
  }

  private async listen(lanIp: string, port: number, targetPort: number): Promise<void> {
    this.stop()
    const server = net.createServer((socket) => {
      const upstream = net.connect({ host: '127.0.0.1', port: targetPort })
      // 透传是双向裸管道：任何一端断开/出错就拆掉整条链路，不留半开连接。
      socket.on('error', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
      socket.pipe(upstream)
      upstream.pipe(socket)
      const closeBoth = () => {
        socket.destroy()
        upstream.destroy()
      }
      socket.on('close', closeBoth)
      upstream.on('close', closeBoth)
    })
    await new Promise<void>((resolve, reject) => {
      const fail = (err: Error) => {
        server.close()
        reject(err)
      }
      server.once('error', fail)
      server.listen(port, lanIp, () => {
        server.off('error', fail)
        // 监听建立后再挂常驻错误处理：之后的连接级错误不能变成进程级 uncaught。
        server.on('error', (err) => this.logger.warn(`lan forwarder error: ${err.message}`))
        resolve()
      })
    })
    this.server = server
    this.activeIp = lanIp
    this.activePort = port
    this.listening = true
    this.logger.info(`lan forwarder: ${lanIp}:${port} -> 127.0.0.1:${port}`)
  }

  /** 停止监听并断开所有现有连接（幂等）。 */
  stop(): void {
    if (this.server === null) return
    // 注意：close() 是异步的，紧接着 start 同一 <ip>:<port> 可能撞 EADDRINUSE；
    // 调用方（manager）把这种争用当「对端在转发/稍后重试」处理，不再当故障报。
    const server = this.server
    this.server = null
    this.activeIp = undefined
    this.activePort = undefined
    this.listening = false
    // close() 只停监听，不踢已建立连接；实例已不在 running，连接一并拆掉。
    // closeAllConnections 在 Node 18.2+ 才有（本仓库 @types/node 22 的类型没标），
    // 探测后再调用，旧运行时退化为只停监听、等现有连接自然结束。
    server.close(() => this.logger.info('lan forwarder stopped'))
    const closable = server as unknown as { closeAllConnections?: () => void }
    closable.closeAllConnections?.()
  }
}
