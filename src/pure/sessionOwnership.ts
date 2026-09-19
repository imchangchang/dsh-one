/**
 * 「这个会话打不开」的头号原因：**写句柄被另一个 dsh 进程占着**（#145）。
 *
 * dsh 的会话日志是**单写者**的：一个会话同一时刻只允许一个写句柄，这条约束跨进程
 * 生效（官方 `dsh-session-persistence-jsonl` 在会话目录里落 `session.lock` 并用
 * `flock` 独占；`dsh-session-persistence` 的注释原文是「一次 write open 发现该会话
 * 已绑定活跃写句柄」）。用户日常同时开着好几个 dsh 实例（VS Code 里扩展自己起的那个
 * + 浏览器里手工 `dsh web` 起的那个）时，**同一个会话不能同时被两边激活**：先在那边
 * 打开过的会话，在这边点它就会失败。
 *
 * 失败在用户面前的样子是官方那条通用错误码加一段原始文案（实测原文）：
 *
 * ```
 * resume failed for session "session-…": SessionAlreadyOwnedError:
 *   session "session-…" is already owned by an active write handle
 * ```
 *
 * （`(gateway/internal)` 是官方 `ApiSessionAgentController.resolve()` 捕获异常时套的
 * RemoteError 码，不是持有者名字——#145 的诊断结论。）
 *
 * 判定只认官方错误类名（`SessionAlreadyOwnedError`，`dsh-session-persistence` 的导出
 * 类名，随包版本稳定），不认文案细节——文案里的 `resume failed for session …` 前缀是
 * 官方 `resolve()` 拼的，措辞随时可能改。
 *
 * 纯函数、无 IO、无 `vscode` import（`node --test` 直接测）。
 */

/** 官方错误类名（`dsh-session-persistence` 导出，报文里以 `Error.name` 出现）。 */
export const SESSION_ALREADY_OWNED_ERROR_NAME = 'SessionAlreadyOwnedError'

/** 这条错误是不是「会话已被另一个 dsh 进程的写句柄占用」。 */
export function isSessionAlreadyOwnedError(message: unknown): boolean {
  return typeof message === 'string' && message.includes(SESSION_ALREADY_OWNED_ERROR_NAME)
}
