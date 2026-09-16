/**
 * 自有插件的 npm 包契约（#73）：`packages/*` 里每一个「插件包」都要满足官方装包与
 * 加载链路的全部前置条件，缺一条就在**官方侧静默不工作**（包进了 profile 但行没挂上树、
 * 行挂上了但浏览器侧没东西加载）。这些条件都只有真 dsh 能验，真机实测见
 * `scripts/verify-plugins-official.mjs`；这里钉的是**离线能判**的那一半，改坏了在
 * `npm test` 就红，不用等到几十秒的真机跑。
 *
 * 判据全部从包清单读（`packages/*` 扫目录），新增包自动纳入，不用改本文件。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  COMPOSER_CLEAR_PLUGIN_ID,
  CONTEXT_MENU_PLUGIN_ID,
  GIT_CARD_PLUGIN_ID,
  SESSION_EXPORT_PLUGIN_ID,
  WORKSPACE_TREE_PLUGIN_ID,
} from '../src/ui/assembly/wireFilter.ts'

const ROOT = path.join(import.meta.dirname, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

interface PackageManifest {
  name: string
  type?: string
  main?: string
  exports?: Record<string, unknown>
  files?: string[]
  dsh?: {
    bundle?: { patch?: string }
    client?: { platform?: string; inject?: string[]; external?: string[] }
  }
}

/** 扫目录读包清单：声明了 `dsh.client` 的才算插件包（宿主半只有 `dsh.bundle`）。 */
function pluginPackages(): Array<{ dir: string; manifest: PackageManifest }> {
  const found: Array<{ dir: string; manifest: PackageManifest }> = []
  for (const name of fs.readdirSync(PACKAGES_DIR).sort()) {
    const dir = path.join(PACKAGES_DIR, name)
    const manifestPath = path.join(dir, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageManifest
    if (manifest.dsh?.client !== undefined) found.push({ dir, manifest })
  }
  return found
}

/** `exports[<key>]` 的落点：字符串形式或 `{ default }` 对象形式（官方两种都认）。 */
function exportTarget(manifest: PackageManifest, key: string): string | undefined {
  const value = manifest.exports?.[key]
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const fallback = (value as { default?: unknown }).default
    if (typeof fallback === 'string') return fallback
  }
  return undefined
}

const PACKAGES = pluginPackages()

test('#73：仓库里扫得出插件包，且都在 @dsh-one/dsh-* 作用域下', () => {
  assert.ok(PACKAGES.length > 0, '至少应有一个声明了 dsh.client 的插件包')
  for (const { manifest } of PACKAGES) {
    assert.match(manifest.name, /^@dsh-one\/dsh-/, `${manifest.name} 必须是 @dsh-one/dsh-*（可移植件）`)
  }
})

test('#73：每个插件包的清单满足官方装包与加载的全部前置条件', () => {
  for (const { dir, manifest } of PACKAGES) {
    const at = manifest.name
    // ① `dsh.bundle.patch` —— 官方的 `dsh plugin add` 靠它把包并进 profile 的层列表；
    //    没有它，包只是普通依赖，行不会挂进 loader 树（浏览器侧静默没有东西加载）。
    const patchRel = manifest.dsh?.bundle?.patch
    assert.equal(typeof patchRel, 'string', `${at} 必须声明 dsh.bundle.patch`)
    const patchPath = path.join(dir, patchRel!)
    assert.ok(fs.existsSync(patchPath), `${at} 的 dsh.bundle.patch 指向的文件不存在：${patchRel}`)
    const patch = fs.readFileSync(patchPath, 'utf8')
    assert.match(patch, /(^|\n)- insert:/, `${at} 的 profile 补丁必须 insert 一行把包挂上树`)
    assert.ok(
      patch.includes(`name: '${at}'`) || patch.includes(`name: "${at}"`),
      `${at} 的 profile 补丁必须 insert 名为本包的 name`,
    )

    // ② `dsh.client` —— 官方 client-modules 只认这一张声明；platform 必须是 web，
    //    否则扫到也当没有（源码逐字：`decl.platform !== "web"` → 跳过）。
    assert.equal(manifest.dsh?.client?.platform, 'web', `${at} 的 dsh.client.platform 必须是 "web"`)
    const inject = manifest.dsh?.client?.inject
    assert.ok(Array.isArray(inject) && inject.length > 0, `${at} 必须声明 dsh.client.inject（它依赖的官方插件包）`)
    for (const dep of inject!) {
      assert.match(dep, /^@deepseek-ai\//, `${at} 的 inject 只该列官方插件包，收到 ${dep}`)
    }

    // ③ 双入口：主入口是宿主半（官方 loader 的行模块），`./client` 是浏览器侧 bundle。
    assert.equal(manifest.main, 'lib/index.js', `${at} 的 main 必须是 lib/index.js`)
    assert.ok(fs.existsSync(path.join(dir, 'lib', 'index.js')), `${at} 缺构建产物 lib/index.js（先跑 npm run build）`)
    assert.equal(exportTarget(manifest, './client'), './lib/client.js', `${at} 必须 exports["./client"] → ./lib/client.js`)
    assert.ok(
      fs.existsSync(path.join(dir, 'lib', 'client.js')),
      `${at} 缺构建产物 lib/client.js（先跑 npm run build）`,
    )
    assert.equal(exportTarget(manifest, './cordis.patch.yml'), './cordis.patch.yml', `${at} 必须导出 cordis.patch.yml`)

    // ④ 发布的包要自包含：files 白名单只发这两样产物 + 补丁。
    for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
      assert.ok(manifest.files?.includes(required) === true, `${at} 的 files 白名单必须含 ${required}`)
    }
  }
})

