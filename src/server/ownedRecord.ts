import * as crypto from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Logger } from '../log.ts'

/**
 * 共享身份记录：dsh 实例的 (pid, port, token) 存到所有 VS Code 窗口都能读的位置
 * （`~/.dsh/dsh-owned.json`，与 dsh home 同域），取代原 globalStorage 下的
 * `dsh-owned.json`（per user-data，窗口隔离——0.1.2 认证后第二窗口读不到 token，
 * 把实例当 occupied 换端口另起第二个实例，见 backlog multi-window-adopt-012）。
 *
 * 并发安全：写入原子（同目录 tmp + rename）+ mkdir 锁串行化「读记录 → 判定 →
 * spawn → 落盘」整段。锁模型借鉴 main-lock.sh 的原子 mkdir，但语义是「排队等」
 * 而不是「放弃」——两个窗口同时启动时后到者等前一个落盘后直接 adopt，不产生双实例。
 */

export interface OwnedRecord {
  pid: number
  port: number
  /** dsh >= 0.1.2 每次启动的 token（stdout URL 里的 ?token=）；0.1.1 无。 */
  token?: string
  /** spawn 时 locateDsh 报的版本；reload 后 re-own 时展示用。 */
  version?: string
  /**
   * spawn 这个实例的窗口身份（globalStorage fsPath，per user-data）。reload 后
   * 同一窗口同值 → 认回自己的实例、持有 kill 权；另一个 user-data 的窗口读到
   * 他人 owner → 认证式 adopted（绝不 kill，kill 权只由 owner 持有）。
   * 缺省（旧格式记录）一律按 adopt 处理——宁可少杀不错杀。
   */
  owner?: string
}

export type OwnedDecision = 'own' | 'adopt' | 'none'

/** 判定读到的记录归属：owner 与当前窗口一致 → own；否则 → adopt；无记录 → none。 */
export function resolveOwnership(record: OwnedRecord | null, ownerId: string): OwnedDecision {
  if (record === null) return 'none'
  return record.owner === ownerId ? 'own' : 'adopt'
}

/** 共享记录默认位置：`~/.dsh/dsh-owned.json`（与 dsh home 同域，所有窗口同值）。 */
export function defaultOwnedPath(dshHome = path.join(os.homedir(), '.dsh')): string {
  return path.join(dshHome, 'dsh-owned.json')
}

/** 宽松解析：文件缺失/坏 JSON/字段缺失一律返回 null（当没有记录处理）。 */
export async function readOwnedRecord(filePath: string, logger: Logger): Promise<OwnedRecord | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8')) as Partial<OwnedRecord>
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null
    return {
      pid: parsed.pid,
      port: parsed.port,
      ...(typeof parsed.token === 'string' ? { token: parsed.token } : {}),
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
      ...(typeof parsed.owner === 'string' ? { owner: parsed.owner } : {}),
    }
  } catch {
    return null
  }
}

/**
 * 原子写：同目录 tmp 文件 + rename 覆盖（POSIX rename 原子；Windows 上 Node 的
 * rename 同样覆盖已存在目标）。失败记 warn 返回 false——记录写不进不该阻断启动，
 * 下次再写/降级按无记录处理。
 */
export async function writeOwnedRecord(
  filePath: string,
  record: OwnedRecord,
  logger: Logger,
): Promise<boolean> {
  const tmp = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.writeFile(tmp, JSON.stringify(record))
    await fsp.rename(tmp, filePath)
    return true
  } catch (err) {
    logger.warn(`writing the dsh owned record failed: ${err instanceof Error ? err.message : err}`)
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    return false
  }
}

/** 删除共享记录（force：不存在也视为成功）。 */
export async function clearOwnedRecord(filePath: string): Promise<void> {
  await fsp.rm(filePath, { force: true }).catch(() => undefined)
}

const LOCK_RETRY_MS = 200
/** 锁目录超龄（owner.json 不可读时的兜底判据）即视为废弃，可回收。 */
const LOCK_STALE_MS = 10 * 60_000

export interface OwnedLock {
  /** 释放锁（best-effort；调用方可不 await，测试/确定性场景可 await）。 */
  release(): Promise<void>
}

/**
 * 获取记录锁：`<记录路径>.lock` 目录原子 mkdir，owner.json 里记持锁分支进程 pid。
 * - 持锁进程已死 → 锁废弃，回收重试；
 * - 仍在排队等锁，超过 `timeoutMs` 降级为 no-op 锁（返回的 release 不做任何事，
 *   仅调用方语义不变）；降级后并发安全由 OS 端口绑定兜底（同端口两个 LISTEN 不成立）。
 */
export async function acquireOwnedLock(
  filePath: string,
  logger: Logger,
  timeoutMs = 110_000,
): Promise<OwnedLock> {
  const lockDir = `${filePath}.lock`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await fsp.mkdir(lockDir)
      await fsp.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }))
      return {
        release: async (): Promise<void> => {
          await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => undefined)
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST' && (await lockIsStale(lockDir))) {
        await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => undefined)
        continue
      }
      if (Date.now() >= deadline) {
        logger.warn(`dsh owned record lock busy for ${timeoutMs}ms; proceeding without it`)
        return { release: async (): Promise<void> => undefined }
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS))
    }
  }
}

async function lockIsStale(lockDir: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(lockDir, 'owner.json'), 'utf8')) as { pid?: number }
    if (typeof parsed.pid === 'number') {
      try {
        process.kill(parsed.pid, 0)
        return false // 持锁进程还活着
      } catch (err) {
        // ESRCH = 持锁进程已退出 → 回收；EPERM 等其他情况按活着保守处理
        return (err as NodeJS.ErrnoException).code === 'ESRCH'
      }
    }
  } catch {
    // owner.json 还没写进去/读不出：按锁年龄兜底（刚建的锁 mtime 新，不会被误删）
  }
  try {
    const st = await fsp.stat(lockDir)
    return Date.now() - st.mtimeMs > LOCK_STALE_MS
  } catch {
    return true // 锁目录本身都没了 → 可回收
  }
}

/**
 * 一次性迁移旧 globalStorage pidfile → 共享位置。旧记录是「这个窗口的旧 build」
 * 写的，owner 补成当前窗口身份（升级后 reload 仍认回自己的实例、保留 kill 权）；
 * 共享记录已存在时旧文件直接删（防陈旧态）。旧文件总是删掉——迁移失败也只能降级
 * 走无记录流程（~/.dsh 不可写是极端环境）。
 */
export async function migrateOwnedRecord(
  legacyPath: string,
  sharedPath: string,
  ownerId: string,
  logger: Logger,
): Promise<void> {
  const legacy = await readOwnedRecord(legacyPath, logger)
  const sharedExists = await fsp.access(sharedPath).then(() => true).catch(() => false)
  if (legacy !== null && !sharedExists) {
    await writeOwnedRecord(sharedPath, { ...legacy, owner: ownerId }, logger)
  }
  await fsp.rm(legacyPath, { force: true }).catch(() => undefined)
}
