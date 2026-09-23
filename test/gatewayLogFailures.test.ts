/**
 * 隔离实例网关失败诊断（#231）的单测。
 *
 * 判据是**「真正的异常一定看得见」**。原来 `labGateway` 报错时只取输出末尾 5~6 行、拼成
 * 一行 ` | ` 分隔的短尾巴（窗口还只有 8 KB），而网关崩退的实际形状是：报错头一行、后面
 * 跟着一串 `at …` 栈帧、一个空行、`Node.js v24.x`——**末 6 行里恰好没有那句报错**。
 * 下面第一组断言就用 #231 复现出来的那一份真实输出当夹具（1290 字节，见报告），把这件事
 * 钉成可执行判据；第二组覆盖「异常之后还有一大段输出」这一档（8 KB 窗口会把它挤出去）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { scratchDirSync } from './scratchDirs.ts'
import {
  GATEWAY_OUTPUT_WINDOW_CHARS,
  appendGatewayOutput,
  defaultFailureLogPath,
  extractErrorLines,
  gatewayFailureDetail,
  writeGatewayOutput,
} from './assembly-lab/gatewayLog.ts'

const CRASH_HEADER =
  "SyntaxError: The requested module '@deepseek-ai/dsh-app-boot' does not provide an export named 'watchUserPatches'"

/** 正常启动日志那种形状（不命中任何错误签名）。 */
function noise(roughChars: number): string {
  const lines: string[] = []
  let size = 0
  let index = 0
  while (size < roughChars) {
    const line = `[dsh] boot: plugin #${String(index)} loaded`
    lines.push(line)
    size += line.length + 1
    index += 1
  }
  return lines.join('\n')
}

/**
 * 混装候选树上 `dsh web` 崩退的真实输出（#231 复现，路径缩短了）——**报错头在末 6 行之外**
 * 就是现场「真报错被截掉」的成因。
 */
function crashLog(prefix = '', suffix = ''): string {
  const body = [
    'file:///tmp/dsh-mixed-tree/node_modules/@deepseek-ai/dsh/lib/profile-boot-CuwbWsnH.js:3',
    'import { PROFILE_PATCH_FILENAME, PROFILE_TEMPLATES, PluginPackages, boot, composeEntries, watchUserPatches } from "@deepseek-ai/dsh-app-boot";',
    '                                                                                                                       ^^^^^^^^^^^^^^^^',
    CRASH_HEADER,
    '    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)',
    '    at async ModuleJob.run (node:internal/modules/esm/module_job:553:5)',
    '    at async node:internal/modules/esm/loader:647:26',
    '    at async runCli (file:///tmp/dsh-mixed-tree/node_modules/@deepseek-ai/dsh/lib/bin.js:145:27)',
    '    at async file:///tmp/dsh-mixed-tree/node_modules/@deepseek-ai/dsh/lib/bin.js:168:23',
    '',
    'Node.js v24.21.0',
  ].join('\n')
  return `${prefix}${prefix === '' ? '' : '\n'}${body}\n${suffix}`
}

test('真报错落在「末 6 行」之外：老写法的读数里没有它，新做法按签名筛得出来', () => {
  const log = crashLog()
  // `labGateway` 原来的写法：`输出.trim().split('\n').slice(-6).join(' | ')`。
  const oldView = log.trim().split('\n').slice(-6).join(' | ')
  assert.equal(oldView.includes('does not provide an export named'), false, '这就是 #231 的现场')
  assert.ok(oldView.includes('Node.js v24.21.0'), '老读法给出来的是栈帧尾巴 + Node 版本行')

  const errors = extractErrorLines(log)
  assert.ok(errors.some((line) => line.includes("does not provide an export named 'watchUserPatches'")))
  assert.ok(errors.some((line) => line.includes('at #asyncInstantiate')), '报错后面那几行栈帧是上下文，一起带出来')
})

test('异常之后还有一大段输出时，8 KB 窗口也装不下它（窗口放大到 512 KB 的意义）', () => {
  const log = crashLog(noise(40_000), noise(20_000))
  assert.ok(log.length > 60_000)
  assert.equal(log.slice(-8_000).includes('watchUserPatches'), false, '异常之后又打了一大段输出，8 KB 尾巴里就没有它了')

  const kept = appendGatewayOutput('', log)
  assert.ok(kept.includes('watchUserPatches'), '放大后的窗口装得下它')
  assert.ok(extractErrorLines(kept).some((line) => line.includes('watchUserPatches')))
  assert.ok(GATEWAY_OUTPUT_WINDOW_CHARS > 8_000 * 10)
})

test('滚动窗口：只留最后一段，超出的旧输出被丢掉', () => {
  const kept = appendGatewayOutput('', 'a'.repeat(3_000), 1_000)
  assert.equal(kept.length, 1_000)
  assert.equal(kept, 'a'.repeat(1_000))
  assert.equal(appendGatewayOutput('keep', 'more'), 'keepmore')
})

test('失败说明：异常在前、末尾在后、完整输出路径垫底', () => {
  const detail = gatewayFailureDetail(crashLog(), { logPath: '/tmp/dsh-lab-gateway-1234.log' })
  assert.ok(detail.indexOf('真正的异常') < detail.indexOf('输出末尾'))
  assert.ok(detail.includes("does not provide an export named 'watchUserPatches'"))
  assert.ok(detail.includes('完整输出：/tmp/dsh-lab-gateway-1234.log'))
  assert.equal(gatewayFailureDetail('   \n  ', { logPath: '/tmp/x.log' }), '网关没有任何输出。')
  assert.match(gatewayFailureDetail('only a normal line\n', { logPath: '/tmp/x.log' }), /筛不出错误签名/)
})

test('落盘：完整输出写得下、路径可读回', () => {
  const dir = scratchDirSync('dsh-lab-version-')
  const target = path.join(dir, 'gateway-failure.log')
  assert.equal(writeGatewayOutput(crashLog(), target), target)
  assert.ok(fs.readFileSync(target, 'utf8').includes('watchUserPatches'))
  assert.match(defaultFailureLogPath(1234), /dsh-lab-gateway-1234\.log$/)
  assert.equal(writeGatewayOutput('x', path.join(dir, 'no-such-dir', 'x.log')), undefined, '写不进去时返回 undefined，不抛')
})
