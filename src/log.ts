import * as vscode from 'vscode'
import * as path from 'node:path'
import { LogFile } from './pure/logFile.ts'

/**
 * Centralized logging to a dedicated Output Channel.
 * URLs written to the log are sanitized: query-string values are masked.
 *
 * 同时落一份到文件（#169）：见 `src/pure/logFile.ts`。面板消失这类宿主行为问题事后
 * 只能靠日志自证，输出面板那条通道的落点不受我们控制（VS Code 自己的日志目录、
 * 会被清理），所以这里额外写一份到 `globalStorageUri/logs/` 下——一窗一文件，
 * 文件名带进程号，扩展宿主重启 = 一个全新文件。路径进日志首行，也写在
 * docs/development.md「日志与事后取证」一节。
 */

/** Mask query parameter values in a URL, keeping parameter names for context. */
export function sanitizeUrl(url: string): string {
  return url.replace(/(\?|&)([^=&\s]+)=([^&\s]*)/g, '$1$2=***')
}

/** Sanitize any text that may embed URLs. */
export function sanitize(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (u) => sanitizeUrl(u))
}

/**
 * 日志接收面：`Logger` 实现它，只关心「记三条日志」的调用方按这个签名收参数
 * （在 node 环境里跑的验证 harness / 单测没有 vscode，实现不了 Logger 类，
 * 但完全满足这个接口）。
 */
export interface LogSink {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface LoggerOptions {
  /** 文件 sink 的目录（宿主传 `globalStorageUri/logs`）；缺省 = 只写输出面板。 */
  logFileDir?: string
  /** 文件名的进程号分片（缺省取 `process.pid`；单测用来固定名字）。 */
  pid?: number
}

export class Logger implements vscode.Disposable, LogSink {
  private readonly channel = vscode.window.createOutputChannel('DSH One')
  private readonly file: LogFile | undefined

  constructor(options: LoggerOptions = {}) {
    if (options.logFileDir !== undefined) {
      this.file = new LogFile({
        filePath: path.join(options.logFileDir, `dsh-one-${options.pid ?? process.pid}.log`),
      })
    }
  }

  /** 这份日志同时落盘的位置（只写输出面板时为 undefined）。 */
  get filePath(): string | undefined {
    return this.file?.path
  }

  private write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${sanitize(message)}`
    this.channel.appendLine(line)
    this.file?.append(`[${process.pid}] ${line}`)
  }

  info(message: string): void {
    this.write('info', message)
  }

  warn(message: string): void {
    this.write('warn', message)
  }

  error(message: string): void {
    this.write('error', message)
  }

  show(): void {
    this.channel.show(true)
  }

  dispose(): void {
    this.channel.dispose()
  }
}
