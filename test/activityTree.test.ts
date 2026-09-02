import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatJobDuration,
  isLiveJob,
  jobDotState,
  jobStatusLabel,
  jobsChipLabel,
  orderJobs,
  type ActivityJob,
} from '../src/pure/activityTree.ts'

const NOW = 1_700_000_000_000 // fixed epoch ms for deterministic tests

const job = (
  id: string,
  opts: { kind?: string; status?: string; startedAt?: number; finishedAt?: number; detail?: string } = {},
): ActivityJob => ({
  id,
  kind: opts.kind ?? 'bash',
  label: `job ${id}`,
  status: opts.status ?? 'running',
  startedAt: opts.startedAt ?? NOW,
  ...(opts.finishedAt !== undefined ? { finishedAt: opts.finishedAt } : {}),
  ...(opts.detail ? { detail: opts.detail } : {}),
})

test('isLiveJob treats running/stopping as live, everything else settled', () => {
  assert.equal(isLiveJob(job('a', { status: 'running' })), true)
  assert.equal(isLiveJob(job('b', { status: 'stopping' })), true)
  assert.equal(isLiveJob(job('c', { status: 'completed' })), false)
  assert.equal(isLiveJob(job('d', { status: 'failed' })), false)
  assert.equal(isLiveJob(job('e', { status: 'killed' })), false)
})

test('orderJobs: live first (startedAt asc), then settled (finishedAt desc)', () => {
  const ordered = orderJobs([
    job('done-new', { status: 'completed', startedAt: NOW - 8000, finishedAt: NOW - 1000 }),
    job('live-new', { status: 'running', startedAt: NOW - 500 }),
    job('done-old', { status: 'failed', startedAt: NOW - 9000, finishedAt: NOW - 3000 }),
    job('live-old', { status: 'stopping', startedAt: NOW - 2000 }),
  ])
  assert.deepEqual(
    ordered.map((j) => j.id),
    ['live-old', 'live-new', 'done-new', 'done-old'],
  )
})

test('orderJobs: settled ties fall back to start order; missing finishedAt uses startedAt', () => {
  const ordered = orderJobs([
    job('b', { status: 'completed', startedAt: NOW - 1000, finishedAt: NOW - 100 }),
    job('a', { status: 'completed', startedAt: NOW - 2000, finishedAt: NOW - 100 }),
    job('no-finish', { status: 'killed', startedAt: NOW - 50 }),
  ])
  // no-finish 的结束时刻（startedAt NOW-50）最新；a/b 完成时刻相同，按开始升序。
  assert.deepEqual(
    ordered.map((j) => j.id),
    ['no-finish', 'a', 'b'],
  )
})

test('jobsChipLabel: live count wins; all settled shows total; empty is null', () => {
  assert.equal(jobsChipLabel([]), null)
  assert.equal(jobsChipLabel([job('a'), job('b', { status: 'completed' })]), '1 background jobs running')
  assert.equal(
    jobsChipLabel([job('a', { status: 'completed' }), job('b', { status: 'failed' })]),
    '2 background jobs',
  )
  assert.equal(jobsChipLabel([job('a', { status: 'stopping' })]), '1 background jobs running')
})

test('jobDotState maps wire statuses, unknown settles to done', () => {
  assert.equal(jobDotState('running'), 'ongoing')
  assert.equal(jobDotState('stopping'), 'warning')
  assert.equal(jobDotState('killed'), 'warning')
  assert.equal(jobDotState('completed'), 'done')
  assert.equal(jobDotState('failed'), 'error')
  assert.equal(jobDotState('whatever'), 'done')
})

test('jobStatusLabel is the official Chinese vocabulary, unknown passes through', () => {
  assert.equal(jobStatusLabel('running'), 'Running')
  assert.equal(jobStatusLabel('stopping'), 'Stopping')
  assert.equal(jobStatusLabel('completed'), 'Done')
  assert.equal(jobStatusLabel('killed'), 'Cancelled')
  assert.equal(jobStatusLabel('failed'), 'Failed')
  assert.equal(jobStatusLabel('mystery'), 'mystery')
})

test('formatJobDuration uses at most two adjacent units, hours is the widest', () => {
  assert.equal(formatJobDuration(0), '0s')
  assert.equal(formatJobDuration(23_000), '23s')
  assert.equal(formatJobDuration(4 * 60_000 + 58_000), '4m 58s')
  assert.equal(formatJobDuration(3600_000 + 2 * 60_000 + 30_000), '1h 2m')
  // 超过一小时不引入天词汇；负数 clamp 到 0。
  assert.equal(formatJobDuration(26 * 3600_000), '26h 0m')
  assert.equal(formatJobDuration(-500), '0s')
})
