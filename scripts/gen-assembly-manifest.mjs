#!/usr/bin/env node
/**
 * 装配清单生成器（#64，方案 A′）：读 18 个自托管 cordis 客户端包（下线
 * ui-layout/ui-sidebar——服务由自有 shell 插件接管/无人消费）的 package.json
 * `dsh.client` 字段 + 官方前端 dist/index.html，产出 src/ui/assembly/manifest.json
 * ——webview 装配页与 lab harness 共用的一份数据：
 *
 * - frontend：从 dist/index.html 解析出的哈希资产名（module js / modulepreload /
 *   css），禁止硬编码 index-*.js 之类文件名（官方每次发版都变）。
 * - boot：__DSH_BOOT__ wire（官方 WebBoot 消费的数据，见 spike #63 结论）——
 *   bootstrap 批 = dsh-client-modules；application 批 = 其余 17 个官方包 +
 *   合成 entry @dsh-one/vscode-shell（自有 root 外框，build.mjs 打成同格式
 *   自注册 bundle），combo URL 指向 /plugins-local/；entry.url 单包形态。
 *   被删包的 inject 边从保留包的 wire 元数据里剥掉（cordis 服务改由 shell 提供）。
 *
 * 自带校验（任一违反即非零退出）：18 包 id 唯一、platform 全为 web、版本全部
 * 等于 pin、inject 闭包（剥除后）自洽于 18 包、shell entry 形态正确、
 * bootstrap 批完整、application 批 = 17 官方 + shell。
 *
 * 用法：node scripts/gen-assembly-manifest.mjs [--check]
 *   默认：生成并写 src/ui/assembly/manifest.json（内容不变则不动文件）。
 *   --check：只校验「工作区 manifest.json 与重新生成结果一致」，不一致非零退出
 *   （CI/构建期防漂移）。
 */

import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE_MODULES = path.join(REPO_ROOT, 'node_modules')
const FRONTEND_DIST = path.join(NODE_MODULES, '@deepseek-ai', 'dsh-web-frontend', 'dist')
const OUT_FILE = path.join(REPO_ROOT, 'src', 'ui', 'assembly', 'manifest.json')
/**
 * 自托管包闭包（方案 A′，18 个）：chat 的 inject 传递闭包 − ui-layout/ui-sidebar
 * （layout 服务由 @dsh-one/vscode-shell 顶替；sidebar 无人消费），辅助
 * tool/approval/user-questions 保留，bootstrap client-modules 保留，
 * ui-workspace 保留（空白态 workspace 选择器，无侧栏 UI）。
 */
const PACKAGE_NAMES = [
  'dsh-client-modules',
  'dsh-typert-registry',
  'dsh-api-gateway',
  'dsh-api-session-controller',
  'dsh-api-workspace-controller',
  'dsh-client-connection',
  'dsh-api-remotes',
  'dsh-client-ui-theme',
  'dsh-client-locale',
  'dsh-client-ui-renderer',
  'dsh-client-ui-session',
  'dsh-client-ui-settings',
  'dsh-client-ui-conversation',
  'dsh-client-ui-approval',
  'dsh-client-ui-chat',
  'dsh-client-ui-tool',
  'dsh-client-ui-user-questions',
  'dsh-client-ui-workspace',
]
/** 方案 A′ 下线的官方包：wire 里保留包指向它们的 inject 边会被剥除。 */
const REMOVED_IDS = new Set(['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'])
/** 自有 shell 插件（root 外框：layout 服务桩 + root 槽注册 + ThemePresenter）。 */
export const SHELL_PLUGIN_ID = '@dsh-one/vscode-shell'
const SCOPE = '@deepseek-ai/'
const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'
/** 18 包清单（build.mjs 拷资产时复用；shell 由 build.mjs 单独打包）。 */
export const ASSEMBLY_PACKAGE_NAMES = PACKAGE_NAMES

/**
 * 官方 wire 条目形态：inject 空则省略（与网关 HTML 一致），键序
 * id,url,rev,inject,external,immediately。方案 A′ 下 inject 剥除 REMOVED_IDS。
 */
function wireEntry(pkg, rev) {
  const c = pkg.client
  const inject = (Array.isArray(c.inject) ? c.inject : []).filter((dep) => !REMOVED_IDS.has(dep))
  const entry = { id: pkg.id, url: `/plugins-local/??${pkg.id}/client.js&rev=${rev}`, rev }
  if (inject.length > 0) entry.inject = inject
  if (Array.isArray(c.external) && c.external.length > 0) entry.external = c.external
  if (c.immediately === true) entry.immediately = true
  return entry
}

// 注意：inject 边存在真实的环（cordis DI 惰性注入可处理；方案 A′ 前是
// ui-sidebar ↔ ui-workspace），所以 wire 顺序不做拓扑排序——模块系统按 id
// 注册、require 时才物化，注册顺序无关正确性。顺序 = PACKAGE_NAMES 声明序
// （确定性、已按 bootstrap→api→client→ui 分层），shell 插件追加在末尾。

