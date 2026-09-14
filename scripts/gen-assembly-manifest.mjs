#!/usr/bin/env node
/**
 * 装配清单生成器（#64 M1）：读 20 个自托管 cordis 客户端包的 package.json
 * `dsh.client` 字段 + 官方前端 dist/index.html，产出 src/ui/assembly/manifest.json
 * ——webview 装配页与 lab harness 共用的一份数据：
 *
 * - frontend：从 dist/index.html 解析出的哈希资产名（module js / modulepreload /
 *   css），禁止硬编码 index-*.js 之类文件名（官方每次发版都变）。
 * - boot：__DSH_BOOT__ wire（官方 WebBoot 消费的数据，见 spike #63 结论）——
 *   bootstrap 批 = dsh-client-modules；application 批 = 其余 19 包（拓扑序），
 *   combo URL 指向 mirror 的 /plugins-local/??...&rev=<pin>；entry.url 用单包形态。
 *
 * 自带校验（任一违反即非零退出）：包数 == 20、id 唯一、platform 全为 web、
 * 版本全部等于 pin、inject/external 闭包不越出 20 包、bootstrap 批完整。
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
/** 自托管包闭包（spike #63 定量：16 inject 闭包 + tool/approval/user-questions 3 辅助 + client-modules bootstrap）。 */
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
  'dsh-client-ui-layout',
  'dsh-client-ui-renderer',
  'dsh-client-ui-session',
  'dsh-client-ui-sidebar',
  'dsh-client-ui-settings',
  'dsh-client-ui-conversation',
  'dsh-client-ui-approval',
  'dsh-client-ui-chat',
  'dsh-client-ui-tool',
  'dsh-client-ui-user-questions',
  'dsh-client-ui-workspace',
]
const SCOPE = '@deepseek-ai/'
const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'
/** 20 包清单（build.mjs 拷资产时复用）。 */
export const ASSEMBLY_PACKAGE_NAMES = PACKAGE_NAMES

/** 官方 wire 条目形态：inject 空则省略（与网关 HTML 一致），键序 id,url,rev,inject,external,immediately。 */
function wireEntry(pkg, rev) {
  const c = pkg.client
  const entry = { id: pkg.id, url: `/plugins-local/??${pkg.id}/client.js&rev=${rev}`, rev }
  if (Array.isArray(c.inject) && c.inject.length > 0) entry.inject = c.inject
  if (Array.isArray(c.external) && c.external.length > 0) entry.external = c.external
  if (c.immediately === true) entry.immediately = true
  return entry
}

// 注意：inject 边存在真实的环（ui-sidebar ↔ ui-workspace 互 inject，cordis DI
// 惰性注入可处理），所以 wire 顺序不做拓扑排序——模块系统按 id 注册、require 时
// 才物化，注册顺序无关正确性。顺序 = 上面 PACKAGE_NAMES 声明序（确定性、已按
// bootstrap→api→client→ui 分层）。

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
    // inject 闭包必须恰好自洽于 20 包（spike #63：缺包 loud throw）。
    for (const dep of p.client.inject ?? []) {
      if (!idSet.has(dep)) {
        throw new Error(`gen-assembly-manifest: ${p.id} inject ${dep} 不在 20 包闭包内`)
      }
    }
    // external 是模块系统命名空间里的 specifier（`<id>/client` 形态，由种子表/
    // 其他包 exports 满足），只校形态、不计入闭包。
    for (const spec of p.client.external ?? []) {
      if (!/^@[^/]+\/[^/]+\/client$/.test(spec)) {
        throw new Error(`gen-assembly-manifest: ${p.id} external specifier 形态异常: ${spec}`)
      }
      if (!idSet.has(spec.slice(0, -'/client'.length))) {
        throw new Error(`gen-assembly-manifest: ${p.id} external ${spec} 的基础包不在 20 包闭包内`)
      }
    }
  }
  const bootstrap = pkgs.find((p) => p.id === BOOTSTRAP_ID)
  if (bootstrap === undefined || bootstrap.client.immediately !== true || (bootstrap.client.inject ?? []).length !== 0) {
    throw new Error('gen-assembly-manifest: bootstrap 批（dsh-client-modules）不完整')
  }

  // ---- wire ----
  const appPkgs = pkgs.filter((p) => p.id !== BOOTSTRAP_ID)
  const appOrder = appPkgs.map((p) => p.id)
  const entries = pkgs.map((p) => wireEntry(p, pin))
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
  // application 批完整性：恰好是除 bootstrap 外的 19 包。
  if (appOrder.length !== 19) {
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
