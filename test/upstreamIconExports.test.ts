/**
 * 官方图标导出名的两代分叉（#236）的护栏：名字表、取用口，与上游探针那一项。
 *
 * 三件事，对应这条 bug 的三个环节：
 *
 * 1. **表本身**：26 枚图标的两代名字都在，且「这一代的名字」与「上一代的名字」确实是同一枚
 *    图标的两代写法（基名相同、只差后缀）；
 * 2. **取用口的行为**（`resolveOfficialIcon`）：命名空间里只有老名字时取老名字、只有新名字时
 *    取新名字、**两个都没有时抛错**（静默变 `undefined` 是这次事故的形态，绝不能再回去）；
 * 3. **探针那一项**（`checkOfficialIconExports`）：用它读本机官方前端产物，名字齐全时 pass、
 *    少一枚时 fail 且**报出是哪一枚**，产物目录读不到时也 fail（不降级）。
 *
 * 单测环境里 `@deepseek-ai/dsh-client-ui-primitives` import 不进来（它不在磁盘上，见探针
 * 那一项的文件头），所以第 2 条喂的是**假的命名空间对象**；第 3 条喂的是合成的产物目录。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_ICON_WEIGHT,
  OFFICIAL_ICON_FORKS,
  OFFICIAL_ICON_NAMES,
  iconExportCandidates,
  resolveOfficialIcon,
  type OfficialIconNamespace,
} from '../src/pure/officialIcons.ts'
import { scratchDirSync } from './scratchDirs.ts'

const ROOT = path.join(import.meta.dirname, '..')

interface IconCheckRow {
  id: string
  name: string
  status: 'pass' | 'fail'
  detail: string
}

interface IdentifiersModule {
  checkOfficialIconExports(opts: { root: string; version?: string; profile?: string }): IconCheckRow
}

const mod = (await import(
  pathToFileURL(path.join(ROOT, 'scripts', 'dsh-upstream-watch', 'officialIdentifiers.mjs')).href
)) as IdentifiersModule

/** 官方前端产物在装了 dsh 的那棵树里的位置（探针那一项读的就是它）。 */
const ASSETS = path.join('dsh-web-frontend', 'dist', 'assets')

/** 合成一份前端产物：内容随便，只要带齐我们表的候选名。 */
function writeAssets(root: string, { omit = [], only = null }: { omit?: string[]; only?: string[] } = {}): void {
  const dir = path.join(root, ASSETS)
  fs.mkdirSync(dir, { recursive: true })
  const names = only ?? OFFICIAL_ICON_NAMES.flatMap((icon) => iconExportCandidates(icon)[0])
  const kept = names.filter((name) => !omit.includes(name))
  fs.writeFileSync(path.join(dir, 'index-abc123.js'), `const table = {${kept.map((n) => `${n}: local`).join(',')}};\n`)
}

