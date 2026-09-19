import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTagGroup,
  deleteTagGroup,
  emptyTagBucket,
  emptyTagGroups,
  parseTagGroups,
  pruneTagGroups,
  reorderTagGroups,
  sanitizeTagBucket,
  serializeTagGroups,
  setSessionTagGroup,
  setSessionsTagGroup,
  splitByTagGroups,
  tagBucketOf,
  tagGroupCounts,
  tagGroupDisplayName,
  tagGroupNameError,
  tagGroupSessionIds,
  updateTagGroup,
  withPresetTagGroups,
  withTagBucket,
  type TagGroupBucket,
  type TagGroupDef,
} from '../src/pure/sessionTagGroups.ts'
import type { SessionNode } from '../src/pure/workspaceTreeView.ts'

/** 一个最小会话节点（只需要 id + 排序/计数用到的字段）。 */
function node(id: string, patch: Partial<SessionNode> = {}): SessionNode {
  return {
    id,
    title: id,
    blank: false,
    running: false,
    runningSubagentCount: 0,
    completed: false,
    hasActiveSchedule: false,
    updatedAt: 0,
    ...patch,
  }
}

/** 造一个桶：`['A:a,b', 'B:c']` = 组 A 有会话 a、b，组 B 有会话 c。 */
function bucketOf(spec: readonly string[]): TagGroupBucket {
  let bucket = emptyTagBucket()
  for (const entry of spec) {
    const [name, members = ''] = entry.split(':')
    const created = createTagGroup(bucket, name ?? '', `t-${name ?? ''}`, 'orange')
    assert.equal(created.ok, true)
    bucket = created.bucket
    for (const id of members.split(',').filter((value) => value !== '')) {
      const next = setSessionTagGroup(bucket, id, created.id)
      assert.notEqual(next, null)
      bucket = next as TagGroupBucket
    }
  }
  return bucket
}

/** 三个预设组的 id（顺序 = 模型里的默认顺序）。 */
const PRESETS = ['preset-todo', 'preset-doing', 'preset-done']

/** 一份假词典（键 = PRESET_TAG_L10N 的取值），与插件词典同形。 */
function fakeTranslate(key: string): string {
  return ({ Todo: '待办', Doing: '进行中', Done: '已完成' } as Record<string, string>)[key] ?? key
}

test('迁入：v2 旧文件照常收下预设组（#213 把「不恢复内置组」反过来），其余原样保留', () => {
  const legacy = {
    version: 2,
    workspaces: {
      ws1: {
        tags: [
          { id: 'preset-todo', name: null, color: 'yellow' },
          { id: 'preset-doing', name: 'Doing now', color: 'blue' },
          { id: 't-custom', name: ' 甲方  ', color: 'purple' },
        ],
        sessionTags: { s1: 'preset-todo', s2: 't-custom', s3: 'preset-doing' },
        // 折叠是视图态，迁入时读过即弃（#107：走客户端存储，不进这份数据）。
        collapsed: ['preset-todo'],
      },
      ws2: { tags: [{ id: 't-other', name: 'Other', color: 'red' }], sessionTags: { s9: 't-other' } },
    },
  }
  const parsed = parseTagGroups(legacy)
  assert.notEqual(parsed, null)
  assert.deepEqual(parsed?.workspaces.ws1, {
    tags: [
      { id: 'preset-todo', name: null, color: 'yellow' },
      // 旧侧栏允许改预设组名，那份改名在新模型下不算数（名字恒从 l10n 出）；颜色照收。
      { id: 'preset-doing', name: null, color: 'blue' },
      { id: 't-custom', name: '甲方', color: 'purple' },
    ],
    sessionTags: { s1: 'preset-todo', s2: 't-custom', s3: 'preset-doing' },
  })
  assert.deepEqual(parsed?.workspaces.ws2, {
    tags: [{ id: 't-other', name: 'Other', color: 'red' }],
    sessionTags: { s9: 't-other' },
  })
  // 迁入后的形状可以原样写回（幂等：再读一次结果一致）。
  assert.deepEqual(parseTagGroups(JSON.parse(serializeTagGroups(parsed as never))), parsed)
  // 折叠字段一个字节都不落进新文件。
  assert.equal(serializeTagGroups(parsed as never).includes('collapsed'), false)
})

