/**
 * ~/.dsh/dsh-one/ 客户端状态目录的 IO 壳：读全部模块（宽松）、原子写（同目录
 * tmp + rename）、写前重读的模块级更新（读-合-写经内部队列串行化——同窗口两个
 * 写操作不互相覆盖；跨窗口/派生脚本之间仍是 last-writer-wins，丢失率靠
 * dshStateFile 的字段级合并压低）、目录监视（派生脚本 / 其它窗口写文件后
 * 插件热重载）。
 *
 * 与 Memento 的关系：文件是本方案的权威存储（跨窗口/重启共享），VSCode
 * Memento 只作为一次性迁移源，迁移成功后删除（见 sessionsStore.create）。
 * 原子写失败不阻断调用方（返回 false），下次写再试；坏文件按无文件降级。
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  dshModuleFile,
  emptyDraftsFile,
  capDraftsFile,
  parseDraftsFile,
  parseGroupFile,
  parseIdListFile,
  parseTagFile,
  serializeDraftsFile,
  serializeGroupFile,
  serializeIdListFile,
  serializeTagFile,
  serializeTagFileV2,
  DSH_MODULE_NAMES,
  type DraftsFile,
  type DshModuleName,
  type GroupFile,
  type IdListFile,
  type TagFile,
  type TagFileV2,
  type AnyTagFile,
} from '../pure/dshStateFile.ts'

/** 全部模块的快照；模块缺失/坏文件 = null（触发旧值迁移）。 */
export interface DshStateSnapshot {
  recycleBin: IdListFile | null
  groups: GroupFile | null
  /** 标签组文件：v2（per-workspace）或 v1（旧全局，待迁移），按 version 判别。 */
  tags: TagFileV2 | TagFile | null
  pinned: IdListFile | null
  unread: IdListFile | null
}

const EMPTY_SNAPSHOT: DshStateSnapshot = {
  recycleBin: null,
  groups: null,
  tags: null,
  pinned: null,
  unread: null,
}

export interface DshStateStoreOptions {
  /** 覆盖默认目录（测试用）。 */
  dir?: string
  /** watch 事件防抖毫秒，默认 300；0 = 不防抖。 */
  watchDebounceMs?: number
  /**
   * 决策/失败日志出口（结构与 Logger 吻合，extension 直接传 logger；测试可不传）。
   * 只记「难复现的现场」：迁移决策、写失败原因、坏文件、watch 状态——正常读写不记。
   */
  log?: { info(message: string): void; warn(message: string): void }
}

export class DshStateStore {
  readonly dir: string
  private readonly watchDebounceMs: number
  private watcher: fs.FSWatcher | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<() => void>()
  /**
   * 写操作串行队列：update* 是「读文件 → 合并 → 写回」，同窗口两个 update
   * 若并发会让后写的读不到先写的结果（丢失更新）。串行化只保同窗口；
   * 跨窗口/跨进程（派生脚本）不经过本队列，仍是 last-writer-wins。
   */
  private writeQueue: Promise<unknown> = Promise.resolve()
  /** 在途写操作数（>0 时调用方应暂缓重载——读到的可能是写前旧值）。 */
  private pendingWrites = 0
  private readonly logSink: DshStateStoreOptions['log']

  constructor(opts: DshStateStoreOptions = {}) {
    this.dir = opts.dir ?? path.join(os.homedir(), '.dsh', 'dsh-one')
    this.watchDebounceMs = opts.watchDebounceMs ?? 300
    this.logSink = opts.log
  }

  private info(message: string): void {
    this.logSink?.info(`client-state: ${message}`)
  }

  private warn(message: string): void {
    this.logSink?.warn(`client-state: ${message}`)
  }

  get writePending(): boolean {
    return this.pendingWrites > 0
  }

  private modulePath(name: DshModuleName): string {
    return path.join(this.dir, dshModuleFile(name))
  }

