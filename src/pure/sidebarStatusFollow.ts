/**
 * 侧栏状态页跟随服务状态变化（#101）。
 *
 * 状态页（`src/ui/sidebarStatusPage.ts`）画出来之后不会自己刷新：服务被别处起停
 * （状态栏的停止/重启、另一个窗口 adopt 上来、启动失败后再点一次）时，用户看到的
 * 还是画出来的那一刻的状态，要等他下一次动作（点按钮、折叠再展开侧栏）才对。
 * 这里把「订阅状态变化 → 按新状态重画」这段接线收成一个小对象，宿主侧
 * （`src/ui/assemblyView.ts`）持着它，跟着侧栏视图的生命周期起停。
 *
 * 为什么单独放 pure：真正要钉住的不是「重画成了什么」，而是**订阅的生命周期**——
 * 视图隐藏时要退订、重新可见时要重订、重试时不能留下一份重复的监听（多一份，
 * 状态每变一次就多触发一次重画）。这些用假事件源就能断言，不必起 VS Code。
 */

/**
 * 事件源只要能「登记一个监听、返回退订句柄」就行（`vscode.Event` 天然满足）。
 * 不写死具体状态类型：判定归 `src/pure/sidebarStatus.ts`，这里只转发。
 */
export interface StatusChangeSource<S> {
  onDidChangeState(listener: (status: S) => void): { dispose(): void }
}

export interface StatusFollowOptions<S> {
  /** 状态事件源（宿主侧传 `ServerManager` 本身）。 */
  source: StatusChangeSource<S>
  /**
   * 当前画在视图里的是不是状态页。装配页在位时返回 false —— 装配页是官方的页面，
   * 它自己管刷新；状态页的跟随不该去抢它，否则服务状态一变就把用户正在看的页面换掉。
   */
  isStatusShown(): boolean
  /** 状态页在位、且服务状态变了：按新状态重画（或服务起来了，该去装配）。 */
  onStatusChanged(status: S): void
}

export interface StatusFollow {
  /** 开始跟随。已在跟随就什么都不做（挂不出第二份监听）。 */
  start(): void
  /** 停止跟随并退订。没在跟随也不报错。 */
  stop(): void
  /** 当前是否在跟随。 */
  started(): boolean
}

export function createStatusFollow<S>(options: StatusFollowOptions<S>): StatusFollow {
  let sub: { dispose(): void } | undefined
  return {
    start(): void {
      if (sub !== undefined) return
      sub = options.source.onDidChangeState((status) => {
        if (!options.isStatusShown()) return
        options.onStatusChanged(status)
      })
    },
    stop(): void {
      sub?.dispose()
      sub = undefined
    },
    started: () => sub !== undefined,
  }
}
