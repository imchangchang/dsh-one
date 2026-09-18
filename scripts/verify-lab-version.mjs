#!/usr/bin/env node
/**
 * 浏览器验证（装配实验室）跑在**指定版本的 dsh** 上——上游发版时接新版本的第一步门禁。
 *
 * ## 为什么需要它（#191）
 *
 * 实验室连的 `dsh` 是 `PATH` 上那一个（`test/assembly-lab/labGateway.ts` 直接 spawn `dsh`），
 * 所以它验的一直是**本机已装**的那一版。于是「上游发新版 → 装配页整棵起不来」这种事在
 * 本机永远看不见：0.1.6-alpha.2 就是靠着这一条整页白（`renderSlot('root') before any
 * 'root' registration`），而探针那一套查的是「名字还在不在」——它读字节，不跑页面，
 * 查不出「装起来崩不崩」。本脚本把「装一份候选版本到临时目录 + 用它跑实验室」合成一条
 * 命令，让「接新版本」这一步有一步必跑的、能判死的动作。
 *
 * ## 它证明什么、不证明什么
 *
 * 证明：**这一版 dsh 上四棵装配树装得起来**（F-01 CONTRACT：零槽位崩溃、零装载未激活、
 * 预期槽位有内容、frame 插件真的执行）。不证明：宿主层（CSP / 剪贴板 / 原生菜单）——
 * 那是 VS Code 验证的事；也不证明探针那一面。
 *
 * ## 用法
 *
 *   node scripts/verify-lab-version.mjs 0.1.6-alpha.2
 *   node scripts/verify-lab-version.mjs 0.1.6-alpha.2 --suite F-01,F-10,F-11
 *   node scripts/verify-lab-version.mjs next          # 按 npm 标签
 *
 * 候选版本装在临时目录里（跑完删掉，**不动本机的 dsh 安装**）；实验室照默认跑法起
 * 自己的隔离实例（独立 `DSH_HOME` + 随机端口 + 跑完按 PID 收），用户的 `~/.dsh` 与
 * 日常那台实例都不碰。
 *
 * 退出码 = 实验室的退出码（0 全过 / 1 有断言失败 / 2 起不来）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const NPM_PKG = '@deepseek-ai/dsh'

function usage() {
  process.stderr.write(
    [
      '用法: node scripts/verify-lab-version.mjs <version|tag> [--suite F-01,F-10]',
      '',
      '  <version>        要验的 dsh 版本（如 0.1.6-alpha.2）或 npm 标签（如 next）',
      '  --suite <ids>    只跑指定套件（缺省 F-01：底座契约完备性——「装不装得起来」那一面）',
      '  --keep           跑完留下候选版本那份安装（排查用；路径会打印出来）',
      '',
    ].join('\n'),
  )
}

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  usage()
  process.exit(argv.length === 0 ? 2 : 0)
}
const version = argv[0]
const valueOf = (name) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}
const suites = valueOf('suite') ?? 'F-01'
const keep = argv.includes('--keep')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-version-'))
const cleanup = () => {
  if (keep) {
    process.stderr.write(`[lab-version] 候选版本留在 ${tmp}\n`)
    return
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

let resolved
try {
  process.stderr.write(`[lab-version] 装 ${NPM_PKG}@${version} 到 ${tmp}\n`)
  execFileSync('npm', ['install', '--prefix', tmp, `${NPM_PKG}@${version}`, '--no-audit', '--no-fund', '--loglevel=error'], {
    stdio: 'inherit',
    timeout: 600_000,
  })
  // 认安装里那一份的版本，而不是我们敲进去的字符串：`next` 这种标签写不出具体版本，
  // 报告与 issue 里要写的是实际验过的那一版。
  const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'node_modules', NPM_PKG, 'package.json'), 'utf8'))
  resolved = String(manifest.version)
  process.stderr.write(`[lab-version] 候选版本 = ${resolved}；跑 verify:lab --suite ${suites}\n`)
  const bin = path.join(tmp, 'node_modules', '.bin')
  const result = spawnSync('npm', ['run', 'verify:lab', '--', '--suite', suites], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
  })
  if (result.error) throw result.error
  process.stderr.write(`[lab-version] dsh ${resolved}：verify:lab 退出码 ${String(result.status ?? 'signal')}\n`)
  cleanup()
  process.exit(result.status ?? 2)
} catch (err) {
  process.stderr.write(`[lab-version] 失败：${err instanceof Error ? err.message : String(err)}\n`)
  cleanup()
  process.exit(2)
}
