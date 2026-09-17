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
  private activeIp: string | undefined
  private listening = false

  constructor(private readonly logger: Logger) {}

  /** 转发器是否在监听（绑定成功后为 true）。 */
  get isActive(): boolean {
    return this.listening
  }

  /** 当前绑定的局域网地址；未监听时 undefined。 */
  get boundIp(): string | undefined {
    return this.listening ? this.activeIp : undefined
  }

  /**
   * 在 `<lanIp>:<port>` 监听并透传到 `127.0.0.1:<port>`。重复 start 先停旧的
   * （换 IP / 换端口时走这里）。绑定失败抛错——调用方决定怎么提示。
   */
  async start(lanIp: string, port: number): Promise<void> {
    if (this.listening && this.activeIp === lanIp) return
    this.stop()
    const server = net.createServer((socket) => {
      const upstream = net.connect({ host: '127.0.0.1', port })
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
    this.listening = true
    this.logger.info(`lan forwarder: ${lanIp}:${port} -> 127.0.0.1:${port}`)
  }

  /** 停止监听并断开所有现有连接（幂等）。 */
  stop(): void {
    if (this.server === null) return
    const server = this.server
    this.server = null
    this.activeIp = undefined
    this.listening = false
    // close() 只停监听，不踢已建立连接；实例已不在 running，连接一并拆掉。
    // closeAllConnections 在 Node 18.2+ 才有（本仓库 @types/node 22 的类型没标），
    // 探测后再调用，旧运行时退化为只停监听、等现有连接自然结束。
    server.close(() => this.logger.info('lan forwarder stopped'))
    const closable = server as unknown as { closeAllConnections?: () => void }
    closable.closeAllConnections?.()
  }
}
