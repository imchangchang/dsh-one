/**
 * 「候选版本树」这一层的纯函数（#231）：把一棵装出来的 dsh 读成版本清单、判它内部一致、
 * 按确切版本算出钉住整棵树要用的 overrides。CLI 在 `scripts/verify-lab-version.mjs`，
 * 单测在 `test/labCandidateTree.test.ts`。网络那部分（查发布时刻、跑 npm）留在 CLI 里，
 * 这一层只做算得上单测的事。
 *
 * ## 为什么要有这一层（#231 的现场）
 *
 * `@deepseek-ai/dsh` 自己的依赖写的是 `^0.1.6-alpha.1` 这种范围——同一个范围里 alpha.2
 * 也满足，于是 `npm install @deepseek-ai/dsh@0.1.6-alpha.1` 会把**子包**装成 alpha.2、
 * `dsh` 自己还是 alpha.1。这是一棵版本混杂的树：`dsh web` 起不来（实测
 * `SyntaxError: … '@deepseek-ai/dsh-app-boot' does not provide an export named
 * 'watchUserPatches'`），而门禁照跑照出读数——读出来的既不代表候选版、也不代表现网。
 *
 * 同一件事还有**第二半**，0.1.2-rc.1 上实测撞到：上游不只 `dsh*` 这一族按批次发版，
 * `@deepseek-ai/cordis-plugin-hmr` 这种包也在同一批里，范围写成 `^1.0.17`，npm 会顺到比
 * 候选版本晚 19 天发布的那一版（1.0.19）——结果 `dsh web` 在启动时就报
 * `user patch-layer watching requires the Cordis HMR service` 并退出（整轮与 F-01 都跑不了）。
 * 所以钉的范围是**上游自己那一批（`@deepseek-ai/*` 全部）**，而不是只有 `dsh*`：
 *
 * - **同族包**（`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`）：钉到候选那一版，并且必须
 *   **彼此同版本**（上游按同一条版本线一起发布）；
 * - **同期上游包**（`@deepseek-ai/cordis*` / `schemastery` / …）：钉到**候选版本发布窗口内**
 *   的那一版（{@link pickAsOfVersion}，窗口由 CLI 算出：候选发布时刻 + 一小时）——就是
 *   「这一版候选发布那天装的树」。
 *
 * 范围之外（`commander`、`js-yaml` 这类第三方）不动：它们版本线独立，也没出过这类事故；
 * 要连它们一起冻就得按日期过滤整棵树，那是另一件事，真需要了再另立条目。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

/** 候选包自己的名字（也是装配侧取清单时认的那个 id）。 */
export const ROOT_PACKAGE = '@deepseek-ai/dsh'

/** 上游那一批包的 scope（钉版本的范围）。 */
export const VENDOR_SCOPE = '@deepseek-ai'

/**
 * 报告里点名的那几个关键子包：`dsh-app-boot` 是 #231 现场那一条，其余是装配链路
 * （boot → 前端运行时 / 渲染器 / 侧栏 / 对话区）与网关，出问题时最先要看它们。
 */
export const KEY_SUBPACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-conversation',
]

/** 树里一个包的一条读数。同一包名可能有多个副本（嵌套安装），每一个都单独列出来。 */
export interface InstalledPackage {
  name: string
  version: string
  /** 相对树根的位置（`node_modules/@deepseek-ai/dsh-app-boot` 这种）。 */
  where: string
  /**
   * 这个包的清单里**自己声明的**上游依赖（包名 → 规格串，只留 `@deepseek-ai/*`）。
   * 用途只有一个：认出「上游自己钉死确切版本」的那些包（见 {@link exactPinnedVersions}）。
   */
  declares?: Record<string, string>
}

/** 期望版本表：树里出现的每个 `@deepseek-ai/*` 包名 → 它该是的那一版。 */
export type VersionTargets = Record<string, string>

/** 版本体检结论。 */
export interface VersionVerdict {
  /** 同族包期望的那一版（= 候选版本；树里没有它就是 undefined）。 */
  candidate: string | undefined
  family: InstalledPackage[]
  /** 同族包里出现过的版本集合（一致时只有一个）。 */
  distinctFamilyVersions: string[]
  /** 版本与期望对不上的包（含同族与同期上游包）。 */
  mismatches: InstalledPackage[]
  /** 树里有、但期望表里没有的上游包——没钉到的那些，读数同样不作数。 */
  unknown: InstalledPackage[]
  missingKey: string[]
  ok: boolean
}

/** 同族包名 = `@deepseek-ai/dsh` 自己，或 `@deepseek-ai/dsh-*`。 */
export function isFamilyName(name: string): boolean {
  return name === ROOT_PACKAGE || name.startsWith(`${ROOT_PACKAGE}-`)
}

