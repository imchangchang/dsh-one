/**
 * 「会话被另一个 dsh 进程占着写句柄」的判定（#145）：报文匹配只认官方错误类名，
 * 不认官方拼给用户看的那段前缀（措辞随版本变）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SESSION_ALREADY_OWNED_ERROR_NAME,
  isSessionAlreadyOwnedError,
} from '../src/pure/sessionOwnership.ts'

/** 实测原文（dsh 0.1.6-alpha.1，两条客户端连接的复现回执）。 */
const REAL_MESSAGE =
  'resume failed for session "session-7ea4bc36-b5ac-49b5-bfe8-876e0532ef0e": ' +
  'SessionAlreadyOwnedError: session "session-7ea4bc36-b5ac-49b5-bfe8-876e0532ef0e" ' +
  'is already owned by an active write handle'

test('官方那条 resume 失败的原文认出来', () => {
  assert.equal(isSessionAlreadyOwnedError(REAL_MESSAGE), true)
})

test('类名常量与官方导出的名字一致', () => {
  assert.equal(SESSION_ALREADY_OWNED_ERROR_NAME, 'SessionAlreadyOwnedError')
  assert.ok(REAL_MESSAGE.includes(SESSION_ALREADY_OWNED_ERROR_NAME))
})

test('别的会话错误不误判', () => {
  assert.equal(isSessionAlreadyOwnedError('session "x" not found'), false)
  assert.equal(isSessionAlreadyOwnedError('gateway/internal resume failed for session "x": TypeError: boom'), false)
  // 名字相近的另一条官方错误（同一模块导出）不能串味
  assert.equal(isSessionAlreadyOwnedError('SessionAlreadyExistsError: session "x" already exists'), false)
})

test('非字符串入参一律 false（事件参数来自线上，形状不可信）', () => {
  for (const value of [undefined, null, 42, {}, [], true]) {
    assert.equal(isSessionAlreadyOwnedError(value), false)
  }
})