  /** 读全部模块；坏文件/不存在 → null（宽松降级，绝不抛；坏文件记 warn）。 */
  async load(): Promise<DshStateSnapshot> {
    const snapshot: DshStateSnapshot = { ...EMPTY_SNAPSHOT }
    await Promise.all(
      DSH_MODULE_NAMES.map(async (name) => {
        const value = await this.readRaw(name)
        if (value === null) return
        const parsed =
          name === 'groups'
            ? parseGroupFile(value)
            : name === 'tags'
              ? parseTagFile(value)
              : parseIdListFile(value)
        if (parsed === null) {
          this.warn(
            `${this.modulePath(name)} exists but did not parse (bad JSON/shape/version) — treated as missing (legacy migration or in-memory keep)`,
          )
          return
        }
        switch (name) {
          case 'recycle-bin':
            snapshot.recycleBin = parsed as IdListFile
            break
          case 'pinned':
            snapshot.pinned = parsed as IdListFile
            break
          case 'unread':
            snapshot.unread = parsed as IdListFile
            break
          case 'groups':
            snapshot.groups = parsed as GroupFile
            break
          case 'tags':
            snapshot.tags = parsed as AnyTagFile
            break
        }
      }),
    )
    return snapshot
  }

  private async readRaw(name: DshModuleName): Promise<string | null> {
    try {
      return await fsp.readFile(this.modulePath(name), 'utf8')
    } catch {
      return null
    }
  }

  /** 原子写整模块（tmp+rename，经写队列串行）；失败返回 false，不抛。 */
  async writeModule(name: DshModuleName, raw: string): Promise<boolean> {
    return this.enqueue(() => this.writeFile(name, raw))
  }

