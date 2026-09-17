#!/usr/bin/env node
/**
 * 构建产物前置检查（#106）。
 *
 * `dist/` 与包内 `lib/`（`packages/<包名>/lib/`）都是 `npm run build` 打出来的、**不入库**
 * （见 .gitignore）。凡是读它们的脚本，在开始干活之前先问一句「产物在不在」：缺了就把缺
 * 哪几个文件、以及「先跑一次 npm run build」直接说出来，而不是等几百行之后撞一句 ENOENT，
 * 或落成一条看不出原因的断言失败。
 *
 * **只检查、不构建**：读到产物的地方默默替调用方构建，会让「这次验的是源码还是上一轮的
 * 旧产物」变得看不出来。npm scripts 里需要产物的那几条一律用 `npm run build &&` 兜底
 * （见 package.json 的 test / verify:*）。
 *
 * 用法：
 *   - 脚本里：`import { assertBuildArtifacts } from './check-build-artifacts.mjs'`，
 *     在 main() 开头调一次；
 *   - 命令行：`node scripts/check-build-artifacts.mjs`（全在 → 退出 0，缺 → 列出清单并退出 2）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** `exports[<key>]` 的落点：字符串形式或 `{ default }` 对象形式（官方两种都认）。 */
function exportTarget(manifest, key) {
  const value = manifest.exports?.[key]
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const fallback = value.default
    if (typeof fallback === 'string') return fallback
  }
  return undefined
}

/**
 * 构建后应当存在的产物。取的是**每一样产物的代表**（不是全集）：build 一次跑完全部，
 * 少任何一样都说明这个工作区没构建过，所以这里列代表就够了——
 *   - `dist/extension.js` 与 `dist/assembly/plugins/`：扩展侧（宿主 bundle + 装配用的插件 bundle）；
 *   - 每个自有插件包清单里声明的入口（`main` 与 `exports["./client"]`）：包侧产物。
 * 包清单是唯一事实源，所以新增插件包不用改这里。
 */
export function expectedBuildArtifacts() {
  const expected = [
    path.join(ROOT, 'dist', 'extension.js'),
    path.join(ROOT, 'dist', 'assembly', 'plugins'),
  ]
  for (const name of fs.readdirSync(path.join(ROOT, 'packages')).sort()) {
    const dir = path.join(ROOT, 'packages', name)
    const manifestPath = path.join(dir, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    for (const relative of [manifest.main, exportTarget(manifest, './client')]) {
      if (typeof relative === 'string') expected.push(path.join(dir, relative))
    }
  }
  return expected
}

/** 缺哪个产物就报哪个，并给出该跑什么；缺产物时以 2 退出。 */
export function assertBuildArtifacts() {
  const missing = expectedBuildArtifacts().filter((file) => !fs.existsSync(file))
  if (missing.length === 0) return
  console.error('缺构建产物（下列文件还没有被构建出来）：')
  for (const file of missing) console.error(`  - ${path.relative(ROOT, file)}`)
  console.error('产物不入库（.gitignore 的 dist/ 与 packages/<包名>/lib/，#106）——先跑一次：npm run build')
  process.exit(2)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  assertBuildArtifacts()
  console.log('构建产物齐全。')
}
