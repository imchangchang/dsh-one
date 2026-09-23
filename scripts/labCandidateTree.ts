/**
 * 「候选版本树」这一层的纯函数（#231）：把一棵装出来的 dsh 读成版本清单、判它内部一致、
 * 按确切版本生成钉住用的 overrides。CLI 在 `scripts/verify-lab-version.mjs`，
 * 单测在 `test/labCandidateTree.test.ts`。
 *
 * ## 为什么要有这一层（#231 的现场）
 *
 * `@deepseek-ai/dsh` 自己的依赖写的是 `^0.1.6-alpha.1` 这种范围——同一个范围里 alpha.2
 * 也满足，于是 `npm install` 把**子包**装成 alpha.2、`dsh` 自己还是 alpha.1（装的是
 * 确切版本）。这是一棵版本混杂的树：`dsh web` 起不来（实测
 * `SyntaxError: … '@deepseek-ai/dsh-app-boot' does not provide an export named 'watchUserPatches'`），
 * 而门禁照跑照出读数——读出来的既不代表候选版、也不代表现网，是个假读数。
 *
 * ## 判据（一句话）
 *
 * **同族包（`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`）必须同版本**：上游把这些包按同一条
 * 版本线一起发布，`dsh` 与它的子包版本不一致就是混装。装的时候按确切版本钉住整棵树
 * （{@link pinnedOverrides}），装完再核一遍（{@link checkFamilyVersions}）——钉不住就报错
 * 停下，不跑套件。
 *
 * 为什么不一并钉 `@deepseek-ai/cordis` / `@deepseek-ai/schemastery` 这些：它们的版本号与
 * dsh 不在同一条线上（实测 `cordis@4.0.2`、`schemastery@3.18.2`），范围也稳定，混装这件事
 * 与它们无关；把它们一起钉住反而会把无关包的版本冻在某一版上。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

/** 候选包自己的名字（也是装配侧取清单时认的那个 id）。 */
export const ROOT_PACKAGE = '@deepseek-ai/dsh'

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
}

/** 同族包的版本体检结论。 */
export interface FamilyVerdict {
  /** 期望版本：树里 `@deepseek-ai/dsh` 自己那一版（树里没有它就是 undefined）。 */
  expected: string | undefined
  family: InstalledPackage[]
  distinctVersions: string[]
  mismatches: InstalledPackage[]
  missingKey: string[]
  ok: boolean
}

/** 同族包名 = `@deepseek-ai/dsh` 自己，或 `@deepseek-ai/dsh-*`。 */
export function isFamilyName(name: string): boolean {
  return name === ROOT_PACKAGE || name.startsWith(`${ROOT_PACKAGE}-`)
}

/**
 * 从 `package-lock.json` 的 `packages` 表里取出同族包名。
 *
 * 锁文件的键是路径形状（`node_modules/@deepseek-ai/dsh-app-boot`，嵌套的更长），
 * 所以按末段取包名。用锁文件而不是装完再扫：`npm install --package-lock-only`
 * 只取元数据就能把整棵树的包名解析出来，不用先把上百个包下载解包一遍。
 */
export function familyNamesFromLock(lock: unknown): string[] {
  const packages = (lock as { packages?: Record<string, unknown> } | undefined)?.packages ?? {}
  const names = new Set<string>()
  for (const key of Object.keys(packages)) {
    const matched = /(?:^|\/)node_modules\/(@[^/]+\/[^/]+)$/.exec(key)
    if (matched !== null && isFamilyName(matched[1] ?? '')) names.add(matched[1] ?? '')
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
 * 钉住整棵树用的 `overrides`：同族子包一律钉到 `version`。
 *
 * `@deepseek-ai/dsh` 自己不进 overrides——它在 `dependencies` 里已经是确切版本，
 * npm 也不允许 overrides 与根的直接依赖打架。
 */
export function pinnedOverrides(names: readonly string[], version: string): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const name of names) {
    if (name === ROOT_PACKAGE) continue
    overrides[name] = version
  }
  return overrides
}

