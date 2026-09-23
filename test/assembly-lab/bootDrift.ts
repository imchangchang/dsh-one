/**
 * 「某条目永远起不来」的现场（#228 的启动自愈要在它上面验，浏览器实验室专用）。
 *
 * ## 为什么要有这个夹具，而不是等真漂移复现
 *
 * 真现场（#225）是「官方某个插件在某一版开始等一个这棵树里不存在的服务」，要复现
 * 就得把某个官方插件重新放回某棵树的清单里——那条路**绑死在某一版官方产物上**
 * （alpha.2 上 ui-plan 才等 uiConversation），下一个版本官方一改，套件就假红。
 * 这里走的是同一类失败里**不依赖官方依赖图**的那一半：往本页清单里加一条
 * **没有任何 bundle 会注册**的条目，官方装载器取它的代码时找不到注册 → 官方启动审计
 * 照样报 `web boot: 1 entry did not activate` + `<id>: import failed (see console for
 * the import error)`（0.1.6-alpha.2 实测，2026-09-22）。
 *
 * 判据读的是**官方那句审计报错**（F-01 的 `BOOT_FAIL_RE` 同一条口径），自愈那侧只认
 * 报错里点名的 id——所以夹具要的是「审计点名一个 id」，形状与真漂移一致。
 *
 * ## 两条取值（`?drift=`）
 *
 * - `sick:<id>`：**每次加载都**加同一个 id —— 自愈能救（摘掉它，重载后这一页正常）。
 * - `fresh:<前缀>`：**每次加载换一个 id**（`<前缀>-<序号>`）—— 自愈救不了（摘掉的那条
 *   在下一轮不存在了，新的一条又冒出来），用来验「只试一次，再失败就落到失败提示条」。
 * - `many:<条数>`（#237）：一次往清单里塞这么多条没人注册的条目 —— 官方审计一次点名
 *   这么多条，正是**系统性故障**的形状（#237 现场：把第三方插件那个用户那一页的
 *   49 条一次性报出来），自愈按规模阈值收手：一条都不摘、落到失败提示条。
 *   条数与 `SELF_HEAL_MAX_IDS` 的关系由 F-67 那一档自己说清楚（要用大于阈值的值）。
 *
 * ## 为什么 id 不进批的 combo URL
 *
 * 镜像（`server/assemblyMirror.ts`）对请求里的本机插件 id 是**按 id 读盘**的：把这条
 * 合成 id 塞进批 URL 只会让整包请求 404/502（页面上什么都起不来，那就不是本条要的现场
 * 了）。官方客户端取模块代码用的是**批的 URL**（`arrive()` 的 `row.initialUrl`），所以
 * 「条目在 entries 与批里、批 URL 里没有它」正是「这条永远注册不上」的形状。
 *
 * ## 这个夹具自带的一点噪音（如实记下，不影响判据）
 *
 * 合成条目的代码取不到，官方装载器会对**已经加载过的那个批 URL 再取一次**
 * （`arrive()` 按 URL 去重只覆盖同时在飞的请求），整包于是执行了第二遍，客户端为每个
 * 已在表里的条目抛 `duplicate factory registration … (bundle executed twice without
 * invalidate?)`——页面上是一串未捕获错误。真漂移（例如 #225 那种「服务等不到」）不会
 * 走这一步：那条的代码一直在整包里、只是不激活。所以这些 pageerror 是这个夹具的形状
 * 带来的，跟自愈要验的那条链路（官方审计点名 → 摘掉 → 重载一次）无关；F-67 的判据一条
 * 都没落在它们身上。
 */
import type { BootWire, BootWireEntry } from '../../src/ui/assembly/wireFilter.ts'

/** 页面查询参数：造漂移现场（取值见文件头）。 */
export const BOOT_DRIFT_QUERY = 'drift'

/** 页面查询参数：`off` = 这一页不装启动自愈（负向对照用）。 */
export const SELF_HEAL_QUERY = 'selfHeal'

/** `?selfHeal=` 的这一取值 = 不装启动自愈（其余取值照常装）。 */
export const SELF_HEAL_OFF = 'off'

/** 稳定漂移（自愈救得了）的 spec 前缀。 */
export const STABLE_DRIFT = 'sick'

/** 每轮换 id 的漂移（自愈救不了）的 spec 前缀。 */
export const FRESH_DRIFT = 'fresh'

/** 一次塞很多条的漂移（系统性故障的形状，验 #237 的规模阈值）的 spec 前缀。 */
export const MANY_DRIFT = 'many'

/** `many:` 那一档的 id 前缀（`?drift=many:<条数>` 只要给条数，id 由这里拼）。 */
export const MANY_DRIFT_ID_PREFIX = '@deepseek-ai/dsh-client-lab-drift-many'

/**
 * 把漂移条目并进这一页的清单。
 *
 * @param wire - 该树过滤后的清单（`filterWire` 的产物）。
 * @param spec - `sick:<id>` / `fresh:<前缀>` / `many:<条数>`（见文件头）；形状不对直接抛，
 *   别静默放过——套件里那个现场要是不成立，红的是「页面没被挡住」一类读起来莫名其妙的
 *   断言。
 * @param seq - 调用方给的序号（实验室按**每次加载**递增）：`fresh:` 用它换新 id，
 *   `many:` 用它让同一页的两次加载拿到两组不同的 id。
 */
export function applyBootDrift(wire: BootWire, spec: string, seq: number): BootWire {
  const colon = spec.indexOf(':')
  const kind = colon === -1 ? '' : spec.slice(0, colon)
  const value = colon === -1 ? '' : spec.slice(colon + 1)
  if (value === '' || (kind !== STABLE_DRIFT && kind !== FRESH_DRIFT && kind !== MANY_DRIFT)) {
    throw new Error(
      `lab: drift spec must be "${STABLE_DRIFT}:<id>", "${FRESH_DRIFT}:<prefix>" or "${MANY_DRIFT}:<count>", got ${JSON.stringify(spec)}`,
    )
  }
  const count = Number(value)
  if (kind === MANY_DRIFT && (!Number.isInteger(count) || count < 1)) {
    throw new Error(`lab: "${MANY_DRIFT}:" needs a positive integer count, got ${JSON.stringify(value)}`)
  }
  const ids =
    kind === STABLE_DRIFT
      ? [value]
      : kind === FRESH_DRIFT
        ? [`${value}-${String(seq)}`]
        : Array.from({ length: count }, (_, index) => `${MANY_DRIFT_ID_PREFIX}-${String(seq)}-${String(index)}`)
  const rows: BootWireEntry[] = ids.map((id) => ({ id, url: `/plugins-local/??${id}/client.js&rev=lab-drift`, rev: 'lab-drift' }))
  return {
    ...wire,
    entries: [...wire.entries, ...rows],
    batches: wire.batches.map((batch) =>
      batch.phase === 'application' ? { ...batch, entries: [...batch.entries, ...ids] } : batch,
    ),
  }
}
