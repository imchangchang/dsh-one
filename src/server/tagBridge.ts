import * as http from 'node:http'
import * as crypto from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseTagBridgeRequest, parseTagBridgeRecord, type TagBridgeRecord } from '../pure/tagBridgeCore.ts'

/**
 * Loopback tag-bridge：派生脚本 --tag 的落点。
 *
 * 职责：扩展激活时在 127.0.0.1 起一个 HTTP 监听（端口 0 随机分配），生成每进程
 * 随机 token，把 `{port, token}` 原子写进 `~/.dsh/dsh-one/bridge.json`（扩展进程
 * 自己写，不涉 dsh 文件沙箱）。端点只做一件事：收 `{group, sessionIds}` → 交给注入
 * 的 `assignTags` 回调（sessionsStore.assignTagGroup 的封装）——不接受任意路径/内容。
 *
 * 安全口径（与 dsh 网关同级信任模型）：只绑 127.0.0.1、随机端口、token 认证。
 * 多窗口：每个窗口各自起端点、写同一份 bridge.json；晚激活的窗口覆盖注册，
 * 早激活的失效（见 dispose 的「仅当仍是注册者才移除」）。
 *
 * IO-only（无 vscode import）——可用 node --test 离屏起真实 http 服务测协议与认证。
 */
export interface TagBridgeAssignInput {
  group: string
  sessionIds: string[]
}

export interface TagBridgeAssignResult {
  ok: boolean
  error?: string
  tagName?: string
  tagId?: string
  sessionCount?: number
}

export interface TagBridgeOptions {
  /** bridge.json 的落点；默认 `~/.dsh/dsh-one/bridge.json`。测试可覆盖。 */
  filePath?: string
  /** 处理一次合法 tag 请求：找/建组 + 批量归属（真实实现 = sessionsStore.assignTagGroup）。 */
  assignTags: (input: TagBridgeAssignInput) => Promise<TagBridgeAssignResult> | TagBridgeAssignResult
  logger: { info(message: string): void; warn(message: string): void }
}

/** 请求体上限：派生一批 session 的 sessionId 列表足够小（每条 ~36 字节），
 *  1MB 是防滥用/内存的宽上限；超过直接 413。 */
const BODY_LIMIT_BYTES = 1024 * 1024

/** 判定请求是否授权：Authorization: Bearer <token>（保持 token 不进 URL/日志）。 */
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers['authorization']
  if (typeof header !== 'string') return false
  return header === `Bearer ${token}`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

export class TagBridge {
  private readonly filePath: string
  private readonly assignTags: TagBridgeOptions['assignTags']
  private readonly logger: TagBridgeOptions['logger']
  private readonly record: TagBridgeRecord
  private readonly server: http.Server
  private listening = false

  constructor(opts: TagBridgeOptions) {
    this.filePath = opts.filePath ?? path.join(os.homedir(), '.dsh', 'dsh-one', 'bridge.json')
    this.assignTags = opts.assignTags
    this.logger = opts.logger
    this.record = { port: 0, token: crypto.randomBytes(32).toString('base64url') }
    this.server = http.createServer((req, res) => void this.handle(req, res))
  }

  get port(): number {
    return this.record.port
  }

  get token(): string {
    return this.record.token
  }

  /** 起监听（端口 0 随机）+ 原子写 bridge.json。返回实际 port。 */
  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err)
      this.server.once('error', onError)
      // 只绑 127.0.0.1；端口 0 = 由 OS 分配一个空闲端口。
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', onError)
        const addr = this.server.address()
        if (addr !== null && typeof addr === 'object') this.record.port = addr.port
        resolve()
      })
    })
    this.listening = true
    await this.writeRecord()
    this.logger.info(`tag-bridge: listening on 127.0.0.1:${this.record.port} (bridge record at ${this.filePath})`)
    return this.record.port
  }

  private async writeRecord(): Promise<void> {
    const tmp = `${this.filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
    try {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
      await fsp.writeFile(tmp, JSON.stringify(this.record))
      await fsp.rename(tmp, this.filePath)
    } catch (err) {
      // 记录写不进不应阻断启动；下次激活再写。记 warn 方便定位。
      await fsp.rm(tmp, { force: true }).catch(() => undefined)
      this.logger.warn(`tag-bridge: writing bridge record failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 只认这一个路径 + 一种方法，其余明确拒绝——能力窄于任何被拦的写动作。
    if (req.method !== 'POST' || req.url !== '/tag') {
      sendJson(res, 404, { ok: false, error: 'not-found' })
      return
    }
    if (!authorized(req, this.record.token)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    const body = await readBody(req)
    if (body === null) {
      sendJson(res, 413, { ok: false, error: 'payload-too-large' })
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(body)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad-request' })
      return
    }
    const parsed = parseTagBridgeRequest(raw)
    if (!parsed.ok) {
      sendJson(res, parsed.error === 'empty-group' ? 400 : 400, { ok: false, error: parsed.error })
      return
    }
    try {
      const result = await this.assignTags(parsed.value)
      if (!result.ok) {
        sendJson(res, 500, { ok: false, error: result.error ?? 'internal' })
        return
      }
      sendJson(res, 200, { ok: true, tag: { name: result.tagName, id: result.tagId }, sessionCount: result.sessionCount })
    } catch (err) {
      this.logger.warn(`tag-bridge: assignTags failed: ${err instanceof Error ? err.message : String(err)}`)
      sendJson(res, 500, { ok: false, error: 'internal' })
    }
  }

  /**
   * 关闭监听；若 bridge.json 仍指向本窗口的记录（晚激活的窗口没覆盖它）则一并移除，
   * 否则不动（被新窗口覆盖时让新记录留效）。返回值供测试断言是否清理了记录。
   */
  async dispose(): Promise<boolean> {
    if (!this.listening) return false
    this.listening = false
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    try {
      const raw = JSON.parse(await fsp.readFile(this.filePath, 'utf8')) as unknown
      const record = parseTagBridgeRecord(raw)
      if (record !== null && record.port === this.record.port && record.token === this.record.token) {
        await fsp.rm(this.filePath, { force: true })
        this.logger.info('tag-bridge: disposed; bridge record removed (this window was the registrant)')
        return true
      }
    } catch {
      // 读不出/已是别的记录：不必清，静默。
    }
    this.logger.info('tag-bridge: disposed; bridge record left (superseded by another window)')
    return false
  }
}
