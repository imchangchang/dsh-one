/**
 * 会话导出（#84 迁移到宿主能力口）的纯逻辑：官方导出路由、建议文件名、错误归类。
 *
 * 单独放这里是为了能被单测直接钉住——插件文件本身 import 了 react 与官方原语，
 * 单测进不来（仓库既有做法：能纯化的逻辑一律纯化，见 hostCalls/hostDownload）。
 */

/** 官方会话导出的下载路由（`dsh-session-log-export` 的 `SESSION_LOG_EXPORT_PATH`）。 */
export const SESSION_EXPORT_PATH = '/api/session.export'

/** 建议文件名：去掉会话 id 里不适合做文件名的字符（与扩展侧落盘命名一致）。 */
export function sessionExportFileName(sessionId: string): string {
  return `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
}

/**
 * 导出请求的网关路径（官方路由 + 两个查询参数：会话 id 与「含子代理」开关）。
 * 参数一律 `encodeURIComponent`——会话 id 是外部输入，进 URL 前必须转义。
 */
export function sessionExportPath(sessionId: string): string {
  return `${SESSION_EXPORT_PATH}?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=true`
}

/**
 * 失败要不要提示用户：**用户取消不是失败**（宿主侧的保存对话框取消，用户自己按的），
 * 静默；其余失败（含「宿主不可用」）弹提示。
 */
export function shouldReportExportFailure(code: string | undefined): boolean {
  return code !== 'cancelled'
}
