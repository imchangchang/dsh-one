/**
 * 「会话被另一个 dsh 进程占着写权限，这里用不了」的提示通道（#145）。
 *
 * 为什么需要它：dsh 的会话日志是单写者（见 `pure/sessionOwnership.ts` 的文件头），
 * 用户同时开着两个 dsh 实例时，先在那边打开过的会话在这边点它就会激活失败。这次失败
 * 官方客户端**没有界面**——`api-session/error` 只落到会话对象的 `lastAgentError` 上
 * （0.1.6-alpha.1 全仓只有一个写入方、没有读取方），用户当场看到的只有之后发消息时
 * 那条原始吐司（`resume failed for session …: SessionAlreadyOwnedError: …`），既看不出
 * 原因也没有下一步。侧栏树是用户点击的地方，在这里给一条能行动的提示。
 *
 * 为什么走模块级信号而不是 props：订阅的安装点在插件 `apply`（拿得到官方客户端服务
 * `remote`），而**文案的翻译**要做在组件里（`tr` 是组件那一层的东西，官方没有给插件层
 * 的同步取词口）。两者之间就用这条模块级信号连起来——与 `flash.ts`（飘提示）、
 * `selection.ts`（选择态入口信号）同一处置。
 *
 * 与 `flash.ts` 的分工：这里只说「发生了什么」，怎么显示归飘提示宿主。
 */

const listeners = new Set<(sessionId: string) => void>()

/**
 * 报一次「该会话被别的 dsh 进程占着」。
 *
 * 每次事件都报（不按会话去重）：用户每点一次那行会话，都该拿到一次反馈——静默会让
 * 人以为界面卡住了。
 */
export function reportSessionOwnedElsewhere(sessionId: string): void {
  for (const listener of [...listeners]) listener(sessionId)
}

/** 订阅（返回退订函数）。 */
export function onSessionOwnedElsewhere(listener: (sessionId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
