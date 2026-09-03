/**
 * 粘贴附件（图片/普通文件）的统一落盘目录：OS 临时目录下的固定子目录。
 * 系统会定期清理（macOS 默认 3 天未访问），不会无限增长，也绝不落进任何
 * 项目/工作区（不污染 git）。会话无 cwd 或图片/文件粘贴都写这里。
 */
import * as os from 'node:os'
import * as path from 'node:path'

export function attachmentDir(): string {
  return path.join(os.tmpdir(), 'dsh-one-attachments')
}
