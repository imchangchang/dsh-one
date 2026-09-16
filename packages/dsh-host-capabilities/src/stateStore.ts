/**
 * 宿主半的状态存储（#84 能力③）：键 → JSON 值，落在 dsh 自己的目录下。
 *
 * 位置与文件命名**沿用扩展侧既有的 `~/.dsh/dsh-one/<键>.json`**（`dsh-one` 是我们
 * 插件的命名空间，见 `src/pure/dshStateFile.ts`）。沿用不是偷懒：AGENTS.md 铁律
 * 「插件状态按官方惯例存储」要求用户可感知的持久状态由宿主半拥有、落 `~/.dsh`，
 * 路径与文件一旦换掉，用户在 #82 迁移时就得搬一遍数据——同一份数据不该有第二个家。
 *
 * 写入一律**原子**（同目录 tmp + rename），与扩展侧 dshStateStore 同口径：多个客户端
 * （VS Code 窗口 + 浏览器页签）同时写时至少不会读到半截文件。
 *
 * 键的形状在 `src/pure/hostCapabilities.ts` 校核（只允许 `[a-z0-9._-]`，禁 `..`）——
 * 那是本模块唯一的路径穿越闸门，任何情况下都不许在键上直接拼路径。
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * dsh 家目录：`DSH_HOME` 环境变量优先，否则 `~/.dsh`（与官方
 * `@deepseek-ai/dsh-home-paths` 的 `DSH_HOME` 口径一致；这里不引那个包，只为
 * 两行路径解析多一个运行时依赖不值当）。
 */
export function dshHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DSH_HOME
  return override !== undefined && override !== '' ? override : path.join(os.homedir(), '.dsh')
}

/** 状态目录（与扩展侧 dshStateStore 同目录：`~/.dsh/dsh-one/`）。 */
export function stateDir(home: string = dshHomeDir()): string {
  return path.join(home, 'dsh-one')
}

/** 状态文件路径（键已由调用方校核；这里再兜一道，任何分隔符都不许进）。 */
export function stateFilePath(key: string, home: string = dshHomeDir()): string {
  if (key.includes('/') || key.includes('\\') || key.includes('..')) {
    throw new Error(`refusing to build a state path from key ${JSON.stringify(key)}`)
  }
  return path.join(stateDir(home), `${key}.json`)
}

/** 读一个键；文件不存在或内容坏掉一律返回 null（坏文件不该让插件崩）。 */
export async function readState(key: string, home: string = dshHomeDir()): Promise<unknown> {
  let raw: string
  try {
    raw = await fsp.readFile(stateFilePath(key, home), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** 原子写一个键（同目录 tmp + rename）。 */
export async function writeState(key: string, serialized: string, home: string = dshHomeDir()): Promise<void> {
  const target = stateFilePath(key, home)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, serialized, 'utf8')
  await fsp.rename(tmp, target)
}

/** 删一个键；返回是否真的删掉了（不存在时为 false，不报错）。 */
export async function deleteState(key: string, home: string = dshHomeDir()): Promise<boolean> {
  try {
    await fsp.unlink(stateFilePath(key, home))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
