import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TagBridge } from '../src/server/tagBridge.ts'
import { DshStateStore } from '../src/ui/dshStateStore.ts'
import { sanitizeTags, nextCustomColor, type SessionTagDef } from '../src/pure/sessionTags.ts'

const noopLogger = { info: () => {}, warn: () => {} }
const STORE_DIR = 'dsh-one'

/**
 * 真桥 e2e：真实 TagBridge（127.0.0.1 随机端口 + token + bridge.json）+ 真实
 * DshStateStore（updateTags 原子写 tags.json）+ 赋权后的 POST。验证 /tag 请求
 * 一路走到 tags.json 落盘成 v2 的「组定义 + 会话归属」，且幂等（同名组不重复建）。
 */
test('真桥 e2e: POST /tag 写入 tags.json v2（找/建组 + 归属 + 幂等）', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'dsh-tag-e2e-'))
  const storeDir = path.join(sandbox, STORE_DIR)
  const bridgeFile = path.join(sandbox, 'bridge.json')
  const io = new DshStateStore({ dir: storeDir, log: noopLogger })

  const bridge = new TagBridge({
    filePath: bridgeFile,
    // assignTags 复刻 sessionsStore.assignTagGroup 的写路径：逐 workspace 找/建
    // 同名组（颜色轮换）→ 批量归属。这里单 workspace（ws-e2e）演示。
    assignTags: async ({ group, sessionIds }) => {
      const wsId = 'ws-e2e'
      const ok = await io.updateTags((prev) => {
        const bucket = prev.workspaces[wsId] ?? { tags: sanitizeTags(undefined), sessionTags: {}, collapsed: [] }
        let tag = bucket.tags.find((t) => t.name === group)
        if (!tag) {
          tag = { id: `t-${randomUUID()}`, name: group, color: nextCustomColor(bucket.tags) } as SessionTagDef
          bucket.tags = [...bucket.tags, tag]
        }
        const sessionTags: Record<string, string> = { ...bucket.sessionTags }
        for (const sid of sessionIds) sessionTags[sid] = tag.id
        return {
          ...prev,
          workspaces: { ...prev.workspaces, [wsId]: { ...bucket, sessionTags } },
        }
      })
      if (!ok) return { ok: false, error: 'write-failed' }
      return { ok: true, tagName: group, tagId: 't-set', sessionCount: sessionIds.length }
    },
    logger: noopLogger,
  })
  await bridge.start()
  const record = JSON.parse(await readFile(bridgeFile, 'utf8')) as { port: number; token: string }
  try {
    const doPost = (body: unknown) =>
      fetch(`http://127.0.0.1:${record.port}/tag`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${record.token}` },
        body: JSON.stringify(body),
      })
    const r1 = await doPost({ group: 'e2e 批量组', sessionIds: ['s-1', 's-2'] })
    assert.equal(r1.status, 200)
    const tagsPath = path.join(storeDir, 'tags.json')
    const tags = JSON.parse(await readFile(tagsPath, 'utf8')) as {
      version: number
      workspaces: Record<string, { tags: Array<{ id: string; name: string | null }>; sessionTags: Record<string, string> }>
    }
    assert.equal(tags.version, 2)
    assert.ok(tags.workspaces['ws-e2e'])
    const bucket = tags.workspaces['ws-e2e']
    const tag = bucket.tags.find((t) => t.name === 'e2e 批量组')
    assert.ok(tag, 'group definition should exist')
    assert.equal(bucket.sessionTags['s-1'], tag.id)
    assert.equal(bucket.sessionTags['s-2'], tag.id)

    // 幂等：同名组再 POST 不新增第二个组定义。
    const r2 = await doPost({ group: 'e2e 批量组', sessionIds: ['s-3'] })
    assert.equal(r2.status, 200)
    const tags2 = JSON.parse(await readFile(tagsPath, 'utf8')) as typeof tags
    const sameName = tags2.workspaces['ws-e2e'].tags.filter((t) => t.name === 'e2e 批量组')
    assert.equal(sameName.length, 1)
    assert.equal(tags2.workspaces['ws-e2e'].sessionTags['s-3'], sameName[0].id)
  } finally {
    await bridge.dispose()
    await rm(sandbox, { recursive: true, force: true })
  }
})
