/**
 * 宿主半的落盘能力（#84 能力①）：把一段内容写到「用户能找到的位置」。
 *
 * 目标目录按序取：`~/Downloads`（存在时）→ `~/.dsh/exports`（不存在就建）。
 * 之所以不弹选择框：宿主半跑在 dsh 宿主进程里，那是个没有 GUI 的进程；**选位置
 * 是 shell 的事**——VS Code 侧的同一口由扩展宿主实现（`showSaveDialog`），
 * 前端插件看不到差别（见 `packages/dsh-plugin-kit/src/hostCapabilities.ts` 的能力表）。
 *
 * 文件名由调用方给（已被 `parseSuggestedName` 校核：无路径分隔符、无 `..`），
 * 这里再兜一道 basename，杜绝写穿目录。
 *
 * **重名不覆盖**：同名文件已存在时追加 `-1`、`-2`…（导出是用户主动动作，静默
 * 覆盖用户已有文件比多一个前缀坏得多）。
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { dshHomeDir } from './stateStore.ts'

/** 落盘结果的目录解析（测试可注入）。 */
export interface SaveLocation {
  /** 首选目录（不存在或不可写时回落）。 */
  preferred: string
  /** 回落目录（不存在则创建）。 */
  fallback: string
}

/** 默认落点：`~/Downloads` 优先，`~/.dsh/exports` 兜底。 */
export function defaultSaveLocation(home: string = dshHomeDir()): SaveLocation {
  return { preferred: path.join(os.homedir(), 'Downloads'), fallback: path.join(home, 'exports') }
}

async function usableDir(dir: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(dir)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/** 选一个可写的落点（首选不存在就用回落，回落目录按需创建）。 */
export async function resolveSaveDir(location: SaveLocation): Promise<string> {
  if (await usableDir(location.preferred)) return location.preferred
  await fsp.mkdir(location.fallback, { recursive: true })
  return location.fallback
}

/** 在目录里挑一个不冲突的文件名（`名称.ext` → `名称-1.ext` → `名称-2.ext`…）。 */
export async function uniqueFileName(dir: string, suggestedName: string): Promise<string> {
  const base = path.basename(suggestedName)
  const ext = path.extname(base)
  const stem = base.slice(0, base.length - ext.length)
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? base : `${stem}-${index}${ext}`
    const exists = await fsp
      .stat(path.join(dir, candidate))
      .then(() => true)
      .catch(() => false)
    if (!exists) return candidate
  }
  throw new Error(`no unused file name available for ${base}`)
}

/**
 * 写一段 base64 内容到落点，返回绝对路径。
 * @param suggestedName - 已校核的文件名（无路径分隔符）。
 * @param base64 - 已校核的 base64 文本。
 * @param location - 落点（缺省 `~/Downloads` → `~/.dsh/exports`）。
 */
export async function saveContentFile(
  suggestedName: string,
  base64: string,
  location: SaveLocation = defaultSaveLocation(),
): Promise<string> {
  const dir = await resolveSaveDir(location)
  const name = await uniqueFileName(dir, path.basename(suggestedName))
  const target = path.join(dir, name)
  const bytes = Buffer.from(base64, 'base64')
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, bytes)
  await fsp.rename(tmp, target)
  return target
}
