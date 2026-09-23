/**
 * 装配页的**启动自愈**（#228）：官方启动审计报「某条目起不来」时，页面自己把点名的
 * 那一条从**本页清单**里摘掉、把这一页重载**一次**；重试之后再失败就落到失败提示条
 * （`failureNotice.ts`，#201），不再摘、不再重载。
 *
 * ## 为什么要页面自己来（#225 那个现场）
 *
 * dsh 0.1.6-alpha.2 上，官方启动审计报
 * `web boot: 1 entry did not activate` /
 * `@deepseek-ai/dsh-client-ui-plan: pending (waiting for service: uiConversation)`，
 * 整页被官方那张「Failed to load plugins」卡挡住。规则化那条（#227 改 block list 的
 * 推导）覆盖「依赖被挡掉的包」这一类，但覆盖不了所有漂移（服务级依赖、官方新加的
 * 注入项、官方改名……）。所以还要有一手页面自己的补救：让用户不必等我们发版。
 *
 * ## 机制分层（照 AGENTS.md 的机制优先序）
 *
 * - **官方预留 seam（第 3 层）**：清单本身就是 seam——`globalThis.__DSH_BOOT__` 是官方
 *   给 shell 预留的启动清单（`__DSH_BOOT__` 与 `__DSH_TRANSPORT__` 同一类），页面在
 *   它被官方模块消费之前改它，属于「用官方给的口子换一份清单」，不是改官方产物。
 * - **官方机制名词**：摘条目这件事没有官方 API（官方没有「卸掉一个起不来的条目」的口子），
 *   所以这里做的是**和宿主侧 block list 同一个形状**的事（`wireFilter.ts` 的过滤）：
 *   从 entries 里去掉那一行、从它所在批的 entries 里去名、把批的 combo URL 里那一段
 *   也去掉。只减不增，且只减官方点名的那一条。
 *
 * ## 三个必须是死的
 *
 * 1. **只重试一次，绝不循环**：能不能重载取决于「这一页之前有没有用过那一次」——
 *    记录写在 `sessionStorage`（作用域 = 这一个页面实例，重载保留、新面板另算）。
 *    记录**写成功**才允许重载：存储不可用（隐私模式等）时**不重载**，直接落到失败
 *    提示条——写不下记录就没有「只用一次」的保证，宁可不救也不循环。
 * 2. **只认官方点出来的 id**：审计文本里的那条 id 是唯一输入。文本不是审计形状
 *    （正则不中）时什么都不动。id 在本页清单里摘不干净（不在 entries 里、在
 *    bootstrap 批里、是它所在批的唯一成员——官方 `parseBootManifest` 会拒绝空批与
 *    「不属于任何批的条目」）时也不重载，直接落到失败提示条：救不了就别浪费那一次。
 * 3. **必须留痕、必须上报**：摘了谁、因为什么都写成一行日志。在 VS Code webview 里
 *    探针（`probe.ts`）把 `console.warn` 转发进扩展日志，所以这一行**同时**落在宿主
 *    日志与开发者控制台；实验室里就是那条被 harness 采集的控制台行。**不能悄悄修好**
 *    ——否则 `verify:lab` 的 F-01「零装载未激活」就失去检测能力，漂移会变成永远
 *    发现不了。原始审计错误照旧原样打到控制台（这层钩子只旁听，不吞）。
 *
 * ## #237 补上的两条边界（这一手不许缩放成灾难）
 *
 * 4. **一次点名太多就不摘**（`SELF_HEAL_MAX_IDS`）：那是系统性故障（整批没到 / 网关刚
 *    重启 / 上游改了装载形状），摘掉点名的那些既救不回来、又是按故障规模肢解本页清单。
 *    #237 的现场就是没有这条边界——49 条一路摘到 62 条。判据是**规模**，不是错误文案：
 *    两种故障在审计里都写 `import failed`。
 * 5. **记录用完要清**（`watchForBoot` 与 `act` 里那两条 one-way 路径）：这一页真的起来了
 *    （#root 出现过内容、审计静了一个窗口）或者「审计点名的那几条都不是我们摘掉的那几条」
 *    （= 那次摘除不是解药，#237 现场的形状）时就把记录删掉。记录说的是「上一轮为什么摘下
 *    这些」，不是对某条目的永久判决——不清的话，根因修好了这一页也照旧每次加载都摘一遍
 *    （#237 的现场里那份记录从写下到用户手动清 sessionStorage 都在）。
 */

/** 这一次重试的记录（作用域 = 一个页面实例，重载保留）。 */
export const SELF_HEAL_STORAGE_KEY = 'dsh-one.assembly.self-heal'

