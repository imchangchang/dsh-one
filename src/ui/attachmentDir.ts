/**
 * 粘贴附件（图片/普通文件）的统一落盘目录：OS 临时目录下按会话分目录的固定
 * 子目录（`os.tmpdir()/dsh-one-attachments/<sessionId>/`；无附着会话回退
 * `default/`）。Windows: %TEMP%，macOS/Linux: /tmp 或 $TMPDIR——`os.tmpdir()`
 * 天然跨平台。OS 临时目录不保证定期清理；与 dsh 归档语义一致（归档只标记不
 * 删），附件只增不删、归档保留恢复能力；绝不落进任何项目/工作区（不污染 git）。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { readdir } from 'node:fs/promises'

export function attachmentDir(sessionId: string | undefined): string {
  return path.join(os.tmpdir(), 'dsh-one-attachments', sessionId || 'default')
}

/** 会话目录里下一个序号：扫描匹配 `namePattern` 的现有文件取最大 N + 1（新目录从 1 起）。
 *  命名兼容 `imgN-M.ext` 防撞后缀（孤儿也占位，避免重复分配）。 */
export async function nextSequenceIndex(dir: string, namePattern: RegExp): Promise<number> {
  let max = 0
  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      const m = namePattern.exec(entry)
      if (m) max = Math.max(max, Number(m[1]))
    }
  } catch {
    // 目录尚不存在：从 1 起
  }
  return max + 1
}
