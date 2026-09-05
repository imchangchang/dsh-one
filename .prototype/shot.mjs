import { chromium } from 'playwright'

const url = 'file:///Users/cgeng/Workspaces/dsh-one/.prototype/session-row-prototype.html'
const out = '/Users/cgeng/Workspaces/dsh-one/.prototype/session-row-prototype.png'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 400 }, deviceScaleFactor: 2 })
await page.goto(url)
await page.waitForTimeout(400)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('saved', out)
