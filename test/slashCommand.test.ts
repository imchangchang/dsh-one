import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeSlashCommand } from '../src/pure/slashCommand.ts'

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
