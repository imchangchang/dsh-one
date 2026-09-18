/**
 * 本地插件产物指纹的单测（#207）。
 *
 * 这条读数不判任何断言，但它决定「整轮中途 `dist/assembly/plugins` 有没有被重建过」这句话
 * 在报告里怎么写——那是排查「长轮次里会话面退化」（#203）时唯一的现场记录。所以在纯函数这
 * 一层把三样钉住：轻量指纹对什么敏感（大小 / 修改时间 / 增删文件）、内容指纹与 #173 的
 * combo 缓存键同源、以及三种形态（没变 / 只有轻量变了 / 内容也变了）的措辞与定位。
 *
 * 真目录那一批用本仓统一的 scratch 目录现造（`scratchDirs.ts`，#200；跑在 `npm test` 里，
 * 不碰仓库的 `dist/`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { scratchDir } from './scratchDirs.ts'
import {
  bundleStampOf,
  describeBundleRound,
  readBundleContentRev,
  readBundleStamp,
  type BundleFile,
  type BundleRound,
  type BundleSample,
} from './assembly-lab/localBundleFingerprint.ts'

const file = (rel: string, size: number, mtimeMs: number): BundleFile => ({ rel, size, mtimeMs })

const sample = (at: string, seconds: number, stamp: string, files = 3, bytes = 3000): BundleSample => ({
  at,
  seconds,
  stamp,
  files,
  bytes,
  detail: '',
})

/** 一份「什么都没变」的整轮读数（后面几个用例只改其中一两处）。 */
const round = (over: Partial<BundleRound> = {}): BundleRound =>
  ({
    dir: '/repo/dist/assembly/plugins',
    start: sample('整轮开始前', 0, 'stampA'),
    boundaries: [sample('F-01', 5, 'stampA'), sample('F-02', 30, 'stampA'), sample('F-03', 60, 'stampA')],
    end: sample('整轮结束后', 90, 'stampA'),
    startContent: 'contentA',
    endContent: 'contentA',
    ...over,
  }) as BundleRound

test('bundleStampOf：与文件在目录里的顺序无关，只看路径 / 大小 / 修改时间', () => {
  const files = [file('b/client.js', 20, 111), file('a/client.js', 10, 222)]
  assert.equal(bundleStampOf(files), bundleStampOf([...files].reverse()))
  // 大小变了、修改时间变了、多一个文件，三种都算变。
  assert.notEqual(bundleStampOf(files), bundleStampOf([file('b/client.js', 21, 111), file('a/client.js', 10, 222)]))
  assert.notEqual(bundleStampOf(files), bundleStampOf([file('b/client.js', 20, 112), file('a/client.js', 10, 222)]))
  assert.notEqual(bundleStampOf(files), bundleStampOf([...files, file('c/client.js', 1, 1)]))
  // 改名同样算变（路径参与哈希）。
  assert.notEqual(bundleStampOf(files), bundleStampOf([file('b/client2.js', 20, 111), file('a/client.js', 10, 222)]))
})

