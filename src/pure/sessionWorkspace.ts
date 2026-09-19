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
 *
 * ## 为什么两路都必须留（#182 实测定案）
 *
 * #96 审计的 D7 提过「只留 workspaces.list 的 path 一路」，理由是 `byId[current].cwd`
 * 取的是官方字段名（三档依赖）。**实测证明收成一路会真的少认会话**，所以两路保留，
 * 并把这条登记成**有意依赖**：
 *
 * - 工作区那一行的 `sessionIds` 只覆盖「归属该工作区」的会话；**子代理会话**
 *   （`parentId` 有值，官方 `dsh-client-ui-subagent` 允许从会话头目录打开任一层）与
 *   **未分组会话**（官方 `session/create {cwd}` 建的、或侧栏「未分组」桶的 ＋ 建的
 *   `sessions.create({})`）都不在任何 `sessionIds` 里。本机 2026-09-18 实测：584 条
 *   子会话只有 25 条在册；工作区分档数据里 107 条未分组会话全部不在册；
 * - 这两类会话若只剩工作区一路就拿不到 cwd，宿主会回落到 VS Code 工作区目录。同一台
 *   临时 `DSH_HOME` 网关 + 真 git 的实测：未分组会话的提交在会话自己那个目录里查得到
 *   （`查到=true`），收成一路后查询根变成 VS Code 打开的那个仓库（`查到=false`）；
 * - 反过来看，**属工作区的会话两路本来就同值**：官方 `session/create` 走 workspaceId
 *   那条路时 cwd 直接取 `workspace.path`（`dsh-api-session-controller` 的
 *   `SessionCommandController.create`），而且成员归属是「ownership + cwd 事实」——
 *   显式 cwd 的会话不会因此被收进工作区（实测过）。所以「会话 cwd 与所属工作区 path
 *   不一致」这件事在真实数据里只可能出现在非成员会话上，而这个场景恰恰只有 cwd 一路
 *   答得出来。
 *
 * 注意：`SessionSummary.cwd` 是官方客户端服务的**公开字段**
 * （`@deepseek-ai/dsh-api-session-controller/client` 导出 `SessionListState` /
 * `SessionSummary`，该契约模块自述是「the outward sessions-service face — what
 * `ctx.sessions` exposes to feature packages」），不是私有实现细节；只是它仍属 #96
 * 的**三档**（官方字段名），故在此登记为由实测支撑的有意依赖。
 * 常驻护栏 = 实验室 F-60（`test/assembly-lab/gitCardCwdSuites.ts`）。
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
