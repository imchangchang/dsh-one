import * as path from 'node:path'
import { consoleLogger, startLabServer } from './test/assembly-lab/labServer.ts'
import { launchBrowser } from './test/assembly-lab/harness.ts'
import { startEmptyGateway } from './test/assembly-lab/emptyGateway.ts'
import { installLabDataset, SIDEBAR_DATASET, datasetSessionItem } from './test/assembly-lab/dataset.ts'

const log = consoleLogger(true)
const empty = await startEmptyGateway(log)
const lab = await startLabServer({
  gateway: empty.gateway,
  token: empty.token,
  ...(empty.version === undefined ? {} : { version: empty.version }),
  log,
  pluginsDir: path.join(process.cwd(), 'dist/assembly/plugins'),
  port: 3174,
})
const browser = await launchBrowser(true)
const view = {
  activeGroupId: null,
  groupExpansion: Object.fromEntries(SIDEBAR_DATASET.workspaces.map((w) => [w.workspaceId, true])),
  recycleCollapsed: [],
  tagCollapsed: [],
}
try {
  for (const routeName of ['sidebar', 'sidebar-official']) {
    const route = lab.trees.find((t) => t.route === routeName)!
    for (const variant of ['none', 'view', 'current'] as const) {
      const context = await browser.newContext({ viewport: { width: 400, height: 900 } })
      await installLabDataset(context, SIDEBAR_DATASET)
      const scripts: string[] = []
      if (variant === 'view') {
        scripts.push(`(() => { try { localStorage.setItem('dsh.workspaceTree.view', ${JSON.stringify(JSON.stringify(view))}) } catch {} })()`)
      }
      if (variant === 'current') {
        scripts.push(`(() => { try { localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: 'lab-session-01' }))}) } catch {} })()`)
      }
      for (const script of scripts) await context.addInitScript({ content: script })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
      await page.goto(`${lab.origin}/${route.route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
      const facts = await page.evaluate(() => ({
        own: document.querySelectorAll('[data-dshone-tree-row="session"]').length,
        official: document.querySelectorAll('[class*="_sessionRow"]').length,
      }))
      console.log(routeName, variant, JSON.stringify(facts), 'errors', JSON.stringify(errors.slice(0, 2)))
      await context.close()
    }
  }
} finally {
  await browser.close()
  lab.dispose()
  await empty.dispose()
}
