import { exchangeToken, cookieHeader } from './src/server/assemblyMirror.ts'
import { consoleLogger } from './test/assembly-lab/labServer.ts'
const log = consoleLogger(true)
const gw = 'http://127.0.0.1:3080'
const rec = JSON.parse(await (await import('node:fs/promises')).readFile(`${process.env.HOME}/.dsh/dsh-owned.json`, 'utf8'))
await exchangeToken(gw, rec.token, log)
const cookie = cookieHeader(gw) as string
const res = await fetch(`${gw}/api/session/list`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'diag-1', method: 'session/list', payload: { args: { _request: {} } } }),
})
const parsed = JSON.parse(await res.text()) as { result?: { value?: Record<string, unknown> & { items?: Record<string, unknown>[] } } }
const value = parsed.result?.value ?? {}
console.log('value keys', JSON.stringify(Object.keys(value)))
const items = value.items ?? []
const first = items[0] ?? {}
console.log('item keys', JSON.stringify(Object.keys(first)))
const projections = first.projections as Record<string, unknown>
console.log('projections keys', JSON.stringify(Object.keys(projections)))
const values = (projections.values ?? {}) as Record<string, unknown>
console.log('values keys', JSON.stringify(Object.keys(values)))
console.log('sessionListMetadata', JSON.stringify(values.sessionListMetadata))
console.log('title value type', typeof values.title, JSON.stringify(values.title))
for (const [k, v] of Object.entries(first)) {
  if (k === 'projections') continue
  console.log(' field', k, '=', typeof v, JSON.stringify(v)?.slice(0, 120))
}