/** 上游那一批（钉版本的范围）：`@deepseek-ai/*` 全部。 */
export function isVendorName(name: string): boolean {
  return name.startsWith(`${VENDOR_SCOPE}/`)
}

/**
 * 从 `package-lock.json` 的 `packages` 表里取出上游包名（`@deepseek-ai/*` 全部）。
 *
 * 锁文件的键是路径形状（`node_modules/@deepseek-ai/dsh-app-boot`，嵌套的更长），
 * 所以按末段取包名。用锁文件而不是装完再扫：`npm install --package-lock-only`
 * 只取元数据就能把整棵树的包名解析出来，不用先把上百个包下载解包一遍。
 */
export function vendorNamesFromLock(lock: unknown): string[] {
  const packages = (lock as { packages?: Record<string, unknown> } | undefined)?.packages ?? {}
  const names = new Set<string>()
  for (const key of Object.keys(packages)) {
    const matched = /(?:^|\/)node_modules\/(@[^/]+\/[^/]+)$/.exec(key)
    if (matched !== null && isVendorName(matched[1] ?? '')) names.add(matched[1] ?? '')
  }
  return [...names].sort()
}

/** 锁文件里 `@deepseek-ai/dsh` 解析出来的**确切版本**（范围 / 标签都在这一步落定）。 */
export function resolvedVersionFromLock(lock: unknown): string | undefined {
  const packages = (lock as { packages?: Record<string, { version?: unknown }> } | undefined)?.packages ?? {}
  const entry = packages[`node_modules/${ROOT_PACKAGE}`]
  return typeof entry?.version === 'string' ? entry.version : undefined
}

/**
 * 锁文件里各上游包的**声明规格**（父包自己写的那一串），包名 → 规格（多个父包声明同一个
 * 包名时按字典序取第一个，只为确定性）。
 *
 * 读的是锁文件 `packages[*].dependencies`——它就是各包清单里的那一段，只是不用把上百个包
 * 下载解包一遍就能拿到。{@link exactPinnedVersions} 拿它认出「上游自己钉死确切版本」的包。
 */
export function vendorDeclaredSpecsFromLock(lock: unknown): Record<string, string> {
  const packages =
    (lock as { packages?: Record<string, { dependencies?: Record<string, unknown> }> } | undefined)?.packages ?? {}
  const specs: Record<string, string> = {}
  for (const key of Object.keys(packages).sort()) {
    const dependencies = packages[key]?.dependencies ?? {}
    for (const [name, spec] of Object.entries(dependencies).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!isVendorName(name) || typeof spec !== 'string') continue
      if (specs[name] === undefined) specs[name] = spec
    }
  }
  return specs
}

/** 一条规格串是不是**确切版本**（`1.0.17`，不带 `^` / `~` / 范围 / 标签）。 */
function isExactVersionSpec(spec: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.trim())
}

/**
 * 上游自己**钉死确切版本**的包：包名 → 那一版（规格串里所有确切取值只出现一个时才算，
 * 出现两个相互打架的确切值时交给发布窗口那条启发式、由装完的版本校验去拦）。
 *
 * 为什么要有这条（2026-09-23 实测）：发布窗口那条启发式（{@link pickAsOfVersion}）假设
 * 「同期上游包都按同一批发版」，于是把候选窗口内**最新**的那一版钉住——#231 的现场正是
 * 靠它挡住了 0.1.2-rc.1 上 `^1.0.17` 顺到 1.0.19 的混装。但上游有一批包是**自己钉死
 * 确切版本**的：0.1.5-rc.3 的 `dsh` / `dsh-base` 都把 `@deepseek-ai/cordis-plugin-hmr`
 * 写成 `1.0.17`，而窗口启发式会把它顶成窗口里更新的 1.0.18（比候选早两小时发布）——
 * 那样装出来的树 `dsh web` 起不来，实测报
 * `Error: dsh: user patch-layer watching requires the Cordis HMR service` 并退出。
 * 上游自己钉了就是不希望被顶掉，所以**先看它钉没钉**，钉了就用它钉的那一版。
 */
export function exactPinnedVersions(specs: Record<string, string>): VersionTargets {
  const byName = new Map<string, Set<string>>()
  for (const [name, spec] of Object.entries(specs)) {
    if (!isExactVersionSpec(spec)) continue
    byName.set(name, new Set([...(byName.get(name) ?? []), spec.trim()]))
  }
  const pins: VersionTargets = {}
  for (const [name, versions] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (versions.size !== 1) continue
    pins[name] = [...versions][0] as string
  }
  return pins
}

/**
 * 从 npm 的 `time` 表（包名 → 版本 → 发布时刻）里挑「候选发布窗口内最新的一版」：
 * 发布时刻不晚于 `cutoff` 的那些版本里最新的一个（按发布时刻排，不按版本号排——
 * 预发布版本号的大小顺序与发布时间顺序不一定一致）。
 */
