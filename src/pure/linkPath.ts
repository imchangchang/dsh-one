/**
 * 对话里「文件链接」href 识别（markdown 链接与 @引用 chip 共用）。
 *
 * 返回 true = 文件路径类 href（绝对/相对/~/file:），交给宿主打开；
 * http(s)/mailto 等外链另走 openExternal；其他 scheme（javascript:/data:/vscode:…）
 * 既不是文件路径也不是合法外链，保持不可点并被 DOMPurify 默认白名单剥掉。
 *
 * 纯函数无宿主依赖；在解码前（marked 输出，如 C:%5CUsers）解码后均可工作。
 */

/** 是否形如 file: URI（宿主端经 Uri.fsPath 解析）。 */
export function isFilePathHref(href: string): boolean {
  if (/^file:/i.test(href)) return true
  // Windows 绝对路径：C:\… 或 C:/…（marked 会把反斜杠输出成 %5C，所以也认 %）
  if (/^[a-z]:[\\/%]/i.test(href)) return true
  // POSIX 绝对路径 /…、UNC \\server\share、用户目录 ~…
  if (/^[\\/~]/u.test(href)) return true
  // 相对路径 ./…、../…
  if (/^\.{1,2}[\\/]/u.test(href)) return true
  // 带 scheme 的（https:/mailto:/tel:/javascript:…）：不是文件路径——外链由
  // openExternal 分支处理，危险 scheme 留给 DOMPurify 默认拦截。
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false
  // 无 scheme：视为相对路径（docs/foo.md、AGENTS.md）
  return true
}
