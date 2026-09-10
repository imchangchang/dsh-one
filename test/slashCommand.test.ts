import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asSkillList,
  claimableSlashCommand,
  slashClaimHolds,
  slashClaimToken,
  asSkillSpec,
  asSlashCommandSpec,
  fuzzyCandidates,
  fuzzyScore,
  HOST_SLASH_COMMAND_NAMES,
  isHostSlashCommand,
  looksLikeSlashCommand,
  slashCommandName,
} from '../src/pure/slashCommand.ts'

test('pure commands look like commands', () => {
  assert.equal(looksLikeSlashCommand('/stop'), true)
  assert.equal(looksLikeSlashCommand('/new'), true)
  assert.equal(looksLikeSlashCommand('/permission always'), true)
  assert.equal(looksLikeSlashCommand('/'), true)
})

test('command typos still route to the unknown-command reply', () => {
  assert.equal(looksLikeSlashCommand('/permisison'), true)
  assert.equal(looksLikeSlashCommand('/stpo'), true)
})

test('absolute paths are prompts, not commands', () => {
  assert.equal(looksLikeSlashCommand('/Users/cgeng/Downloads/xxx.svg'), false)
  assert.equal(looksLikeSlashCommand('/etc/hosts'), false)
})

test('path followed by a Chinese question is a prompt', () => {
  assert.equal(looksLikeSlashCommand('/Users/cgeng/Downloads/xxx.svg 这张图帮我改一下'), false)
})

test('leading whitespace is ignored', () => {
  assert.equal(looksLikeSlashCommand('  /stop'), true)
  assert.equal(looksLikeSlashCommand('\t/Users/a/b'), false)
  assert.equal(looksLikeSlashCommand('   '), false)
})

test('non-slash text and empty input are prompts', () => {
  assert.equal(looksLikeSlashCommand('hello'), false)
  assert.equal(looksLikeSlashCommand(''), false)
})

test('multi-line input routes on the first token', () => {
  assert.equal(looksLikeSlashCommand('/stop\n第二行'), true)
  assert.equal(looksLikeSlashCommand('/Users/a/b\n第二行'), false)
})

test('slashCommandName extracts the first token', () => {
  assert.equal(slashCommandName('/goal'), 'goal')
  assert.equal(slashCommandName('/goal 处理当前版本发现问题'), 'goal')
  assert.equal(slashCommandName('  /permission read-only'), 'permission')
  assert.equal(slashCommandName('/'), undefined)
  assert.equal(slashCommandName('/Users/a/b'), undefined)
  assert.equal(slashCommandName('hello'), undefined)
  assert.equal(slashCommandName(''), undefined)
})

test('host built-in set covers the panel-mirrored six, not the client-only /model', () => {
  assert.deepEqual([...HOST_SLASH_COMMAND_NAMES].sort(), [
    'compact',
    'export',
    'feedback',
    'goal',
    'permission',
    'plan',
  ])
  assert.equal(isHostSlashCommand('goal'), true)
  assert.equal(isHostSlashCommand('compact'), true)
  assert.equal(isHostSlashCommand('model'), false)
  assert.equal(isHostSlashCommand('schedule'), false)
  assert.equal(isHostSlashCommand(''), false)
})

test('asSlashCommandSpec narrows the commands/list wire shape', () => {
  assert.deepEqual(asSlashCommandSpec({ name: 'goal', description: 'set or view the goal', input: { hint: '<objective>', images: true } }), {
    name: 'goal',
    description: 'set or view the goal',
    hint: '<objective>',
  })
  assert.deepEqual(asSlashCommandSpec({ name: 'compact', description: 'compact history' }), {
    name: 'compact',
    description: 'compact history',
  })
})

test('asSlashCommandSpec drops malformed entries instead of poisoning the roster', () => {
  assert.equal(asSlashCommandSpec({ name: 'goal' }), undefined)
  assert.equal(asSlashCommandSpec({ description: 'no name' }), undefined)
  assert.equal(asSlashCommandSpec(null), undefined)
  assert.equal(asSlashCommandSpec('goal'), undefined)
  assert.equal(asSlashCommandSpec({ name: 1, description: 'x' }), undefined)
  // input.hint 非字符串不致死：按无 hint 处理。
  assert.deepEqual(asSlashCommandSpec({ name: 'goal', description: 'x', input: { hint: 3 } }), {
    name: 'goal',
    description: 'x',
  })
})

