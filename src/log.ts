import * as vscode from 'vscode'

/**
 * Centralized logging to a dedicated Output Channel.
 * URLs written to the log are sanitized: query-string values are masked.
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

export class Logger implements vscode.Disposable, LogSink {
  private readonly channel = vscode.window.createOutputChannel('DSH One')

  private write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${sanitize(message)}`
    this.channel.appendLine(line)
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