test('迁入：坏值与旧版本一律按空处理（不猜归属；预设组由视图侧补，见 withPresetTagGroups）', () => {
  assert.deepEqual(emptyTagGroups(), { version: 2, workspaces: {} })
  assert.equal(parseTagGroups(null), null)
  assert.equal(parseTagGroups([]), null)
  assert.equal(parseTagGroups({ version: 2 }), null)
  assert.equal(parseTagGroups({ version: 2, workspaces: [] }), null)
  // v1 是旧全局模型：没有「会话属于哪个工作区」的映射，分不了桶，不猜。
  assert.equal(parseTagGroups({ version: 1, tags: [], sessionTags: { s1: 'x' } }), null)
})

test('清洗：丢重复 id / 空名 / 坏颜色，归属只留指向已知组的', () => {
  const bucket = sanitizeTagBucket({
    tags: [
      { id: 't1', name: 'One', color: 'not-a-color' },
      { id: 't1', name: 'Duplicate id', color: 'red' },
      { id: 't2', name: '   ', color: 'red' },
      { id: 't3', name: 'Three' },
      { id: '', name: 'No id', color: 'red' },
    ],
    sessionTags: { a: 't1', b: 't-unknown', c: 't3', '': 't1' },
  })
  assert.deepEqual(bucket, {
    tags: [
      { id: 't1', name: 'One', color: 'orange' },
      { id: 't3', name: 'Three', color: 'orange' },
    ],
    sessionTags: { a: 't1', c: 't3' },
  })
  assert.equal(sanitizeTagBucket('nope'), null)
})

test('清洗：预设组收下但名字恒回 null；指向预设组的归属恒有效（桶里没存过那条定义也算）', () => {
  const bucket = sanitizeTagBucket({
    tags: [
      { id: 'preset-todo', name: '我自己起的名字', color: 'purple' },
      { id: 'preset-doing', name: null, color: 'not-a-color' },
    ],
    sessionTags: { a: 'preset-doing', b: 'preset-done' },
  })
  assert.deepEqual(bucket, {
    tags: [
      { id: 'preset-todo', name: null, color: 'purple' },
      { id: 'preset-doing', name: null, color: 'orange' },
    ],
    sessionTags: { a: 'preset-doing', b: 'preset-done' },
  })
})

test('标签组名：空名与同桶重名被拒；改名与新建共用同一份判定', () => {
  const bucket = bucketOf(['甲方'])
  assert.equal(tagGroupNameError(bucket, '   '), 'empty')
  assert.equal(tagGroupNameError(bucket, '甲方'), 'duplicate')
  assert.equal(tagGroupNameError(bucket, '甲方', 't-甲方'), null)
  assert.equal(tagGroupNameError(bucket, '乙方'), null)
  assert.deepEqual(createTagGroup(bucket, '  ', 't-new', 'red'), { ok: false, error: 'empty' })
  assert.deepEqual(createTagGroup(bucket, '甲方', 't-new', 'red'), { ok: false, error: 'duplicate' })

  const created = createTagGroup(bucket, ' 乙方 ', 't-new', 'red')
  assert.equal(created.ok, true)
  assert.deepEqual((created as { bucket: TagGroupBucket }).bucket.tags[1], { id: 't-new', name: '乙方', color: 'red' })
})

test('视图桶：缺的预设组补在末尾（持久数据一个字节不改），名字走 l10n', () => {
  const bucket = bucketOf(['A:a'])
  const view = withPresetTagGroups(bucket)
  assert.deepEqual(view.tags.map((tag) => tag.id), ['t-A', ...PRESETS])
  assert.deepEqual(view.sessionTags, { a: 't-A' })
  // 补的是视图：原桶一个字节没动。
  assert.deepEqual(bucket.tags.map((tag) => tag.id), ['t-A'])
  // 已经在桶里的预设组不重复补、用户换过的颜色照旧，顺序也不动（用户拖过之后听数据的）。
  const persisted: TagGroupBucket = {
    tags: [
      { id: 'preset-done', name: null, color: 'red' },
      { id: 't-A', name: 'A', color: 'orange' },
    ],
    sessionTags: {},
  }
  const view2 = withPresetTagGroups(persisted)
  assert.deepEqual(view2.tags.map((tag) => tag.id), ['preset-done', 't-A', 'preset-todo', 'preset-doing'])
  assert.equal(view2.tags[0]?.color, 'red')
  // 名字：预设组走 l10n（字典键 = PRESET_TAG_L10N 那一份），自建组用原文。
  assert.deepEqual(
    withPresetTagGroups(emptyTagBucket()).tags.map((tag) => tagGroupDisplayName(tag, fakeTranslate)),
    ['待办', '进行中', '已完成'],
  )
  const custom: TagGroupDef = { id: 't-A', name: '甲组', color: 'orange' }
  assert.equal(tagGroupDisplayName(custom, fakeTranslate), '甲组')
})

