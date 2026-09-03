/**
 * 粘贴附件（图片/普通文件）的统一落盘目录：OS 临时目录下按会话分目录的固定
 * 子目录（`os.tmpdir()/dsh-one-attachments/<sessionId>/`；无附着会话回退
 * `default/`）。Windows: %TEMP%，macOS/Linux: /tmp 或 $TMPDIR——`os.tmpdir()`
 * 天然跨平台。系统会定期清理（macOS 默认 3 天未访问），不会无限增长，也绝不
 * 落进任何项目/工作区（不污染 git）。
 */
import * as os from 'node:os'
import * as path from 'node:path'

export function attachmentDir(sessionId: string | undefined): string {
  return path.join(os.tmpdir(), 'dsh-one-attachments', sessionId || 'default')
}
