/**
 * 侧栏状态页的分流判定（#100）：把「宿主侧服务状态 + 装配失败的处境」归成三态
 * 之一，交给宿主侧渲染。纯数据——不 import 任何 VS Code API，装配视图
 * （src/ui/assemblyView.ts）与单测共用。
 *
 * 为什么状态页必须是宿主侧渲染的普通 HTML：侧栏位平时装的是「装配页」，它要
 * 本机 dsh 网关下发官方前端资产；dsh 没装时网关根本起不来，装配页组装不了。
 * 所以这一层不能参与装配树，判定也就必须能脱离 vscode 单测。
 *
 * 三态：
 * - `notInstalled`：`locateDsh` 找不到 dsh（`reason === 'dshNotFound'`）；
 * - `serviceDown`：服务没在跑或在启动中（含认证实例防护这类启动失败）；
 * - `assemblyFailed`：服务在跑但装配失败（拉清单 / 起 loopback 代理出错）。
 */

/** 判定需要的宿主侧状态（`ServerManager.getStatus()` 的子集，结构化兼容）。 */
export interface SidebarHostStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  url?: string
  /** 启动失败原因（`ServerStatus.reason`）：`dshNotFound` = 未安装。 */
  reason?: string
  /** 启动失败详情（`ServerStatus.error`），原样展示给用户。 */
  error?: string
}

/** 状态页要渲染的一态（`assemble` 不在此列：那是「不用状态页，去装配」）。 */
export type SidebarStatusView =
  | { kind: 'notInstalled' }
  | { kind: 'serviceDown'; starting: boolean; detail?: string }
  | { kind: 'assemblyFailed'; detail: string }

/** 判定结果：`assemble` = 服务在跑，交给装配页；其余三态由状态页渲染。 */
export type SidebarStatusDecision = { kind: 'assemble'; url: string } | SidebarStatusView

/**
 * 装之前先判「该给用户看哪一态」。未安装优先于一切：dsh 没装时网关起不来，
 * 装配失败只是它的下游表现，报「装配失败」会让用户去查一个他解决不了的错误。
 */
export function decideSidebarStatus(status: SidebarHostStatus): SidebarStatusDecision {
  if (status.reason === 'dshNotFound') return { kind: 'notInstalled' }
  // 启动中：只说「正在启动」，不给启动按钮（再点一次没有意义）。
  if (status.state === 'starting') return { kind: 'serviceDown', starting: true }
  if (status.state !== 'running' || status.url === undefined) {
    return status.error === undefined
      ? { kind: 'serviceDown', starting: false }
      : { kind: 'serviceDown', starting: false, detail: status.error }
  }
  return { kind: 'assemble', url: status.url }
}

/**
 * 装配失败时的落点：服务在跑却装不起来（清单拉取失败、loopback 代理起不来、
 * 内核版本不合等）。未安装仍优先走 `notInstalled`——装配过程中发现的「没装」
 * 与启动时发现的「没装」是同一种处境。
 */
export function assemblyFailureView(status: SidebarHostStatus, error: string): SidebarStatusView {
  if (status.reason === 'dshNotFound') return { kind: 'notInstalled' }
  return { kind: 'assemblyFailed', detail: error }
}
