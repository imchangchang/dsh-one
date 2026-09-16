/**
 * 「取网关内容交给用户」与「落盘」两项宿主能力的单测（#84）：用假件跑完整流程，
 * 把安全边界（只取本站内容、目标由用户选）与取消语义钉死。
 *
 * 被测的是 `src/pure/hostDownload.ts`（纯逻辑）——VS Code 侧的实际入口
 * （hostBridge 的 `file.download` / `file.save`）只负责注入 VS Code 三件套与提示，
 * 那个文件 import 了 `vscode`，单测进不来，所以逻辑全部压在这一层。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHostCallError } from '../src/pure/hostCallError.ts'
import { performGatewayDownload, performSaveContent, type DownloadDeps } from '../src/pure/hostDownload.ts'

interface Recorded {
  fetched: string[]
  written: Array<{ target: string; text: string }>
}

function deps(overrides: Partial<DownloadDeps> = {}): { deps: DownloadDeps; recorded: Recorded } {
  const recorded: Recorded = { fetched: [], written: [] }
  const base: DownloadDeps = {
    gatewayOrigin: () => 'http://127.0.0.1:3999',
    fetchImpl: async (url) => {
      recorded.fetched.push(url)
      return new Response('zip-bytes', { status: 200 })
    },
    chooseSavePath: async (name) => `/tmp/${name}`,
    writeBytes: async (target, data) => {
      recorded.written.push({ target, text: Buffer.from(data).toString('utf8') })
    },
  }
  return { deps: { ...base, ...overrides }, recorded }
}

test('取内容：路径拼到网关源上，内容按用户选的位置落盘', async () => {
  const { deps: d, recorded } = deps()
  const result = await performGatewayDownload(
    { path: '/api/session.export?sessionId=s1', suggestedName: 'dsh-session-s1.zip' },
    d,
  )
  assert.deepEqual(result, { path: '/tmp/dsh-session-s1.zip' })
  assert.deepEqual(recorded.fetched, ['http://127.0.0.1:3999/api/session.export?sessionId=s1'])
  assert.deepEqual(recorded.written, [{ target: '/tmp/dsh-session-s1.zip', text: 'zip-bytes' }])
})

test('取内容：页面给的路径不许跳源（协议相对 / 绝对 URL / ..）', async () => {
  for (const path of ['//evil.example/x', 'https://evil.example/x', '/api/../../secret', 'api/x']) {
    const { deps: d, recorded } = deps()
    const result = await performGatewayDownload({ path, suggestedName: 'a.zip' }, d)
    assert.equal(isHostCallError(result), true, `${path} 应被拒`)
    assert.equal(recorded.fetched.length, 0, `${path} 不应发出请求`)
  }
})

test('取内容：网关不可达时报 unsupported（不静默换源）', async () => {
  const { deps: d, recorded } = deps({ gatewayOrigin: () => undefined })
  const result = await performGatewayDownload({ path: '/api/x', suggestedName: 'a.zip' }, d)
  assert.deepEqual(result, { code: 'unsupported', message: 'the dsh gateway is not reachable from this window' })
  assert.equal(recorded.fetched.length, 0)
})

test('取内容：HTTP 失败报 not-found，且不弹保存框', async () => {
  let asked = 0
  const { deps: d } = deps({
    fetchImpl: async () => new Response('nope', { status: 404 }),
    chooseSavePath: async () => {
      asked += 1
      return '/tmp/a.zip'
    },
  })
  const result = await performGatewayDownload({ path: '/api/x', suggestedName: 'a.zip' }, d)
  assert.equal(isHostCallError(result), true)
  assert.equal((result as { code: string }).code, 'not-found')
  assert.equal(asked, 0, 'HTTP 失败不该再弹保存框')
})

test('取内容：用户取消 → cancelled，且不写盘', async () => {
  const { deps: d, recorded } = deps({ chooseSavePath: async () => null })
  const result = await performGatewayDownload({ path: '/api/x', suggestedName: 'a.zip' }, d)
  assert.equal((result as { code: string }).code, 'cancelled')
  assert.deepEqual(recorded.written, [])
})

test('取内容：写盘失败报 failed（把原因带出来）', async () => {
  const { deps: d } = deps({
    writeBytes: async () => {
      throw new Error('EACCES: permission denied')
    },
  })
  const result = await performGatewayDownload({ path: '/api/x', suggestedName: 'a.zip' }, d)
  assert.deepEqual(result, { code: 'failed', message: 'EACCES: permission denied' })
})

test('取内容：参数形状不对直接拒（不进 HTTP）', async () => {
  for (const args of [undefined, null, 'x', { path: '/api/x' }, { path: 7, suggestedName: 'a.zip' }, { path: '/api/x', suggestedName: '../evil' }]) {
    const { deps: d, recorded } = deps()
    const result = await performGatewayDownload(args, d)
    assert.equal(isHostCallError(result), true, `${JSON.stringify(args)} 应被拒`)
    assert.equal(recorded.fetched.length, 0)
  }
})

test('落盘：base64 内容写到用户选的位置', async () => {
  const { deps: d, recorded } = deps()
  const result = await performSaveContent({ suggestedName: 'notes.md', base64: Buffer.from('# hi').toString('base64') }, d)
  assert.deepEqual(result, { path: '/tmp/notes.md' })
  assert.deepEqual(recorded.written, [{ target: '/tmp/notes.md', text: '# hi' }])
})

test('落盘：用户取消 → cancelled；文件名不合法 → invalid-args', async () => {
  const cancelled = await performSaveContent(
    { suggestedName: 'notes.md', base64: 'aGk=' },
    { chooseSavePath: async () => null, writeBytes: async () => {} },
  )
  assert.equal((cancelled as { code: string }).code, 'cancelled')
  const bad = await performSaveContent(
    { suggestedName: 'a/b.md', base64: 'aGk=' },
    { chooseSavePath: async () => '/tmp/x', writeBytes: async () => {} },
  )
  assert.equal((bad as { code: string }).code, 'invalid-args')
})