test('归属：一个会话最多一个组（改归属 = 覆盖），移出 = 记 null；无变化返回 null', () => {
  const bucket = bucketOf(['A:a', 'B:'])
  const toB = setSessionTagGroup(bucket, 'a', 't-B')
  assert.deepEqual(toB?.sessionTags, { a: 't-B' })
  assert.equal(setSessionTagGroup(toB as TagGroupBucket, 'a', 't-B'), null)
  assert.deepEqual(setSessionTagGroup(toB as TagGroupBucket, 'a', null)?.sessionTags, {})
  // 未知组 id 不给记（脏归属写进去渲染不出来，只会变成看不见的悬挂数据）。
  assert.equal(setSessionTagGroup(bucket, 'a', 't-不存在的组'), null)
  assert.equal(setSessionTagGroup(bucket, '', 't-A'), null)
  // 预设组 id 恒算已知目标：它不必先落定义（视图侧恒补，见 withPresetTagGroups）。
  const toPreset = setSessionTagGroup(bucket, 'a', 'preset-todo')
  assert.deepEqual(toPreset?.sessionTags, { a: 'preset-todo' })
  assert.deepEqual(toPreset?.tags.map((tag) => tag.id), ['t-A', 't-B'])
  assert.equal(setSessionTagGroup(toPreset as TagGroupBucket, 'a', 'preset-todo'), null)
  // 整组移出：一次一批。
  assert.deepEqual(setSessionsTagGroup(bucket, ['a', 'ghost'], null)?.sessionTags, {})
  assert.equal(setSessionsTagGroup(bucket, ['ghost'], null), null)
})

test('删组：定义与归属一起删，别的组不受影响；预设组拒删（动作层这一道是硬的）', () => {
  const bucket = bucketOf(['A:a', 'B:b'])
  assert.deepEqual(deleteTagGroup(bucket, 't-A'), { tags: [{ id: 't-B', name: 'B', color: 'orange' }], sessionTags: { b: 't-B' } })
  assert.equal(deleteTagGroup(bucket, 't-不存在'), null)
  // 预设组：定义在、归属在，删除请求一律回 null（= 调用方跳过落盘，一个字节都不变）。
  assert.equal(deleteTagGroup(withPresetTagGroups(bucket), 'preset-todo'), null)
  assert.equal(deleteTagGroup(bucket, 'preset-done'), null)
  assert.equal(deleteTagGroup(bucketOf([]), 'preset-doing'), null)
})

test('改名/换色：非法名与无变化都返回 null；预设组只接受换色', () => {
  const bucket = bucketOf(['A:a', 'B:'])
  assert.deepEqual(updateTagGroup(bucket, 't-A', { name: ' 甲 ' })?.tags[0], { id: 't-A', name: '甲', color: 'orange' })
  assert.deepEqual(updateTagGroup(bucket, 't-A', { color: 'red' })?.tags[0], { id: 't-A', name: 'A', color: 'red' })
  assert.equal(updateTagGroup(bucket, 't-A', { name: 'B' }), null)
  assert.equal(updateTagGroup(bucket, 't-A', { name: '  ' }), null)
  assert.equal(updateTagGroup(bucket, 't-A', { name: 'A', color: 'orange' }), null)
  assert.equal(updateTagGroup(bucket, 't-不存在', { color: 'red' }), null)

  // 预设组：改名拒（名字走 l10n）、换色收（旧侧栏 setTagColor 对预设组没有门槛）。
  const view = withPresetTagGroups(bucket)
  assert.equal(updateTagGroup(view, 'preset-todo', { name: '待办' }), null)
  assert.deepEqual(updateTagGroup(view, 'preset-todo', { color: 'red' })?.tags.find((tag) => tag.id === 'preset-todo'), {
    id: 'preset-todo',
    name: null,
    color: 'red',
  })
  assert.equal(updateTagGroup(view, 'preset-todo', { color: 'yellow' }), null)
  // 桶里没落定义时找不到它——调用方要先过一遍视图桶（树里的换色就是这么做的）。
  assert.equal(updateTagGroup(bucket, 'preset-todo', { color: 'red' }), null)
})

