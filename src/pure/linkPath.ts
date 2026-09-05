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

/**
 * 行内码（反引号包裹）文本是否形如文件路径——用于「点击直接在 VS Code 打开」判定。
 *
 * 与 isFilePathHref 的 href 语义不同：href 里「无 scheme 一律视为相对路径」，
 * 对行内码文本太宽——反引号里命令/变量（git status、npm run build、VITE_PORT）
 * 远多于路径，照搬会把命令变成可点目标。这里收紧为「一眼是文件路径」的启发式：
 * - 绝对路径（POSIX / UNC / ~ / file: / Windows drive）原样放行；
 * - ./ ../ 前缀放行；
 * - dotfile（.gitignore / .env 等）；
 * - 相对路径或纯文件名：末段必须有 2–10 位纯字母扩展名（拿不准的不点，
 *   交给 hover 复制兜底——见 webview 侧 decorateInlineCodes）。
 * 含空白/括号/引号/通配的文本判为命令或占位符，一律不点。
 */
export function isInlineCodeFilePath(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\s/.test(t)) return false
  if (/[`"'()<>{}[\]*?|]/.test(t)) return false
  if (/^[\\/~]/u.test(t) || /^file:/i.test(t)) return true
  if (/^[a-z]:[\\/]/i.test(t)) return true
  if (/^\.{1,2}[\\/]/u.test(t)) return true
  if (/^\.[a-z][a-z0-9_-]*$/iu.test(t)) return true
  return (
    /^(?:[a-zA-Z0-9_+@.-]+[\\/])+[a-zA-Z0-9_+@.-]+\.[a-zA-Z]{2,10}$/iu.test(t) ||
    /^[a-zA-Z0-9_+@.-]+\.[a-zA-Z]{2,10}$/iu.test(t)
  )
}