/**
 * 本页清单被摘过的痕迹（挂在 `<html>` 上的属性值 = 本次摘掉的 id，逗号分隔）。
 *
 * 为什么要在 DOM 上留一格：日志是给人和宿主日志看的，属性是给断言与「一眼看出这一页
 * 和宿主下发的那份清单不一样」用的——页面上出现它，就说明**这一页的清单被页面自己改过**。
 */
export const SELF_HEAL_MARK = 'data-dshone-self-heal'

/** 审计文本进日志/记录时截断到这个长度（够看清 id 与原因，不把整段错误灌进日志）。 */
const TEXT_LIMIT = 400

/**
 * 一次审计最多摘几条（#237）。**超过就不摘**——一次点名这么多条目，那不是「某个插件
 * 起不来」，而是系统性故障（我们转发的那一份整包整批没到、网关刚重启、上游改了装载
 * 形状……），摘掉点名的那些既救不回来、又是在按系统性故障的规模**肢解本页清单**：
 * #237 的现场就是这么从 49 条一路摘到 62 条的（记录还存在 sessionStorage 里、从不
 * 清除，每次加载继续摘）。
 *
 * 为什么判据是「条数」而不是「错误属于 import 那一类」：两种故障在审计文本里都可能写
 * `import failed`——#237 现场是整批 49 条（系统性），而 #228 那一手要救的场合也可能
 * 只有一条（那一条自己的代码就是取不到、或它等的服务没了）。判据落在**规模**上，
 * 两种场合才分得开；系统性那一类（一次几十条）天然远超这个阈值。
 */
export const SELF_HEAL_MAX_IDS = 3

/**
 * 页面启动一次、清单里没有任何条目起不来（= 官方启动审计没报错）时，把记录清掉
 * （#237 的另一半）。不清的后果：根因修好之后这一页照旧每次加载都摘一遍——那份记录
 * 是「上一轮为什么摘」的**状态**，不是对某条目的永久判决。
 *
 * 判据落在「页面上真的渲染出东西了，而审计一次都没报」：官方那次审计一定发生在它
 * 渲染自己的失败卡之前（`console.error` 是最早的载体），所以「#root 里出现了子节点 +
 * 审计没报」= 这一页真的起来了。
 */

/**
 * 自愈脚本（`pageHtml` 以内联 `<script nonce>` 注入，位置**在 `__DSH_BOOT__` 赋值之后、
 * 阻塞 bootstrap script 与主 bundle 之前**）。
 *
 * 为什么必须在这个位置：`__DSH_BOOT__` 由上一行内联脚本赋上、由**主 bundle**
 * （`<script type="module">`，默认 defer，解析完才跑）消费——夹在中间才既拿得到清单、
 * 又赶得上在官方读它之前改完。bootstrap 批（官方 client-modules 自己）永远不摘：
 * 那一段的 `<script src>` 在服务端就已经拼好写进 HTML，改清单也换不掉它。
 *
 * 内嵌脚本里的注释一律英文（与 pageHtml.ts 其余几段内联脚本同规矩）。
 */