test('fuzzyScore accepts ordered subsequences and rejects the rest', () => {
  assert.equal(fuzzyScore('compact', '') !== undefined, true)
  assert.equal(fuzzyScore('compact', 'comp') !== undefined, true)
  // 子序列：跳字命中
  assert.equal(fuzzyScore('permission', 'pm') !== undefined, true)
  // 顺序不可颠倒 / 字符不在名里 / query 更长：不匹配
  assert.equal(fuzzyScore('plan', 'nalp'), undefined)
  assert.equal(fuzzyScore('plan', 'planx'), undefined)
  assert.equal(fuzzyScore('plan', 'z'), undefined)
})

test('fuzzyCandidates ranks prefix hits first, then by score, keeping ties stable', () => {
  const names = [{ name: 'permission' }, { name: 'plan' }, { name: 'compact' }]
  // 空前缀=原序
  assert.deepEqual(fuzzyCandidates(names, '').map((c) => c.name), ['permission', 'plan', 'compact'])
  // 前缀命中优于子序列命中：'p' 下 permission/plan 都是前缀，compact 不是 → 沉底
  assert.deepEqual(fuzzyCandidates(names, 'p').map((c) => c.name), ['permission', 'plan', 'compact'])
  assert.deepEqual(fuzzyCandidates(names, 'plan').map((c) => c.name), ['plan'])
  // 大小写不敏感
  assert.deepEqual(fuzzyCandidates(names, 'CO').map((c) => c.name), ['compact'])
})

test('asSkillSpec narrows the skills/list entry, defaulting modelInvocable to true', () => {
  assert.deepEqual(asSkillSpec({ name: 'foo', description: 'd', modelInvocable: false }), {
    name: 'foo',
    description: 'd',
    modelInvocable: false,
  })
  assert.deepEqual(asSkillSpec({ name: 'foo', description: 'd' }), {
    name: 'foo',
    description: 'd',
    modelInvocable: true,
  })
  assert.equal(asSkillSpec({ name: 3, description: 'd' }), undefined)
  assert.equal(asSkillSpec(null), undefined)
})

test('asSkillList tolerates both the bare {skills} value and an {ok,value} envelope', () => {
  const entries = [{ name: 'a', description: 'x', modelInvocable: true }, { name: 'b', description: 'y' }]
  assert.equal(asSkillList({ skills: entries }).length, 2)
  assert.equal(asSkillList({ ok: true, value: { skills: entries } }).length, 2)
  assert.deepEqual(asSkillList({ ok: false }), [])
  assert.deepEqual(asSkillList(undefined), [])
  assert.deepEqual(asSkillList({ skills: 'nope' }), [])
})

test('slashClaimToken carries the trailing space the claimed draft must start with', () => {
  assert.equal(slashClaimToken('goal'), '/goal ')
  assert.equal(slashClaimHolds('/goal ', slashClaimToken('goal')), true)
  assert.equal(slashClaimHolds('/goal 打补丁', slashClaimToken('goal')), true)
  assert.equal(slashClaimHolds('/goal', slashClaimToken('goal')), false)
  assert.equal(slashClaimHolds('/goals ', slashClaimToken('goal')), false)
  assert.equal(slashClaimHolds('', slashClaimToken('goal')), false)
})

test('claimableSlashCommand admits only arg-taking commands', () => {
  assert.equal(claimableSlashCommand({ name: 'goal', description: 'd', hint: '[<objective>|clear]' }), true)
  assert.equal(claimableSlashCommand({ name: 'compact', description: 'd' }), false)
  assert.equal(claimableSlashCommand({ name: 'compact', description: 'd', hint: '' }), false)
  assert.equal(claimableSlashCommand(undefined), false)
})
