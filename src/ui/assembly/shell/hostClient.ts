/**
 * 宿主能力桥的页面侧薄封装（#65 批 1）：底层是 pageHtml 注入的页面侧 SDK
 * （globalThis.__DSH_ONE_HOST__，见 ui/assembly/hostSdk.ts），本模块只做类型投影与
 * 「SDK 缺席」的兜底拒绝。
 *
 * **插件不直接用本模块**（#84 起）：插件调的是宿主能力口
 * （`./hostCapabilities.ts`），由它决定这次调用落在这条桥上（VS Code 侧）还是落在
 * 宿主半的网关 RPC 上（官方 web 侧）。本模块是那条桥的页面侧门面，只服务能力口
 * （#83 起三个 `dsh-*` 插件都经能力口，已无插件直连本模块）。
 *
 * 每个插件各自打包一份能力口、能力口再打包本模块（各插件是独立 bundle，
 * 没有共享模块作用域）。
 */
export interface HostCallFailure extends Error {
  /** 宿主回执的结构化错误码（unknown-call/invalid-args/not-found/git-missing/no-host/timeout…）。 */
  code?: string
}

interface HostSdk {
  call(name: string, args?: unknown): Promise<unknown>
}

const sdk = (): HostSdk | undefined => (globalThis as { __DSH_ONE_HOST__?: HostSdk }).__DSH_ONE_HOST__

/** 页面侧 SDK 是否已就绪（未就绪时调用会立刻 reject，插件据此走降级路径）。 */
export function hostCallAvailable(): boolean {
  return sdk() !== undefined
}

/** 发起一次宿主能力调用；错误带 code（宿主回执的结构化错误码原样透出）。 */
export function hostCall<T = unknown>(call: string, args?: unknown): Promise<T> {
  const face = sdk()
  if (face === undefined) {
    const error = new Error('the host capability bridge is unavailable in this page') as HostCallFailure
    error.code = 'no-host'
    return Promise.reject(error)
  }
  return face.call(call, args) as Promise<T>
}
