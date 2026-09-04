import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAttempts, ThrottledQueue } from '../src/pure/thumbQueue.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('ThrottledQueue: 41 tasks never exceed the concurrency cap and all settle', async () => {
  const queue = new ThrottledQueue(4)
  const started = new Set<number>()
  let maxInFlight = 0
  const done: number[] = []

  const tasks = Array.from({ length: 41 }, (_, i) =>
    queue.run(async () => {
      started.add(i)
      if (queue.inFlight > maxInFlight) maxInFlight = queue.inFlight
      await sleep(5)
      done.push(i)
    }),
  )
  await Promise.all(tasks)

  assert.equal(maxInFlight <= 4, true, `inFlight peaked at ${maxInFlight} (> 4)`)
  assert.equal(started.size, 41)
  assert.equal(done.length, 41)
  assert.equal(queue.inFlight, 0)
  assert.equal(queue.queued, 0)
})

test('ThrottledQueue: waiting tasks start in FIFO order', async () => {
  const queue = new ThrottledQueue(1)
  const order: number[] = []
  const t0 = queue.run(async () => {
    await sleep(10)
    order.push(0)
  })
  const t1 = queue.run(async () => order.push(1))
  const t2 = queue.run(async () => order.push(2))
  await Promise.all([t0, t1, t2])
  assert.deepEqual(order, [0, 1, 2])
})

test('runAttempts: first success is a single attempt', async () => {
  const attempts: number[] = []
  const result = await runAttempts(
    async (a) => {
      attempts.push(a)
      return 'ok'
    },
    { timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 1 },
  )
  assert.equal(result, 'ok')
  assert.deepEqual(attempts, [1])
})

test('runAttempts: one transient failure then success = 2 attempts', async () => {
  const attempts: number[] = []
  const result = await runAttempts(
    async (a) => {
      attempts.push(a)
      if (a === 1) throw new Error('boom')
      return 'recovered'
    },
    { timeoutMs: 1000, maxAttempts: 3, retryDelayMs: 1 },
  )
  assert.equal(result, 'recovered')
  assert.deepEqual(attempts, [1, 2])
})

test('runAttempts: persistent failure stops at maxAttempts and rejects', async () => {
  const attempts: number[] = []
  await assert.rejects(
    runAttempts(
      async (a) => {
        attempts.push(a)
        throw new Error(`fail #${a}`)
      },
      { timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 1 },
    ),
    /fail #2/,
  )
  assert.deepEqual(attempts, [1, 2])
})

test('runAttempts: timeout counts as a failure and frees attempt budget', async () => {
  const attempts: number[] = []
  const t = Date.now()
  await assert.rejects(
    runAttempts(
      async (a) => {
        attempts.push(a)
        return new Promise<string>(() => {}) // never settles
      },
      { timeoutMs: 20, maxAttempts: 2, retryDelayMs: 1 },
    ),
    /timed out/,
  )
  assert.deepEqual(attempts, [1, 2])
  assert.equal(Date.now() - t >= 40, true, 'two attempts each wait the full timeout')
})

test('ThrottledQueue + runAttempts: 41 thumb fetches, missing files converge to failure', async () => {
  // 模拟 requestFileThumb 的全流程：读盘（fake fs）+ 队列限流 + 失败收敛。
  // 41 个文件里有 1 个缺失：缺失文件恰好尝试 maxAttempts 次后放弃（回失败态），
  // 其余文件 1 次成功；41 个任务全部 settle，无无限重试。
  const queue = new ThrottledQueue(4)
  const readAttempts = new Map<string, number>()
  const failures: string[] = []
  let maxInFlight = 0

  const paths: string[] = []
  for (let i = 0; i < 41; i++) paths.push(`/tmp/thumb-e2e/img-${i}.png`)
  const missing = paths[17]

  const settle = await Promise.allSettled(
    paths.map((p) =>
      queue.run(() =>
        runAttempts(async () => {
          readAttempts.set(p, (readAttempts.get(p) ?? 0) + 1)
          if (queue.inFlight > maxInFlight) maxInFlight = queue.inFlight
          await sleep(3)
          if (p === missing) throw new Error('ENOENT: no such file')
          return Buffer.from(`base64-${p}`)
        }, { timeoutMs: 500, maxAttempts: 2, retryDelayMs: 1 }),
      ).then(
        (data) => data,
        (err) => {
          failures.push(p)
          throw err
        },
      ),
    ),
  )

  assert.equal(settle.filter((s) => s.status === 'fulfilled').length, 40)
  assert.deepEqual(failures, [missing])
  assert.equal(readAttempts.get(missing), 2, 'missing file attempted exactly maxAttempts times')
  assert.equal(
    [...readAttempts.entries()].filter(([p]) => p !== missing).every(([, n]) => n === 1),
    true,
    'existing files read once each',
  )
  assert.equal(maxInFlight <= 4, true, `inFlight peaked at ${maxInFlight} (> 4)`)
  assert.equal(queue.inFlight, 0)
})