const withSynthetic = (root: string, run: (root: string) => void): void => {
  try {
    run(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('#236 名字表：26 枚图标的两代名字一一对应（基名相同、只差后缀）', () => {
  assert.equal(OFFICIAL_ICON_NAMES.length, 26, `表里有 ${OFFICIAL_ICON_NAMES.length} 枚，#236 核过的是 26 枚`)
  assert.equal(DEFAULT_ICON_WEIGHT, 'Regular', '缺省档位是 Regular（依据见 src/pure/officialIcons.ts 的文件头）')
  for (const icon of OFFICIAL_ICON_NAMES) {
    const fork = OFFICIAL_ICON_FORKS[icon]
    assert.match(icon, /^Icon[A-Za-z]+$/, `${icon} 要是新一代基名（不带档位 / 尺寸后缀）`)
    assert.ok(fork.sized.startsWith(icon), `${icon} 的上一代名 ${fork.sized} 要以基名开头`)
    assert.match(fork.sized, /(12|14|16|20)$/, `${icon} 的上一代名 ${fork.sized} 要是尺寸后缀写法`)
    assert.notEqual(fork.sized, icon, `${icon} 的两代名字不能相同（那就不叫分叉了）`)
    const candidates = iconExportCandidates(icon)
    assert.equal(candidates.length, 2, `${icon} 的候选名是「这一代 + 上一代」两个`)
    assert.equal(candidates[0], `${icon}${fork.weight ?? DEFAULT_ICON_WEIGHT}`)
    assert.equal(candidates[1], fork.sized)
  }
})

test('#236 取用口：命名空间里是上一代的名字时取到它', () => {
  const namespace: OfficialIconNamespace = { IconTrashOutline16: () => 'old' }
  const component = resolveOfficialIcon(namespace, 'IconTrashOutline')
  assert.equal((component as () => unknown)(), 'old')
})

test('#236 取用口：命名空间里是这一代的名字时取到它（两档都在时取表里那一档）', () => {
  const both: OfficialIconNamespace = {
    IconTrashOutlineMedium: () => 'medium',
    IconTrashOutlineRegular: () => 'regular',
  }
  assert.equal((resolveOfficialIcon(both, 'IconTrashOutline') as () => unknown)(), 'regular')
  const mediumOnly: OfficialIconNamespace = { IconTrashOutlineMedium: () => 'medium' }
  assert.throws(
    () => resolveOfficialIcon(mediumOnly, 'IconTrashOutline'),
    /IconTrashOutlineRegular/,
    '表里要 Regular 而只剩 Medium：这属于「档位漂了」，要当场报错而不是悄悄换一档',
  )
})

test('#236 取用口：两代名字都不在场时抛错，且错误里写明这一代与上一代各要什么名', () => {
  assert.throws(
    () => resolveOfficialIcon({}, 'IconTrashOutline'),
    (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      assert.match(text, /IconTrashOutline/, '要点出是哪一枚')
      assert.match(text, /IconTrashOutlineRegular/, '要点出这一代要的名字')
      assert.match(text, /IconTrashOutline16/, '要点出上一代要的名字')
      return true
    },
  )
})

test('#236 探针：本机官方产物里 26 枚齐全 → pass', () => {
  const root = scratchDirSync('dsh-icon-exports-')
  writeAssets(root)
  withSynthetic(root, (dir) => {
    const row = mod.checkOfficialIconExports({ root: dir, version: '0.1.6-alpha.2', profile: '合成产物' })
    assert.equal(row.id, 'official-icon-exports')
    assert.equal(row.status, 'pass', row.detail)
    assert.match(row.detail, /26 枚全部在场/)
    assert.match(row.detail, /合成产物/)
  })
})

test('#236 探针：上一代的名字（尺寸后缀）在场也算通过——两代名字任一在场即过', () => {
  const root = scratchDirSync('dsh-icon-exports-')
  writeAssets(root, { only: OFFICIAL_ICON_NAMES.map((icon) => OFFICIAL_ICON_FORKS[icon].sized) })
  withSynthetic(root, (dir) => {
    const row = mod.checkOfficialIconExports({ root: dir, version: '0.1.6-alpha.2', profile: '合成产物' })
    assert.equal(row.status, 'pass', row.detail)
  })
})

test('#236 探针：少一枚就 fail，且当场报出是哪一枚、两代各要什么名', () => {
  const root = scratchDirSync('dsh-icon-exports-')
  writeAssets(root, { omit: ['IconTrashOutlineRegular'] })
  withSynthetic(root, (dir) => {
    const row = mod.checkOfficialIconExports({ root: dir, version: '0.1.7-alpha.2', profile: '合成产物' })
    assert.equal(row.status, 'fail')
    assert.match(row.detail, /IconTrashOutline/, '要点出是哪一枚')
    assert.match(row.detail, /IconTrashOutlineRegular/)
    assert.match(row.detail, /IconTrashOutline16/)
    assert.match(row.detail, /缺 1 枚/)
  })
})

test('#236 探针：产物目录读不到也 fail（不许降级成「没问题」）', () => {
  const root = scratchDirSync('dsh-icon-exports-')
  withSynthetic(root, (dir) => {
    const row = mod.checkOfficialIconExports({ root: dir, version: '0.1.7-alpha.2', profile: '合成产物' })
    assert.equal(row.status, 'fail')
    assert.match(row.detail, /读不到官方前端产物目录/)
  })
})
