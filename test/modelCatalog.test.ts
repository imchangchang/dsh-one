import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelCatalogDirectory, modelLabelOf } from '../src/server/modelCatalog.ts'
import type { ModelCatalogValue } from '../src/server/modelCatalog.ts'
import type { Logger } from '../src/log.ts'

const noopLogger = { info() {}, warn() {}, error() {} } as unknown as Logger

const catalogOf = (): ModelCatalogValue => ({
  groups: [
    {
      id: 'provider-a',
      name: 'Provider A',
      models: [
        { id: 'model-1', name: 'Model One', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] } },
      ],
    },
  ],
  failures: [],
  routable: true,
})

/** Deferred promise pair for steering the fake remote. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('modelCatalogDirectory: loads once, shares one in-flight load', async () => {
  let calls = 0
  const dir = new ModelCatalogDirectory(noopLogger, () => {
    calls += 1
    return Promise.resolve(catalogOf())
  })
  const [a, b] = await Promise.all([dir.load('http://a'), dir.load('http://a')])
  assert.equal(calls, 1)
  assert.deepEqual(a.groups, b.groups)
  assert.equal(dir.read().status, 'ready')
})

test('modelCatalogDirectory: concurrent callers share the same in-flight operation', async () => {
  const gate = deferred<ModelCatalogValue>()
  let calls = 0
  const dir = new ModelCatalogDirectory(noopLogger, () => {
    calls += 1
    return gate.promise
  })
  const first = dir.load('http://a')
  const second = dir.load('http://a')
  gate.resolve(catalogOf())
  await Promise.all([first, second])
  assert.equal(calls, 1)
})

test('modelCatalogDirectory: url change invalidates the cached generation', async () => {
  let calls = 0
  const dir = new ModelCatalogDirectory(noopLogger, () => {
    calls += 1
    return Promise.resolve(catalogOf())
  })
  await dir.load('http://a')
  await dir.load('http://b')
  assert.equal(calls, 2)
})

test('modelCatalogDirectory: failure flags error and the next load refetches', async () => {
  let calls = 0
  const dir = new ModelCatalogDirectory(noopLogger, () => {
    calls += 1
    if (calls === 1) return Promise.reject(new Error('boom'))
    return Promise.resolve(catalogOf())
  })
  await assert.rejects(() => dir.load('http://a'), /boom/)
  assert.equal(dir.read().status, 'error')
  assert.equal(dir.read().value, null)
  await dir.load('http://a')
  assert.equal(dir.read().status, 'ready')
  assert.equal(calls, 2)
})

test('modelCatalogDirectory: invalidate flips to idle and next load refetches', async () => {
  let calls = 0
  const dir = new ModelCatalogDirectory(noopLogger, () => {
    calls += 1
    return Promise.resolve(catalogOf())
  })
  await dir.load('http://a')
  dir.invalidate()
  assert.equal(dir.read().status, 'idle')
  assert.equal(dir.read().value, null)
  await dir.load('http://a')
  assert.equal(calls, 2)
})

test('modelCatalogDirectory: listeners fire on loading, ready, error and invalidate', async () => {
  const dir = new ModelCatalogDirectory(noopLogger, () => Promise.resolve(catalogOf()))
  const seen: string[] = []
  const stop = dir.onDidChange(() => seen.push(dir.read().status))
  await dir.load('http://a')
  dir.invalidate()
  stop()
  await dir.load('http://a') // stopped listener must not fire
  assert.deepEqual(seen, ['loading', 'ready', 'idle'])
})

test('modelLabelOf: catalog display name with default effort suffix', () => {
  const label = modelLabelOf({ provider: 'provider-a', model: 'model-1' }, catalogOf())
  assert.equal(label, 'Model One High')
})

test('modelLabelOf: explicit reasoningEffort wins over default effort', () => {
  const label = modelLabelOf(
    { provider: 'provider-a', model: 'model-1', reasoningEffort: 'low' },
    catalogOf(),
  )
  assert.equal(label, 'Model One Low')
})

test('modelLabelOf: reasoning model without default effort labels Default', () => {
  const catalog = catalogOf()
  catalog.groups[0].models.push({
    id: 'model-2',
    name: 'Model Two',
    reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  })
  const label = modelLabelOf({ provider: 'provider-a', model: 'model-2' }, catalog)
  assert.equal(label, 'Model Two Default')
})

test('modelLabelOf: reasoning model without default effort honors explicit effort', () => {
  const catalog = catalogOf()
  catalog.groups[0].models.push({
    id: 'model-2',
    name: 'Model Two',
    reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  })
  const label = modelLabelOf(
    { provider: 'provider-a', model: 'model-2', reasoningEffort: 'high' },
    catalog,
  )
  assert.equal(label, 'Model Two High')
})

test('modelLabelOf: non-reasoning model has no effort suffix', () => {
  const catalog = catalogOf()
  catalog.groups[0].models.push({ id: 'model-3', name: 'Model Three' })
  const label = modelLabelOf({ provider: 'provider-a', model: 'model-3' }, catalog)
  assert.equal(label, 'Model Three')
})

test('modelLabelOf: unknown route falls back to raw ids (advisory catalog)', () => {
  const label = modelLabelOf({ provider: 'provider-x', model: 'model-9' }, catalogOf())
  assert.equal(label, 'model-9')
})
