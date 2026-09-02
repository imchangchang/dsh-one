import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contextMenuResource, isChatPanelTabArg } from '../src/pure/contextResource.ts'

test('contextMenuResource：explorer/context 直接传 Uri（带 scheme）', () => {
  const uri = { fsPath: '/a/b.ts', scheme: 'file', authority: '', path: '/a/b.ts' }
  assert.deepEqual(contextMenuResource(uri), { fsPath: '/a/b.ts', scheme: 'file' })
})

test('contextMenuResource：editor/context 的 { resourceUri } args 对象', () => {
  const args = { resourceUri: { fsPath: '/a/b.ts', scheme: 'file' }, other: 1 }
  assert.deepEqual(contextMenuResource(args), { fsPath: '/a/b.ts', scheme: 'file' })
})

test('contextMenuResource：{ uri } 形状与裸 { fsPath } 兜底', () => {
  assert.deepEqual(contextMenuResource({ uri: { fsPath: '/a/b.ts', scheme: 'file' } }), {
    fsPath: '/a/b.ts',
    scheme: 'file',
  })
  assert.deepEqual(contextMenuResource({ fsPath: '/a/b.ts' }), { fsPath: '/a/b.ts', scheme: undefined })
})

test('contextMenuResource：非文件 scheme 原样透出，由调用方拒绝', () => {
  const link = { fsPath: '/a/b.ts', scheme: 'https' }
  assert.deepEqual(contextMenuResource(link), { fsPath: '/a/b.ts', scheme: 'https' })
})

test('contextMenuResource：无效输入返回 undefined', () => {
  assert.equal(contextMenuResource(undefined), undefined)
  assert.equal(contextMenuResource(null), undefined)
  assert.equal(contextMenuResource(42), undefined)
  assert.equal(contextMenuResource('string'), undefined)
  assert.equal(contextMenuResource({}), undefined)
  assert.equal(contextMenuResource({ resourceUri: { scheme: 'file' } }), undefined) // 缺 fsPath
  assert.equal(contextMenuResource({ resourceUri: 42 }), undefined)
})

test('isChatPanelTabArg：chat 面板 tab 的资源 URI（path 或 fsPath 形状）', () => {
  assert.equal(
    isChatPanelTabArg({
      scheme: 'webview-panel',
      path: 'webview-panel/webview-dshOne.chatPanel-abc123',
    }),
    true,
  )
  // 反序列化后的 Uri 通常带 fsPath；两者都认，path 优先。
  assert.equal(
    isChatPanelTabArg({
      scheme: 'webview-panel',
      fsPath: 'webview-panel/webview-dshOne.chatPanel-def456',
    }),
    true,
  )
})

test('isChatPanelTabArg：其他 webview / 文件 / 垃圾输入为 false', () => {
  // 其他 viewType 的 webview tab（如内置浏览器、markdown 预览）。
  assert.equal(
    isChatPanelTabArg({ scheme: 'webview-panel', path: 'webview-panel/webview-simpleBrowser-x' }),
    false,
  )
  assert.equal(isChatPanelTabArg({ scheme: 'file', fsPath: '/a/b.ts' }), false)
  assert.equal(isChatPanelTabArg(undefined), false)
  assert.equal(isChatPanelTabArg('dsh-session:abc'), false)
  assert.equal(isChatPanelTabArg({}), false)
  // chat 面板前缀但不带 path/fsPath（缺反序列化字段）。
  assert.equal(isChatPanelTabArg({ scheme: 'webview-panel' }), false)
})
