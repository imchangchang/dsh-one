import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelWindowRecord, parseModelWindowRecord } from '../src/pure/modelWindowCache.ts'

test('modelWindowRecord / parseModelWindowRecord：往返一致', () => {
  const map = new Map<string, number>([
    ['deepseek/deepseek-v4-flash', 1_000_000],
    ['kimi/kimi-k2', 256_000],
  ])
  const record = modelWindowRecord(map)
  assert.deepEqual(record, { 'deepseek/deepseek-v4-flash': 1_000_000, 'kimi/kimi-k2': 256_000 })
  assert.deepEqual([...parseModelWindowRecord(record)], [...map])
  // 空映射序列化/解析也稳定（首次启动 globalState 无记录时）。
  assert.deepEqual(parseModelWindowRecord(modelWindowRecord(new Map())), new Map())
})

test('parseModelWindowRecord：畸形条目跳过（不污染学习映射）', () => {
  const parsed = parseModelWindowRecord({ a: 1, bad1: NaN, bad2: Infinity, bad3: 0, bad4: -5, bad5: '1M', bad6: null })
  assert.deepEqual([...parsed], [['a', 1]])
  // 非对象输入按空映射处理：缓存是尽力而为，坏了丢一次学习即可。
  assert.equal(parseModelWindowRecord(null).size, 0)
  assert.equal(parseModelWindowRecord('junk').size, 0)
  assert.equal(parseModelWindowRecord([['a', 1]]).size, 0)
  assert.equal(parseModelWindowRecord(undefined).size, 0)
})
