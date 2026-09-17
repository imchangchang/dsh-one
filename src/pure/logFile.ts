/**
 * 日志文件的落盘（#169）：把扩展日志同时写进扩展 globalStorage 下的一个文件。
 *
 * 为什么要有它：VS Code 的输出面板（`src/log.ts` 的 OutputChannel）只在 VS Code
 * 自己的日志目录里留痕（`logs/<时间戳>/window1/exthost/output_logging_<…>/`），路径
 * 随窗口与版本变、且被 VS Code 的日志清理管着；出了问题要「事后自证」时找不到
 * 稳定的落点。这里给一个我们自己控制的固定位置，路径由调用方给。
 *
 * 一窗一文件（文件名带进程号，见 src/log.ts）：多个 VS Code 窗口共享同一份
 * globalStorage，共用一个文件会互相穿插、轮转还会打架；一窗一文件之外，一次
 * 扩展宿主重启 = 一个新文件，正好把「哪次重启丢的面板」对齐成一份可读记录。
 *
 * 不 import vscode（单测直接跑），失败一律吞掉——日志写不进去绝不能影响扩展。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

/** 单文件上限（超过就轮转到 `<名>.1`，只留一份上一版）。 */
export const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024

export interface LogFileOptions {
  /** 目标文件绝对路径（目录不存在会建）。 */
  filePath: string
  /** 单文件上限，默认 2 MiB。 */
  maxBytes?: number
}

export class LogFile {
  private readonly filePath: string
  private readonly backupPath: string
  private readonly maxBytes: number
  private bytes: number
  /** 目录都建不出来时关掉自己（写不进去就别每次再试一遍）。 */
  private disabled = false

  constructor(options: LogFileOptions) {
    this.filePath = options.filePath
    this.backupPath = `${options.filePath}.1`
    this.maxBytes = options.maxBytes ?? LOG_FILE_MAX_BYTES
    this.bytes = 0
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      // 同进程内换文件重开（如 logger 重建）时按已有大小接着算。
      this.bytes = fs.statSync(this.filePath).size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') this.bytes = 0
      else this.disabled = true
    }
  }

  /** 已写到的文件路径（调用方用它报给用户，失败也照报——那是约定的取证位置）。 */
  get path(): string {
    return this.filePath
  }

  /** 追加一行（自动补换行）。任何 IO 失败都只关掉自己，不抛给调用方。 */
  append(line: string): void {
    if (this.disabled) return
    const text = `${line}\n`
    try {
      if (this.bytes + Buffer.byteLength(text) > this.maxBytes) this.rotate()
      fs.appendFileSync(this.filePath, text)
      this.bytes += Buffer.byteLength(text)
    } catch {
      this.disabled = true
    }
  }

  private rotate(): void {
    try {
      fs.renameSync(this.filePath, this.backupPath)
    } catch {
      /* 没有旧文件（或改名失败）：下面截断重来即可 */
    }
    this.bytes = 0
  }
}