  private async writeFile(name: DshModuleName, raw: string): Promise<boolean> {
    const file = this.modulePath(name)
    const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
    try {
      await fsp.mkdir(this.dir, { recursive: true })
      await fsp.writeFile(tmp, raw)
      await fsp.rename(tmp, file)
      return true
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined)
      this.warn(`write ${file} failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /** 写操作串行化：上一个写（成败不论）落定后才跑下一个。 */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    this.pendingWrites += 1
    const run = this.writeQueue.then(op, op)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run.finally(() => {
      this.pendingWrites -= 1
    })
  }

  /* ---- 每个模块的「读-合-写」更新 ----
   * mutator 只表达本次意图的增量（追加/删除/按 id 改），作用于文件里的最新值
   * 而不是调用方的内存态——这样另一窗口/脚本写进文件的条目不会被覆盖。
   * mutator 原样返回 prev（同引用）表示无变化，跳过落盘。mutator 抛错按写失败
   * 处理（返回 false），不向调用方抛（persist 全是 fire-and-forget）。 */

  async updateRecycleBin(mutator: (prev: string[]) => string[]): Promise<boolean> {
    return this.updateIdList('recycle-bin', mutator)
  }

  async updatePinned(mutator: (prev: string[]) => string[]): Promise<boolean> {
    return this.updateIdList('pinned', mutator)
  }

  async updateUnread(mutator: (prev: string[]) => string[]): Promise<boolean> {
    return this.updateIdList('unread', mutator)
  }

  private async updateIdList(
    name: 'recycle-bin' | 'pinned' | 'unread',
    mutator: (prev: string[]) => string[],
  ): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const raw = await this.readRaw(name)
        const prev = raw !== null ? (parseIdListFile(raw)?.sessionIds ?? []) : []
        const next = mutator(prev)
        if (next === prev) return true
        return await this.writeFile(name, serializeIdListFile({ version: 1, sessionIds: next }))
      } catch (err) {
        this.warn(`update ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    })
  }

  async updateGroups(mutator: (prev: GroupFile) => GroupFile): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const raw = await this.readRaw('groups')
        const prev = raw !== null ? (parseGroupFile(raw) ?? emptyGroupFile()) : emptyGroupFile()
        const next = mutator(prev)
        if (next === prev) return true
        return await this.writeFile('groups', serializeGroupFile(next))
      } catch (err) {
        this.warn(`update groups failed: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    })
  }

  async updateTags(mutator: (prev: TagFileV2) => TagFileV2): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const raw = await this.readRaw('tags')
        // 文件权威：读到 v2 用其值；缺失/坏文件按 v2 空骨架。
        const parsed = raw !== null ? parseTagFile(raw) : null
        const prev = parsed ?? emptyTagFileV2()
        if (prev.version === 1) {
          // v1（旧全局，待迁移）：本方法只服务 v2 写；v1→v2 转换只能由迁移链
          // （sessionsStore.migratePendingV1ToV2，走 writeModule 原子替换）完成。
          // 这里一旦响应写会落盘一个空 v2 骨架、覆盖 v1 唯一持久副本，与迁移竞态。
          // 因此拒绝本次写（不动文件），等迁移落盘后由 store 内存态追平。
          this.warn('tags.json is v1 legacy (pending migration) — write rejected; v2 conversion happens via the baseline-driven migration, will retry after it lands')
          return false
        }
        const next = mutator(prev)
        if (next === prev) return true
        return await this.writeFile('tags', serializeTagFileV2(next))
      } catch (err) {
        this.warn(`update tags failed: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    })
  }

  /* ---- drafts 模块：不进 load() 快照/热重载（高频写，见 DSH_MODULE_NAMES 注释），
   *  读在 webview ready 时现读现解析。---- */

  /** 现读 drafts.json；缺失/坏文件按空草稿集降级（坏文件记 warn，不抛）。 */
  async readDrafts(): Promise<DraftsFile> {
    const raw = await this.readRaw('drafts')
    if (raw === null) return emptyDraftsFile()
    const parsed = parseDraftsFile(raw)
    if (parsed === null) {
      this.warn(`${this.modulePath('drafts')} exists but did not parse (bad JSON/shape/version) — treated as empty`)
      return emptyDraftsFile()
    }
    return parsed
  }

  /** 读-合-写 drafts.json（同窗口串行；跨窗口 last-writer-wins，key 级合并压丢失率）。 */
  async updateDrafts(mutator: (prev: DraftsFile) => DraftsFile): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const raw = await this.readRaw('drafts')
        const prev = raw !== null ? (parseDraftsFile(raw) ?? emptyDraftsFile()) : emptyDraftsFile()
        const next = mutator(prev)
        if (next === prev) return true
        return await this.writeFile('drafts', serializeDraftsFile(capDraftsFile(next)))
      } catch (err) {
        this.warn(`update drafts failed: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    })
  }

  /* ---- 目录监视：外部写（派生脚本/其它窗口，也含本窗口自己的写）→ 防抖回调。
   *  返回退订函数；dispose() 关闭监视器并清掉全部监听。 */

  watch(onChange: () => void): () => void {
    this.listeners.add(onChange)
    if (this.watcher === null) {
      try {
        // 目录可能还没建（首次启动）：先建再 watch；建不了/监视不了则跳过
        // 热重载（写路径有自己的报错，不受影响）。
        fs.mkdirSync(this.dir, { recursive: true })
        this.watcher = fs.watch(this.dir, { persistent: false }, () => this.schedule())
        this.watcher.on('error', (err) => {
          this.warn(`watcher on ${this.dir} errored — hot reload disabled: ${err.message}`)
          this.watcher?.close()
          this.watcher = null
        })
        this.info(`watching ${this.dir} (hot reload on)`)
      } catch (err) {
        this.watcher = null
        this.warn(`cannot watch ${this.dir} — hot reload disabled: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return () => {
      this.listeners.delete(onChange)
    }
  }

  private schedule(): void {
    if (this.listeners.size === 0) return
    if (this.watchDebounceMs <= 0) {
      for (const fn of this.listeners) fn()
      return
    }
    if (this.watchTimer !== null) return
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      for (const fn of this.listeners) fn()
    }, this.watchDebounceMs)
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.watchTimer !== null) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    this.listeners.clear()
  }
}

function emptyGroupFile(): GroupFile {
  return { version: 1, groups: [], membership: {}, activeGroupId: null }
}

function emptyTagFileV2(): TagFileV2 {
  return { version: 2, workspaces: {} }
}
