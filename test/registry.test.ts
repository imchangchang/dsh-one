import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickVersion } from '../src/pure/registry.ts'

const packument = {
  'dist-tags': { latest: '0.1.0' },
  versions: {
    '0.1.0-rc.6': {},
    '0.1.0-rc.7': {},
    '0.1.0': {},
    '0.1.1-rc.1': {},
    '0.1.1-rc.2': {},
  },
}

test('stable channel uses dist-tags.latest', () => {
  assert.equal(pickVersion(packument, { channel: 'stable' }), '0.1.0')
})

test('rc channel picks the highest version including prereleases', () => {
  assert.equal(pickVersion(packument, { channel: 'rc' }), '0.1.1-rc.2')
})

test('pinned version wins over channel', () => {
  assert.equal(pickVersion(packument, { channel: 'rc', pinnedVersion: '0.1.0-rc.7' }), '0.1.0-rc.7')
  assert.equal(
    pickVersion(packument, { channel: 'stable', pinnedVersion: ' 0.1.1-rc.1 ' }),
    '0.1.1-rc.1',
  )
})

test('unknown pinned version throws', () => {
  assert.throws(() => pickVersion(packument, { channel: 'rc', pinnedVersion: '9.9.9' }))
})

test('rc channel without versions throws', () => {
  assert.throws(() => pickVersion({ 'dist-tags': { latest: '1.0.0' } }, { channel: 'rc' }))
})

test('stable channel without dist-tags throws', () => {
  assert.throws(() => pickVersion({ versions: { '1.0.0': {} } }, { channel: 'stable' }))
})