export function pickAsOfVersion(times: Record<string, string>, cutoff: string): string | undefined {
  const limit = Date.parse(cutoff)
  if (Number.isNaN(limit)) return undefined
  let best: { version: string; at: number } | undefined
  for (const [version, at] of Object.entries(times)) {
    if (version === 'created' || version === 'modified') continue
    const stamp = Date.parse(at)
    if (Number.isNaN(stamp) || stamp > limit) continue
    if (best === undefined || stamp > best.at) best = { version, at: stamp }
  }
  return best?.version
}

/**
 * 钉住整棵树用的 `overrides`（包名 → 确切版本）。
 *
 * `@deepseek-ai/dsh` 自己不进 overrides——它在 `dependencies` 里已经是确切版本，
 * npm 也不允许 overrides 与根的直接依赖打架。
 */
export function pinnedOverrides(targets: VersionTargets): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const [name, version] of Object.entries(targets)) {
    if (name === ROOT_PACKAGE) continue
    overrides[name] = version
  }
  return overrides
}

/**
 * 读一棵装出来的树的版本清单：只读 `node_modules` 里的包清单，不跑 `dsh`、不连网。
 * 只留 `scope` 下的包（缺省上游 scope）；嵌套安装的副本也一并列出来——混装现场
 * 恰好就是「同一个名字两个版本」。
 */
export async function readInstalledPackages(
  root: string,
  options: { scope?: string; maxDepth?: number } = {},
): Promise<InstalledPackage[]> {
  const scope = options.scope ?? VENDOR_SCOPE
  const found: InstalledPackage[] = []
  await walk(path.join(root, 'node_modules'), scope, options.maxDepth ?? 6, root, found)
  found.sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)))
  return found
}

async function walk(dir: string, scope: string, depth: number, root: string, found: InstalledPackage[]): Promise<void> {
  if (depth < 0) return
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const at = path.join(dir, entry.name)
    let packageDirs: string[] = []
    if (entry.name === scope) {
      const scoped = await fsp.readdir(at, { withFileTypes: true }).catch(() => [])
      packageDirs = scoped.filter((each) => each.isDirectory()).map((each) => path.join(at, each.name))
    } else if (!entry.name.startsWith('@')) {
      packageDirs = [at]
    }
    for (const packageDir of packageDirs) {
      const manifest = await readManifest(packageDir)
      if (manifest !== undefined && typeof manifest.name === 'string' && manifest.name.startsWith(scope)) {
        found.push({
          name: manifest.name,
          version: typeof manifest.version === 'string' ? manifest.version : '',
          where: path.relative(root, packageDir),
          declares: vendorDeclares(manifest.dependencies),
        })
      }
      await walk(path.join(packageDir, 'node_modules'), scope, depth - 1, root, found)
    }
  }
}

/** 一份清单里的 `dependencies` 中属于上游 scope 的那些（包名 → 规格串）。 */
function vendorDeclares(dependencies: unknown): Record<string, string> {
  const specs: Record<string, string> = {}
  if (dependencies === null || typeof dependencies !== 'object') return specs
  for (const [name, spec] of Object.entries(dependencies as Record<string, unknown>)) {
    if (isVendorName(name) && typeof spec === 'string') specs[name] = spec
  }
  return specs
}

/**
 * 从**装出来的树**（{@link readInstalledPackages} 的读数）算「上游自己钉死确切版本」的包，
 * 口径与 {@link exactPinnedVersions} 同一份——`--from` 那一路手上只有一棵装好的树、没有
 * 锁文件，用它。
 */
export function exactPinnedVersionsFromPackages(packages: readonly InstalledPackage[]): VersionTargets {
  const specs: Record<string, string> = {}
  const seen = new Map<string, Set<string>>()
  for (const entry of packages) {
    for (const [name, spec] of Object.entries(entry.declares ?? {})) {
      const values = seen.get(name) ?? new Set<string>()
      values.add(spec)
      seen.set(name, values)
    }
  }
  // 同一个包名被多处声明时，只有**只出现一个**确切取值才算「上游钉死了它」——与
  // exactPinnedVersions 同一口径（打架的那种交给装完的版本校验去拦）。
  for (const [name, values] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (values.size !== 1) continue
    const only = [...values][0] as string
    if (!isExactVersionSpec(only)) continue
    specs[name] = only
  }
  return exactPinnedVersions(specs)
}

/**
 * 读一个包目录的清单；读不到（文件不在 / 读不动）或不是 JSON 时返回 undefined——
 * 这种目录按「不是一个能读的包」跳过。方向是 **fail-closed**：万一跳掉的正是
 * `@deepseek-ai/dsh` 自己，候选版本就成了 undefined，校验当场判不一致并停下，
 * 不会因为少读一份清单而放过一棵混装的树。
 */
