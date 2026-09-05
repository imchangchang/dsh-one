import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissionDisplayName, permissionOptionLabel } from '../src/pure/permissionLabel.ts'

/** zh 译文表（与 l10n/bundle.l10n.zh-cn.json 的权限三段一致，就近抽样验证选择逻辑）。 */
const zh: Record<string, string> = {
  'Read Only': '仅可查看',
  'Workspace Write': '工作区内修改',
  'Full access': '完全权限',
}
const zhT = (key: string): string => zh[key] ?? key

test('permissionDisplayName: kebab-case → Title Case, non-kebab passes through', () => {
  assert.equal(permissionDisplayName('workspace-write'), 'Workspace Write')
  assert.equal(permissionDisplayName('read-only'), 'Read Only')
  assert.equal(permissionDisplayName('danger-full-access'), 'Danger Full Access')
  assert.equal(permissionDisplayName('工作区内修改'), '工作区内修改')
  assert.equal(permissionDisplayName('Custom Preset'), 'Custom Preset')
})

test('permissionOptionLabel: built-in preset with machine name uses the locale product label', () => {
  assert.equal(permissionOptionLabel('workspace-write', 'workspace-write', zhT), '工作区内修改')
  assert.equal(permissionOptionLabel('read-only', 'read-only', zhT), '仅可查看')
  assert.equal(permissionOptionLabel('danger-full-access', 'danger-full-access', zhT), '完全权限')
})

test('permissionOptionLabel: built-in preset with the English product label also localizes', () => {
  // 与官方 displayPermissionPreset 同判定：name 是机器名或英文 product label 都命中。
  assert.equal(permissionOptionLabel('workspace-write', 'Workspace Write', zhT), '工作区内修改')
  assert.equal(permissionOptionLabel('danger-full-access', 'Full access', zhT), '完全权限')
})

test('permissionOptionLabel: identity t() (English UI) yields the English product label', () => {
  assert.equal(permissionOptionLabel('workspace-write', 'workspace-write', (s) => s), 'Workspace Write')
  assert.equal(permissionOptionLabel('read-only', 'read-only', (s) => s), 'Read Only')
  assert.equal(permissionOptionLabel('danger-full-access', 'danger-full-access', (s) => s), 'Full access')
})

test('permissionOptionLabel: unknown preset falls back to the machine-name transform', () => {
  // 未加映射的 value：roster 原文（kebab）Title Case 透传，不走 product label。
  assert.equal(permissionOptionLabel('custom-mode', 'custom-mode', zhT), 'Custom Mode')
  assert.equal(permissionOptionLabel('custom-mode', 'Custom Mode', zhT), 'Custom Mode')
})

test('permissionOptionLabel: localized host name passes through untouched', () => {
  // 服务端未来若直接发本地化 name（非 kebab 非英文 product label），不改写。
  assert.equal(permissionOptionLabel('whatever', '工作区内修改', zhT), '工作区内修改')
})