export function selfHealJs(): string {
  return `(() => {
  var KEY = ${JSON.stringify(SELF_HEAL_STORAGE_KEY)}
  var MARK = ${JSON.stringify(SELF_HEAL_MARK)}
  var FAILURE_API = ${JSON.stringify('__DSH_ONE_PAGE_FAILURE__')}
  var LIMIT = ${String(TEXT_LIMIT)}
  // At most this many entries are ever dropped at once (see SELF_HEAL_MAX_IDS): an audit
  // naming more than that is a systematic failure (a whole batch never arrived, the gateway
  // was restarted, upstream changed how entries load), and amputating this page's manifest
  // at that scale cannot fix it - it only strips entries the page still needs.
  var MAX_DROP = ${String(SELF_HEAL_MAX_IDS)}
  // The official boot audit (WebBoot.run in the frontend bundle) collects every loader
  // entry that is not active and throws ONE Error whose first line is this sentence, then
  // names each entry on its own line - "<id>: pending (waiting for service: x)" or
  // "<id>: import failed (see console for the import error)". Only the ids it printed are
  // ever used; nothing here guesses what else might be broken.
  var AUDIT = /^web boot: \\d+ entr(?:y|ies) did not activate/
  var ID_LINE = /^(\\S+): /
  // The page's own log channel: in the VS Code webview probe.ts wraps console.warn and
  // forwards it to the extension log; in the lab it is the console line the harness
  // captures. The audit itself is never swallowed (below), so the drift stays visible.
  var report = function (text) {
    try { console.warn("page self-heal: " + text) } catch (ignored) {}
  }
  // The single retry this page instance is allowed, as recorded before the reload.
  var read = function () {
    try {
      var raw = sessionStorage.getItem(KEY)
      if (raw === null) return null
      var value = JSON.parse(raw)
      if (value === null || typeof value !== "object" || !Array.isArray(value.removed)) return null
      return value
    } catch (ignored) {
      return null
    }
  }
  var write = function (removed, reason) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ attempt: 1, removed: removed, reason: reason }))
      return true
    } catch (ignored) {
      return false
    }
  }
  var isObject = function (value) { return value !== null && typeof value === "object" }
  var batchOf = function (wire, id) {
    if (!isObject(wire) || !Array.isArray(wire.batches)) return null
    for (var i = 0; i < wire.batches.length; i++) {
      var batch = wire.batches[i]
      if (isObject(batch) && Array.isArray(batch.entries) && batch.entries.indexOf(id) !== -1) return batch
    }
    return null
  }
  var hasRow = function (wire, id) {
    if (!isObject(wire) || !Array.isArray(wire.entries)) return false
    for (var i = 0; i < wire.entries.length; i++) {
      var row = wire.entries[i]
      if (isObject(row) && row.id === id) return true
    }
    return false
  }
  // Drop one id from a combo URL's resource list ("/plugins-local/??<id>/client.js,…&rev=…").
  var dropFromUrl = function (url, id) {
    var start = url.indexOf("/??")
    var end = start === -1 ? -1 : url.indexOf("&", start)
    if (end === -1) return url
    var items = url.slice(start + 3, end).split(",")
    var kept = []
    for (var i = 0; i < items.length; i++) {
      if (items[i] !== id + "/client.js" && items[i] !== id) kept.push(items[i])
    }
    if (kept.length === items.length) return url
    return url.slice(0, start + 3) + kept.join(",") + url.slice(end)
  }
  // Can this id be dropped without leaving the manifest self-contradictory? The official
  // parser rejects a batch with an empty resource list and an entry that belongs to no
  // batch, so: the bootstrap batch is off limits (the loader itself, and its script URL
  // is already fixed in this HTML), and a row that is the only member of its batch would
  // leave that batch empty.
  var canDrop = function (wire, id) {
    if (!isObject(wire) || !hasRow(wire, id)) return false
    var batch = batchOf(wire, id)
    if (batch === null) return true
    if (batch.phase === "bootstrap") return false
    return batch.entries.length > 1
  }
  var dropOne = function (wire, id) {
    if (!isObject(wire)) return false
    var dropped = false
    if (Array.isArray(wire.entries)) {
      var rows = []
      for (var i = 0; i < wire.entries.length; i++) {
        var row = wire.entries[i]
        if (isObject(row) && row.id === id) { dropped = true; continue }
        rows.push(row)
      }
      wire.entries = rows
    }
    var batch = batchOf(wire, id)
    if (batch !== null && batch.phase !== "bootstrap" && batch.entries.length > 1) {
      var kept = []
      for (var j = 0; j < batch.entries.length; j++) {
        if (batch.entries[j] !== id) kept.push(batch.entries[j])
      }
      batch.entries = kept
      if (typeof batch.url === "string") batch.url = dropFromUrl(batch.url, id)
      dropped = true
    }
    return dropped
  }
  var auditIds = function (text) {
    var lines = String(text).split("\\n")
    if (!AUDIT.test(lines[0])) return null
    var ids = []
    for (var i = 1; i < lines.length; i++) {
      var match = ID_LINE.exec(lines[i])
      if (match !== null) ids.push(match[1])
    }
    return ids
  }
  // Apply the recorded retry, if this page already used it (a reload lands here).
  var retried = read()
  if (retried !== null) {
    var wire = globalThis.__DSH_BOOT__
    var dropped = []
    for (var index = 0; index < retried.removed.length; index++) {
      var id = retried.removed[index]
      if (canDrop(wire, id) && dropOne(wire, id)) dropped.push(id)
    }
    try { document.documentElement.setAttribute(MARK, dropped.join(",")) } catch (ignored) {}
    report("stripped [" + dropped.join(", ") + "] from this page's manifest; the previous load's boot audit was: " + retried.reason)
  }
  var notice = function (text) {
    var api = globalThis[FAILURE_API]
    if (api === undefined) return
    // force: the audit text is first-hand evidence and beats whatever the bar captured
    // passively (a cross-origin classic script's sanitized "Script error." often wins that
    // race - measured in the lab on this very scene).
    try { api.note(text, true) } catch (ignored) {}
    try { api.show() } catch (ignored) {}
  }
  var handled = false
  // Forgetting the record (see SELF_HEAL_STORAGE_KEY): two one-way paths, both write one line.
  var forget = function (why) {
    try { sessionStorage.removeItem(KEY) } catch (ignored) {}
    report("the retry record is cleared - " + why)
  }
  var act = function (ids, text) {
    var trimmed = String(text).replace(/\\s+/g, " ").trim().slice(0, LIMIT)
    if (retried === null) {
      // Too many entries at once = a systematic failure, not one broken entry: report it and
      // touch nothing (see MAX_DROP). Dropping them would gut this page's manifest without
      // fixing anything, and the record would keep doing it on later loads.
      if (ids.length > MAX_DROP) {
        report("the boot audit named " + ids.length + " entries (more than " + MAX_DROP + "), which is a systematic failure rather than one broken entry; dropping nothing - " + trimmed)
        notice(trimmed)
        return
      }
      var droppable = []
      for (var i = 0; i < ids.length; i++) {
        if (canDrop(globalThis.__DSH_BOOT__, ids[i])) droppable.push(ids[i])
      }
      if (droppable.length === 0) {
        report("the boot audit named [" + ids.join(", ") + "] but none of them can be dropped from this page's manifest; not reloading - " + trimmed)
        notice(trimmed)
        return
      }
      if (!write(droppable, trimmed)) {
        report("cannot record the single retry (session storage unavailable); not reloading - " + trimmed)
        notice(trimmed)
        return
      }
      report("the boot audit named [" + ids.join(", ") + "] -> dropping [" + droppable.join(", ") + "] and reloading this page once - " + trimmed)
      try { location.reload() } catch (ignored) {}
      return
    }
    // This load carried the record. If the audit now names none of the entries that record
    // dropped, that drop was not the remedy for what is broken now (the #237 scene: the
    // dropped ids never come back, fresh ones keep showing up) - so it must not be carried
    // into later loads.
    var relevant = false
    for (var j = 0; j < ids.length; j++) {
      if (retried.removed.indexOf(ids[j]) !== -1) relevant = true
    }
    if (!relevant) {
      forget("the boot audit named none of the entries this page dropped ([" + retried.removed.join(", ") + "])")
    }
    report("the boot audit failed again after the single retry; dropping nothing more - " + trimmed)
    notice(trimmed)
  }
  var detect = function (text) {
    if (handled) return
    var ids = auditIds(text)
    if (ids === null || ids.length === 0) return
    handled = true
    act(ids, text)
  }
  // Clear the record once this page has served its purpose (see SELF_HEAL_STORAGE_KEY's note):
  // the record says "the previous load failed and here is what got dropped", and it must not
  // outlive the reason it was written. Signal = "#root has shown content, and the audit stayed
  // quiet for a settle window".
  //
  // Why a window rather than "there is content": our own frame plugin mounts into #root as soon
  // as its entry activates, which happens *before* the official audit is computed (official
  // run(): load all entries, wait for them, and only then audit). So content can appear on a
  // page that is about to fail (measured in the lab on this very scene). Both directions are
  // one-way loose ends and this one is the cheap side: never clearing keeps a plugin out of
  // this page's manifest forever after the cause is gone (the #237 harm), while clearing early
  // costs one extra reload the next time the page is opened while the entry is still broken
  // (that load re-writes the record when it strips).
  var BOOT_QUIET_TICKS = 4
  var BOOT_TICK_MS = 500
  var watchForBoot = function () {
    if (retried === null) return
    if (typeof setTimeout !== "function") return
    var doc = typeof document === "undefined" ? undefined : document
    if (doc === undefined || typeof doc.getElementById !== "function") return
    var quiet = 0
    var tick = function () {
      if (handled) return
      var root = doc.getElementById("root")
      var children =
        root === null || root === undefined || root.childNodes === null || root.childNodes === undefined
          ? 0
          : root.childNodes.length
      quiet = children > 0 ? quiet + 1 : 0
      if (quiet >= BOOT_QUIET_TICKS) {
        forget("this page rendered with the recorded drop in place and the boot audit stayed quiet for " + String(BOOT_QUIET_TICKS * BOOT_TICK_MS) + "ms")
        return
      }
      try { setTimeout(tick, BOOT_TICK_MS) } catch (ignored) {}
    }
    try { setTimeout(tick, BOOT_TICK_MS) } catch (ignored) {}
  }
  watchForBoot()
  // console.error is the earliest carrier: the official run() logs the audit error before
  // it renders its own failure card. Pass everything through unchanged.
  var originalError = console.error
  console.error = function () {
    var args = Array.prototype.slice.call(arguments)
    try { originalError.apply(console, args) } catch (ignored) {}
    for (var i = 0; i < args.length; i++) {
      var arg = args[i]
      var text = arg instanceof Error ? arg.message : typeof arg === "string" ? arg : ""
      if (text !== "") detect(text)
    }
  }
  // Wired as well in case a future official version lets the audit escape the boot catch
  // instead of rendering its card (then the error reaches window.onerror, not console).
  window.addEventListener("error", function (event) {
    var error = event.error
    detect(error && error.message ? error.message : event.message || "")
  })
})()`
}
