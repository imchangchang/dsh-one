import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isDshCommandLine,
  parseLsofPids,
  parseNetstatPids,
  parseProcTcpListeners,
  socketInodeFromFdLink,
} from '../src/server/externalDsh.ts'

test('parseLsofPids: 只取纯数字行（lsof -ti 输出）', () => {
  assert.deepEqual(parseLsofPids('33411\n'), [33411])
  assert.deepEqual(parseLsofPids('33411\n33412\n'), [33411, 33412])
  assert.deepEqual(parseLsofPids(''), [])
  assert.deepEqual(parseLsofPids('\n\n'), [])
  // 非数字行（其他 lsof 输出形态/错误文本）不取
  assert.deepEqual(parseLsofPids('COMMAND PID USER\n33411\n'), [33411])
})

test('parseNetstatPids: 匹配端口的 TCP LISTENING 行 → pid（Windows netstat -ano）', () => {
  const sample = [
    '  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       33411',
    '  TCP    127.0.0.1:3081         0.0.0.0:0              LISTENING       999',
    '  TCP    [::]:3080              [::]:0                 LISTENING       33411',
    '  UDP    0.0.0.0:3080         0.0.0.0:0              *',
  ].join('\r\n')
  assert.deepEqual(parseNetstatPids(sample, 3080), [33411, 33411])
  assert.deepEqual(parseNetstatPids(sample, 3081), [999])
  assert.deepEqual(parseNetstatPids(sample, 9999), [])
})

test('parseProcTcpListeners: 只取 state 0A（LISTEN）行，端口十六进制解析', () => {
  // 字段: sl local_address rem_address st tx:rx tr:tm->when retrnmt uid timeout inode ...
  const sample = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:0C08 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 52341 1',
    '   1: 0100007F:0C08 00000000:0000 01 00000000:00000000 00:00000000 00000000     0        0 52342 1', // ESTABLISHED，忽略
    '   2: 0100007F:0C09 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 52343 1',
  ].join('\n')
  const rows = parseProcTcpListeners(sample)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].port, 0x0c08) // 3080
  assert.equal(rows[0].inode, '52341')
  assert.equal(rows[1].port, 0x0c09) // 3081
})

test('socketInodeFromFdLink: socket:[N] → inode，非 socket 链接 → null', () => {
  assert.equal(socketInodeFromFdLink('socket:[52341]'), '52341')
  assert.equal(socketInodeFromFdLink('/Users/x/file.txt'), null)
  assert.equal(socketInodeFromFdLink('pipe:[123]'), null)
})

test('isDshCommandLine: 识别 npm 全局安装与本地 checkout 的 dsh 命令行', () => {
  // npm 全局（ps 显示 node + 真实路径，含 @deepseek-ai/dsh）
  assert.equal(
    isDshCommandLine('node /Users/u/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 3080'),
    true,
  )
  // 本地 checkout（bin.dsh 路径段）
  assert.equal(isDshCommandLine('node /Users/u/dev/dsh/lib/bin.js web --port 3099'), true)
  // 直接执行 dsh（shebang 形态）
  assert.equal(isDshCommandLine('/usr/local/bin/dsh web --port 3080'), true)
  // Windows：npm 全局 .cmd 走 node 的真实路径
  assert.equal(
    isDshCommandLine('node "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --host 127.0.0.1 --port 3080'),
    true,
  )
  // 拒绝：无关 node 服务 / 其他程序
  assert.equal(isDshCommandLine('node /Users/u/dev/myserver/index.js --port 3080'), false)
  assert.equal(isDshCommandLine('python3 -m http.server 3080'), false)
  // 路径里恰好含 "dsh" 的无关程序（不匹配独立 path 段或包路径）
  assert.equal(isDshCommandLine('node /Users/u/Desktop/dsh-backup/app.js'), false)
})
