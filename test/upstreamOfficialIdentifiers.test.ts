/**
 * 官方内部标识符探针（#179，`scripts/dsh-upstream-watch/officialIdentifiers.mjs`）的单测。
 *
 * 这里不碰本机 profile（CI 上没有），用的是**按官方 0.1.6-alpha.1 实测形状手写的合成产物**
 * （每个包一个文件、只留被查的那几行）。测三件事：
 *
 * 1. 清单形状：「每条都要有出处文件、形状、理由与我方使用点」这条要求的可执行形式，
 *    外加「使用点里的 `src/…` 文件确实存在」——`where` 写错文件时测试先红；
 * 2. 正向：合成产物齐全 → pass；
 * 3. 负向（就是 #179 验收要的「故意让某个标识符找不着」）：删掉一条、删掉整包、
 *    改掉文案 —— 都要 fail，且 detail 里点得出**条目名与出处文件**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { scratchDirSync } from './scratchDirs.ts'

const ROOT = path.join(import.meta.dirname, '..')

interface IdentifierDep {
  id: string
  what: string
  pkg: string
  file: string
  pattern: RegExp
  why: string
  where: string
}

interface CheckRow {
  id: string
  name: string
  status: 'pass' | 'fail'
  detail: string
}

interface OfficialIdentifiersModule {
  IDENTIFIERS: IdentifierDep[]
  resolveRealpath(target: string): string
  checkOfficialIdentifiers(opts: { root: string; version?: string; profile?: string }): CheckRow
}

// 说明符走 file:// URL（Windows 绝对路径不能直接喂给 ESM loader，见 test/esmImportSpecifiers.test.ts）。
const mod = (await import(pathToFileURL(path.join(ROOT, 'scripts', 'dsh-upstream-watch', 'officialIdentifiers.mjs')).href)) as OfficialIdentifiersModule

/**
 * 合成官方产物：键是「包名 + 文件」，值是官方 0.1.6-alpha.1 实测形状的最小摘录
 * （只保留本探针查的那几个标识符）。改这里等于改「我们以为官方长什么样」。
 */
const SYNTHETIC: Record<string, string> = {
  'dsh-client-ui-layout/lib/client.js': `
    ctx.slots.register({
      name: "root",
      children: {
        "sidebar": {
          kind: "single",
          scope: "root"
        },
        "main": {
          kind: "keyed",
          scope: "root"
        },
        "rightbar": {
          kind: "single",
          scope: "root"
        },
        "shell.overlay": {
          kind: "list",
          scope: "root"
        }
      }
    });
  `,
  'dsh-client-ui-sidebar/lib/client.js': `
    const zh = {
      "toggle.open": "展开侧边栏",
      "toggle.collapse": "收起侧边栏"
    };
    const en = {
      "toggle.open": "Expand sidebar",
      "toggle.collapse": "Collapse sidebar"
    };
  `,
  'dsh-session-log-export/lib/client.js': `ctx.slots.inject("conversation.session.header.utilities", () => ({ id: "session-log-download" }));`,
  'dsh-client-ui-theme/lib/client.js': `ctx.slots.inject("settings.general.item", () => ({ id: "appearance" }));`,
  'dsh-client-ui-settings-general/lib/client.js': `ctx.slots.inject("settings.action", () => ({ id: "open-document" }));`,
  'dsh-client-ui-cordis/lib/client.js': `ctx.slots.inject("sidebar.footer.action", () => ({ id: "cordis-panel" }));`,
  'dsh-api-session-controller/lib/client.js': `
    this.lastAgentError = message;
    lastAgentError: this.lastAgentError,
  `,
}