test('#73：浏览器侧 bundle 的注册 id 等于包名（官方 loader 的行名 / wire 的行 id / combo 段的 id 三处同一个）', () => {
  for (const { dir, manifest } of PACKAGES) {
    const bundle = fs.readFileSync(path.join(dir, 'lib', 'client.js'), 'utf8')
    assert.ok(
      bundle.startsWith('window.__ModuleLoader__.load({\n\tid: '),
      `${manifest.name} 的 lib/client.js 必须是官方 combo 格式（window.__ModuleLoader__.load 自注册）`,
    )
    const id = /^\s*id:\s*("(?:[^"\\]|\\.)*")/.exec(bundle.split('\n')[1] ?? '')?.[1]
    assert.equal(JSON.parse(id ?? 'null'), manifest.name, `${manifest.name} 的 bundle 注册 id 必须等于包名`)
  }
})

test('#73：bundle 只 require 自己声明为 external 的模块（否则种子表满足不了、打进包会双重实例化）', () => {
  for (const { dir, manifest } of PACKAGES) {
    const declared = new Set(manifest.dsh?.client?.external ?? [])
    const bundle = fs.readFileSync(path.join(dir, 'lib', 'client.js'), 'utf8')
    const requested = new Set([...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))
    for (const spec of requested) {
      assert.ok(declared.has(spec), `${manifest.name} 的 bundle require 了 ${spec}，但 dsh.client.external 没声明它`)
    }
  }
})

test('#73：可移植件（dsh-* 插件 id）都有一个同名包，源码入口也指得回真文件', () => {
  /** 装配清单里的可移植件 id（`vscode-*` 那几个是平台专用件，不进 packages/）。 */
  const portableIds = [
    GIT_CARD_PLUGIN_ID,
    CONTEXT_MENU_PLUGIN_ID,
    COMPOSER_CLEAR_PLUGIN_ID,
    SESSION_EXPORT_PLUGIN_ID,
    WORKSPACE_TREE_PLUGIN_ID,
  ]
  const packaged = new Set(PACKAGES.map(({ manifest }) => manifest.name))
  for (const id of portableIds) {
    assert.ok(packaged.has(id), `可移植件 ${id} 还没有对应的包（packages/ 里没有同名插件包）`)
  }
  // 包源码入口是薄薄一层包边界，指回仓库里的插件本体——名字改了而这里没改，
  // 构建会挂（esbuild 解析不到），这条让它在 npm test 就红。
  for (const { dir, manifest } of PACKAGES) {
    const entry = fs.readFileSync(path.join(dir, 'src', 'client.ts'), 'utf8')
    const source = /from '([^']+)'/.exec(entry)?.[1]
    assert.ok(source !== undefined, `${manifest.name} 的 src/client.ts 必须 re-export 插件本体`)
    assert.ok(path.isAbsolute(source!) === false && source!.startsWith('..'), `${manifest.name} 的入口应指向仓库里的共享源码`)
    assert.ok(
      fs.existsSync(path.resolve(dir, 'src', source!)),
      `${manifest.name} 的入口指回的源文件不存在：${source}`,
    )
  }
})