test('组间排序：只接受与全集等长的置换，无变化/缺项/多项都返回 null', () => {
  const bucket = bucketOf(['A:a', 'B:', 'C:'])
  assert.deepEqual(reorderTagGroups(bucket, ['t-C', 't-A', 't-B'])?.tags.map((tag) => tag.id), ['t-C', 't-A', 't-B'])
  assert.equal(reorderTagGroups(bucket, ['t-A', 't-B', 't-C']), null)
  assert.equal(reorderTagGroups(bucket, ['t-A', 't-B']), null)
  assert.equal(reorderTagGroups(bucket, ['t-A', 't-B', 't-A']), null)
  assert.equal(reorderTagGroups(bucket, ['t-A', 't-B', 't-X']), null)
  // 带预设组的视图桶：提交的是整份显示顺序，重排后预设组也落进这份数据。
  const view = withPresetTagGroups(bucketOf(['A:a']))
  assert.deepEqual(
    reorderTagGroups(view, ['t-A', 'preset-done', 'preset-todo', 'preset-doing'])?.tags.map((tag) => tag.id),
    ['t-A', 'preset-done', 'preset-todo', 'preset-doing'],
  )
})

test('空组清理：成员全没了（归档/消失）的组连归属一起清掉；回收站里的仍算活着', () => {
  const bucket = bucketOf(['A:a,b', 'B:c', 'C:'])
  // C 从建出来就没有成员（旧文件里可能存着这种），一并清掉。
  const alive = (id: string): boolean => id === 'c'
  assert.deepEqual(pruneTagGroups(bucket, alive), { tags: [{ id: 't-B', name: 'B', color: 'orange' }], sessionTags: { c: 't-B' } })
  // 所有成员都活着时，只清掉那个从来没成员的组 C（它也占不了位），A/B 原样保留。
  assert.deepEqual(pruneTagGroups(bucket, () => true)?.tags.map((tag) => tag.id), ['t-A', 't-B'])
  // 没有可清理的返回 null。
  assert.equal(pruneTagGroups(bucketOf(['A:a', 'B:c']), () => true), null)
  assert.equal(pruneTagGroups(emptyTagBucket(), () => true), null)

  // 预设组不参与这条清理：定义与归属都留着（此刻没成员不等于它没了）。
  const view = withPresetTagGroups(bucketOf(['A:a']))
  const pruned = pruneTagGroups({ tags: view.tags, sessionTags: { ...view.sessionTags, ghost: 'preset-todo' } }, () => false)
  assert.deepEqual(pruned?.tags.map((tag) => tag.id), PRESETS)
  assert.deepEqual(pruned?.sessionTags, { ghost: 'preset-todo' })
})

test('切块：空组不占位、未归组的殿后；组内置顶 = 在该组内靠前，组间位置不受置顶影响', () => {
  // 组顺序 A、B；会话官方顺序 s1..s5，其中 s1 与 s5 置顶（s5 属 B）。
  const bucket = bucketOf(['A:s2,s1,s3', 'B:s5,s4'])
  const sessions = [node('s1'), node('s2'), node('s3'), node('s4'), node('s5')]
  const pinned = new Set(['s1', 's5'])
  const split = splitByTagGroups(sessions, bucket, (item) => pinned.has(item.id))
  assert.deepEqual(split.blocks.map((block) => block.def.name), ['A', 'B'])
  // A：s1 置顶 → 排到 A 组内最前（s2、s3 其余保持官方顺序）。
  assert.deepEqual(split.blocks[0]?.sessions.map((item) => item.id), ['s1', 's2', 's3'])
  // B：s5 置顶 → 排到 B 组内最前。
  assert.deepEqual(split.blocks[1]?.sessions.map((item) => item.id), ['s5', 's4'])
  assert.deepEqual(split.ungrouped, [])
})