/** 把合成产物铺到临时目录，返回该目录（收尾交给 scratchDirs）。 */
function writeSynthetic(overrides: Record<string, string | null> = {}): string {
  const dir = scratchDirSync('dsh-official-ids-')
  const merged: Record<string, string | null> = { ...SYNTHETIC, ...overrides }
  for (const [rel, content] of Object.entries(merged)) {
    if (content === null) continue
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return dir
}

const withSynthetic = (overrides: Record<string, string | null>, run: (root: string) => void): void => {
  const dir = writeSynthetic(overrides)
  try {
    run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('清单形状：每条都有出处文件、形状、理由与我方使用点，id 不重复', () => {
  assert.ok(mod.IDENTIFIERS.length >= 11, `清单条目 ${mod.IDENTIFIERS.length} 条，少于 #96 审计核实的 11 条`)
  const ids = new Set<string>()
  for (const dep of mod.IDENTIFIERS) {
    assert.ok(dep.id.length > 0 && !ids.has(dep.id), `id 重复或为空: ${dep.id}`)
    ids.add(dep.id)
    assert.match(dep.pkg, /^@deepseek-ai\//, `${dep.id} 的出处包名要在 @deepseek-ai 作用域下`)
    assert.ok(dep.file.startsWith('lib/'), `${dep.id} 的出处文件要指向产物（lib/）`)
    assert.ok(dep.pattern instanceof RegExp, `${dep.id} 缺形状`)
    assert.ok(dep.why.length > 0, `${dep.id} 缺「漂移了会怎样」的说明`)
    assert.ok(dep.where.includes('src/'), `${dep.id} 缺我方使用点`)
  }
})

test('清单里的我方使用点指向的文件都还在', () => {
  for (const dep of mod.IDENTIFIERS) {
    // 我方使用点：仓库根的 `src/...` 或插件包的 `packages/.../src/...`（#94 起可移植
    // 插件的本体住在包里）。边界用前视排除包路径里的内层 `src/`，免得拼出半个路径。
    const files = [...dep.where.matchAll(/(?<![\w/.-])((?:src|packages)\/[\w./-]+\.ts)/g)].map((m) => m[1])
    assert.ok(files.length > 0, `${dep.id} 的使用点里没有 src/… 文件`)
    for (const rel of files) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${dep.id} 的使用点文件不存在: ${rel}`)
    }
  }
})

test('正向：合成产物齐全时 pass，detail 记下读的是哪一份', () => {
  withSynthetic({}, (root) => {
    const row = mod.checkOfficialIdentifiers({ root, version: '0.1.6-alpha.1', profile: '合成产物' })
    assert.equal(row.id, 'official-identifiers')
    assert.equal(row.status, 'pass', row.detail)
    assert.match(row.detail, /0\.1\.6-alpha\.1/)
    assert.match(row.detail, /合成产物/)
  })
})

test('负向：删掉一个标识符即 fail，且报出条目名与出处文件', () => {
  withSynthetic(
    { 'dsh-client-ui-theme/lib/client.js': `ctx.slots.inject("settings.general.item", () => ({ id: "font-size" }));` },
    (root) => {
      const row = mod.checkOfficialIdentifiers({ root, version: '0.1.6-alpha.1', profile: '合成产物' })
      assert.equal(row.status, 'fail')
      assert.match(row.detail, /entry-id\.appearance/)
      assert.match(row.detail, /@deepseek-ai\/dsh-client-ui-theme\/lib\/client\.js/)
      assert.match(row.detail, /settingsLayoutPlugin\.ts/)
    },
  )
})

test('负向：整包不在（出处文件读不到）也 fail，并说明是文件读不到', () => {
  withSynthetic({ 'dsh-api-session-controller/lib/client.js': null }, (root) => {
    const row = mod.checkOfficialIdentifiers({ root, version: '0.1.6-alpha.1', profile: '合成产物' })
    assert.equal(row.status, 'fail')
    assert.match(row.detail, /snapshot-field\.lastAgentError/)
    assert.match(row.detail, /出处文件读不到/)
  })
})

test('负向：官方改文案（格式没变、字变了）能被认出来', () => {
  withSynthetic(
    { 'dsh-client-ui-sidebar/lib/client.js': `const zh = { "toggle.collapse": "收起侧栏" };` },
    (root) => {
      const row = mod.checkOfficialIdentifiers({ root, version: '0.1.6-alpha.1', profile: '合成产物' })
      assert.equal(row.status, 'fail')
      assert.match(row.detail, /sidebar-toggle\.zh/)
      assert.match(row.detail, /sidebar-toggle\.en/)
    },
  )
})