/** 生成 + 校验。导出供 test/assemblyManifest.test.ts 复用。 */
export async function generateAssemblyManifest({ nodeModulesDir = NODE_MODULES, frontendDistDir = FRONTEND_DIST } = {}) {
  const readPkg = async (name) => {
    const pkg = JSON.parse(
      await fsp.readFile(path.join(nodeModulesDir, SCOPE + name, 'package.json'), 'utf8'),
    )
    const client = pkg.dsh?.client
    if (client === undefined || typeof client !== 'object') {
      throw new Error(`gen-assembly-manifest: ${SCOPE}${name} 缺 dsh.client 字段`)
    }
    return { name, id: SCOPE + name, version: pkg.version, client }
  }
  const pkgs = await Promise.all(PACKAGE_NAMES.map(readPkg))
  const html = await fsp.readFile(path.join(frontendDistDir, 'index.html'), 'utf8')
  const moduleJs = /type="module"[^>]*src="\.\/(assets\/[^"]+)"/.exec(html)?.[1]
  if (moduleJs === undefined) throw new Error('gen-assembly-manifest: dist/index.html 未找到 module script')
  const preloadJs = [...html.matchAll(/modulepreload"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  const css = [...html.matchAll(/stylesheet"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  if (preloadJs.length === 0 || css.length === 0) {
    throw new Error('gen-assembly-manifest: dist/index.html 未找到 modulepreload/stylesheet 资产')
  }

  // ---- 校验 ----
  const ids = pkgs.map((p) => p.id)
  if (new Set(ids).size !== ids.length) throw new Error('gen-assembly-manifest: 包 id 重复')
  const versions = new Set(pkgs.map((p) => p.version))
  if (versions.size !== 1) {
    throw new Error(`gen-assembly-manifest: 自托管包版本不一致: ${[...versions].join(', ')}`)
  }
  const pin = pkgs.find((p) => p.id === BOOTSTRAP_ID)?.version
  for (const p of pkgs) {
    if (p.client.platform !== 'web') {
      throw new Error(`gen-assembly-manifest: ${p.id} platform=${p.client.platform}（预期 web）`)
    }
  }
  const idSet = new Set(ids)
  for (const p of pkgs) {
    // 保留包对下线包的引用必须是 wireEntry 已剥除的那两个（未来新增引用即报错）。
    for (const dep of p.client.inject ?? []) {
      if (REMOVED_IDS.has(dep)) continue
      if (!idSet.has(dep)) {
        throw new Error(`gen-assembly-manifest: ${p.id} inject ${dep} 不在 18 包闭包内`)
      }
    }
    // external 是模块系统命名空间里的 specifier（`<id>/client` 形态，由种子表/
    // 其他包 exports 满足），只校形态、不计入闭包。
    for (const spec of p.client.external ?? []) {
      if (!/^@[^/]+\/[^/]+\/client$/.test(spec)) {
        throw new Error(`gen-assembly-manifest: ${p.id} external specifier 形态异常: ${spec}`)
      }
      if (!idSet.has(spec.slice(0, -'/client'.length))) {
        throw new Error(`gen-assembly-manifest: ${p.id} external ${spec} 的基础包不在 18 包闭包内`)
      }
    }
  }
  const bootstrap = pkgs.find((p) => p.id === BOOTSTRAP_ID)
  if (bootstrap === undefined || bootstrap.client.immediately !== true || (bootstrap.client.inject ?? []).length !== 0) {
    throw new Error('gen-assembly-manifest: bootstrap 批（dsh-client-modules）不完整')
  }

  // ---- wire ----
  const appOrder = pkgs.filter((p) => p.id !== BOOTSTRAP_ID).map((p) => p.id)
  const entries = pkgs.map((p) => wireEntry(p, pin))
  // 自有 shell 插件合成 entry：模块级零 require（react/cordis/store 全走种子表
  // external），wire 层无 inject 边；cordis 插件面的 inject(['slots','theme'])
  // 在 bundle 产物里，不经 wire。
  const shellEntry = {
    id: SHELL_PLUGIN_ID,
    url: `/plugins-local/??${SHELL_PLUGIN_ID}/client.js&rev=${pin}`,
    rev: pin,
  }
  entries.push(shellEntry)
  appOrder.push(SHELL_PLUGIN_ID)
  const appCombo = `/plugins-local/??${appOrder.map((id) => `${id}/client.js`).join(',')}&rev=${pin}`
  const boot = {
    rev: pin,
    entries,
    batches: [
      {
        phase: 'bootstrap',
        url: `/plugins-local/??${BOOTSTRAP_ID}/client.js&rev=${pin}`,
        rev: pin,
        entries: [BOOTSTRAP_ID],
      },
      { phase: 'application', url: appCombo, rev: pin, entries: appOrder },
    ],
  }
  // application 批完整性：恰好是除 bootstrap 外的 17 官方包 + shell。
  if (appOrder.length !== 18 || appOrder.filter((id) => id === SHELL_PLUGIN_ID).length !== 1) {
    throw new Error('gen-assembly-manifest: application 批不完整')
  }

  return {
    version: pin,
    frontend: { moduleJs, preloadJs, css },
    bootstrapUrl: boot.batches[0].url,
    boot,
  }
}

async function main() {
  const manifest = await generateAssemblyManifest()
  const rendered = JSON.stringify(manifest, null, 2) + '\n'
  const checkOnly = process.argv.includes('--check')
  let existing = null
  try {
    existing = await fsp.readFile(OUT_FILE, 'utf8')
  } catch {
    // 首次生成
  }
  if (existing === rendered) {
    console.log(`gen-assembly-manifest: ${path.relative(REPO_ROOT, OUT_FILE)} 已是最新（pin=${manifest.version}）`)
    return
  }
  if (checkOnly) {
    console.error('gen-assembly-manifest: manifest.json 与 node_modules 现状不一致，请重新生成')
    process.exit(1)
  }
  await fsp.mkdir(path.dirname(OUT_FILE), { recursive: true })
  await fsp.writeFile(OUT_FILE, rendered)
  console.log(
    `gen-assembly-manifest: 已写 ${path.relative(REPO_ROOT, OUT_FILE)}（pin=${manifest.version}, entries=${manifest.boot.entries.length}）`,
  )
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
