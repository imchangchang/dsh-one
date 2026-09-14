import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ASSEMBLY_PACKAGE_NAMES,
  SHELL_PLUGIN_ID,
  generateAssemblyManifest,
} from '../scripts/gen-assembly-manifest.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE_MODULES = path.join(REPO_ROOT, 'node_modules')
const FRONTEND_DIST = path.join(NODE_MODULES, '@deepseek-ai', 'dsh-web-frontend', 'dist')
const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'
const REMOVED_IDS = ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar']

test('生成器对真实 node_modules 产出完整自洽的装配清单（18 官方包 + shell）', async () => {
  const manifest = await generateAssemblyManifest({ nodeModulesDir: NODE_MODULES, frontendDistDir: FRONTEND_DIST })

  // pin 单一、区间语义由装配页版本门消费。
  assert.equal(manifest.version, '0.1.2-rc.1')

  // 前端资产：哈希文件名解析自 dist/index.html 且真实存在（禁硬编码的回归锚）。
  assert.match(manifest.frontend.moduleJs, /^assets\/index-[^/]+\.js$/)
  for (const href of [manifest.frontend.moduleJs, ...manifest.frontend.preloadJs, ...manifest.frontend.css]) {
    await fsp.access(path.join(FRONTEND_DIST, href))
  }

  // wire：19 条目（18 官方 + shell）id 唯一，inject 闭包自洽且不含被删包。
  const entries = manifest.boot.entries
  assert.equal(entries.length, 19)
  const ids = entries.map((e: { id: string }) => e.id)
  assert.equal(new Set(ids).size, 19)
  const idSet = new Set(ids)
  for (const entry of entries) {
    for (const dep of entry.inject ?? []) {
      assert.ok(idSet.has(dep), `${entry.id} inject ${dep} 越出闭包`)
      assert.ok(!REMOVED_IDS.includes(dep), `${entry.id} inject 仍引用下线包 ${dep}`)
    }
    const escaped = entry.id.replaceAll('/', '\\/')
    assert.match(entry.url, new RegExp(`^/plugins-local/\\?\\?${escaped}/client\\.js&rev=0\\.1\\.2-rc\\.1$`))
  }

  // shell 合成 entry：恰一个，wire 层无 inject/immediately（插件面 inject 在 bundle 内）。
  const shellEntries = entries.filter((e) => e.id === SHELL_PLUGIN_ID)
  assert.equal(shellEntries.length, 1)
  assert.equal(shellEntries[0].inject, undefined)
  assert.equal(shellEntries[0].immediately, undefined)

  // 批：bootstrap 恰为 client-modules；application = 17 官方 + shell。
  const [bootstrap, application] = manifest.boot.batches
  assert.equal(bootstrap.phase, 'bootstrap')
  assert.deepEqual(bootstrap.entries, [BOOTSTRAP_ID])
  assert.equal(application.phase, 'application')
  assert.equal(application.entries.length, 18)
  assert.ok(!application.entries.includes(BOOTSTRAP_ID))
  assert.equal(application.entries.filter((id) => id === SHELL_PLUGIN_ID).length, 1)
  for (const id of application.entries) {
    assert.ok(application.url.includes(`${id}/client.js`), `application combo 缺 ${id}`)
  }
  assert.equal(manifest.bootstrapUrl, bootstrap.url)
  assert.ok(ids.includes(BOOTSTRAP_ID))
  // 下线包不再出现在任何条目里。
  for (const removed of REMOVED_IDS) {
    assert.ok(!ids.includes(removed), `下线包 ${removed} 仍在 wire 中`)
  }
})

test('生成器校验：inject 依赖越出 18 包闭包即拒绝', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'assembly-manifest-'))
  try {
    const fixtureNm = path.join(tmp, 'node_modules', '@deepseek-ai')
    const frontendDist = path.join(tmp, 'frontend-dist')
    await fsp.mkdir(fixtureNm, { recursive: true })
    await fsp.mkdir(frontendDist, { recursive: true })
    await fsp.writeFile(
      path.join(frontendDist, 'index.html'),
      '<script type="module" crossorigin src="./assets/index-TEST.js"></script>' +
        '<link rel="modulepreload" crossorigin href="./assets/vendor-TEST.js">' +
        '<link rel="stylesheet" crossorigin href="./assets/vendor-TEST.css">',
    )
    for (const name of ASSEMBLY_PACKAGE_NAMES) {
      const dir = path.join(fixtureNm, name)
      await fsp.mkdir(dir, { recursive: true })
      const inject =
        name === 'dsh-client-ui-chat'
          ? // 越界依赖：闭包校验必须抓住它。
            ['@deepseek-ai/dsh-not-in-closure']
          : name === 'dsh-api-session-controller'
            ? [BOOTSTRAP_ID]
            : []
      await fsp.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: `@deepseek-ai/${name}`,
          version: '0.1.2-rc.1',
          dsh: { client: { platform: 'web', inject, immediately: name === 'dsh-client-modules' } },
        }),
      )
    }
    await assert.rejects(
      generateAssemblyManifest({ nodeModulesDir: path.join(tmp, 'node_modules'), frontendDistDir: frontendDist }),
      /不在 18 包闭包内/,
    )
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
})
