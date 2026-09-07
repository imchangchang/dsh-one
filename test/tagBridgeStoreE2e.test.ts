import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TagBridge } from '../src/server/tagBridge.ts'
import { DshStateStore } from '../src/ui/dshStateStore.ts'
import { sanitizeTags, nextCustomColor, type SessionTagDef } from '../src/pure/sessionTags.ts'
import type { TagBridgeRequest } from '../src/pure/tagBridgeCore.ts'

const noopLogger = { info: () => {}, warn: () => {} }
const STORE_DIR = 'dsh-one'
const WS = 'ws-e2e'

/** 在 io（真实 DshStateStore.updateTags）上复刻 sessionsStore 的 tag CRUD 写路径。
 *  单 workspace 演示（与派生场景一致）。 */
function crud(io: DshStateStore) {
  const apply = (mutate: (b: WorkspaceBucket) => WorkspaceBucket) =>
    io.updateTags((prev) => {
      const b = prev.workspaces[WS] ?? { tags: sanitizeTags(undefined), sessionTags: {}, collapsed: [] }
      const nb = mutate({ ...b, tags: [...b.tags], sessionTags: { ...b.sessionTags }, collapsed: [...b.collapsed] })
      return { ...prev, workspaces: { ...prev.workspaces, [WS]: nb } }
    })

  const findTag = (b: WorkspaceBucket, idOrName: string) => b.tags.find((t) => t.id === idOrName || t.name === idOrName)

  return {
    async handle(req: TagBridgeRequest) {
      if (req.action === 'assign') {
        if (req.group !== undefined) {
          let tagId = ''
          await apply((b) => {
            let tag = findTag(b, req.group!)
            if (!tag) {
              tag = { id: `t-${randomUUID()}`, name: req.group!, color: nextCustomColor(b.tags) } as SessionTagDef
              b.tags = [...b.tags, tag]
            }
            tagId = tag.id
            for (const sid of req.sessionIds) b.sessionTags[sid] = tag.id
            return b
          })
          return { ok: true, tagName: req.group, tagId, sessionCount: req.sessionIds.length }
        }
        let found = false
        await apply((b) => {
          const tag = b.tags.find((t) => t.id === req.tagId)
          if (!tag) return b
          found = true
          for (const sid of req.sessionIds) b.sessionTags[sid] = tag.id
          return b
        })
        if (!found) return { ok: false, error: 'tag-not-found' }
        return { ok: true, tagId: req.tagId, sessionCount: req.sessionIds.length }
      }
      if (req.action === 'get') {
        let group: { workspaceId: string; id: string; name: string | null; color: string; preset: boolean } | null = null
        await apply((b) => {
          const tagId = b.sessionTags[req.sessionId]
          const tag = tagId ? findTag(b, tagId) : undefined
          group = tag ? { workspaceId: WS, id: tag.id, name: tag.name, color: tag.color, preset: tag.name === null } : null
          return b
        })
        return { ok: true, group }
      }
      // unassign
      await apply((b) => {
        for (const sid of req.sessionIds) delete b.sessionTags[sid]
        return b
      })
      return { ok: true, sessionCount: req.sessionIds.length }
    },
  }
}

interface WorkspaceBucket {
  tags: SessionTagDef[]
  sessionTags: Record<string, string>
  collapsed: string[]
}

test('真桥 e2e: assign 按组名 / assign 按 tagId / get / unassign 全链路到 tags.json v2', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'dsh-tag-e2e-'))
  const storeDir = path.join(sandbox, STORE_DIR)
  const bridgeFile = path.join(sandbox, 'bridge.json')
  const io = new DshStateStore({ dir: storeDir, log: noopLogger })
  const handler = crud(io)

  const bridge = new TagBridge({ filePath: bridgeFile, handle: (req) => handler.handle(req), logger: noopLogger })
  await bridge.start()
  const record = JSON.parse(await readFile(bridgeFile, 'utf8')) as { port: number; token: string }
  const tagsPath = path.join(storeDir, 'tags.json')
  const readTags = async (): Promise<{ version: number; workspaces: Record<string, WorkspaceBucket> }> =>
    JSON.parse(await readFile(tagsPath, 'utf8'))
  const post = (body: unknown) =>
    fetch(`http://127.0.0.1:${record.port}/tag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${record.token}` },
      body: JSON.stringify(body),
    })

  try {
    // 1. assign 按组名：建组 + 归属，幂等。
    const r1 = await post({ action: 'assign', group: 'e2e 批量组', sessionIds: ['s-1', 's-2'] })
    assert.equal(r1.status, 200)
    let tags = await readTags()
    assert.equal(tags.version, 2)
    const tag = tags.workspaces[WS].tags.find((t) => t.name === 'e2e 批量组')
    assert.ok(tag)
    assert.equal(tags.workspaces[WS].sessionTags['s-1'], tag.id)
    assert.equal(tags.workspaces[WS].sessionTags['s-2'], tag.id)
    // 幂等：同组名再 POST 不新建第二个定义。
    const r1b = await post({ action: 'assign', group: 'e2e 批量组', sessionIds: ['s-3'] })
    assert.equal(r1b.status, 200)
    tags = await readTags()
    assert.equal(tags.workspaces[WS].tags.filter((t) => t.name === 'e2e 批量组').length, 1)
    assert.equal(tags.workspaces[WS].sessionTags['s-3'], tag.id)

    // 2. get：查 s-1 当前组。
    const rg = await post({ action: 'get', sessionId: 's-1' })
    assert.equal(rg.status, 200)
    const gj = (await rg.json()) as { ok: boolean; group: { id: string; name: string } }
    assert.equal(gj.ok, true)
    assert.equal(gj.group.id, tag.id)
    assert.equal(gj.group.name, 'e2e 批量组')
    // 无组 session → null
    const rg2 = await post({ action: 'get', sessionId: 's-999' })
    assert.deepEqual((await rg2.json()).group, null)

    // 3. assign 按 tagId：归到指定已存在组。
    const r2 = await post({ action: 'assign', tagId: tag.id, sessionIds: ['s-4'] })
    assert.equal(r2.status, 200)
    tags = await readTags()
    assert.equal(tags.workspaces[WS].sessionTags['s-4'], tag.id)
    // 未知 tagId → tag-not-found（桥 500 + 错误码）
    const r2b = await post({ action: 'assign', tagId: 't-nope', sessionIds: ['s-5'] })
    assert.equal(r2b.status, 500)
    assert.deepEqual((await r2b.json()), { ok: false, error: 'tag-not-found' })

    // 4. unassign：清归属，组定义保留。
    const r3 = await post({ action: 'unassign', sessionIds: ['s-1', 's-2'] })
    assert.equal(r3.status, 200)
    tags = await readTags()
    assert.equal(tags.workspaces[WS].sessionTags['s-1'], undefined)
    assert.equal(tags.workspaces[WS].sessionTags['s-2'], undefined)
    assert.ok(tags.workspaces[WS].tags.some((t) => t.id === tag.id), 'group definition retained after unassign')
  } finally {
    await bridge.dispose()
    await rm(sandbox, { recursive: true, force: true })
  }
})
