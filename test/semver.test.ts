import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, compare, gte, gt, maxSatisfying } from '../src/pure/semver.ts'

test('parse basic versions', () => {
  assert.deepEqual(parse('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parse('v0.1.0-rc.7'), {
    major: 0,
    minor: 1,
    patch: 0,
    prerelease: ['rc', 7],
  })
  assert.equal(parse('1.2'), null)
  assert.equal(parse('not-a-version'), null)
  assert.equal(parse('1.2.3-'), null)
})

test('compare releases', () => {
  assert.ok(compare('1.2.3', '1.2.3') === 0)
  assert.ok(compare('1.2.4', '1.2.3') > 0)
  assert.ok(compare('1.10.0', '1.9.9') > 0)
  assert.ok(compare('2.0.0', '10.0.0') < 0)
})

test('prerelease ordering', () => {
  // release > prerelease
  assert.ok(compare('0.1.0', '0.1.0-rc.7') > 0)
  // numeric identifiers compare numerically
  assert.ok(compare('0.1.0-rc.10', '0.1.0-rc.7') > 0)
  // numeric < alphanumeric
  assert.ok(compare('0.1.0-1', '0.1.0-alpha') < 0)
  // alpha < alpha.1 < alpha.beta < beta < beta.2 < beta.11 < rc.1 (semver spec example)
  assert.ok(compare('1.0.0-alpha', '1.0.0-alpha.1') < 0)
  assert.ok(compare('1.0.0-alpha.1', '1.0.0-alpha.beta') < 0)
  assert.ok(compare('1.0.0-alpha.beta', '1.0.0-beta') < 0)
  assert.ok(compare('1.0.0-beta', '1.0.0-beta.2') < 0)
  assert.ok(compare('1.0.0-beta.2', '1.0.0-beta.11') < 0)
  assert.ok(compare('1.0.0-beta.11', '1.0.0-rc.1') < 0)
  // patch bump beats prerelease of higher tag
  assert.ok(compare('0.1.1-rc.2', '0.1.0-rc.7') > 0)
})

test('gte / gt for the --no-open version gate', () => {
  assert.ok(gte('0.1.0-rc.7', '0.1.0-rc.7'))
  assert.ok(gte('0.1.1-rc.2', '0.1.0-rc.7'))
  assert.ok(!gte('0.1.0-rc.6', '0.1.0-rc.7'))
  assert.ok(gte('0.1.0', '0.1.0-rc.7'))
  assert.ok(gt('0.1.1-rc.2', '0.1.1-rc.1'))
  assert.ok(!gt('0.1.1-rc.2', '0.1.1-rc.2'))
})

test('maxSatisfying picks the newest, ignoring invalid entries', () => {
  assert.equal(maxSatisfying(['0.1.0-rc.7', '0.1.1-rc.2', '0.1.1-rc.1']), '0.1.1-rc.2')
  assert.equal(maxSatisfying(['0.1.0-rc.7', 'garbage', '0.1.0-rc.10']), '0.1.0-rc.10')
  assert.equal(maxSatisfying([]), null)
})

test('compare throws on invalid input', () => {
  assert.throws(() => compare('nope', '1.2.3'))
})
