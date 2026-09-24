/**
 * 宿主调用通道的页面侧小 SDK（#65 批 1）——由 pageHtml 以内联 nonce 脚本注入，
 * 四棵树的装配页都装：
 *
 *   globalThis.__DSH_ONE_HOST__.call(name, args) -> Promise<data>
 *
 * 职责只有两件：**id 配对**（每次调用生成本页唯一 id，回执按 id 兑现 Promise）
 * 与 **统一获取点复用**（`__DSH_ONE_VSCODE__`，probe.ts 首调 acquireVsCodeApi
 * 后挂的共享实例——VS Code 全页只允许 acquire 一次，插件不得自行再 acquire）。
 *
 * 无宿主（普通浏览器/实验室未装假宿主）时调用直接 reject no-host：装配页绝不
 * 主动要求 VS Code API，只是「有就用」（与 probe.ts 同一约束）。
 */
export function hostSdkJs(): string {
  return `(() => {
  var pending = new Map()
  var seq = 0
  var TIMEOUT_MS = 15000
  var acquire = function () {
    var g = globalThis
    var vscode = g.__DSH_ONE_VSCODE__
    if (vscode === undefined && typeof g.acquireVsCodeApi === "function") {
      try {
        vscode = g.acquireVsCodeApi()
        g.__DSH_ONE_VSCODE__ = vscode
      } catch (ignored) {
        /* 二次 acquire throw：实例已被 probe 持有且全局缺失（不应发生） */
      }
    }
    return vscode
  }
  var fail = function (message, code) {
    var error = new Error(message)
    error.code = code
    return error
  }
  var call = function (name, args) {
    return new Promise(function (resolve, reject) {
      var vscode = acquire()
      if (vscode === undefined) {
        reject(fail("no VS Code host in this page", "no-host"))
        return
      }
      var id = "hc" + (++seq) + "-" + Math.random().toString(36).slice(2, 10)
      var timer = setTimeout(function () {
        if (pending.delete(id)) reject(fail("host call timed out: " + name, "timeout"))
      }, TIMEOUT_MS)
      pending.set(id, {
        resolve: function (value) { clearTimeout(timer); resolve(value) },
        reject: function (error) { clearTimeout(timer); reject(error) },
      })
      try {
        vscode.postMessage({ type: "dshOne.hostCall", call: name, args: args === undefined ? null : args, id: id })
      } catch (error) {
        if (pending.delete(id)) { clearTimeout(timer); reject(fail(String(error), "post-failed")) }
      }
    })
  }
  addEventListener("message", function (event) {
    var data = event.data
    if (data === null || typeof data !== "object" || data.type !== "dshOne.hostResult") return
    if (typeof data.id !== "string") return
    var waiter = pending.get(data.id)
    if (waiter === undefined) return
    pending.delete(data.id)
    if (data.ok === true) {
      waiter.resolve(data.data)
      return
    }
    var error = data.error !== null && typeof data.error === "object" ? data.error : {}
    waiter.reject(fail(typeof error.message === "string" ? error.message : "host call failed", typeof error.code === "string" ? error.code : "failed"))
  })
  globalThis.__DSH_ONE_HOST__ = { call: call, pendingCount: function () { return pending.size } }
})()`
}