test('readBundleStamp / readBundleContentRev：改内容两个都变，只重写不换字节则只有轻量指纹变', async () => {
  const dir = await scratchDir('dsh-lab-bundle-')
  try {
    const one = path.join(dir, 'a.js')
    const two = path.join(dir, '@dsh-one', 'b', 'client.js')
    await fsp.mkdir(path.dirname(two), { recursive: true })
    await fsp.writeFile(one, 'console.log(1)\n')
    await fsp.writeFile(two, 'console.log(2)\n')

    const first = await readBundleStamp(dir)
    const firstRev = await readBundleContentRev(dir)
    assert.equal(first.detail, '')
    assert.equal(first.files, 2)
    assert.equal(first.bytes, 30)
    assert.match(first.stamp, /^[0-9a-f]{12}$/)

    // 同一份字节重新落盘（`npm run build` 重建出一样的内容就是这个形状）：修改时间变了、
    // 轻量指纹跟着变，内容指纹一字不变——combo 缓存键不受影响。
    await fsp.utimes(one, new Date(1_000_000), new Date(1_000_000))
    const rewritten = await readBundleStamp(dir)
    assert.notEqual(rewritten.stamp, first.stamp)
    assert.equal(await readBundleContentRev(dir), firstRev)

    // 内容真变了：两个都变。
    await fsp.writeFile(two, 'console.log(22)\n')
    assert.notEqual((await readBundleStamp(dir)).stamp, first.stamp)
    assert.notEqual(await readBundleContentRev(dir), firstRev)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('readBundleStamp：目录不在 / 空目录都如实记一句，不装作「没变」', async () => {
  const dir = await scratchDir('dsh-lab-bundle-')
  try {
    const empty = await readBundleStamp(dir)
    assert.match(empty.detail, /是空目录/)
    const missing = await readBundleStamp(path.join(dir, 'nope'))
    assert.match(missing.detail, /不存在/)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('describeBundleRound：从头到尾没变过时记一句「没被重建过」', () => {
  const result = describeBundleRound(round())
  assert.equal(result.changed, false)
  assert.equal(result.lines.length, 1)
  assert.match(result.lines[0] ?? '', /整轮没有被重建过：内容指纹一字未变（contentA，3 个文件、2\.9 KB）/)
  assert.match(result.lines[0] ?? '', /3 个套件边界上的轻量指纹也没变过/)
})

test('describeBundleRound：内容指纹变了 → 报出 A → B，并点名第一次看见变化的那一步', () => {
  const result = describeBundleRound(
    round({
      boundaries: [sample('F-01', 5, 'stampA'), sample('F-02', 30, 'stampB'), sample('F-03', 60, 'stampB')],
      end: sample('整轮结束后', 90, 'stampB'),
      endContent: 'contentB',
    }),
  )
  assert.equal(result.changed, true)
  assert.match(result.lines[0] ?? '', /本轮期间本地插件产物被重建过：内容指纹 contentA → contentB/)
  assert.match(result.lines[0] ?? '', /combo 整包缓存键里本地那一半，见 #173/)
  assert.match(result.lines[1] ?? '', /第一次看见变化是在「进入 F-02 之前」这一步（第 2 个套件边界，第 30 秒；轻量指纹 stampA → stampB）/)
  assert.match(result.lines[1] ?? '', /整轮开始 整轮开始前（3 个文件、2\.9 KB），整轮结束 整轮结束后/)
  assert.equal(result.lines.length, 2)
})

test('describeBundleRound：只有轻量指纹变了 → 说清「字节与缓存键都没变，但文件被重新落盘过」', () => {
  const result = describeBundleRound(
    round({ boundaries: [sample('F-01', 5, 'stampA'), sample('F-02', 30, 'stampB'), sample('F-03', 60, 'stampB')], end: sample('整轮结束后', 90, 'stampB') }),
  )
  assert.equal(result.changed, true)
  assert.match(result.lines[0] ?? '', /被重新落盘过，但内容指纹一字未变（contentA）/)
  assert.match(result.lines[0] ?? '', /rm -rf dist\/assembly/)
  assert.match(result.lines[1] ?? '', /「进入 F-02 之前」这一步（第 2 个套件边界，第 30 秒；轻量指纹 stampA → stampB）/)
})

test('describeBundleRound：变了不止一次时把其余几次也列出来', () => {
  const result = describeBundleRound(
    round({
      boundaries: [sample('F-01', 5, 'stampB'), sample('F-02', 30, 'stampB'), sample('F-03', 60, 'stampC')],
      end: sample('整轮结束后', 90, 'stampC'),
    }),
  )
  assert.equal(result.changed, true)
  assert.match(result.lines[1] ?? '', /「进入 F-01 之前」这一步（第 1 个套件边界，第 5 秒；轻量指纹 stampA → stampB）/)
  assert.match(result.lines[2] ?? '', /轻量指纹整轮一共变过 2 次，其余几次在：进入 F-03 之前（60s）/)
})

test('describeBundleRound：整轮结束时目录读不到了，本身就是一次变化', () => {
  const result = describeBundleRound(
    round({ end: { ...sample('整轮结束后', 90, '(目录不存在)'), files: 0, bytes: 0, detail: '/repo/dist/assembly/plugins 不存在（还没跑 npm run build？）' } }),
  )
  assert.equal(result.changed, true)
  assert.match(result.lines[0] ?? '', /有一个端点读不到/)
  assert.match(result.lines[0] ?? '', /整轮结束 \/repo\/dist\/assembly\/plugins 不存在/)
})

test('describeBundleRound：起止都读不到时不谎报「变过」，但照样留下读数', () => {
  const missing = { ...sample('整轮开始前', 0, '(目录不存在)'), files: 0, bytes: 0, detail: '/repo/dist/assembly/plugins 不存在（还没跑 npm run build？）' }
  const result = describeBundleRound(round({ start: missing, end: { ...missing, at: '整轮结束后', seconds: 90 } }))
  assert.equal(result.changed, false)
  assert.match(result.lines[0] ?? '', /有一个端点读不到/)
})
