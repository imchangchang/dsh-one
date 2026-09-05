import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
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
