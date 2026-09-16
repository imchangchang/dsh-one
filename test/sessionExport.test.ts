/**
 * 会话导出的纯逻辑（#84）：路径构造、建议文件名、失败提示口径 + 插件 bundle 的两条
 * 静态契约（插件 id 与槽位贡献 id）。
 *
 * 插件文件本身 import 了 react 与官方原语，单测进不来；能纯化的逻辑都放
 * `src/pure/sessionExport.ts`，剩下这几条从源码/产物上核对（仓库既有做法：见
 * assemblyShellContract.test.ts 与 wireFilter.test.ts）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  SESSION_EXPORT_PATH,
  sessionExportFileName,
  sessionExportPath,
  shouldReportExportFailure,
} from '../src/pure/sessionExport.ts'

const ROOT = path.join(import.meta.dirname, '..')
const PLUGIN_SOURCE = path.join(ROOT, 'src', 'ui', 'assembly', 'shell', 'sessionExportPlugin.ts')
const CLIENT_BUNDLE = path.join(ROOT, 'dist', 'assembly', 'plugins', '@dsh-one', 'dsh-session-export', 'client.js')

test('导出走官方既有路由，会话 id 进 URL 前被转义', () => {
  assert.equal(SESSION_EXPORT_PATH, '/api/session.export')
  assert.equal(
    sessionExportPath('a b/c?d'),
    '/api/session.export?sessionId=a%20b%2Fc%3Fd&includeDescendants=true',
  )
})

test('建议文件名去掉不适合做文件名的字符（含路径分隔符）', () => {
  assert.equal(sessionExportFileName('0192ab-cd_ef'), 'dsh-session-0192ab-cd_ef.zip')
  // 点与分隔符都落在白名单外 → 一律换成下划线（连 `..` 都拼不出来）。
  assert.equal(sessionExportFileName('../../etc/passwd'), 'dsh-session-______etc_passwd.zip')
  assert.equal(sessionExportFileName('a b'), 'dsh-session-a_b.zip')
})

test('用户取消失败不弹提示，其余失败要弹', () => {
  assert.equal(shouldReportExportFailure('cancelled'), false)
  for (const code of ['failed', 'unavailable', 'invalid-args', undefined]) {
    assert.equal(shouldReportExportFailure(code), true, `${String(code)} 应提示`)
  }
})

test('插件 id 与槽位贡献 id 已按命名铁律改名（dsh-*）', () => {
  const source = fs.readFileSync(PLUGIN_SOURCE, 'utf8')
  assert.match(source, /@dsh-one\/dsh-session-export/, '插件自述与 CSS 标记要用新 id')
  assert.match(source, /id: 'session-log-download-dsh'/, '槽位贡献 id 要跟着改')
  assert.doesNotMatch(source, /@dsh-one\/vscode-session-export/, '不许残留旧 id')
  // 可移植的判据：插件自己不再碰 VS Code 通道（能力口在两侧各配一个实现）。
  assert.doesNotMatch(source, /acquireVsCodeApi/, '插件不得直接碰 VS Code API')
  assert.doesNotMatch(source, /dshOne\.hostCall/, '插件不得直接走宿主调用通道')
  assert.doesNotMatch(source, /postMessage\(/, '插件不得直接 postMessage')
})

test('客户端 bundle 里只经能力口调宿主（dist 未构建时跳过）', (t) => {
  // dist/ 是构建产物且不进版本库：没构建过就跳过，别把「没跑 build」误报成功能坏了。
  if (!fs.existsSync(CLIENT_BUNDLE)) {
    t.skip('dist 未构建（npm run build 后本断言生效）')
    return
  }
  const bundle = fs.readFileSync(CLIENT_BUNDLE, 'utf8')
  // bundle 里只该经能力口调宿主：VS Code 桥的调用名与网关端点名都在，且没有裸
  // postMessage 到旧的自定义消息类型。
  assert.ok(bundle.includes('file.download'), 'bundle 应经能力口调宿主下载')
  assert.ok(bundle.includes('dshOneHostCapabilities'), 'bundle 应带官方侧端点名（网关 RPC 分支）')
  assert.ok(!bundle.includes('dshOne.exportSessionLog'), '旧的自定义导出消息类型必须删干净')
})
