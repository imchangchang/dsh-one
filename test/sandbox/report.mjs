#!/usr/bin/env node
// report.mjs —— 把验证台账（ledger JSON）+ 截图渲染成单文件 HTML 测试报告。
//
// 用法:
//   node test/sandbox/report.mjs [--ledger <path>] [--out <path>]
// 缺省: ledger = test/sandbox/verify.ledger.json，out = ledger 同目录 verify.report.html
//
// ledger 格式（字段说明）:
//   title         报告标题
//   branch/commit 被验分支与 commit（dev-finish 时由生成方填写）
//   environment   {mode,dsh,locale,theme,image,driver,date} 任意键值，渲染成信息表
//   coverageNote  覆盖范围声明（真桌面/真模型/平台问题不在范围内）
//   items[]       {id,phase:'new-feature'|'regression',name,expect,result:'pending'|'done'|'pass'|'fail',
//                  screenshots:string[],notes}
//   result 语义: pending=未执行；done=驱动执行完待人工判定；pass/fail=结论已定。
//
// 截图以 base64 内嵌（单文件报告可独立分发/存档）。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
function argValue(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}

const defaultLedger = resolve(dirname(fileURLToPath(import.meta.url)), 'verify.ledger.json')
const ledgerPath = resolve(argValue('ledger') ?? defaultLedger)
const outPath = resolve(argValue('out') ?? ledgerPath.replace(/\.json$/, '.report.html'))

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const env = ledger.environment ?? {}
const items = ledger.items ?? []

const resultBadge = {
  pass: '<span class="badge pass">通过</span>',
  fail: '<span class="badge fail">失败</span>',
  done: '<span class="badge done">待判定</span>',
  pending: '<span class="badge pending">未执行</span>',
}

const envRows = Object.entries(env)
  .map(([k, v]) => `<tr><th>${k}</th><td>${String(v)}</td></tr>`)
  .join('')

const itemHtml = items
  .map((it) => {
    const shots = (it.screenshots ?? [])
      .map((p) => {
        let src = ''
        try {
          src = `data:image/png;base64,${readFileSync(resolve(p)).toString('base64')}`
        } catch {
          src = ''
        }
        if (!src) return `<div class="shot-missing">截图缺失: ${p}</div>`
        return `<figure><img src="${src}" alt="${it.id} 截图" loading="lazy"/><figcaption>${p}</figcaption></figure>`
      })
      .join('')
    return `
    <section class="item">
      <h3><span class="id">${it.id}</span> ${it.name} ${resultBadge[it.result] ?? it.result}</h3>
      <div class="meta">阶段：${it.phase === 'new-feature' ? '新增功能' : '回归测试'}</div>
      <h4>期望</h4>
      <pre>${it.expect}</pre>
      ${it.notes ? `<h4>说明</h4><pre>${it.notes}</pre>` : ''}
      ${shots ? `<h4>截图</h4>${shots}` : ''}
    </section>`
  })
  .join('')

const summary = (phase) => {
  const list = items.filter((i) => i.phase === phase)
  if (!list.length) return ''
  const pass = list.filter((i) => i.result === 'pass').length
  const fail = list.filter((i) => i.result === 'fail').length
  return `<tr><td>${phase === 'new-feature' ? '新增功能' : '回归测试'}</td><td>${list.length}</td><td>${pass}</td><td>${fail}</td></tr>`
}

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<title>${ledger.title ?? 'DSH One 验收报告'}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1c1c1c;background:#fafafa}
  h1{font-size:20px} h2{font-size:16px;margin-top:28px} h3{font-size:14px} h4{font-size:13px;margin-bottom:4px}
  pre{white-space:pre-wrap;background:#f0f0f0;padding:8px;border-radius:4px;font-size:12px}
  table{border-collapse:collapse;width:100%;margin:8px 0}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}
  .badge{padding:2px 8px;border-radius:10px;font-size:12px;color:#fff}
  .badge.pass{background:#2e7d32}.badge.fail{background:#c62828}.badge.done{background:#f9a825}.badge.pending{background:#757575}
  figure{margin:8px 0} img{max-width:100%;border:1px solid #ddd;border-radius:4px}
  figcaption{font-size:12px;color:#555}
  .shot-missing{color:#c62828;font-size:12px}
  .item{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px 16px;margin:12px 0}
  .id{font-family:monospace;color:#555}
</style>
</head>
<body>
<h1>${ledger.title ?? 'DSH One 验收报告'}</h1>
<p>分支 <code>${ledger.branch ?? ''}</code> @ <code>${ledger.commit ?? ''}</code></p>
<h2>环境</h2>
<table>${envRows}</table>
<h2>结论汇总</h2>
<table><tr><th>阶段</th><th>总数</th><th>通过</th><th>失败</th></tr>${summary('new-feature')}${summary('regression')}</table>
<h2>明细</h2>
${itemHtml || '<p>（无条目）</p>'}
${ledger.coverageNote ? `<h2>覆盖范围</h2><pre>${ledger.coverageNote}</pre>` : ''}
</body>
</html>`

writeFileSync(outPath, html, 'utf8')
console.log(`报告已生成: ${outPath}（${items.length} 项，截图内嵌 ${items.reduce((n, i) => n + (i.screenshots?.length ?? 0), 0)} 张）`)