test('切块：#214 空组一律不占位（预设组也一样），有成员才出块', () => {
  const bucket = withPresetTagGroups(bucketOf(['A:s2', 'B:']))
  const sessions = [node('s1'), node('s2'), node('s3')]
  const split = splitByTagGroups(sessions, bucket, () => false)
  // t-A 有成员 → 出块；t-B 空着 → 不出；三个预设组也空着 → 一个都不出（不再各占一行）。
  assert.deepEqual(split.blocks.map((block) => block.def.id), ['t-A'])
  assert.deepEqual(split.blocks[0]?.sessions.map((item) => item.id), ['s2'])
  assert.deepEqual(split.ungrouped.map((item) => item.id), ['s1', 's3'])
  // 「空着不渲染」不等于「没了」：三个预设组照旧在视图桶里——「移到分组…」的清单就是这份 tags。
  assert.deepEqual(bucket.tags.map((tag) => tag.id), ['t-A', 't-B', ...PRESETS])
  // 往预设组里归一条 → 它立刻出块（有成员才出块 ≠ 预设组出不了块）。
  const assigned = setSessionTagGroup(bucket, 's1', 'preset-doing')
  const assignedSplit = splitByTagGroups(sessions, assigned as TagGroupBucket, () => false)
  assert.deepEqual(assignedSplit.blocks.map((block) => block.def.id), ['t-A', 'preset-doing'])
  assert.deepEqual(
    assignedSplit.blocks.find((block) => block.def.id === 'preset-doing')?.sessions.map((item) => item.id),
    ['s1'],
  )
})

test('切块：未归组的行排在所有组块之后，且同样「置顶项先、其余官方顺序」', () => {
  const bucket = bucketOf(['A:s2'])
  const sessions = [node('s1'), node('s2'), node('s3')]
  const split = splitByTagGroups(sessions, bucket, (item) => item.id === 's3')
  assert.deepEqual(split.blocks[0]?.sessions.map((item) => item.id), ['s2'])
  assert.deepEqual(split.ungrouped.map((item) => item.id), ['s3', 's1'])
})

test('切块：没有任何标签组时原样返回（未归组那段 = 整层，置顶项先）', () => {
  const sessions = [node('s1'), node('s2'), node('s3')]
  const split = splitByTagGroups(sessions, emptyTagBucket(), (item) => item.id === 's2')
  assert.deepEqual(split.blocks, [])
  assert.deepEqual(split.ungrouped.map((item) => item.id), ['s2', 's1', 's3'])
})

test('组内会话 id：按归属表顺序收集（整组动作按它取全集）', () => {
  const bucket = bucketOf(['A:a,b', 'B:'])
  assert.deepEqual(tagGroupSessionIds(bucket, 't-A'), ['a', 'b'])
  assert.deepEqual(tagGroupSessionIds(bucket, 't-B'), [])
})

test('折叠计数：每个会话只进一个桶，优先级 待交互 > 运行中 > 未读', () => {
  const counts = tagGroupCounts(
    [
      node('a', { pendingInteraction: 'question', running: true, unread: true } as Partial<SessionNode>),
      node('b', { running: true }),
      node('c', { runningSubagentCount: 2 }),
      node('d'),
      node('e'),
    ],
    (id) => id === 'd' || id === 'a',
  )
  assert.deepEqual(counts, { pending: 1, running: 2, unread: 1 })
})

test('桶读写：没有桶给空桶、没有组定义也没有归属的桶不落盘（不给工作区留空气键）', () => {
  const file = emptyTagGroups()
  assert.deepEqual(tagBucketOf(file, 'ws1'), emptyTagBucket())
  const bucket = bucketOf(['A:a'])
  const written = withTagBucket(file, 'ws1', bucket)
  assert.deepEqual(tagBucketOf(written, 'ws1'), bucket)
  assert.deepEqual(tagBucketOf(written, 'ws2'), emptyTagBucket())
  // 删掉最后一个组再写回 → 这个工作区的键消失。
  assert.deepEqual(withTagBucket(written, 'ws1', emptyTagBucket()).workspaces, {})
  // 只有归属、没有组定义（会话归进了预设组）的桶要留下——不然那条归属就丢了。
  const presetOnly = withTagBucket(file, 'ws3', { tags: [], sessionTags: { a: 'preset-todo' } })
  assert.deepEqual(presetOnly.workspaces.ws3, { tags: [], sessionTags: { a: 'preset-todo' } })
  assert.deepEqual(parseTagGroups(JSON.parse(serializeTagGroups(presetOnly)))?.workspaces.ws3, {
    tags: [],
    sessionTags: { a: 'preset-todo' },
  })
})
