/**
 * ~/.dsh/dsh-one/ 客户端状态目录的 IO 壳：读全部模块（宽松）、原子写（同目录
 * tmp + rename）、写前重读的模块级更新（合并交给 dshStateFile 纯函数）、
 * 目录监视（派生脚本 / 其它窗口写文件后插件热重载）。
 *
 * 与 Memento 的关系：文件是本方案的权威存储（跨窗口/重启共享），VSCode
 * Memento 只作为一次性迁移源，迁移后删除（见 sessionsStore.create）。
 * 原子写失败不阻断调用方（返回 false），下次写再试；坏文件按无文件降级。
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  dshModuleFile,
  parseGroupFile,
  parseIdListFile,
  parseTagFile,
  serializeGroupFile,
  serializeIdListFile,
  serializeTagFile,
  mergeIdList,
  mergeSessionTags,
  mergeTagDefs,
  DSH_MODULE_NAMES,
  type DshModuleName,
  type GroupFile,
  type IdListFile,
  type TagFile,
} from '../pure/dshStateFile.ts'

/** 全部模块的快照；模块缺失/坏文件 = null（触发旧值迁移）。 */
export interface DshStateSnapshot {
  recycleBin: IdListFile | null
  groups: GroupFile | null
  tags: TagFile | null
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
}

const READ_TIMEOUTS_S = 0

export class DshStateStore {
  readonly dir: string
  private readonly watchDebounceMs: number
  private watcher: fs.FSWatcher | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private pending = false

  constructor(opts: DshStateStoreOptions = {}) {
    this.dir = opts.dir ?? path.join(os.homedir(), '.dsh', 'dsh-one')
    this.watchDebounceMs = opts.watchDebounceMs ?? 300
  }

  private modulePath(name: DshModuleName): string {
    return path.join(this.dir, dshModuleFile(name))
  }

  /** 读全部模块；坏文件/不存在 → null（宽松降级，绝不抛）。 */
  async load(): Promise<DshStateSnapshot> {
    const snapshot: DshStateSnapshot = { ...EMPTY_SNAPSHOT }
    await Promise.all(
      DSH_MODULE_NAMES.map(async (name) => {
        const value = await this.readRaw(name)
        if (value === null) return
        switch (name) {
          case 'recycle-bin':
          case 'pinned':
          case 'unread':
            snapshot[name] = parseIdListFile(value)
            break
          case 'groups':
            snapshot.groups = parseGroupFile(value)
            break
          case 'tags':
            snapshot.tags = parseTagFile(value)
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

  /** 原子写（tmp+rename）；失败 warn 返回 false，不抛。 */
  async writeModule(name: DshModuleName, raw: string): Promise<boolean> {
    const file = this.modulePath(name)
    const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
    try {
      await fsp.mkdir(this.dir, { recursive: true })
      await fsp.writeFile(tmp, raw)
      await fsp.rename(tmp, file)
      return true
    } catch {
      await fsp.rm(tmp, { force: true }).catch(() => undefined)
      return false
    }
  }

  /* ---- 每个模块的「读-合-写」更新（写前重读 + 字段级合并，见 dshStateFile） ---- */

  async updateRecycleBin(mutator: (prev: string[]) => string[]): Promise<boolean> {
    const raw = await this.readRaw('recycle-bin')
    const prev = raw !== null ? (parseIdListFile(raw)?.sessionIds ?? []) : []
    return this.writeModule('recycle-bin', serializeIdListFile({ version: 1, sessionIds: mutator(prev) }))
  }

  async updatePinned(mutator: (prev: string[]) => string[]): Promise<boolean> {
    const raw = await this.readRaw('pinned')
    const prev = raw !== null ? (parseIdListFile(raw)?.sessionIds ?? []) : []
    return this.writeModule('pinned', serializeIdListFile({ version: 1, sessionIds: mutator(prev) }))
  }

  async updateUnread(mutator: (prev: string[]) => string[]): Promise<boolean> {
    const raw = await this.readRaw('unread')
    const prev = raw !== null ? (parseIdListFile(raw)?.sessionIds ?? []) : []
    return this.writeModule('unread', serializeIdListFile({ version: 1, sessionIds: mutator(prev) }))
  }

  async updateGroups(mutator: (prev: GroupFile) => GroupFile): Promise<boolean> {
    const raw = await this.readRaw('groups')
    const prev = raw !== null ? (parseGroupFile(raw) ?? emptyGroupFile()) : emptyGroupFile()
    return this.writeModule('groups', serializeGroupFile(mutator(prev)))
  }

  async updateTags(mutator: (prev: TagFile) => TagFile): Promise<boolean> {
    const raw = await this.readRaw('tags')
    const prev = raw !== null ? (parseTagFile(raw) ?? emptyTagFile()) : emptyTagFile()
    return this.writeModule('tags', serializeTagFile(mutator(prev)))
  }

  /* ---- 目录监视：外部写（派生脚本/其它窗口）→ 防抖回调 ---- */

  watch(onChange: () => void): () => void {
    if (this.watcher === null) {
      // 目录可能还没建（首次启动）：先建再 watch，watch 失败直接重试 setTimeout。
      fs.mkdirSync(this.dir, { recursive: true })
      this.watcher = fs.watch(this.dir, { persistent: false }, () => this.schedule(onChange))
    }
    return () => this.schedule(onChange)
  }

  private schedule(onChange: () => void): void {
    if (this.pending) return
    this.pending = true
    if (this.watchDebounceMs <= 0) {
      onChange()
      this.pending = false
      return
    }
    if (this.watchTimer !== null) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      this.pending = false
      this.watchTimer = null
      onChange()
    }, this.watchDebounceMs)
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.watchTimer !== null) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
  }
}

function emptyGroupFile(): GroupFile {
  return { version: 1, groups: [], membership: {}, activeGroupId: null }
}

function emptyTagFile(): TagFile {
  return { version: 1, tags: [], sessionTags: {} }
}

/** 供 sessionsStore 外部重载用的读取封装：全部模块（保持接口单一）。 */
export async function loadDshSnapshot(io: DshStateStore): Promise<DshStateSnapshot> {
  return io.load()
}

export { mergeIdList, mergeSessionTags, mergeTagDefs }
export type { IdListFile }