async function readManifest(packageDir: string): Promise<{ name?: unknown; version?: unknown; dependencies?: unknown } | undefined> {
  const raw = await fsp.readFile(path.join(packageDir, 'package.json'), 'utf8').catch(() => '')
  if (raw === '') return undefined
  try {
    return JSON.parse(raw) as { name?: unknown; version?: unknown; dependencies?: unknown }
  } catch {
    return undefined
  }
}

/**
 * 判「装出来的树」与期望版本表是否一致。两件事都要成立：
 *
 * - 树里出现的**每个**上游包，版本都等于期望表里给它那一版（同族包因此自然满足
 *   「彼此同版本」——它们都指向候选那一版）；
 * - 树里没有期望表不知道的上游包（`unknown`——没钉到的不算数）。
 */
export function checkVendorVersions(packages: readonly InstalledPackage[], targets: VersionTargets): VersionVerdict {
  const family = packages.filter((each) => isFamilyName(each.name))
  const rootEntry = family.find((each) => each.name === ROOT_PACKAGE)
  const candidate = rootEntry?.version ?? targets[ROOT_PACKAGE]
  const mismatches = packages.filter((each) => {
    const expected = targets[each.name]
    return expected !== undefined && each.version !== expected
  })
  const unknown = packages.filter((each) => targets[each.name] === undefined)
  const present = new Set(family.map((each) => each.name))
  const distinctFamilyVersions = [...new Set(family.map((each) => each.version))].sort()
  return {
    candidate,
    family,
    distinctFamilyVersions,
    mismatches,
    unknown,
    missingKey: KEY_SUBPACKAGES.filter((name) => !present.has(name)),
    ok: family.length > 0 && candidate !== undefined && mismatches.length === 0 && unknown.length === 0,
  }
}

/** 版本读数（人读；报告的「装出来的实际版本清单」贴的就是它）。 */
export function versionReportLines(verdict: VersionVerdict, options: { targets?: VersionTargets } = {}): string[] {
  const byName = new Map(verdict.family.map((each) => [each.name, each.version]))
  const lines = [
    `[lab-version] 装出来的树：${String(verdict.family.length)} 个同族包，版本集合 = {${verdict.distinctFamilyVersions.join(', ')}}`,
    `[lab-version] 关键子包：${KEY_SUBPACKAGES.map((name) => `${name}@${byName.get(name) ?? '（不在树里）'}`).join('、')}`,
  ]
  const targets = options.targets ?? {}
  const siblings = Object.keys(targets)
    .filter((name) => !isFamilyName(name))
    .sort()
  lines.push(
    siblings.length === 0
      ? '[lab-version] 同期上游包（`@deepseek-ai/*` 里非 `dsh*` 的那些）：树里没有，不用钉。'
      : `[lab-version] 同期上游包按候选发布窗口钉住（${String(siblings.length)} 个）：${siblings.map((name) => `${name}@${targets[name] ?? ''}`).join('、')}`,
  )
  return lines
}

/** 内部不一致时的那段说明：哪几个包、各是什么版本、期望是哪一版。 */
export function mismatchDetailLines(
  verdict: VersionVerdict,
  options: { installDir?: string; targets?: VersionTargets } = {},
): string[] {
  const lines: string[] = []
  const targets = options.targets ?? {}
  if (verdict.mismatches.length > 0) {
    lines.push(
      `[lab-version] 装出来的树内部不一致（版本混装）：这些包不是期望的那一版（同族包期望都是 ${verdict.candidate ?? '（树里没有 @deepseek-ai/dsh）'}）`,
    )
    for (const each of verdict.mismatches.slice(0, 40)) {
      lines.push(`  ${each.name}@${each.version}（期望 ${targets[each.name] ?? '?'}，在 ${each.where}）`)
    }
    if (verdict.mismatches.length > 40) {
      lines.push(`  …另有 ${String(verdict.mismatches.length - 40)} 个上游包版本不对（口径同上）`)
    }
  }
  if (verdict.unknown.length > 0) {
    lines.push(`[lab-version] 树里有 ${String(verdict.unknown.length)} 个没钉到版本的上游包（读数不作数）：`)
    for (const each of verdict.unknown.slice(0, 20)) lines.push(`  ${each.name}@${each.version}（在 ${each.where}）`)
  }
  if (verdict.missingKey.length > 0) lines.push(`  树里没有这几个关键子包：${verdict.missingKey.join('、')}`)
  if (options.installDir !== undefined) lines.push(`  （这一棵树的根目录：${options.installDir}）`)
  return lines
}
