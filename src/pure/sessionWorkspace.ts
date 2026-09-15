/**
 * 「当前会话的工作目录」取值契约（纯函数，便于单测）。数据来源是官方服务
 * （机制层 2），按优先序取：
 *
 * 1. 官方 sessions 服务的 list 快照里当前会话行的 `cwd`
 *    （`ctx.sessions.list.getSnapshot().byId[current].cwd`，ui-chat 的 openFile
 *    也用同一处解析「会话路径」）——这是该会话工具调用真正的工作目录；
 * 2. 官方 workspaces 服务注册表里 sessionIds 含当前会话的那一行的 `path`
 *    （`ctx.workspaces.list.getSnapshot().items`，WorkspaceView.path）——
 *    cwd 缺失时（老数据/未投影）用它兜底；
 * 3. 两者都拿不到 → undefined：调用方回落宿主自己的 VS Code 工作区，
 *    不报错、不猜。
 */
export interface SessionWorkspaceSources {
  /** 官方 sessions list 行的 cwd。 */
  sessionCwd?: string | undefined
  /** 官方 workspaces 注册表里该会话所属工作区的 path。 */
  workspacePath?: string | undefined
}

/** 按优先序取一个非空路径；都没有则 undefined。 */
export function pickSessionWorkspacePath(sources: SessionWorkspaceSources): string | undefined {
  const cwd = sources.sessionCwd
  if (typeof cwd === 'string' && cwd !== '') return cwd
  const path = sources.workspacePath
  if (typeof path === 'string' && path !== '') return path
  return undefined
}