/**
 * 读一棵装出来的树的版本清单：只读 `node_modules` 里的包清单，不跑 `dsh`、不连网。
 * 只留 `scope` 下的包（缺省 `@deepseek-ai`）；嵌套安装的副本也一并列出来——混装现场
 * 恰好就是「同一个名字两个版本」。
 */
export async function readInstalledPackages(
  root: string,
  options: { scope?: string; maxDepth?: number } = {},
): Promise<InstalledPackage[]> {
  const scope = options.scope ?? '@deepseek-ai'
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
      const raw = await fsp.readFile(path.join(packageDir, 'package.json'), 'utf8').catch(() => '')
      const manifest = raw === '' ? undefined : (JSON.parse(raw) as { name?: unknown; version?: unknown })
      if (manifest !== undefined && typeof manifest.name === 'string' && manifest.name.startsWith(scope)) {
        found.push({
          name: manifest.name,
          version: typeof manifest.version === 'string' ? manifest.version : '',
          where: path.relative(root, packageDir),
        })
      }
      await walk(path.join(packageDir, 'node_modules'), scope, depth - 1, root, found)
    }
  }
}

/**
 * 判同族包版本是否一致。期望版本缺省取树里 `@deepseek-ai/dsh` 自己那一版——
 * 「这棵树里 dsh 是哪一版，它的同族子包就该是哪一版」正是内部一致的定义。
 */
export function checkFamilyVersions(packages: readonly InstalledPackage[], options: { expected?: string } = {}): FamilyVerdict {
  const family = packages.filter((each) => isFamilyName(each.name))
  const rootEntry = family.find((each) => each.name === ROOT_PACKAGE)
  const expected = options.expected ?? rootEntry?.version
  const distinctVersions = [...new Set(family.map((each) => each.version))].sort()
  const mismatches = expected === undefined ? [] : family.filter((each) => each.version !== expected)
  const present = new Set(family.map((each) => each.name))
  return {
    expected,
    family,
    distinctVersions,
    mismatches,
    missingKey: KEY_SUBPACKAGES.filter((name) => !present.has(name)),
    ok: family.length > 0 && expected !== undefined && mismatches.length === 0,
  }
}

/** 版本读数（人读；报告的「装出来的实际版本清单」贴的就是它）。 */
export function versionReportLines(verdict: FamilyVerdict): string[] {
  const byName = new Map(verdict.family.map((each) => [each.name, each.version]))
  return [
    `[lab-version] 装出来的树：${String(verdict.family.length)} 个同族包，版本集合 = {${verdict.distinctVersions.join(', ')}}`,
    `[lab-version] 关键子包：${KEY_SUBPACKAGES.map((name) => `${name}@${byName.get(name) ?? '（不在树里）'}`).join('、')}`,
  ]
}

/** 内部不一致时的那段说明：哪几个包、各是什么版本、期望是哪一版。 */
export function mismatchDetailLines(verdict: FamilyVerdict, options: { installDir?: string } = {}): string[] {
  const lines = [
    `[lab-version] 装出来的树内部不一致（版本混装）：期望同族包都是 ${verdict.expected ?? '（树里没有 @deepseek-ai/dsh）'}，实际版本集合 = {${verdict.distinctVersions.join(', ')}}`,
  ]
  for (const each of verdict.mismatches.slice(0, 40)) {
    lines.push(`  ${each.name}@${each.version}（期望 ${verdict.expected ?? '?'}，在 ${each.where}）`)
  }
  if (verdict.mismatches.length > 40) {
    lines.push(`  …另有 ${String(verdict.mismatches.length - 40)} 个同族包版本不对（口径同上）`)
  }
  if (verdict.missingKey.length > 0) lines.push(`  树里没有这几个关键子包：${verdict.missingKey.join('、')}`)
  if (options.installDir !== undefined) lines.push(`  （这一棵树的根目录：${options.installDir}）`)
  return lines
}
