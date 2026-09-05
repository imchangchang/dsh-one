import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 400 } })
await page.goto('file:///Users/cgeng/Workspaces/dsh-one/.prototype/session-row-prototype.html')
const data = await page.evaluate(() => {
  const out = {}
  const panels = document.querySelectorAll('.panel')
  panels.forEach((panel, pi) => {
    const rows = panel.querySelectorAll('.session-row')
    out[pi] = [...rows].map((row, i) => {
      const rb = row.getBoundingClientRect()
      const rowCenter = rb.top + rb.height / 2
      const items = [...row.querySelectorAll('.slot-rear > *, .session-time, .session-spin, .session-dot')].map((el) => {
        const b = el.getBoundingClientRect()
        return { cls: el.className || el.tagName, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
      })
      return { rowCenter: Math.round(rowCenter), items: items.map((it) => ({ ...it, dy: Math.round((it.cy - rowCenter) * 10) / 10 })) }
    })
  })
  return out
})
console.log(JSON.stringify(data, null, 1))
await browser.close()
