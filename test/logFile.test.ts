/**
 * 日志文件 sink 的单测（#169）：它要在「写不进去」时也绝不打扰扩展——日志是取证
 * 手段，不能自己变成故障源；另外轮转与追加语义钉住，免得重启后把上一次的记录盖掉
 * （那正好是出问题时要看的那一段）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LogFile } from '../src/pure/logFile.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-one-log-'))
}

test('追加写：行末自带换行，重新构造同一个文件时接着写不覆盖', () => {
  const file = path.join(tempDir(), 'logs', 'dsh-one-123.log')
  const first = new LogFile({ filePath: file })
  first.append('line one')
  assert.equal(first.path, file)

  // 同一个窗口重建 sink（例如 logger 重建）：老内容必须留着
  const second = new LogFile({ filePath: file })
  second.append('line two')
  assert.equal(fs.readFileSync(file, 'utf8'), 'line one\nline two\n')
})

test('超过上限就轮转到 .1，只留一份上一版（恢复现场要的是最近那段）', () => {
  const file = path.join(tempDir(), 'dsh-one-456.log')
  const sink = new LogFile({ filePath: file, maxBytes: 20 })
  sink.append('aaaaaaaaaa') // 11 字节
  sink.append('bbbbbbbbbb') // 再加 11 字节，越过 20 -> 轮转后再写
  assert.equal(fs.readFileSync(file, 'utf8'), 'bbbbbbbbbb\n')
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'aaaaaaaaaa\n')
})

test('目录建不出来时不抛异常、也不写（日志不能拖垮扩展激活）', () => {
  const dir = tempDir()
  // 拿一个普通文件当目录用：mkdirSync 必然失败
  const blocker = path.join(dir, 'not-a-dir')
  fs.writeFileSync(blocker, 'x')
  const sink = new LogFile({ filePath: path.join(blocker, 'dsh-one-789.log') })
  assert.doesNotThrow(() => sink.append('should go nowhere'))
  assert.equal(fs.readdirSync(dir).length, 1)
})
